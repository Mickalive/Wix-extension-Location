/**
 * Plan-state projector — the Contract §7 / Blueprint §4 flow 5 entitlement
 * state machine (BILL-C3-1). Ingests app-billing webhook EVENTS (envelope
 * semantics only) plus periodic Get App Instance SNAPSHOTS and projects the
 * current {@link EntitlementProjection}.
 *
 * RECONCILIATION SUPREMACY (binding, task BILL-C3-1b):
 * - Ingesting a snapshot re-seeds the event layer from the snapshot's
 *   definitely-reported fields and DISCARDS every event effect accumulated
 *   before it (the generation buffer is cleared). A snapshot is the freshest
 *   full-state observation; trial→paid conversion fires NO event (§7), so
 *   only reconciliation can discover it.
 * - The dedup memory (`seenEventIds`) SURVIVES snapshots: a replayed or
 *   duplicated pre-snapshot event can never resurrect stale state on top of
 *   a fresher reconciliation ("snapshot beats stale events").
 * - Unique events delivered AFTER a snapshot legitimately refine the
 *   projection until the next reconciliation (e.g. a purchase that happened
 *   after the last periodic poll grants paid coverage immediately).
 *
 * CONVERGENCE (task BILL-C3-1b): within one generation, events fold in
 * `(entityEventSequence, id)` order over the deduped set, so out-of-order,
 * duplicated and replayed deliveries converge idempotently to the same
 * projected state regardless of arrival order.
 *
 * ISOLATION: one projector instance represents ONE app instance. Events
 * carrying a foreign `instanceId` are ignored (`FOREIGN_INSTANCE`), so clone
 * markers (`originInstanceId`/`copiedFromTemplate`) never leak plan state
 * across instances; clones resolve only from their own signals.
 *
 * Purity: no I/O, no clock, no Wix imports. `receivedAt` is never consulted;
 * expiration dates may ride along in snapshot/installation payloads but no
 * transition or the resolver ever reads them (Invariant C2).
 */

import type { AppInstanceBillingSnapshot } from '../types';
import type { VendorProductOverrides } from '../pure/entitlement';
import {
  assertValidEnvelope,
  emptyPlanView,
  foldEventLayer,
  resolveFromPlanView,
  seedPlanViewFromSnapshot,
} from './fold';
import type {
  BillingEventEnvelope,
  EntitlementProjection,
  EventDerivedPlanView,
  EventIngestStatus,
} from './types';

export interface BillingPlanProjectorOptions {
  /**
   * Instance scope guard. When set, envelopes reporting a DIFFERENT
   * non-empty `instanceId` are ignored. Snapshots have no instanceId: they
   * are fetched by this instance's own adapter and are trusted as such.
   */
  instanceId?: string;
  /** Real vendorProductId → tier mapping; operator-configured, empty by default. */
  overrides?: VendorProductOverrides;
}

export interface BillingPlanProjector {
  readonly instanceId: string | undefined;

  /**
   * Ingest one webhook envelope. Returns `'APPLIED'`, `'DUPLICATE'` (id
   * already seen — replay/duplicate suppressed) or `'FOREIGN_INSTANCE'`
   * (ignored scope mismatch). Throws TypeError on structurally invalid
   * envelopes BEFORE mutating any state.
   */
  ingestEvent(envelope: BillingEventEnvelope): EventIngestStatus;

  /**
   * Reconcile with a periodic Get App Instance snapshot (`null` = Wix
   * genuinely reports no billing data — accepted FREE semantics). Replaying
   * the same snapshot is safe and idempotent. Throws TypeError on non-object
   * input before mutating any state.
   */
  ingestSnapshot(snapshot: AppInstanceBillingSnapshot | null): void;

  /** Current projection (fresh object every call; callers cannot corrupt state). */
  project(): EntitlementProjection;

  /**
   * Snapshot-shaped read model for the enforcement gate's narrow port:
   * the latest reconciled snapshot verbatim while no post-snapshot events
   * are pending, otherwise the refined view rendered into snapshot shape;
   * `null` when nothing is known at all.
   */
  currentSnapshot(): AppInstanceBillingSnapshot | null;
}

export function createBillingPlanProjector(
  options?: BillingPlanProjectorOptions,
): BillingPlanProjector {
  const instanceId = options?.instanceId;
  const overrides = options?.overrides;

  let reconciledRaw: { raw: AppInstanceBillingSnapshot | null } | null = null;
  let autoRenewCancelled = false; // durable marker, preserved across reconciliations
  const generation: BillingEventEnvelope[] = []; // unique events since last reconciliation
  const seenEventIds = new Set<string>(); // NEVER cleared: replays must not beat snapshots

  function foldedView(): EventDerivedPlanView {
    const seed = reconciledRaw
      ? seedPlanViewFromSnapshot(reconciledRaw.raw, autoRenewCancelled)
      : emptyPlanView(autoRenewCancelled);
    return foldEventLayer(seed, generation);
  }

  return {
    instanceId,

    ingestEvent(envelope: BillingEventEnvelope): EventIngestStatus {
      assertValidEnvelope(envelope);
      if (
        instanceId !== undefined &&
        typeof envelope.instanceId === 'string' &&
        envelope.instanceId.length > 0 &&
        envelope.instanceId !== instanceId
      ) {
        return 'FOREIGN_INSTANCE';
      }
      if (seenEventIds.has(envelope.id)) return 'DUPLICATE';
      seenEventIds.add(envelope.id);
      generation.push(envelope);
      return 'APPLIED';
    },

    ingestSnapshot(snapshot: AppInstanceBillingSnapshot | null): void {
      if (snapshot !== null && (typeof snapshot !== 'object' || Array.isArray(snapshot))) {
        throw new TypeError('ingestSnapshot expects an AppInstanceBillingSnapshot object or null');
      }
      // Preserve the durable cancellation marker across reconciliation; every
      // other event-derived effect is superseded by the fresh full state.
      autoRenewCancelled = foldedView().autoRenewCancelled;
      reconciledRaw = { raw: snapshot };
      generation.length = 0;
    },

    project(): EntitlementProjection {
      const view = foldedView();
      const reconciled = reconciledRaw !== null;
      return {
        source: reconciled && generation.length === 0 ? 'SNAPSHOT_RECONCILED' : 'EVENT_DERIVED',
        resolution: resolveFromPlanView(view, overrides),
        autoRenewCancelled: view.autoRenewCancelled,
        reconciledAtLeastOnce: reconciled,
        generationEventCount: generation.length,
      };
    },

    currentSnapshot(): AppInstanceBillingSnapshot | null {
      const view = foldedView();
      const hasSignal =
        view.isFree !== null || view.vendorProductId !== null || view.packageName !== null;
      if (!hasSignal) {
        // Nothing reported anywhere: hand out the raw reconciled snapshot
        // (may be null = genuinely absent billing) so the gate resolves
        // through the accepted table with full fidelity.
        return reconciledRaw !== null ? reconciledRaw.raw : null;
      }
      // Post-snapshot refinement (or events-only): render the merged view.
      // Fields the resolver never reads (C2 advisory dates, trial status,
      // clone markers) are intentionally omitted from the rendered shape.
      return {
        isFree: view.isFree,
        vendorProductId: view.vendorProductId,
        packageName: view.packageName,
      };
    },
  };
}
