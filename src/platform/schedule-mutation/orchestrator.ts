/**
 * Snapshot -> diff -> apply -> verify -> rollback schedule-mutation orchestrator
 * (Contract §9; Blueprint §1 `platform/schedule-mutation`).
 *
 * Binding sequence implemented here:
 *   1. SNAPSHOT  affected events (full JSON incl. revision) and persist the
 *                journal baseline BEFORE any write (§9.1).
 *   2. DIFF      the MutationPlan IS the user-confirmed diff; the dashboard's
 *                confirm modal produced it (§9.2). This orchestrator adds no
 *                rule logic — it applies exactly what it is given.
 *   3. IDEMPOTENT WRITES  deterministic UUIDv5 keys per change (§9.3); replay
 *                with an identical key yields SKIPPED_ALREADY_APPLIED.
 *   4. REVISION-CHECKED UPDATES  stale revisions retry against a fresh snapshot
 *                with bounded attempts (§9.4).
 *   5. VERIFY    re-read the mutated schedule; only then mark applied (§9.5).
 *   6. ROLLBACK  on failure or recovery, restore the persisted snapshot with
 *                fresh idempotency keys (§9.6; Cancel Event is terminal).
 *   7. AUDIT     exactly one audit-log entry per completed mutation run (§9.7).
 *
 * Crash semantics (gate T-RB1): unexpected exceptions (including real process
 * death) intentionally leave the journal record APPLY_IN_PROGRESS — no in-process
 * rollback runs because a dying process cannot be trusted to roll back. The next
 * run either RESUMES via applyNextChange (safe: writes are idempotent) or calls
 * recoverInterruptedApply, which restores the exact pre-apply state from the
 * persisted snapshot.
 *
 * Serverless-friendly: beginApply / applyNextChange / completeApply are public,
 * so a long apply can span multiple invocations on the durable journal state.
 */
import { uuidV5 } from './idempotency';
import { deriveChangeIdempotencyKey } from './idempotency';
import { PlatformError } from '../contracts';
import type {
  AppliedChangeRecord,
  AuditAction,
  AuditLogEntry,
  Clock,
  MutationJournalStore,
  MutationPlan,
  MutationRecordState,
  PersistedMutationRecord,
  RollbackResult,
  ScheduleGateway,
  ScheduleScope,
  ScheduleSnapshot,
  VerifyResult,
} from '../contracts';

export interface ScheduleMutationOrchestratorOptions {
  gateway: ScheduleGateway;
  journal: MutationJournalStore;
  clock: Clock;
  /**
   * Tenant identifier used ONLY inside idempotency-key derivation. Supplied by
   * the runtime context; this library never fabricates Wix identifiers.
   */
  siteId: string;
  /** Bounded revision-conflict retries per change (Contract §9.4). Default 3. */
  maxRevisionRetries?: number;
  /** Audit actor when plan.createdBy is absent. */
  actor?: string;
}

export interface BeginApplyOutcome {
  record: PersistedMutationRecord;
  snapshot: ScheduleSnapshot;
  /** True when an existing non-terminal baseline was resumed instead of recreated. */
  resumed: boolean;
}

export interface MutationSummary {
  planId: string;
  status: 'APPLIED' | 'ROLLED_BACK';
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  verify: VerifyResult | null;
  rollback: RollbackResult | null;
  auditEntryId: string;
}

export interface RecoverySummary {
  planId: string;
  snapshotId: string;
  complete: boolean;
  mismatches: string[];
  notes: string[];
  auditEntryId: string;
}

/**
 * Terminal journal states (cycle-2 hardening, accepted-audit observation N1):
 * EVERY state outside the non-terminal allowlist below is treated as terminal,
 * so a future state addition can never silently bypass the guards. Both
 * completeApply and failApply reject every terminal state with INVALID_STATE
 * BEFORE touching the gateway or appending any audit entry.
 */
const NON_TERMINAL_STATES: ReadonlySet<MutationRecordState> = new Set([
  'SNAPSHOT_PERSISTED',
  'APPLY_IN_PROGRESS',
]);

function assertNotTerminal(planId: string, state: MutationRecordState): void {
  if (!NON_TERMINAL_STATES.has(state)) {
    throw new PlatformError(
      'INVALID_STATE',
      `plan ${planId} already reached terminal state ${state}; the requested transition is rejected fail-fast (no gateway call, no journal write, no audit entry)`,
    );
  }
}

export class ScheduleMutationOrchestrator {
  private readonly gateway: ScheduleGateway;
  private readonly journal: MutationJournalStore;
  private readonly clock: Clock;
  private readonly siteId: string;
  private readonly maxRevisionRetries: number;
  private readonly actor: string;

