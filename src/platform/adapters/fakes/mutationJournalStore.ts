/**
 * In-memory fake {@link MutationJournalStore} (Blueprint §3; Contract §9.1/§9.7).
 * Durable-record semantics: baselines are immutable once persisted, progress
 * updates merge onto the stored record, duplicate audit entry ids are rejected
 * as an integrity guard, and an optional shared `trace` records operation order
 * for snapshot-before-first-write assertions.
 */
import { PlatformError } from '../../contracts';
import type {
  AuditLogEntry,
  Instant,
  JournalProgressPatch,
  MutationJournalStore,
  MutationRecordState,
  PersistedMutationRecord,
  ScheduleScope,
} from '../../contracts';

const IN_PROGRESS_STATES: ReadonlySet<MutationRecordState> = new Set([
  'SNAPSHOT_PERSISTED',
  'APPLY_IN_PROGRESS',
]);

export interface FakeMutationJournalStoreOptions {
  now?: () => Instant;
  /** Ordered operation log shared with gateway fake for ordering assertions. */
  trace?: string[];
}

export class FakeMutationJournalStore implements MutationJournalStore {
  readonly auditEntries: AuditLogEntry[] = [];
  private readonly records = new Map<string, PersistedMutationRecord>();
  private readonly insertionOrder: string[] = [];
  private readonly auditIds = new Set<string>();

  private readonly nowFn: () => Instant;
  private readonly trace?: string[];

  constructor(options: FakeMutationJournalStoreOptions = {}) {
    this.nowFn = options.now ?? (() => '2026-08-24T12:00:00.000Z');
    this.trace = options.trace;
  }

  async persistBaseline(record: PersistedMutationRecord): Promise<void> {
    this.trace?.push(`journal.persistBaseline:${record.planId}`);
    if (this.records.has(record.planId)) {
      throw new PlatformError(
        'INVALID_STATE',
        `baseline already persisted for plan ${record.planId}`,
      );
    }
    const stored: PersistedMutationRecord = {
      ...structuredClone(record),
      state: 'SNAPSHOT_PERSISTED',
      confirmedChangeIds: [],
      updatedAt: this.nowFn(),
    };
    this.records.set(record.planId, stored);
    this.insertionOrder.push(record.planId);
  }

  async updateProgress(
    planId: string,
    patch: JournalProgressPatch,
  ): Promise<PersistedMutationRecord> {
    this.trace?.push(`journal.updateProgress:${planId}:${patch.state ?? 'progress'}`);
    const record = this.records.get(planId);
    if (!record) {
      throw new PlatformError('NOT_FOUND', `no journal record for plan ${planId}`);
    }
    if (patch.state !== undefined) record.state = patch.state;
    if (patch.confirmedChangeIds !== undefined) {
      record.confirmedChangeIds = [...patch.confirmedChangeIds];
    }
    record.updatedAt = this.nowFn();
    return structuredClone(record);
  }

  async loadByPlanId(planId: string): Promise<PersistedMutationRecord | null> {
    const record = this.records.get(planId);
    return record ? structuredClone(record) : null;
  }

  async loadLatestInProgress(scope: ScheduleScope): Promise<PersistedMutationRecord | null> {
    for (let i = this.insertionOrder.length - 1; i >= 0; i--) {
      const id = this.insertionOrder[i];
      if (id === undefined) continue;
      const record = this.records.get(id);
      if (!record) continue;
      if (!IN_PROGRESS_STATES.has(record.state)) continue;
      if (
        record.scope.scheduleId === scope.scheduleId &&
        record.scope.ownerType === scope.ownerType &&
        record.scope.ownerId === scope.ownerId
      ) {
        return structuredClone(record);
      }
    }
    return null;
  }

  async recordAudit(entry: AuditLogEntry): Promise<void> {
    this.trace?.push(`journal.recordAudit:${entry.action}:${entry.planId}`);
    if (this.auditIds.has(entry.entryId)) {
      throw new PlatformError('INVALID_STATE', `duplicate audit entry id ${entry.entryId}`);
    }
    this.auditIds.add(entry.entryId);
    this.auditEntries.push(structuredClone(entry));
  }

  async listAudit(scope?: ScheduleScope): Promise<AuditLogEntry[]> {
    const filtered = scope
      ? this.auditEntries.filter(
          (e) =>
            e.scope.scheduleId === scope.scheduleId &&
            e.scope.ownerType === scope.ownerType &&
            e.scope.ownerId === scope.ownerId,
        )
      : [...this.auditEntries];
    return structuredClone(filtered);
  }
}
