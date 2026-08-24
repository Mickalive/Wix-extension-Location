/**
 * Schedule-mutation orchestrator tests (INT-C1-1 item d; Contract §9, gate
 * T-RB1 simulation). Proves each mandated acceptance behavior:
 *   1. snapshot persisted BEFORE the first write;
 *   2. replaying apply with an identical idempotency key => exactly one applied change;
 *   3. stale-revision conflict retries with a fresh revision then succeeds;
 *   4. simulated crash mid-apply + recovery run restores the EXACT pre-apply state;
 *   5. every completed mutation appends exactly one audit entry.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/platform/adapters/fakes/clock';
import {
  FakeMutationJournalStore,
  FakeScheduleGateway,
  SimulatedProcessCrash,
} from '../../src/platform/adapters/fakes/index';
import { ScheduleMutationOrchestrator } from '../../src/platform/schedule-mutation/orchestrator';
import { deriveChangeIdempotencyKey } from '../../src/platform/schedule-mutation/idempotency';
import type {
  ApplyResult,
  MutationPlan,
  ScheduleEventRecord,
  ScheduleGateway,
  ScheduleScope,
  Weekday,
} from '../../src/platform/contracts';

const SCHEDULE_ID = 'sched-business-1';
const SCOPE: ScheduleScope = { scheduleId: SCHEDULE_ID, ownerType: 'BUSINESS', ownerId: 'owner-1' };
const SITE_ID = 'site-under-test'; // test-local derivation input, not a Wix identifier

function makeMaster(
  id: string,
  weekday: Weekday,
  anchorDate: string,
  start = '10:00',
  end = '18:00',
): ScheduleEventRecord {
  return {
    eventId: id,
    type: 'WORKING_HOURS',
    recurrence: 'MASTER',
    scheduleId: SCHEDULE_ID,
    startLocalDate: anchorDate,
    startLocalTime: start,
    endLocalTime: end,
    weekday,
    locationId: null,
    revision: '3',
    raw: { source: 'seed', eventId: id },
  };
}

/** Contract §4.4 default business schedule shape: Mon–Fri 10:00–18:00 MASTERs. */
function seedDefaultSchedule(gateway: FakeScheduleGateway): ScheduleEventRecord[] {
  const seed: ScheduleEventRecord[] = [
    makeMaster('evt-mon', 'MON', '2026-08-24'),
    makeMaster('evt-tue', 'TUE', '2026-08-25'),
    makeMaster('evt-wed', 'WED', '2026-08-26'),
    makeMaster('evt-thu', 'THU', '2026-08-27'),
    makeMaster('evt-fri', 'FRI', '2026-08-28'),
  ];
  gateway.seed(SCHEDULE_ID, seed);
  return structuredClone(seed);
}

interface Deps {
  gateway: FakeScheduleGateway;
  journal: FakeMutationJournalStore;
  clock: FakeClock;
  trace: string[];
}

function makeDeps(): Deps {
  const trace: string[] = [];
  const clock = new FakeClock('2026-08-24T12:00:00.000Z');
  const gateway = new FakeScheduleGateway({ now: () => clock.now(), trace });
  const journal = new FakeMutationJournalStore({ now: () => clock.now(), trace });
  return { gateway, journal, clock, trace };
}

function makeOrchestrator(deps: Deps, overrides?: { maxRevisionRetries?: number }) {
  return new ScheduleMutationOrchestrator({
    gateway: deps.gateway,
    journal: deps.journal,
    clock: deps.clock,
    siteId: SITE_ID,
    maxRevisionRetries: overrides?.maxRevisionRetries,
  });
}

function createChange(changeId: string, weekday: Weekday, anchorDate: string, startTime: string, endTime: string) {
  return {
    changeId,
    action: 'CREATE_MASTER' as const,
    weekday,
    startTime,
    endTime,
    anchorDate,
    locationId: null,
  };
}

