/**
 * Cross-lane DTOs — canonical shapes for `src/shared/types.ts`.
 *
 * Purity: this file must never import `@wix/*` and must stay dependency-free
 * so every lane can consume it.
 */

export type Instant = string;
export type IanaZone = string;
export type LocalDate = string;
export type LocalTime = string;
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export type BookingStatus =
  | 'CREATED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'WAITING_LIST'
  | 'UPDATED'
  | 'CANCELED';

export const DEFAULT_COUNT_INCLUDED_STATUSES: readonly BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
] as const;

export interface WeeklyWindowDTO {
  weekday: Weekday;
  start: LocalTime;
  end: LocalTime;
}

export type ExceptionKind = 'CLOSED' | 'OVERRIDE';

export interface ExceptionDTO {
  exceptionId: string;
  date: LocalDate;
  kind: ExceptionKind;
  windows?: WeeklyWindowDTO[];
  reason?: string;
}

export type LimitDimension = 'DAY' | 'SERVICE' | 'LOCATION';

export interface LimitDTO {
  limitId: string;
  dimension: LimitDimension;
  targetId?: string;
  maxCount: number;
  includedStatuses: BookingStatus[];
}

export interface RuleSetDTO {
  ruleSetId: string;
  revision: string;
  version: number;
  locationWindows: Record<string, WeeklyWindowDTO[]>;
  serviceWindows: Record<string, WeeklyWindowDTO[]>;
  exceptions: ExceptionDTO[];
  limits: LimitDTO[];
}

export interface BookingFacts {
  at: Instant;
  serviceId: string;
  locationId?: string | null;
  slotStart?: Instant;
  slotEnd?: Instant;
  timezone: IanaZone;
  identityKey?: string | null;
}

export interface Explanation {
  decision: 'allow' | 'block';
  ruleId: string;
  code: string;
  customerMessage: string;
}

export interface RuleOutcome {
  decision: 'allow' | 'block';
  explanations: Explanation[];
}

export type ScheduleOwnerType = 'BUSINESS' | 'STAFF';

export interface ScheduleScope {
  scheduleId: string;
  ownerType: ScheduleOwnerType;
  ownerId: string;
  locationId?: string | null;
}

export interface ScheduleEventRecord {
  eventId: string;
  type: string;
  recurrence: 'MASTER' | 'INSTANCE' | 'ONE_TIME';
  scheduleId: string;
  startLocalDate: LocalDate;
  startLocalTime: LocalTime;
  endLocalTime?: LocalTime;
  weekday?: Weekday;
  locationId?: string | null;
  revision: string;
  raw: Record<string, unknown>;
}

export interface ScheduleSnapshot {
  snapshotId: string;
  takenAt: Instant;
  scope: ScheduleScope;
  events: ScheduleEventRecord[];
}

export type PlannedAction = 'CREATE_MASTER' | 'UPDATE_MASTER' | 'CANCEL_EVENT';

interface PlannedChangeBase {
  changeId: string;
  action: PlannedAction;
  idempotencyKey?: string;
}

export interface CreateMasterChange extends PlannedChangeBase {
  action: 'CREATE_MASTER';
  weekday: Weekday;
  startTime: LocalTime;
  endTime: LocalTime;
  anchorDate: LocalDate;
  locationId?: string | null;
}

export interface UpdateMasterChange extends PlannedChangeBase {
  action: 'UPDATE_MASTER';
  eventId: string;
  expectedRevision: string;
  startTime?: LocalTime;
  endTime?: LocalTime;
  locationId?: string | null;
}

export interface CancelEventChange extends PlannedChangeBase {
  action: 'CANCEL_EVENT';
  eventId: string;
  expectedRevision: string;
}

export type PlannedChange =
  | CreateMasterChange
  | UpdateMasterChange
  | CancelEventChange;

export interface MutationPlan {
  planId: string;
  scope: ScheduleScope;
  ruleVersion: number;
  changes: PlannedChange[];
  createdAt: Instant;
  createdBy: string;
  reason: string;
}

export type AppliedChangeStatus = 'APPLIED' | 'SKIPPED_ALREADY_APPLIED' | 'FAILED';

export interface MutationErrorDetail {
  code: string;
  message: string;
  retriable: boolean;
}

export interface AppliedChangeRecord {
  changeId: string;
  status: AppliedChangeStatus;
  eventId?: string;
  revision?: string;
  attempts?: number;
  error?: MutationErrorDetail;
}

export interface ApplyResult {
  planId: string;
  appliedAt: Instant;
  results: AppliedChangeRecord[];
  allApplied: boolean;
}

export interface VerifyResult {
  planId: string;
  verified: boolean;
  checkedAt: Instant;
  mismatches: string[];
}

export interface RollbackResult {
  snapshotId: string;
  rolledBackAt: Instant;
  restoredEventIds: string[];
  removedEventIds: string[];
  complete: boolean;
  notes: string[];
}

export type MutationRecordState =
  | 'SNAPSHOT_PERSISTED'
  | 'APPLY_IN_PROGRESS'
  | 'APPLY_COMPLETED'
  | 'ROLLED_BACK'
  | 'RECOVERED';

export interface PersistedMutationRecord {
  planId: string;
  scope: ScheduleScope;
  state: MutationRecordState;
  snapshot: ScheduleSnapshot;
  plan: MutationPlan;
  confirmedChangeIds: string[];
  updatedAt: Instant;
}

export interface JournalProgressPatch {
  state?: MutationRecordState;
  confirmedChangeIds?: string[];
}

export type AuditAction =
  | 'MUTATION_APPLIED'
  | 'MUTATION_FAILED_ROLLED_BACK'
  | 'RECOVERY_COMPLETED';

export interface AuditLogEntry {
  entryId: string;
  at: Instant;
  actor: string;
  action: AuditAction;
  planId: string;
  scope: ScheduleScope;
  summary: string;
  snapshotRef: string;
  rollbackRef?: string | null;
  details?: Record<string, unknown>;
}

export interface SlotQuery {
  serviceId: string;
  locationId?: string;
  fromDate: LocalDate;
  toDate: LocalDate;
  timeZone: IanaZone;
}

export interface Slot {
  startDate: Instant;
  endDate: Instant;
  serviceId: string;
  localDate: LocalDate;
  locationId?: string | null;
  capacity?: number;
}

export interface CountQuery {
  fromUtc: Instant;
  toUtc: Instant;
  serviceId?: string;
  locationId?: string;
  includedStatuses: BookingStatus[];
}

export interface PolicyDecision {
  allowedLocationIds: string[];
  overLimit: boolean;
  degraded: boolean;
  warning?: string | null;
}