  constructor(options: ScheduleMutationOrchestratorOptions) {
    this.gateway = options.gateway;
    this.journal = options.journal;
    this.clock = options.clock;
    this.siteId = options.siteId;
    this.maxRevisionRetries = options.maxRevisionRetries ?? 3;
    this.actor = options.actor ?? 'schedule-mutation-orchestrator';
  }

  // ------------------------------------------------------------- step API

  /**
   * Step 1+2: snapshot the scope and persist the journal baseline BEFORE any
   * write. Idempotent for retries: an existing non-terminal baseline is
   * resumed untouched (the pre-apply snapshot must never be replaced);
   * terminal plans are rejected — submit a new planId instead.
   */
  async beginApply(plan: MutationPlan): Promise<BeginApplyOutcome> {
    const existing = await this.journal.loadByPlanId(plan.planId);
    if (existing) {
      assertNotTerminal(plan.planId, existing.state);
      return { record: existing, snapshot: existing.snapshot, resumed: true };
    }

    const enriched = this.withDerivedIdempotencyKeys(plan);
    const snapshot = await this.gateway.snapshotWorkingHours(enriched.scope);
    const record: PersistedMutationRecord = {
      planId: enriched.planId,
      scope: enriched.scope,
      state: 'SNAPSHOT_PERSISTED',
      snapshot,
      plan: enriched,
      confirmedChangeIds: [],
      updatedAt: this.clock.now(),
    };
    await this.journal.persistBaseline(record); // Contract §9.1: before ANY write
    return { record, snapshot, resumed: false };
  }

  /**
   * Step 3: durably mark APPLY_IN_PROGRESS, then apply the single oldest
   * pending change with bounded revision-conflict retry (§9.4). Progress is
   * confirmed on the journal AFTER gateway success and BEFORE the next write,
   * which is what makes crash recovery exact.
   */
  async applyNextChange(plan: MutationPlan): Promise<AppliedChangeRecord> {
    const record = await this.mustLoad(plan.planId);
    assertNotTerminal(plan.planId, record.state);
    // Defensive re-enrichment: the durable record is the source of truth for
    // resume flows, and older baselines may predate key derivation.
    const enrichedRecordPlan = this.withDerivedIdempotencyKeys(record.plan);
    const pending = pendingChanges({ ...record, plan: enrichedRecordPlan });
    const next = pending[0];
    if (!next) {
      throw new PlatformError('INVALID_STATE', `plan ${plan.planId} has no pending changes`);
    }

    await this.journal.updateProgress(plan.planId, { state: 'APPLY_IN_PROGRESS' });

    const result = await this.applySingleWithRetry(
      { ...enrichedRecordPlan, scope: record.scope },
      next,
    );

    if (result.status !== 'FAILED') {
      const confirmed = [...record.confirmedChangeIds, next.changeId];
      await this.journal.updateProgress(plan.planId, { confirmedChangeIds: confirmed });
    }
    return result;
  }

  /**
   * Steps 5–7: verify the mutated schedule; on success mark APPLY_COMPLETED and
   * append the single audit entry; on verification failure roll back (§9.6),
   * mark ROLLED_BACK and append the failure audit entry.
   *
   * Terminal-state hardening (cycle-2, audit observation N1): rejects EVERY
   * terminal journal state (APPLY_COMPLETED, ROLLED_BACK, RECOVERED — and any
   * future terminal state) with INVALID_STATE BEFORE the gateway is consulted,
   * so a post-rollback or post-recovery completion can never re-verify,
   * re-roll back, or append a second audit entry.
   */
  async completeApply(plan: MutationPlan): Promise<MutationSummary> {
    const enriched = this.withDerivedIdempotencyKeys(plan);
    const record = await this.mustLoad(enriched.planId);
    assertNotTerminal(enriched.planId, record.state);
    const verify = await this.gateway.verifyApplied(enriched);
    if (!verify.verified) {
      return this.failApply(enriched, {
        code: 'VERIFY_FAILED',
        message: `verification failed: ${verify.mismatches.join('; ')}`,
        verify,
      });
    }
    await this.journal.updateProgress(enriched.planId, { state: 'APPLY_COMPLETED' });
    const auditEntryId = await this.appendAudit({
      action: 'MUTATION_APPLIED',
      plan: enriched,
      snapshotRef: record.snapshot.snapshotId,
      summary: `Applied ${record.confirmedChangeIds.length}/${enriched.changes.length} schedule change(s).`,
      details: { verifiedAt: verify.checkedAt, ruleVersion: enriched.ruleVersion },
    });
    return {
      planId: enriched.planId,
      status: 'APPLIED',
      appliedCount: record.confirmedChangeIds.length,
      skippedCount: Math.max(enriched.changes.length - record.confirmedChangeIds.length, 0),
      failedCount: 0,
      verify,
      rollback: null,
      auditEntryId,
    };
  }

