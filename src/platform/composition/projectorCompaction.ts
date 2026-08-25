/**
 * Bounded retention/compaction for the billing plan projector's dedup memory
 * (INT-C4-1 item b; Billing audit CYCLE_32792897988 observation 2 routed
 * here; Contract §6/§7; Blueprint §4 flow 5).
 *
 * PROBLEM (audit observation 2): `createBillingPlanProjector` keeps
 * `seenEventIds` for its whole lifetime — correct for the pure core, but a
 * long-lived warm serverless process ingesting sustained unique webhook
 * traffic would grow that set without bound.
 *
 * THIS WRAPPER owns retention so the accepted billing core stays untouched:
 * it implements the full {@link BillingPlanProjector} surface and can drop in
 * anywhere the plain projector is expected — including
 * `projectedSnapshotSource(projector)` in ../entitlementComposition.ts.
 *
 * EVICTION SEMANTICS (two tiers):
 * 1. RECONCILIATION RETIREMENT (the normal, loss-free path). Ingesting a
 *    snapshot re-seeds truth (Contract §7 reconciliation supremacy), so every
 *    pre-snapshot event effect is superseded anyway. At each reconciliation
 *    the current generation is retired: its ids move into a bounded FIFO
 *    id-set (`maxRetiredIds`) kept purely for duplicate suppression, and the
 *    SEQUENCE WATERMARK advances to the highest retired numeric
 *    `entityEventSequence`.
 * 2. FORCED COMPACTION (flood between polls). If the live generation exceeds
 *    `maxGenerationEvents`, the oldest arrivals beyond `retentionWindow` are
 *    dropped, the watermark advances over their ranks, and the inner
 *    projector is REBUILT from (last snapshot + durable cancellation marker +
 *    retained generation). Rebuilding is what actually bounds memory: the
 *    inner core's private dedup set restarts containing only the retained
 *    window (+ at most one reserved marker id per rebuild).
 *
 * SAFE RE-DETECTION OF COMPACTED EVENTS ("no resurrected paid state"):
 * - An event whose id is still retained ⇒ `'DUPLICATE'` (unchanged semantics).
 * - A replayed already-compacted event with a usable numeric sequence ≤ the
 *   watermark is FENCED: classified `'DUPLICATE'` without reaching the inner
 *   core. Wix assigns monotonically increasing `entityEventSequence` values,
 *   so anything at/below the watermark predates everything already compacted;
 *   replaying it after a downgrading reconciliation must never re-apply an
 *   old purchase on top of fresher state.
 *
 * DOCUMENTED TRADEOFFS (all healed by the MANDATORY periodic reconciliation,
 * Contract §7 — trial→paid conversion fires no event, so polls are not
 * optional):
 * - A legitimate late delivery whose rank is ≤ the watermark (i.e. older than
 *   the compaction frontier) is suppressed until the next poll restores true
 *   state. Webhook effects are only refinements between polls; supremacy makes
 *   every poll self-healing.
 * - Envelopes WITHOUT a usable numeric sequence cannot be fenced once their id
 *   is evicted from the bounded sets; such replays may re-apply once as
 *   refinements. Transitions are idempotent, so this converges — and the next
 *   reconciliation discards refinement layers wholesale. Sequence-less
 *   deliveries are a defensive corner (Contract §6 orders via
 *   `entityEventSequence`), not the operating norm.
 * - Forced mid-generation compaction drops refinement effects of evicted
 *   events until the next reconciliation; projections are exact again at every
 *   convergence point (immediately after each snapshot).
 *
 * DURABLE MARKER: `autoRenewCancelled` survives reconciliations inside the
 * accepted core. A rebuild would lose a marker whose causing event was
 * retired, so rebuilds observe the marker first and, if needed, re-seed it
 * with one reserved synthetic auto-renewal-cancellation envelope (that
 * transition writes ONLY the marker — no plan identifier is touched). The
 * reserved id is deterministic per rebuild and bounded by construction.
 *
 * Purity: no I/O, no clock, no Wix imports. Envelope TYPES (semantics only)
 * cross this seam because it IS the ingestion boundary owned by the webhook
 * pipeline caller; transport/signature validation stays upstream (Contract §6),
 * and the ENFORCEMENT consumers (../entitlementComposition.ts +
 * ../validation-plugin/**) never import any webhook type (test-pinned).
 */