/** Spy wrapper capturing per-change gateway results for assertions. */
function spyGateway(inner: ScheduleGateway): { gateway: ScheduleGateway; results: ApplyResult[] } {
  const results: ApplyResult[] = [];
  const gateway: ScheduleGateway = {
    snapshotWorkingHours: (scope) => inner.snapshotWorkingHours(scope),
    verifyApplied: (plan) => inner.verifyApplied(plan),
    rollbackTo: (snapshot) => inner.rollbackTo(snapshot),
    applyWindowChanges: async (plan) => {
      const result = await inner.applyWindowChanges(plan);
      results.push(result);
      return result;
    },
  };
  return { gateway, results };
}

describe('schedule-mutation orchestrator (Contract §9)', () => {
  it('persists the snapshot to the journal BEFORE the first gateway write', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps);
    const plan: MutationPlan = {
      planId: 'plan-order',
      scope: SCOPE,
      ruleVersion: 1,
      changes: [createChange('c0', 'MON', '2026-08-31', '09:00', '12:00')],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'split Monday hours',
    };

    await orch.applyPlan(plan);

    const baselineIdx = deps.trace.indexOf(`journal.persistBaseline:${plan.planId}`);
    const firstWriteIdx = deps.trace.findIndex((t) => t.startsWith('gateway.apply:'));
    expect(baselineIdx).toBeGreaterThanOrEqual(0);
    expect(firstWriteIdx).toBeGreaterThan(baselineIdx);
    // Snapshot itself is taken before the baseline persist (§9.1 order).
    expect(deps.trace[0]).toBe(`gateway.snapshot:${SCHEDULE_ID}`);
    expect(deps.trace[1]).toBe(`journal.persistBaseline:${plan.planId}`);
  });

  it('replaying apply with identical idempotency keys results in exactly ONE applied change', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const spied = spyGateway(deps.gateway);
    const orchA = new ScheduleMutationOrchestrator({ gateway: spied.gateway, journal: deps.journal, clock: deps.clock, siteId: SITE_ID });
    const orchB = new ScheduleMutationOrchestrator({ gateway: spied.gateway, journal: deps.journal, clock: deps.clock, siteId: SITE_ID });

    const changes = [createChange('c0', 'SAT', '2026-09-05', '09:00', '12:00')];
    // Two plans, same semantic content => same derived idempotency keys.
    const planA: MutationPlan = { planId: 'plan-a', scope: SCOPE, ruleVersion: 2, changes, createdAt: deps.clock.now(), createdBy: 'tester', reason: 'add Saturday window' };
    const planB: MutationPlan = { ...planA, planId: 'plan-b' };

    const summaryA = await orchA.applyPlan(planA);
    expect(summaryA.status).toBe('APPLIED');

    const expectedKey = deriveChangeIdempotencyKey(
      { siteId: SITE_ID, scopeScheduleId: SCHEDULE_ID, ruleVersion: 2 },
      changes[0]!,
    );
    expect(deps.gateway.hasAppliedKey(expectedKey)).toBe(true);

    const summaryB = await orchB.applyPlan(planB);
    expect(summaryB.status).toBe('APPLIED'); // completed as a no-op replay

    // The replay attempt hit the gateway and was recognized as already applied.
    const replayResult = spied.results.at(-1);
    expect(replayResult?.results[0]?.status).toBe('SKIPPED_ALREADY_APPLIED');
    expect(replayResult?.results[0]?.eventId).toBe(spied.results[0]?.results[0]?.eventId);

    // Exactly one applied change exists on the schedule: 5 seeded + 1 created.
    const live = deps.gateway.liveEvents(SCHEDULE_ID);
    expect(live).toHaveLength(6);
    const saturdayWindows = live.filter((e) => e.weekday === 'SAT');
    expect(saturdayWindows).toHaveLength(1);
    expect(saturdayWindows[0]).toMatchObject({ startLocalTime: '09:00', endLocalTime: '12:00' });
  });

  it('retries a stale-revision conflict with a fresh revision and then succeeds', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const spied = spyGateway(deps.gateway);
    const orch = new ScheduleMutationOrchestrator({ gateway: spied.gateway, journal: deps.journal, clock: deps.clock, siteId: SITE_ID });

    const update = {
      changeId: 'u-mon',
      action: 'UPDATE_MASTER' as const,
      eventId: 'evt-mon',
      expectedRevision: '3',
      startTime: '08:00',
      endTime: '18:00',
    };
    const plan: MutationPlan = {
      planId: 'plan-conflict',
      scope: SCOPE,
      ruleVersion: 3,
      changes: [update],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'earlier Monday opening',
    };

    // Simulate a concurrent writer bumping the revision before our first attempt.
    deps.gateway.queueRevisionConflictOnce('u-mon');

    await deps.journal.persistBaseline({
      planId: plan.planId,
      scope: SCOPE,
      state: 'SNAPSHOT_PERSISTED',
      snapshot: await deps.gateway.snapshotWorkingHours(SCOPE),
      plan,
      confirmedChangeIds: [],
      updatedAt: deps.clock.now(),
    });
    // Step-level call exposes the orchestrator's retry-aware change record.
    const applied = await orch.applyNextChange(plan);
    await orch.completeApply(plan);

    expect(applied.status).toBe('APPLIED');
    expect(applied.attempts).toBe(2); // one conflict + one successful retry
    // First gateway call conflicted, second succeeded after re-reading revisions.
    expect(spied.results).toHaveLength(2);
    expect(spied.results[0]?.results[0]?.status).toBe('FAILED');
    expect(spied.results[0]?.results[0]?.error?.code).toBe('REVISION_CONFLICT');
    expect(spied.results[1]?.results[0]?.status).toBe('APPLIED');

    const monday = deps.gateway.liveEvents(SCHEDULE_ID).find((e) => e.eventId === 'evt-mon');
    expect(monday?.startLocalTime).toBe('08:00');
    expect(monday?.revision).toBe('5'); // concurrent bump -> 4, our write -> 5

    // Exactly one audit entry for the successful mutation run.
    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('MUTATION_APPLIED');
  });

  it('stops after bounded revision retries, rolls back, and leaves content unchanged', async () => {
    const deps = makeDeps();
    const preApply = seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps, { maxRevisionRetries: 2 });

    const plan: MutationPlan = {
      planId: 'plan-conflict-exhausted',
      scope: SCOPE,
      ruleVersion: 3,
      changes: [{
        changeId: 'u-tue',
        action: 'UPDATE_MASTER',
        eventId: 'evt-tue',
        expectedRevision: '3',
        startTime: '07:00',
      }],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'persistent conflict drill',
    };
    deps.gateway.failConflictsAlways('u-tue');

    const summary = await orch.applyPlan(plan);

    expect(summary.status).toBe('ROLLED_BACK');
    expect(summary.rollback?.complete).toBe(true);
    // Live state restored to exact pre-apply CONTENT. Revisions legitimately
    // differ: simulated concurrent writers bumped evt-tue's revision, and a
    // rollback restores content — it cannot un-bump platform revisions.
    const stripRevisions = (events: ScheduleEventRecord[]) =>
      events.map((e) => ({ ...e, revision: '' }));
    expect(stripRevisions(deps.gateway.liveEvents(SCHEDULE_ID))).toEqual(stripRevisions(preApply));
    const record = await deps.journal.loadByPlanId(plan.planId);
    expect(record?.state).toBe('ROLLED_BACK');
    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('MUTATION_FAILED_ROLLED_BACK');
    expect(audit[0]?.rollbackRef).toBe(summary.rollback?.snapshotId);
  });

  it('recovers from a simulated crash mid-apply by restoring the EXACT pre-apply state', async () => {
    const deps = makeDeps();
    const preApply = seedDefaultSchedule(deps.gateway);
    const preApplyIds = new Set(preApply.map((e) => e.eventId));

    const plan: MutationPlan = {
      planId: 'plan-crash',
      scope: SCOPE,
      ruleVersion: 4,
      changes: [
        createChange('c-mon-am', 'MON', '2026-08-31', '09:00', '12:00'),
        createChange('c-mon-pm', 'MON', '2026-08-31', '14:00', '18:00'),
        createChange('c-sun', 'SUN', '2026-09-06', '10:00', '13:00'),
      ],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'split windows rollout',
    };
    deps.gateway.crashBeforeChangeNumber(plan.planId, 2); // die just before the 2nd write

    // --- first process: applies change #1, then "dies" ---
    const dyingProcess = makeOrchestrator(deps);
    await dyingProcess.beginApply(plan);
    const first = await dyingProcess.applyNextChange(plan);
    expect(first.status).toBe('APPLIED');
    await expect(dyingProcess.applyNextChange(plan)).rejects.toBeInstanceOf(SimulatedProcessCrash);

    // Journal durably holds the interrupted state.
    const interrupted = await deps.journal.loadLatestInProgress(SCOPE);
    expect(interrupted?.planId).toBe('plan-crash');
    expect(interrupted?.state).toBe('APPLY_IN_PROGRESS');
    expect(interrupted?.confirmedChangeIds).toEqual(['c-mon-am']);

    // One orphaned write escaped before the crash.
    const liveAfterCrash = deps.gateway.liveEvents(SCHEDULE_ID);
    expect(liveAfterCrash).toHaveLength(6);
    const orphans = liveAfterCrash.filter((e) => !preApplyIds.has(e.eventId));
    expect(orphans).toHaveLength(1);

    // --- second process: recovery restores the exact pre-apply state ---
    const freshProcess = makeOrchestrator(deps);
    const recovery = await freshProcess.recoverInterruptedApply(SCOPE);

    expect(recovery).not.toBeNull();
    expect(recovery?.planId).toBe('plan-crash');
    expect(recovery?.complete).toBe(true);
    expect(recovery?.mismatches).toEqual([]);

    expect(deps.gateway.liveEvents(SCHEDULE_ID)).toEqual(preApply); // ids AND content
    expect(
      deps.gateway.tombstonedEvents(SCHEDULE_ID).map((e) => e.eventId),
    ).toContain(orphans[0]!.eventId);

    const record = await deps.journal.loadByPlanId('plan-crash');
    expect(record?.state).toBe('RECOVERED');

    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('RECOVERY_COMPLETED');
    expect(audit[0]?.snapshotRef).toBe(interrupted?.snapshot.snapshotId);
    expect(audit[0]?.rollbackRef).toBe(interrupted?.snapshot.snapshotId);
  });

  it('supports resuming an interrupted apply instead of rolling back (idempotent writes)', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const plan: MutationPlan = {
      planId: 'plan-resume',
      scope: SCOPE,
      ruleVersion: 5,
      changes: [
        createChange('r-sat', 'SAT', '2026-09-05', '10:00', '12:00'),
        createChange('r-sun', 'SUN', '2026-09-06', '10:00', '12:00'),
      ],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'weekend windows',
    };
    deps.gateway.crashBeforeChangeNumber(plan.planId, 2);

    const firstProcess = makeOrchestrator(deps);
    await firstProcess.beginApply(plan);
    await firstProcess.applyNextChange(plan);
    await expect(firstProcess.applyNextChange(plan)).rejects.toBeInstanceOf(SimulatedProcessCrash);

    // The transient fault does not recur in the second process.
    deps.gateway.resetFaults();

    const secondProcess = makeOrchestrator(deps);
    const second = await secondProcess.applyNextChange(plan); // resumes pending change
    expect(second.status).toBe('APPLIED');
    const summary = await secondProcess.completeApply(plan);
    expect(summary.status).toBe('APPLIED');
    expect(deps.gateway.liveEvents(SCHEDULE_ID)).toHaveLength(7);
  });

  it('rolls back when verification detects drift, then audits the failure', async () => {
    const deps = makeDeps();
    const preApply = seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps);
    const plan: MutationPlan = {
      planId: 'plan-drift',
      scope: SCOPE,
      ruleVersion: 6,
      changes: [createChange('d-wed', 'WED', '2026-09-02', '11:00', '15:00')],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'verify drift drill',
    };
    deps.gateway.forceVerifyDrift(plan.planId, ['external writer removed the created window']);

    const summary = await orch.applyPlan(plan);

    expect(summary.status).toBe('ROLLED_BACK');
    expect(summary.verify?.verified).toBe(false);
    expect(deps.gateway.liveEvents(SCHEDULE_ID)).toEqual(preApply);
    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('MUTATION_FAILED_ROLLED_BACK');
  });

  it('appends exactly ONE audit entry per mutation run with who/when/what/why/refs', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps);
    const plan: MutationPlan = {
      planId: 'plan-audit',
      scope: SCOPE,
      ruleVersion: 7,
      changes: [createChange('a-thu', 'THU', '2026-09-03', '09:00', '11:00')],
      createdAt: deps.clock.now(),
      createdBy: 'merchant-admin',
      reason: 'extend Thursday morning',
    };

    const summary = await orch.applyPlan(plan);
    deps.clock.advanceMs(1000);
    const replaySummary = await makeOrchestrator(deps).applyPlan({ ...plan, planId: 'plan-audit-2' });

    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(2); // one per completed mutation run

    const first = audit[0];
    expect(first?.action).toBe('MUTATION_APPLIED');
    expect(first?.actor).toBe('merchant-admin');
    expect(first?.at).toBe('2026-08-24T12:00:00.000Z');
    expect(first?.planId).toBe('plan-audit');
    expect(first?.summary).toContain('Applied 1/1');
    expect(first?.snapshotRef).toMatch(/^snap-/);
    expect(first?.rollbackRef).toBeNull();
    expect(first?.entryId).toBe(summary.auditEntryId);

    const second = audit[1];
    expect(second?.at).toBe('2026-08-24T12:00:01.000Z');
    expect(second?.entryId).toBe(replaySummary.auditEntryId);
    expect(second?.entryId).not.toBe(first?.entryId);
  });

  it('handles empty plans without any gateway write and still audits once', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps);
    const plan: MutationPlan = {
      planId: 'plan-empty',
      scope: SCOPE,
      ruleVersion: 8,
      changes: [],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'no-op confirmation',
    };

    const summary = await orch.applyPlan(plan);

    expect(summary.status).toBe('APPLIED');
    expect(summary.appliedCount).toBe(0);
    expect(deps.trace.some((t) => t.startsWith('gateway.apply:'))).toBe(false);
    const audit = await deps.journal.listAudit();
    expect(audit).toHaveLength(1);
  });

  it('beginApply resumes an existing non-terminal baseline without replacing the snapshot', async () => {
    const deps = makeDeps();
    seedDefaultSchedule(deps.gateway);
    const orch = makeOrchestrator(deps);
    const plan: MutationPlan = {
      planId: 'plan-resume-baseline',
      scope: SCOPE,
      ruleVersion: 9,
      changes: [createChange('b-fri', 'FRI', '2026-09-04', '09:00', '10:00')],
      createdAt: deps.clock.now(),
      createdBy: 'tester',
      reason: 'baseline stability drill',
    };

    const first = await orch.beginApply(plan);
    expect(first.resumed).toBe(false);
    const second = await orch.beginApply(plan);
    expect(second.resumed).toBe(true);
    expect(second.snapshot.snapshotId).toBe(first.snapshot.snapshotId);

    const baselineCalls = deps.trace.filter((t) => t.startsWith('journal.persistBaseline:')).length;
    expect(baselineCalls).toBe(1);
  });
});
