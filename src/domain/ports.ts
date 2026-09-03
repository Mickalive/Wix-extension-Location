/**
 * Domain-owned adapter ports — canonical shapes finalized by the accepted Integration lane.
 *
 * Purity: NO `@wix/*` imports ever. Platform implements these ports; the pure
 * domain consumes them. Dependency direction: platform -> domain(ports) +
 * shared; domain -> stdlib + shared only.
 */

import type {
  AppliedChangeRecord,
  ApplyResult,
  AuditAction,
  AuditLogEntry,
  BookingStatus,
  CountQuery,
  Instant,
  IanaZone,
  JournalProgressPatch,
  MutationPlan,
  PersistedMutationRecord,
  PolicyDecision,
  RollbackResult,
  RuleSetDTO,
  ScheduleScope,
  ScheduleSnapshot,
  SlotQuery,
  Slot,
  VerifyResult,
} from '../shared/types';
import type { TargetOperation } from '../shared/errors';

export type RuleSet = RuleSetDTO;

/**
 * Validation-plugin operation a single evaluation serves (Contract §5.3).
 * Deliberate alias of the shared {@link TargetOperation} union so the domain
 * can never drift from the binding failure-semantics taxonomy
 * (`failureSemanticsFor`). The six platform targets collapse onto three
 * operations: the `*_MULTI_SERVICE` variants share their base operation's
 * semantics (multi-service bookings are sequences of single-service bookings
 * under one operation); the platform layer performs that mapping.
 */
export type EvaluationTarget = TargetOperation;

/**
 * ADDITIVE cycle-4 evolution (RULES-C4-1; authorized by the
 * `canonical_contracts_notice` in docs/NEXT_CYCLE.json): optional per-invocation
 * target context carried on {@link EvaluationDeps.targetContext}.
 *
 * Safe default: an ABSENT context evaluates every rule family exactly as
 * before cycle 4 (CREATE semantics), bit-for-bit — accepted platform and
 * billing consumers compile and behave unchanged. The per-target rule-family
 * matrix and its Contract §5.3 rationale live in src/domain/README.md
 * ("Target-aware evaluation").
 */
export interface EvaluationTargetContext {
  /** Which validation operation this evaluation serves. */
  target: EvaluationTarget;
  /**
   * RESCHEDULE only: booking id of the booking being rescheduled (the
   * "subject"). Duplicate detection skips any existing booking carrying this
   * id, so the mover's own still-existing booking never flags
   * DUPLICATE_BOOKING against its own proposed slot, while genuine overlaps
   * with OTHER bookings still block. Matching is conservative: existing facts
   * without a bookingId can never match. Ignored for CREATE/CANCEL.
   *
   * Platform note (honest limitation): the validation payload must actually
   * carry the rescheduled booking's identifier for this to be supplyable —
   * unproven until payload probe gate T-VP3/T-VP5 evidence exists. Without a
   * subject id, RESCHEDULE duplicate detection cannot exclude the own booking
   * and degrades to today's behavior (documented residual, never hidden).
   */
  subjectBookingId?: string | null;
}

export interface Clock {
  now(): Instant;
  zone(): IanaZone;
}

export interface RulesConfigStore {
  loadActiveRuleSet(): Promise<RuleSet | null>;
  saveRuleSet(next: RuleSet, expectedRevision: string): Promise<RuleSet>;
}

export interface ScheduleGateway {
  snapshotWorkingHours(scope: ScheduleScope): Promise<ScheduleSnapshot>;
  applyWindowChanges(plan: MutationPlan): Promise<ApplyResult>;
  verifyApplied(plan: MutationPlan): Promise<VerifyResult>;
  rollbackTo(snapshot: ScheduleSnapshot): Promise<RollbackResult>;
}

export interface AvailabilityGateway {
  slots(q: SlotQuery): Promise<Slot[]>;
}

export interface BookingCountGateway {
  count(q: CountQuery): Promise<number>;
}

export interface EntitlementGate {
  allowedLocationIds(): Promise<PolicyDecision>;
}

export interface MutationJournalStore {
  persistBaseline(record: PersistedMutationRecord): Promise<void>;
  updateProgress(
    planId: string,
    patch: JournalProgressPatch,
  ): Promise<PersistedMutationRecord>;
  loadByPlanId(planId: string): Promise<PersistedMutationRecord | null>;
  loadLatestInProgress(scope: ScheduleScope): Promise<PersistedMutationRecord | null>;
  recordAudit(entry: AuditLogEntry): Promise<void>;
  listAudit(scope?: ScheduleScope): Promise<AuditLogEntry[]>;
}

export type {
  AppliedChangeRecord,
  ApplyResult,
  AuditAction,
  AuditLogEntry,
  BookingStatus,
  CountQuery,
  Instant,
  IanaZone,
  JournalProgressPatch,
  MutationPlan,
  PersistedMutationRecord,
  PolicyDecision,
  RollbackResult,
  RuleSetDTO,
  ScheduleScope,
  ScheduleSnapshot,
  SlotQuery,
  Slot,
  VerifyResult,
} from '../shared/types';
