import type {
  AuditLogEntry,
  JournalProgressPatch,
  MutationJournalStore,
  PersistedMutationRecord,
  ScheduleScope,
} from '../../../domain/ports';
import { loadState, saveState } from './state-store';

const TERMINAL = new Set(['APPLY_COMPLETED', 'ROLLED_BACK', 'RECOVERED']);

function scopeKey(scope: ScheduleScope): string {
  return [scope.ownerType, scope.ownerId, scope.scheduleId, scope.locationId ?? ''].join('-').replace(/[^A-Za-z0-9-]/g, '-');
}

export class WixDataMutationJournal implements MutationJournalStore {
  constructor(private readonly instanceId: string) {}

  async persistBaseline(record: PersistedMutationRecord): Promise<void> {
    await saveState(this.instanceId, `journal-${record.planId}`, 'mutation', record);
    await saveState(this.instanceId, `journal-scope-${scopeKey(record.scope)}`, 'mutation', { planId: record.planId });
  }

  async updateProgress(planId: string, patch: JournalProgressPatch): Promise<PersistedMutationRecord> {
    const current = await this.loadByPlanId(planId);
    if (!current) throw new Error(`Missing mutation journal ${planId}`);
    const next: PersistedMutationRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await saveState(this.instanceId, `journal-${planId}`, 'mutation', next);
    return next;
  }

  loadByPlanId(planId: string): Promise<PersistedMutationRecord | null> {
    return loadState<PersistedMutationRecord>(this.instanceId, `journal-${planId}`);
  }

  async loadLatestInProgress(scope: ScheduleScope): Promise<PersistedMutationRecord | null> {
    const pointer = await loadState<{ planId?: string }>(this.instanceId, `journal-scope-${scopeKey(scope)}`);
    if (!pointer?.planId) return null;
    const record = await this.loadByPlanId(pointer.planId);
    if (!record || TERMINAL.has(record.state)) return null;
    return record;
  }

  async recordAudit(entry: AuditLogEntry): Promise<void> {
    const key = `audit-${scopeKey(entry.scope)}`;
    const existing = (await loadState<AuditLogEntry[]>(this.instanceId, key)) ?? [];
    const next = [...existing, entry].slice(-200);
    await saveState(this.instanceId, key, 'mutation', next);
  }

  async listAudit(scope?: ScheduleScope): Promise<AuditLogEntry[]> {
    if (!scope) return [];
    return (await loadState<AuditLogEntry[]>(this.instanceId, `audit-${scopeKey(scope)}`)) ?? [];
  }
}
