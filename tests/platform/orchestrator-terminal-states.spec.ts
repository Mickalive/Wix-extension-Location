/**
 * Orchestrator terminal-state hardening regressions (INT-C2-1 item a; accepted
 * audit CYCLE_32692407760_INTEGRATION.md observation N1).
 *
 * Binding behavior proven here:
 *  - completeApply AND failApply reject EVERY terminal journal state
 *    (APPLY_COMPLETED, ROLLED_BACK, RECOVERED) with an INVALID_STATE
 *    PlatformError — not merely APPLY_COMPLETED;
 *  - the rejection happens FAIL-FAST: no gateway verify/rollback call, no
 *    journal progress write, and NO second audit entry is appended;
 *  - the clock ADVANCES between operations, proving the guard itself (not the
 *    journal's duplicate-audit-id integrity check) rejects the call — with a
 *    frozen clock a pre-fix duplicate would have died on entry-id collision
 *    instead, and with an advancing clock it would have appended a second
 *    MUTATION_FAILED_ROLLED_BACK / MUTATION_APPLIED entry for one run.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/platform/adapters/fakes/clock';
import {
  FakeMutationJournalStore,
  FakeScheduleGateway,
} from '../../src/platform/adapters/fakes/index';
import { ScheduleMutationOrchestrator } from '../../src/platform/schedule-mutation/orchestrator';
import type {
  MutationPlan,
  ScheduleEventRecord,
  ScheduleScope,
  Weekday,
} from '../../src/platform/contracts';

const SCHEDULE_ID = 'sched-business-n1';
const SCOPE: ScheduleScope = { scheduleId: SCHEDULE_ID, ownerType: 'BUSINESS', ownerId: 'owner-n1' };
const SITE_ID = 'site-under-test'; // test-local derivation input, not a Wix identifier

function makeMaster(id: string, weekday: Weekday): ScheduleEventRecord {
  return {
    eventId: id,
    type: 'WORKING_HOURS',
    recurrence: 'MASTER',
    scheduleId: SCHEDULE_ID,
    startLocalDate: '2026-08-24',
    startLocalTime: '10:00',
    endLocalTime: '18:00',
    weekday,
    locationId: null,
    revision: '3',
    raw: { source: 'seed' },
  };
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
  gateway.seed(SCHEDULE_ID, [makeMaster('evt-mon', 'MON')]);
  return { gateway, journal, clock, trace };
}

function makeOrchestrator(deps: Deps): ScheduleMutationOrchestrator {
  return new ScheduleMutationOrchestrator({
    gateway: deps.gateway,
    journal: deps.journal,
    clock: deps.clock,
    siteId: SITE_ID,
  });
}

function planWith(planId: string, clock: FakeClock): MutationPlan {
  return {
    planId,
    scope: SCOPE,
    ruleVersion: 1,
    changes: [
      {
        changeId: `${planId}-c0`,
        action: 'CREATE_MASTER',
        weekday: 'TUE',
        startTime: '09:00',
        endTime: '12:00',
        anchorDate: '2026-08-25',
        locationId: null,
      },
    ],
    createdAt: clock.now(),
    createdBy: 'tester',
    reason: `terminal-state drill ${planId}`,
  };
}

/** Drives a plan to ROLLED_BACK via verification drift and returns its audit count. */
async function driveToRolledBack(deps: Deps, orch: ScheduleMutationOrchestrator): Promise<MutationPlan> {
  const plan = planWith('plan-rolled-back', deps.clock);
  deps.gateway.forceVerifyDrift(plan.planId, ['external drift']);
  const summary = await orch.applyPlan(plan);
  expect(summary.status).toBe('ROLLED_BACK');
  const record = await deps.journal.loadByPlanId(plan.planId);
  expect(record?.state).toBe('ROLLED_BACK');
  return plan;
}

/** Drives a plan to RECOVERED via simulated crash mid-apply + recovery. */
async function driveToRecovered(deps: Deps, orch: ScheduleMutationOrchestrator): Promise<MutationPlan> {
  const plan = planWith('plan-recovered', deps.clock);
  deps.gateway.crashBeforeChangeNumber(plan.planId, 1); // die before the FIRST write
  await orch.beginApply(plan);
  await expect(orch.applyNextChange(plan)).rejects.toMatchObject({ name: 'SimulatedProcessCrash' });

  const freshProcess = makeOrchestrator(deps);
  const recovery = await freshProcess.recoverInterruptedApply(SCOPE);
  expect(recovery?.planId).toBe(plan.planId);
  const record = await deps.journal.loadByPlanId(plan.planId);
  expect(record?.state).toBe('RECOVERED');
  return plan;
}

