/**
 * Schedule-mutation safety orchestrator (Contract §9) + deterministic
 * UUIDv5 idempotency-key derivation (§9.3). Public surface of the
 * integration lane for schedule writes; no rule logic lives here.
 */
export {
  ScheduleMutationOrchestrator,
  pendingChanges,
  windowContentDiffs,
} from './orchestrator';
export type {
  BeginApplyOutcome,
  MutationSummary,
  RecoverySummary,
  ScheduleMutationOrchestratorOptions,
} from './orchestrator';
export {
  SCHEDULE_MUTATION_IDEMPOTENCY_NAMESPACE,
  deriveChangeIdempotencyKey,
  deriveRollbackIdempotencyKey,
  describeChangeForIdempotency,
  uuidV5,
} from './idempotency';