import { assertValidEnvelope } from '../../billing/projection/fold';
import { createBillingPlanProjector } from '../../billing/projection/projector';
import type { BillingPlanProjector } from '../../billing/projection/projector';
import type {
  BillingEventEnvelope,
  EventIngestStatus,
} from '../../billing/projection/types';
import type { AppInstanceBillingSnapshot } from '../../billing/types';
import type { VendorProductOverrides } from '../../billing/pure/entitlement';

/** Generation length that triggers forced compaction (flood between polls). */
export const DEFAULT_GENERATION_COMPACTION_LIMIT = 512;

/** Newest arrivals kept (and replayed into a rebuilt inner) at forced compaction. */
export const DEFAULT_RETENTION_WINDOW = 256;

/** Bounded FIFO size of retired envelope ids kept for duplicate suppression. */
export const DEFAULT_MAX_RETIRED_IDS = 4096;

const MARKER_ENVELOPE_ID_PREFIX = '__plan_projection_compaction_marker__';

export interface CompactingProjectorOptions {
  /** Instance scope guard, forwarded to the inner core (clone isolation). */
  instanceId?: string;
  /** Real vendorProductId → plan mapping; operator-configured, empty default. */
  overrides?: VendorProductOverrides;
  /** Default {@link DEFAULT_GENERATION_COMPACTION_LIMIT}. */
  maxGenerationEvents?: number;
  /** Default {@link DEFAULT_RETENTION_WINDOW}. Must be < maxGenerationEvents. */
  retentionWindow?: number;
  /** Default {@link DEFAULT_MAX_RETIRED_IDS}. */
  maxRetiredIds?: number;
}

export interface CompactionStats {
  /** Live generation envelopes + retired suppression ids — the bounded total. */
  retainedIds: number;
  /** Highest retired numeric sequence rank; null while nothing was retired. */
  watermark: number | null;
  /** How many times the inner core was rebuilt (forced compactions). */
  rebuilds: number;
  /** Total envelopes retired (reconciliation + forced) over the lifetime. */
  retiredTotal: number;
}

export interface CompactingBillingPlanProjector extends BillingPlanProjector {
  /** Observability for tests/ops: proves the retention bounds hold. */
  stats(): CompactionStats;
}

/**
 * Numeric sequence rank mirroring the accepted fold's ordering parse
 * (`(entityEventSequence, id)` total order): finite numbers and numeric
 * strings rank numerically; anything else is unusable (`null` here — the fold
 * ranks such envelopes oldest). Mechanical parsing only; recognition logic is
 * never duplicated.
 */
