/**
 * Enforcement composition root (INT-C4-1; Blueprint §4 flows 5 → 1).
 * Pure, Wix-import-free wiring: accepted billing exports + injected ports →
 * the gate consumed by the validation-plugin handlers and the GET /meter
 * endpoint. See ./README.md for the binding wiring protocol and the dedup
 * compaction tradeoffs.
 */
export type {
  ComposeEntitlementGateDeps,
  ComposedEntitlementGate,
  ComposeValidationEntitlementDeps,
  ValidationEntitlementComposition,
} from './entitlementComposition';
export {
  composeEntitlementGate,
  composeValidationEntitlement,
} from './entitlementComposition';
export type {
  CompactingBillingPlanProjector,
  CompactingProjectorOptions,
  CompactionStats,
} from './projectorCompaction';
export {
  createCompactingProjector,
  DEFAULT_GENERATION_COMPACTION_LIMIT,
  DEFAULT_MAX_RETIRED_IDS,
  DEFAULT_RETENTION_WINDOW,
} from './projectorCompaction';
export type {
  AppInstanceSnapshotFetcher,
  IntervalTimers,
  PollTriggerBinding,
  ReconciliationFire,
  ReconciliationSeam,
  ReconciliationSeamDeps,
} from './reconciliation';
export {
  createReconciliationSeam,
  defaultIntervalTimers,
  intervalPollTrigger,
} from './reconciliation';