  /**
   * Failure path: rollback from the persisted snapshot, then audit (§9.6/§9.7).
   *
   * Terminal-state hardening (cycle-2, audit observation N1): rejects EVERY
   * terminal journal state with INVALID_STATE BEFORE rolling back, so a
   * completed, rolled-back or recovered plan can never be rolled back again
   * or accumulate a second failure audit entry.
   */
  async failApply(
    plan: MutationPlan,
    cause: { code: string; message: string; verify?: VerifyResult },
  ): Promise<MutationSummary> {
    const enriched = this.withDerivedIdempotencyKeys(plan);
    const record = await this.mustLoad(enriched.planId);
    assertNotTerminal(enriched.planId, record.state);
    const rollback = await this.gateway.rollbackTo(record.snapshot);
    await this.journal.updateProgress(enriched.planId, { state: 'ROLLED_BACK' });
    const auditEntryId = await this.appendAudit({
      action: 'MUTATION_FAILED_ROLLED_BACK',
      plan: enriched,
      snapshotRef: record.snapshot.snapshotId,
      summary: `Mutation failed (${cause.code}: ${cause.message}); rolled back to snapshot ${record.snapshot.snapshotId}.`,
      rollbackRef: record.snapshot.snapshotId,
      details: {
        causeCode: cause.code,
        causeMessage: cause.message,
        rollbackNotes: rollback.notes,
        removedEventIds: rollback.removedEventIds,
      },
    });
    return {
      planId: enriched.planId,
      status: 'ROLLED_BACK',
      appliedCount: record.confirmedChangeIds.length,
      skippedCount: 0,
      failedCount: Math.max(enriched.changes.length - record.confirmedChangeIds.length, 1),
      verify: cause.verify ?? null,
      rollback,
      auditEntryId,
    };
  }

  // ------------------------------------------------------- composed helpers

  /**
   * Convenience composition of the full §9 sequence for plans that fit one
   * invocation. Long-running applies should drive begin/next/complete directly.
   */
  async applyPlan(plan: MutationPlan): Promise<MutationSummary> {
    await this.beginApply(plan);
    let lastFailure: { code: string; message: string } | null = null;
    for (;;) {
      const record = await this.mustLoad(plan.planId);
      if (pendingChanges(record).length === 0) break;
      const result = await this.applyNextChange(plan);
      if (result.status === 'FAILED' && result.error) {
        lastFailure = { code: result.error.code, message: result.error.message };
        break;
      }
    }
    if (lastFailure) {
      return this.failApply(plan, lastFailure);
    }
    return this.completeApply(plan);
  }

  /**
   * Crash-mid-apply recovery (gate T-RB1): restores the EXACT pre-apply state
   * from the persisted snapshot of the latest interrupted plan for the scope,
   * verifies restoration at working-hours-window granularity, marks the record
   * RECOVERED and appends its own audit entry. Returns null when nothing is
   * pending for the scope.
   */
  async recoverInterruptedApply(scope: ScheduleScope): Promise<RecoverySummary | null> {
    const record = await this.journal.loadLatestInProgress(scope);
    if (!record) return null;

    const rollback = await this.gateway.rollbackTo(record.snapshot);
    const postRollbackSnapshot = await this.gateway.snapshotWorkingHours(scope);
    const mismatches = windowContentDiffs(record.snapshot, postRollbackSnapshot);
    const complete = rollback.complete && mismatches.length === 0;

    await this.journal.updateProgress(record.planId, { state: 'RECOVERED' });
    const at = this.clock.now();
    const auditEntryId = auditEntryIdFor(record.planId, 'RECOVERY_COMPLETED', at);
    await this.journal.recordAudit({
      entryId: auditEntryId,
      at,
      actor: this.actor,
      action: 'RECOVERY_COMPLETED',
      planId: record.planId,
      scope: record.scope,
      summary: complete
        ? `Recovered interrupted mutation ${record.planId}: pre-apply state restored from snapshot ${record.snapshot.snapshotId}.`
        : `Recovered interrupted mutation ${record.planId} WITH DRIFT: ${mismatches.join('; ')}`,
      snapshotRef: record.snapshot.snapshotId,
      rollbackRef: record.snapshot.snapshotId,
      details: { complete, mismatches, rollbackNotes: rollback.notes },
    });

    return {
      planId: record.planId,
      snapshotId: record.snapshot.snapshotId,
      complete,
      mismatches,
      notes: rollback.notes,
      auditEntryId,
    };
  }

  // -------------------------------------------------------------- internals

  private withDerivedIdempotencyKeys(plan: MutationPlan): MutationPlan {
    return {
      ...plan,
      changes: plan.changes.map((change) =>
        change.idempotencyKey
          ? change
          : {
              ...change,
              idempotencyKey: deriveChangeIdempotencyKey(
                { siteId: this.siteId, scopeScheduleId: plan.scope.scheduleId, ruleVersion: plan.ruleVersion },
                change,
              ),
            },
      ),
    };
  }