function sequenceRank(envelope: BillingEventEnvelope): number | null {
  const raw = envelope.entityEventSequence;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function createCompactingProjector(
  options?: CompactingProjectorOptions,
): CompactingBillingPlanProjector {
  const instanceId = options?.instanceId;
  const overrides = options?.overrides;
  const maxGenerationEvents = options?.maxGenerationEvents ?? DEFAULT_GENERATION_COMPACTION_LIMIT;
  const retentionWindow = options?.retentionWindow ?? DEFAULT_RETENTION_WINDOW;
  const maxRetiredIds = options?.maxRetiredIds ?? DEFAULT_MAX_RETIRED_IDS;
  if (!Number.isSafeInteger(maxGenerationEvents) || maxGenerationEvents < 1) {
    throw new Error('createCompactingProjector: maxGenerationEvents must be a positive integer');
  }
  if (!Number.isSafeInteger(retentionWindow) || retentionWindow < 0 || retentionWindow >= maxGenerationEvents) {
    throw new Error('createCompactingProjector: retentionWindow must be < maxGenerationEvents');
  }
  if (!Number.isSafeInteger(maxRetiredIds) || maxRetiredIds < 1) {
    throw new Error('createCompactingProjector: maxRetiredIds must be a positive integer');
  }

  let inner: BillingPlanProjector = createBillingPlanProjector({ instanceId, overrides });
  let hasReconciled = false;
  let lastSnapshot: AppInstanceBillingSnapshot | null = null;

  /** Unique envelopes since the last reconciliation, in arrival order. */
  let generation: BillingEventEnvelope[] = [];
  const generationIds = new Set<string>();

  /** Bounded FIFO of retired ids (duplicate suppression only, no payloads). */
  const retiredIds = new Set<string>();
  let watermark: number | null = null;
  let rebuilds = 0;
  let retiredTotal = 0;

  function advanceWatermarkTo(rank: number): void {
    watermark = watermark === null ? rank : Math.max(watermark, rank);
  }

  function retireId(id: string): void {
    retiredIds.add(id);
    if (retiredIds.size > maxRetiredIds) {
      const oldest = retiredIds.values().next();
      if (oldest.done !== true) retiredIds.delete(oldest.value);
    }
  }

  /**
   * Rebuilds the inner core from (last snapshot + durable marker + retained
   * generation), restarting its private unbounded dedup set. The durable
   * cancellation marker is observed BEFORE the swap and re-seeded with one
   * reserved synthetic envelope when the retained replay does not reproduce
   * it (its transition writes ONLY the marker).
   */
  function rebuildInner(retained: readonly BillingEventEnvelope[]): void {
    const markerBefore = inner.project().autoRenewCancelled;
    const fresh = createBillingPlanProjector({ instanceId, overrides });
    if (hasReconciled) {
      fresh.ingestSnapshot(lastSnapshot);
    }
    for (const envelope of retained) {
      // A virgin core has seen none of these ids: APPLIED is the only
      // possible outcome; scope mismatches were filtered at first ingest.
      fresh.ingestEvent(envelope);
    }
    if (markerBefore && !fresh.project().autoRenewCancelled) {
      fresh.ingestEvent({
        id: `${MARKER_ENVELOPE_ID_PREFIX}${rebuilds}`,
        eventType: 'PAID_PLAN_AUTO_RENEWAL_CANCELLED',
        payload: {},
      });
    }
    inner = fresh;
    rebuilds += 1;
  }

  /** Forced compaction: bound the generation, fence what is dropped, rebuild. */
  function forceCompact(): void {
    if (generation.length <= retentionWindow) return;
    const keepFrom = generation.length - retentionWindow;
    const dropped = generation.slice(0, keepFrom);
    const retained = generation.slice(keepFrom);
    for (const envelope of dropped) {
      const rank = sequenceRank(envelope);
      if (rank !== null) advanceWatermarkTo(rank);
      retireId(envelope.id);
      retiredTotal += 1;
    }
    generation = [...retained];
    generationIds.clear();
    for (const envelope of retained) generationIds.add(envelope.id);
    rebuildInner(generation);
  }

  return {
    instanceId: inner.instanceId,

    ingestEvent(envelope: BillingEventEnvelope): EventIngestStatus {
      // Same structural precondition as the inner core: throws BEFORE any
      // state mutation anywhere in the wrapper.
      assertValidEnvelope(envelope);
      if (
        instanceId !== undefined &&
        typeof envelope.instanceId === 'string' &&
        envelope.instanceId.length > 0 &&
        envelope.instanceId !== instanceId
      ) {
        return 'FOREIGN_INSTANCE';
      }
      if (generationIds.has(envelope.id)) return 'DUPLICATE';
      if (retiredIds.has(envelope.id)) return 'DUPLICATE';
      const rank = sequenceRank(envelope);
      if (rank !== null && watermark !== null && rank <= watermark) {
        // Fenced stale replay of an already-compacted event: safely
        // re-detected WITHOUT remembering its id forever.
        return 'DUPLICATE';
      }
      const status = inner.ingestEvent(envelope);
      if (status === 'APPLIED') {
        generation.push(envelope);
        generationIds.add(envelope.id);
        if (generation.length > maxGenerationEvents) forceCompact();
      }
      return status;
    },

    ingestSnapshot(snapshot: AppInstanceBillingSnapshot | null): void {
      if (snapshot !== null && (typeof snapshot !== 'object' || Array.isArray(snapshot))) {
        throw new TypeError('ingestSnapshot expects an AppInstanceBillingSnapshot object or null');
      }
      // Inner first: on its rejection the wrapper stays untouched.
      inner.ingestSnapshot(snapshot);
      // Reconciliation retirement: pre-snapshot effects are superseded by
      // supremacy; keep ids (bounded) for duplicate suppression and fence
      // ranked replays via the watermark.
      for (const envelope of generation) {
        const rank = sequenceRank(envelope);
        if (rank !== null) advanceWatermarkTo(rank);
        retireId(envelope.id);
        retiredTotal += 1;
      }
      generation = [];
      generationIds.clear();
      hasReconciled = true;
      lastSnapshot = snapshot;
    },

    project() {
      return inner.project();
    },

    currentSnapshot() {
      return inner.currentSnapshot();
    },

    stats(): CompactionStats {
      return {
        retainedIds: generation.length + retiredIds.size,
        watermark,
        rebuilds,
        retiredTotal,
      };
    },
  };
}