/** Drives a plan to APPLY_COMPLETED successfully. */
async function driveToCompleted(deps: Deps, orch: ScheduleMutationOrchestrator): Promise<MutationPlan> {
  const plan = planWith('plan-completed', deps.clock);
  const summary = await orch.applyPlan(plan);
  expect(summary.status).toBe('APPLIED');
  const record = await deps.journal.loadByPlanId(plan.planId);
  expect(record?.state).toBe('APPLY_COMPLETED');
  return plan;
}

interface TraceCounts {
  verify: number;
  rollback: number;
  apply: number;
}

function countGatewayOps(deps: Deps): TraceCounts {
  return {
    verify: deps.trace.filter((t) => t.startsWith('gateway.verify:')).length,
    rollback: deps.trace.filter((t) => t.startsWith('gateway.rollback:')).length,
    apply: deps.trace.filter((t) => t.startsWith('gateway.apply:')).length,
  };
}

describe('completeApply rejects EVERY terminal state fail-fast (N1)', () => {
  for (const [label, drive] of [
    ['ROLLED_BACK', driveToRolledBack],
    ['RECOVERED', driveToRecovered],
    ['APPLY_COMPLETED', driveToCompleted],
  ] as const) {
    it(`rejects a post-${label} completeApply with INVALID_STATE and appends no second audit entry`, async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const plan = await drive(deps, orch);

      const auditBefore = await deps.journal.listAudit();
      const opsBefore = countGatewayOps(deps);

      // Advance the clock so a hypothetical second audit entry would carry a
      // DISTINCT id — only the orchestrator's own terminal-state guard can
      // reject this call (audit observation N1's adversarial scenario).
      deps.clock.advanceMs(3_600_000);

      await expect(orch.completeApply(plan)).rejects.toMatchObject({
        name: 'PlatformError',
        code: 'INVALID_STATE',
        retriable: false,
      });
      await expect(orch.completeApply(plan)).rejects.toThrow(
        new RegExp(`terminal state ${label}`),
      );

      const auditAfter = await deps.journal.listAudit();
      expect(auditAfter).toHaveLength(auditBefore.length); // no second audit entry
      const opsAfter = countGatewayOps(deps);
      expect(opsAfter.verify).toBe(opsBefore.verify); // fail-fast: never re-verified
      expect(opsAfter.rollback).toBe(opsBefore.rollback); // never re-rolled back
      expect(opsAfter.apply).toBe(opsBefore.apply); // never re-applied
    });
  }

  it('reports NOT_FOUND for an unknown plan before any state check can pass', async () => {
    const deps = makeDeps();
    const ghost: MutationPlan = planWith('plan-ghost', deps.clock);
    await expect(makeOrchestrator(deps).completeApply(ghost)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('failApply rejects EVERY terminal state fail-fast (N1)', () => {
  for (const [label, drive] of [
    ['ROLLED_BACK', driveToRolledBack],
    ['RECOVERED', driveToRecovered],
    ['APPLY_COMPLETED', driveToCompleted],
  ] as const) {
    it(`rejects a post-${label} failApply with INVALID_STATE and appends no second audit entry`, async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const plan = await drive(deps, orch);

      const auditBefore = await deps.journal.listAudit();
      const opsBefore = countGatewayOps(deps);

      // Advancing clock: a pre-fix implementation would append a SECOND
      // MUTATION_FAILED_ROLLED_BACK entry under a distinct id here.
      deps.clock.advanceMs(3_600_000);

      await expect(
        orch.failApply(plan, { code: 'VERIFY_FAILED', message: 'late failure probe' }),
      ).rejects.toMatchObject({
        name: 'PlatformError',
        code: 'INVALID_STATE',
        retriable: false,
      });

      const auditAfter = await deps.journal.listAudit();
      expect(auditAfter).toHaveLength(auditBefore.length); // no duplicate failure entry
      const opsAfter = countGatewayOps(deps);
      expect(opsAfter.rollback).toBe(opsBefore.rollback); // no second rollback ran
      expect(opsAfter.verify).toBe(opsBefore.verify);
      expect(opsAfter.apply).toBe(opsBefore.apply);

      // The durable record was left untouched by the rejected call.
      const record = await deps.journal.loadByPlanId(plan.planId);
      expect(record?.state).toBe(label);
    });
  }
});
