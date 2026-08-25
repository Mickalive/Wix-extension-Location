/**
 * Periodic plan-state reconciliation seam (INT-C4-1 item a; Contract §7;
 * Blueprint §4 flow 5).
 *
 * BINDING PLATFORM FACT (Contract §7): a trial→paid conversion fires NO
 * webhook event — "periodic reconciliation mandatory". Webhook refinement
 * alone can therefore never discover a conversion; only ingesting a fresh
 * Get App Instance snapshot can. This seam makes the poll an explicit,
 * injectable part of the composition root instead of hidden timing magic:
 *
 *  - `reconcileNow()` fetches one snapshot through the injected port and
 *    feeds it to the projector (use {@link createCompactingProjector} so each
 *    reconciliation also retires dedup memory — see ./projectorCompaction.ts).
 *  - `onPollTrigger(binding)` registers an INJECTABLE poll trigger: the host
 *    decides how polls fire (scheduled event extension, warm-start hook, cron
 *    outside the process). The binding receives the fire function and returns
 *    its own unsubscribe — no timer ownership lives here, so tests and thin
 *    adapters stay deterministic.
 *
 * TRANSPORT FAILURES: the fetch port MUST THROW on infrastructure failure and
 * may return `null` ONLY when Wix genuinely reports no billing data (same
 * adapter semantics as the billing lane's paging ports). A thrown fetch never
 * touches projector state; `reconcileNow` reports `false` and notifies the
 * optional `onError` observer so the failure is logged/surfaced — never
 * silent, never fabricated into data.
 *
 * Purity: no Wix imports; the fetcher is an injected port implemented by the
 * T-VP0 thin adapter (Get App Instance, SCOPE.DC.MANAGE-YOUR-APP, Contract
 * §5.1).
 */

import type { AppInstanceBillingSnapshot } from '../../billing/types';
import type { BillingPlanProjector } from '../../billing/projection/projector';

/**
 * Port over Get App Instance for ONE reconciliation poll. MUST THROW on
 * transport/auth/malformed-payload failure ("state UNKNOWN"); `null` asserts
 * a trustworthy "no billing section" observation.
 */
export interface AppInstanceSnapshotFetcher {
  fetchCurrentSnapshot(): Promise<AppInstanceBillingSnapshot | null>;
}

/** Fired by registered triggers; resolves when the poll attempt settles. */
export type ReconciliationFire = () => void;

/**
 * Registers a poll trigger and returns its unsubscribe. Implementations own
 * their scheduling mechanism (interval, platform scheduler, external cron
 * callback) — this seam deliberately owns none.
 */
export type PollTriggerBinding = (fire: ReconciliationFire) => () => void;

export interface ReconciliationSeam {
  /**
   * One reconciliation attempt: fetch → ingest. Returns true when a snapshot
   * was ingested; false when the fetch failed (state untouched, observer
   * notified). Re-ingesting the same snapshot is idempotent (accepted core).
   */
  reconcileNow(): Promise<boolean>;
  /** Registers an injectable poll trigger; returns its unsubscribe. */
  onPollTrigger(binding: PollTriggerBinding): () => void;
  /** Unsubscribes every registered trigger. */
  dispose(): void;
}

export interface ReconciliationSeamDeps {
  projector: BillingPlanProjector;
  fetcher: AppInstanceSnapshotFetcher;
  /** Observability hook for fetch failures (log/alert/persist upstream). */
  onError?: (error: unknown) => void;
}

export function createReconciliationSeam(deps: ReconciliationSeamDeps): ReconciliationSeam {
  const unsubscribes = new Set<() => void>();

  async function reconcileNow(): Promise<boolean> {
    let snapshot: AppInstanceBillingSnapshot | null;
    try {
      snapshot = await deps.fetcher.fetchCurrentSnapshot();
    } catch (error) {
      if (deps.onError) deps.onError(error);
      return false;
    }
    deps.projector.ingestSnapshot(snapshot);
    return true;
  }

  return {
    async reconcileNow(): Promise<boolean> {
      return reconcileNow();
    },

    onPollTrigger(binding: PollTriggerBinding): () => void {
      const unsubscribe = binding(() => {
        void reconcileNow();
      });
      unsubscribes.add(unsubscribe);
      return () => {
        unsubscribe();
        unsubscribes.delete(unsubscribe);
      };
    },

    dispose(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes.clear();
    },
  };
}

/**
 * Minimal timer abstraction so hosts/tests inject their own scheduler; the
 * default binds to the ambient timers of a long-lived warm process.
 */
export interface IntervalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const defaultIntervalTimers: IntervalTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Interval-based {@link PollTriggerBinding} for hosts that keep a warm
 * process alive between requests. Serverless platforms that freeze between
 * invocations should instead trigger on warm-start/scheduled events via
 * `onPollTrigger` directly.
 */
export function intervalPollTrigger(
  intervalMs: number,
  timers: IntervalTimers = defaultIntervalTimers,
): PollTriggerBinding {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('intervalPollTrigger: intervalMs must be a positive finite number');
  }
  return (fire) => {
    const handle = timers.setInterval(fire, intervalMs);
    return () => timers.clearInterval(handle);
  };
}
