/**
 * Enforcement gate — the billing lane's implementation of the canonical
 * domain port `EntitlementGate` (src/domain/ports.ts) feeding both the
 * validation-plugin path and the dashboard meter (Blueprint §3/§4 flow 5).
 *
 * Ratified posture (Contract §7, §11 C5; Blueprint §5):
 * - FAIL-OPEN on billing/counting/listing infrastructure errors: a transient
 *   API failure must never block a paying merchant's bookings. Degraded
 *   decisions carry `degraded: true` plus a persisted warning; CONSUMERS MUST
 *   treat `degraded: true` as "entitlement coverage unknown — do not block
 *   bookings because of entitlement".
 * - Warnings persist in an injected ledger (Integration lane backs it with a
 *   data collection) so the dashboard can show a prominent persistent warning.
 *   Transient infrastructure warnings clear automatically on the next healthy
 *   call (recovery); UNKNOWN_PLAN_IDENTIFIER persists until the operator maps
 *   the identifier. Layering: `PolicyDecision.warning` carries the CURRENT
 *   decision's own signals; the durable history lives in the ledger and is
 *   rendered by the dashboard from `ledger.load()`.
 * - Over-limit is NOT an error: it produces a normal decision with
 *   `overLimit: true`, stable coverage ordering, and no deletion of customer
 *   configuration (see pure/coverage.ts).
 *
 * Purity: no Wix imports — every Wix touch arrives through injected ports.
 */

import type { EntitlementGate, PolicyDecision } from '../../domain/ports';
import { resolveEntitlement } from '../pure/entitlement';
import type { VendorProductOverrides } from '../pure/entitlement';
import { selectManagedLocations } from '../pure/coverage';
import type {
  AppInstanceBillingSnapshot,
  BillableCountResult,
  EntitlementResolution,
  EntitlementSignal,
  EntitlementWarning,
  EntitlementWarningCode,
  ManagedLocationRecord,
} from '../types';

/** Port over Get App Instance (Integration lane adapter). Must THROW on transport failure. */
export interface BillingInstancePort {
  getAppInstanceSnapshot(): Promise<AppInstanceBillingSnapshot | null>;
}

/** Port over the managed-location listing (paginated listLocations adapter). */
export interface ManagedLocationListingPort {
  listManagedLocations(): Promise<ManagedLocationRecord[]>;
}

/** Port over the billable-location counter (wraps counter/countFromAdapters). */
export interface BillableCountPort {
  countBillable(): Promise<BillableCountResult>;
}

/**
 * Persistent warning ledger (Integration lane backs it with a data
 * collection; `record` upserts by code so repeated failures accumulate
 * occurrences instead of duplicating rows).
 */
export interface EntitlementWarningLedger {
  record(code: EntitlementWarningCode, message: string): Promise<void>;
  clear(code: EntitlementWarningCode): Promise<void>;
  clearAll(): Promise<void>;
  load(): Promise<EntitlementWarning[]>;
}

export interface EntitlementGateDeps {
  instance: BillingInstancePort;
  listings: ManagedLocationListingPort;
  billableCount: BillableCountPort;
  warnings: EntitlementWarningLedger;
  /** Real vendorProductId → tier mapping; operator-configured, empty by default. */
  overrides?: VendorProductOverrides;
}

/** Warnings that clear themselves once the corresponding call succeeds again. */
export const TRANSIENT_WARNING_CODES: readonly EntitlementWarningCode[] = [
  'BILLING_API_FAILURE',
  'LOCATION_LISTING_FAILURE',
  'BILLABLE_COUNT_FAILURE',
];

/**
 * Internal sentinel used ONLY while the billing API is unreachable: coverage
 * is served unlimited (fail-open). Audit CYCLE_32787032785_BILLING
 * observation 2: `tier` is an EXPLICIT `null` — billing being unreadable
 * claims NO tier at all (the former `'TIER_11_PLUS'` placeholder implied a
 * plan identification that never happened). Consumers on this branch read
 * only `maxLocations`; the type system now forbids tier-shaped misuse.
 */
export interface FailOpenResolution {
  readonly tier: null;
  readonly isPaid: false;
  readonly maxLocations: number;
  readonly restrictionReliable: false;
  readonly warnings: readonly EntitlementSignal[];
}