  private async mustLoad(planId: string): Promise<PersistedMutationRecord> {
    const record = await this.journal.loadByPlanId(planId);
    if (!record) {
      throw new PlatformError('NOT_FOUND', `no journal record for plan ${planId}`);
    }
    return record;
  }

  /** One change per gateway call; bounded revision-conflict retry (§9.4). */
  private async applySingleWithRetry(
    plan: MutationPlan,
    change: MutationPlan['changes'][number],
  ): Promise<AppliedChangeRecord> {
    let current = change;
    let attempt = 0;
    for (;;) {
      const single: MutationPlan = { ...plan, changes: [current] };
      const result = await this.gateway.applyWindowChanges(single);
      const first = result.results[0];
      if (!first) {
        throw new PlatformError('INTERNAL_ERROR', 'gateway returned no result for a single-change plan');
      }
      const retriableConflict =
        first.status === 'FAILED' &&
        first.error?.code === 'REVISION_CONFLICT' &&
        first.error.retriable === true;
      if (!retriableConflict || attempt >= this.maxRevisionRetries) {
        return { ...first, attempts: attempt + 1 };
      }
      // Re-read fresh revisions and retry with the updated expectation (§9.4).
      if (current.action === 'CREATE_MASTER') {
        return { ...first, attempts: attempt + 1 };
      }
      const fresh = await this.gateway.snapshotWorkingHours(plan.scope);
      // `current` narrows to UPDATE|CANCEL here; pin it to a const so the
      // narrowing survives inside the find() callback.
      const target = current;
      const freshEvent = fresh.events.find((e) => e.eventId === target.eventId);
      if (!freshEvent) {
        return { ...first, attempts: attempt + 1 };
      }
      current = { ...target, expectedRevision: freshEvent.revision };
      attempt += 1;
    }
  }

  private async appendAudit(input: {
    action: AuditAction;
    plan: MutationPlan;
    snapshotRef: string;
    summary: string;
    rollbackRef?: string;
    details?: Record<string, unknown>;
  }): Promise<string> {
    const at = this.clock.now();
    const entryId = auditEntryIdFor(input.plan.planId, input.action, at);
    const entry: AuditLogEntry = {
      entryId,
      at,
      actor: input.plan.createdBy || this.actor,
      action: input.action,
      planId: input.plan.planId,
      scope: input.plan.scope,
      summary: input.summary,
      snapshotRef: input.snapshotRef,
      rollbackRef: input.rollbackRef ?? null,
      details: input.details,
    };
    await this.journal.recordAudit(entry);
    return entryId;
  }
}

// ------------------------------------------------------------------ helpers

/** Changes not yet durably confirmed on the journal record. */
export function pendingChanges(record: PersistedMutationRecord): MutationPlan['changes'] {
  const confirmed = new Set(record.confirmedChangeIds);
  return record.plan.changes.filter((c) => !confirmed.has(c.changeId));
}

function auditEntryIdFor(planId: string, action: AuditAction, at: string): string {
  return uuidV5(`${planId}::${action}::${at}`);
}

/**
 * Window-granularity content comparison between snapshots. Event identity is
 * deliberately excluded: terminal-cancelled MASTERs re-create under new ids
 * (Contract §9.6), while working-hours windows are what availability consumes.
 */
export function windowContentDiffs(expected: ScheduleSnapshot, actual: ScheduleSnapshot): string[] {
  const signature = (e: ScheduleSnapshot['events'][number]): string =>
    [
      e.type,
      e.recurrence,
      e.weekday ?? '-',
      e.startLocalDate,
      e.startLocalTime,
      e.endLocalTime ?? '-',
      e.locationId ?? '-',
    ].join('|');

  const expectedCounts = new Map<string, number>();
  for (const e of expected.events) {
    expectedCounts.set(signature(e), (expectedCounts.get(signature(e)) ?? 0) + 1);
  }
  const actualCounts = new Map<string, number>();
  for (const e of actual.events) {
    actualCounts.set(signature(e), (actualCounts.get(signature(e)) ?? 0) + 1);
  }

  const diffs: string[] = [];
  for (const [sig, count] of expectedCounts) {
    const found = actualCounts.get(sig) ?? 0;
    if (found < count) diffs.push(`missing from restored state: ${sig} (expected ${count}, found ${found})`);
  }
  for (const [sig, count] of actualCounts) {
    const wanted = expectedCounts.get(sig) ?? 0;
    if (count > wanted) diffs.push(`unexpected in restored state: ${sig} (expected ${wanted}, found ${count})`);
  }
  return diffs;
}
