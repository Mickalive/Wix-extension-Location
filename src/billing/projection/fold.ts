/**
 * Deterministic event-layer fold (BILL-C3-1; Contract §6/§7, §11 C2;
 * Blueprint §4 flow 5).
 *
 * Convergence property: folding a SET of unique envelopes produces the same
 * {@link EventDerivedPlanView} regardless of arrival order. Mechanism:
 *   1. envelopes are sorted by (entityEventSequence, id) — a total order that
 *      does not depend on delivery order (missing/unparseable sequences rank
 *      oldest; among equals the envelope id decides);
 *   2. every transition is idempotent, so duplicated/replayed deliveries of
 *      the same event fold to the same result as a single delivery.
 *
 * Transitions (Contract §7 binding lifecycle):
 * - PAID_PLAN_PURCHASED: writes the plan identifier/name and `isFree:false`
 *   (a purchase means the instance holds a paid/trial plan — trial signups
 *   fire this event), and re-enables renewal (`autoRenewCancelled:false` —
 *   a new subscription supersedes an old cancellation).
 * - PAID_PLAN_AUTO_RENEWAL_CANCELLED: sets `autoRenewCancelled:true` and
 *   NOTHING else — cancelled-until-expiry KEEPS paid identifiers; the event
 *   alone never downgrades (user stays paid until period end).
 * - APP_INSTALLATION_CREATED/UPDATED: merges defensively reported billing
 *   fields (UQ6: exact payload set UNVERIFIED; absent = not reported).
 *
 * Purity: no I/O, no clock, no Wix imports; inputs are never mutated.
 */

import { resolveEntitlement } from '../pure/entitlement';
import type { VendorProductOverrides } from '../pure/entitlement';
import type { AppInstanceBillingSnapshot, EntitlementResolution } from '../types';
import type {
  BillingEventEnvelope,
  EventDerivedPlanView,
  InstallationBillingPayload,
  PaidPlanAutoRenewalCancelledPayload,
  PaidPlanPurchasedPayload,
} from './types';

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'PAID_PLAN_PURCHASED',
  'PAID_PLAN_AUTO_RENEWAL_CANCELLED',
  'APP_INSTALLATION_CREATED',
  'APP_INSTALLATION_UPDATED',
]);

/** A fresh view with nothing reported yet. */
export function emptyPlanView(autoRenewCancelled = false): EventDerivedPlanView {
  return { isFree: null, vendorProductId: null, packageName: null, autoRenewCancelled };
}

/**
 * Seed a view from a reconciled Get App Instance snapshot (reconciliation
 * supremacy): the snapshot's definitely-reported fields become the baseline
 * the following event generation refines. `autoRenewCancelled` is supplied by
 * the caller (it is preserved across reconciliations, not snapshot-derived).
 */
export function seedPlanViewFromSnapshot(
  snapshot: AppInstanceBillingSnapshot | null,
  autoRenewCancelled: boolean,
): EventDerivedPlanView {
  return {
    isFree: typeof snapshot?.isFree === 'boolean' ? snapshot.isFree : null,
    vendorProductId: nonEmptyString(snapshot?.vendorProductId),
    packageName: nonEmptyString(snapshot?.packageName),
    autoRenewCancelled,
  };
}

/**
 * Structural envelope validation (domain-level precondition; the platform
 * pipeline owns transport/signature validation BEFORE calling the projector).
 * Throws TypeError on blank ids, unknown event types or missing payloads —
 * callers must validate before any state mutation.
 */
export function assertValidEnvelope(envelope: BillingEventEnvelope): void {
  if (typeof envelope?.id !== 'string' || envelope.id.trim().length === 0) {
    throw new TypeError('BillingEventEnvelope.id must be a non-empty string (dedup key, Contract §6)');
  }
  if (!EVENT_TYPES.has(envelope.eventType)) {
    throw new TypeError(`Unknown billing eventType: ${String(envelope.eventType)}`);
  }
  if (typeof envelope.payload !== 'object' || envelope.payload === null) {
    throw new TypeError('BillingEventEnvelope.payload must be an object');
  }
}

/** Sort rank: numeric sequence first (missing ⇒ oldest), then envelope id. */
function sortRank(envelope: BillingEventEnvelope): [number, string] {
  const raw = envelope.entityEventSequence;
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw, envelope.id];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return [parsed, envelope.id];
  }
  return [Number.NEGATIVE_INFINITY, envelope.id];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function applyTransition(view: EventDerivedPlanView, envelope: BillingEventEnvelope): void {
  switch (envelope.eventType) {
    case 'PAID_PLAN_PURCHASED': {
      const payload = envelope.payload as PaidPlanPurchasedPayload;
      const vendorProductId = nonEmptyString(payload.vendorProductId);
      if (vendorProductId !== null) view.vendorProductId = vendorProductId;
      const packageName = nonEmptyString(payload.packageName);
      if (packageName !== null) view.packageName = packageName;
      view.isFree = false; // §7: purchase ⇒ holds a paid/trial plan
      view.autoRenewCancelled = false; // new subscription re-enables renewal
      break;
    }
    case 'PAID_PLAN_AUTO_RENEWAL_CANCELLED': {
      // §7: fires immediately; identifiers KEPT; merchant stays paid until
      // period end. The event alone NEVER downgrades anything.
      view.autoRenewCancelled = true;
      break;
    }
    case 'APP_INSTALLATION_CREATED':
    case 'APP_INSTALLATION_UPDATED': {
      mergeInstallation(view, envelope.payload as InstallationBillingPayload);
      break;
    }
  }
}

/** Defensive merge: only definitely-reported fields overwrite known ones. */
function mergeInstallation(view: EventDerivedPlanView, payload: InstallationBillingPayload): void {
  if (typeof payload?.isFree === 'boolean') view.isFree = payload.isFree;
  const vendorProductId = nonEmptyString(payload?.vendorProductId);
  if (vendorProductId !== null) view.vendorProductId = vendorProductId;
  const packageName = nonEmptyString(payload?.packageName);
  if (packageName !== null) view.packageName = packageName;
}

/**
 * Fold a generation of unique envelopes onto a seeded view. Order- and
 * duplicate-safe by construction (see module docstring); returns a NEW view,
 * never mutating `seed` or the envelopes.
 */
export function foldEventLayer(
  seed: EventDerivedPlanView,
  envelopes: ReadonlyArray<BillingEventEnvelope>,
): EventDerivedPlanView {
  const view: EventDerivedPlanView = { ...seed };
  const ordered = [...envelopes].sort((a, b) => {
    const [rankA, idA] = sortRank(a);
    const [rankB, idB] = sortRank(b);
    if (rankA !== rankB) return rankA < rankB ? -1 : 1;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
  for (const envelope of ordered) {
    applyTransition(view, envelope);
  }
  return view;
}

/**
 * Resolve the accepted decision table (pure/entitlement.ts — consumed
 * UNFORKED) from an event-derived view rendered into snapshot shape.
 */
export function resolveFromPlanView(
  view: EventDerivedPlanView,
  overrides?: VendorProductOverrides,
): EntitlementResolution {
  return resolveEntitlement(
    { isFree: view.isFree, vendorProductId: view.vendorProductId, packageName: view.packageName },
    { overrides },
  );
}
