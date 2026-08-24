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

export type RuleSet = RuleSetDTO;

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