export const FAIL_OPEN_RESOLUTION: FailOpenResolution = Object.freeze({
  tier: null,
  isPaid: false,
  maxLocations: Number.POSITIVE_INFINITY,
  restrictionReliable: false,
  warnings: Object.freeze([]),
} as FailOpenResolution);

/** Resolution shape flowing through the gate's internal posture pipeline. */
export type GateResolution =
  | { billingFailed: false; resolution: EntitlementResolution }
  | { billingFailed: true; resolution: FailOpenResolution };

/** Dashboard meter reading. `degraded: true` ⇒ count unknown; never block on it. */
export interface BillableMeterReading {
  count: number | null;
  degraded: boolean;
}

export function createEntitlementGate(
  deps: EntitlementGateDeps,
): EntitlementGate & { meter(): Promise<BillableMeterReading> } {
  async function resolveWithPosture(): Promise<GateResolution> {
    try {
      const snapshot = await deps.instance.getAppInstanceSnapshot();
      return {
        billingFailed: false,
        resolution: resolveEntitlement(snapshot, { overrides: deps.overrides }),
      };
    } catch (error) {
      await deps.warnings.record(
        'BILLING_API_FAILURE',
        `Billing instance API failed — failing open: ${messageOf(error)}`,
      );
      return { billingFailed: true, resolution: FAIL_OPEN_RESOLUTION };
    }
  }

  async function allowedLocationIds(): Promise<PolicyDecision> {
    const posture = await resolveWithPosture();

    let records: ManagedLocationRecord[] = [];
    let listingFailed = false;
    try {
      records = await deps.listings.listManagedLocations();
    } catch (error) {
      listingFailed = true;
      await deps.warnings.record(
        'LOCATION_LISTING_FAILURE',
        `Location listing failed — failing open: ${messageOf(error)}`,
      );
    }

    // Audit CYCLE_32787032785_BILLING observation 1 (folded at BILL-C3-1):
    // warning liveness is PER-SOURCE. Each transient code clears as soon as
    // ITS OWN source is healthy again — a failing location listing must not
    // keep an already-healed billing failure alive, and vice versa. (The
    // former early-return skipped clear('BILLING_API_FAILURE') whenever the
    // listing threw, letting a stale warning linger until a fully healthy
    // call.)
    if (!posture.billingFailed) {
      await deps.warnings.clear('BILLING_API_FAILURE');
    }
    if (!listingFailed) {
      await deps.warnings.clear('LOCATION_LISTING_FAILURE');
    }

    if (listingFailed) {
      // Coverage unknown: empty id set + degraded flag; consumers must not
      // block bookings while degraded (fail-open posture).
      return {
        allowedLocationIds: [],
        overLimit: false,
        degraded: true,
        warning: 'Location listing unavailable — entitlement coverage temporarily unknown.',
      };
    }

    if (posture.billingFailed) {
      // Fail-open: unlimited coverage until billing state is readable again.
      // Only `maxLocations` is consumed from the sentinel — its explicit
      // null tier is never read (observation 2).
      const coverage = selectManagedLocations(records, posture.resolution.maxLocations);
      return {
        allowedLocationIds: coverage.allowedLocationIds,
        overLimit: false,
        degraded: true,
        warning: 'Billing state unavailable — failing open (all managed locations covered).',
      };
    }

    for (const signal of posture.resolution.warnings) {
      await deps.warnings.record(signal.code, signal.message);
    }
    const coverage = selectManagedLocations(records, posture.resolution.maxLocations);
    const warning =
      posture.resolution.warnings.length > 0 ? (posture.resolution.warnings[0]?.message ?? null) : null;

    return {
      allowedLocationIds: coverage.allowedLocationIds,
      overLimit: coverage.overLimit,
      degraded: false,
      warning,
    };
  }

  async function meter(): Promise<BillableMeterReading> {
    try {
      const result = await deps.billableCount.countBillable();
      await deps.warnings.clear('BILLABLE_COUNT_FAILURE');
      return { count: result.count, degraded: false };
    } catch (error) {
      await deps.warnings.record(
        'BILLABLE_COUNT_FAILURE',
        `Billable-location counting failed — meter degraded: ${messageOf(error)}`,
      );
      // Fail-open: an unreadable meter never blocks bookings.
      return { count: null, degraded: true };
    }
  }

  return { allowedLocationIds, meter };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'unknown error';
}
