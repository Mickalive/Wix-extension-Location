/**
 * Schedule-mutation endpoint behaviors (INT-C2-1 item b; Blueprint §4 flows
 * 2–3; Contract §9). Proves:
 *  - POST apply-plan accepts ONLY a confirmed-diff hash reference: inline plans
 *    and extra keys are rejected INVALID_QUERY, unknown hashes NOT_FOUND, and
 *    execution runs the orchestrator on exactly the confirmed plan;
 *  - GET mutation-status projects the durable journal record (typed codes for
 *    missing query / unknown plan);
 *  - POST recover delegates crash-mid-apply recovery to the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import {
  getMutationStatus,
  postApplyPlan,
  postRecover,
} from '../../src/platform/http';
import type { ConfirmedPlanReference } from '../../src/platform/http';
import { FakeTokenVerifier, VALID_TOKEN, makeApplyPlanSpy, makeConfirmedPlanSpy } from './helpers/httpTestDoubles';
import type {
  MutationPlan,
  PersistedMutationRecord,
  ScheduleScope,
} from '../../src/shared/types';

const SCOPE: ScheduleScope = { scheduleId: 'sched-m', ownerType: 'BUSINESS', ownerId: 'owner-m' };

function confirmedPlan(): MutationPlan {
  return {
    planId: 'plan-confirmed',
    scope: SCOPE,
    ruleVersion: 4,
    changes: [
      {
        changeId: 'c-sat',
        action: 'CREATE_MASTER',
        weekday: 'SAT',
        startTime: '09:00',
        endTime: '12:00',
        anchorDate: '2026-08-29',
        locationId: null,
      },
    ],
    createdAt: '2026-08-24T10:00:00.000Z',
    createdBy: 'merchant-admin',
    reason: 'add Saturday window',
  };
}

function reference(diffHash: string): ConfirmedPlanReference {
  return {
    diffHash,
    plan: confirmedPlan(),
    confirmedBy: 'merchant-admin',
    confirmedAt: '2026-08-24T11:00:00.000Z',
  };
}

interface Rig {
  backing: Map<string, ConfirmedPlanReference>;
  lookup: ReturnType<typeof makeConfirmedPlanSpy>;
  orchestrator: ReturnType<typeof makeApplyPlanSpy>;
  callApplyPlan: (body: unknown) => Promise<unknown>;
}

function makeRig(): Rig {
  const backing = new Map<string, ConfirmedPlanReference>([['hash-ok', reference('hash-ok')]]);
  const lookup = makeConfirmedPlanSpy(backing);
  const orchestrator = makeApplyPlanSpy();
  const verifier = new FakeTokenVerifier();
  const callApplyPlan = async (body: unknown) =>
    postApplyPlan(
      { tokenVerifier: verifier, confirmedPlanLookup: lookup, orchestrator },
      { authToken: VALID_TOKEN, body },
    );
  return { backing, lookup, orchestrator, callApplyPlan };
}

describe('POST apply-plan requires the confirmed-diff hash reference', () => {
  it('executes the orchestrator on the EXACT confirmed plan for a known hash', async () => {
    const rig = makeRig();
    const response = (await rig.callApplyPlan({ confirmedDiffHash: 'hash-ok' })) as {
      status: number;
      body: { summary: { planId: string; status: string }; requestedBy: string };
    };
    expect(response.status).toBe(200);
    expect(response.body.summary.planId).toBe('plan-confirmed');
    expect(response.body.summary.status).toBe('APPLIED');
    expect(rig.lookup.calls()).toBe(1);
    expect(rig.orchestrator.calls()).toBe(1);
    expect(rig.orchestrator.appliedPlans()[0]?.planId).toBe('plan-confirmed');
    expect(rig.orchestrator.appliedPlans()[0]?.changes[0]?.changeId).toBe('c-sat');
  });

  it('rejects an inline plan smuggled in the body (INVALID_QUERY, zero execution)', async () => {
    const rig = makeRig();
    let caught: unknown = null;
    try {
      await rig.callApplyPlan({ plan: confirmedPlan() });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    expect(rig.orchestrator.calls()).toBe(0);
    expect(rig.lookup.calls()).toBe(0);
  });

  it('rejects any extra key next to confirmedDiffHash', async () => {
    const rig = makeRig();
    let caught: unknown = null;
    try {
      await rig.callApplyPlan({ confirmedDiffHash: 'hash-ok', planId: 'plan-confirmed' });
    } catch (error) {
      caught = error;
    }
    const err = caught as { code?: string; details?: { unexpectedKeys: string[] } };
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.details?.unexpectedKeys).toEqual(['planId']);
    expect(rig.orchestrator.calls()).toBe(0);
  });

  it('rejects an unknown / never-confirmed hash with NOT_FOUND', async () => {
    const rig = makeRig();
    let caught: unknown = null;
    try {
      await rig.callApplyPlan({ confirmedDiffHash: 'hash-unconfirmed' });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('NOT_FOUND');
    expect(rig.orchestrator.calls()).toBe(0); // nothing executed without consent
  });

  it('rejects empty and non-string hashes and bodiless requests', async () => {
    const rig = makeRig();
    for (const body of [undefined, {}, { confirmedDiffHash: '' }, { confirmedDiffHash: 7 }]) {
      let caught: unknown = null;
      try {
        await rig.callApplyPlan(body);
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string }).code).toBe('INVALID_QUERY');
    }
    expect(rig.orchestrator.calls()).toBe(0);
  });

  it('surfaces orchestrator INVALID_STATE (e.g. terminal replay) unmodified', async () => {
    const rig = makeRig();
    const failing = {
      applyPlan: async () => {
        throw Object.assign(new Error('terminal'), { code: 'INVALID_STATE', retriable: false });
      },
    };
    let caught: unknown = null;
    try {
      await postApplyPlan(
        {
          tokenVerifier: new FakeTokenVerifier(),
          confirmedPlanLookup: makeConfirmedPlanSpy(rig.backing),
          orchestrator: failing,
        },
        { authToken: VALID_TOKEN, body: { confirmedDiffHash: 'hash-ok' } },
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_STATE');
  });
});

describe('GET mutation status projects the durable journal record', () => {
  function journalWith(record: PersistedMutationRecord | null, counter: { loads: number }) {
    return {
      loadByPlanId: async (planId: string) => {
        counter.loads += 1;
        if (!record || record.planId !== planId) return null;
        return structuredClone(record);
      },
    };
  }

  const storedRecord: PersistedMutationRecord = {
    planId: 'plan-live',
    scope: SCOPE,
    state: 'APPLY_IN_PROGRESS',
    snapshot: { snapshotId: 'snap-0042', takenAt: '', scope: SCOPE, events: [] },
    plan: confirmedPlan(),
    confirmedChangeIds: ['c-sat'],
    updatedAt: '2026-08-24T12:30:00.000Z',
  };

  it('returns the typed projection for a known plan', async () => {
    const counter = { loads: 0 };
    const response = await getMutationStatus(
      { tokenVerifier: new FakeTokenVerifier(), journal: journalWith(storedRecord, counter) },
      { authToken: VALID_TOKEN, query: { planId: 'plan-live' } },
    );
    expect(response.status).toBe(200);
    expect(response.body.status).toMatchObject({
      planId: 'plan-live',
      state: 'APPLY_IN_PROGRESS',
      confirmedChangeIds: ['c-sat'],
      totalChanges: 1,
      snapshotId: 'snap-0042',
      updatedAt: '2026-08-24T12:30:00.000Z',
    });
    expect(counter.loads).toBe(1);
  });

  it('missing planId query ⇒ INVALID_QUERY; unknown plan ⇒ NOT_FOUND', async () => {
    const counter = { loads: 0 };
    const deps = {
      tokenVerifier: new FakeTokenVerifier(),
      journal: journalWith(storedRecord, counter),
    };
    await expect(
      getMutationStatus(deps, { authToken: VALID_TOKEN }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(
      getMutationStatus(deps, { authToken: VALID_TOKEN, query: { planId: 'plan-ghost' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(counter.loads).toBe(1); // missing-query rejection precedes the store
  });
});

describe('POST recover delegates crash recovery to the orchestrator', () => {
  it('returns the recovery summary when an interrupted apply exists', async () => {
    const requestedScopes: ScheduleScope[] = [];
    const summary = {
      planId: 'plan-crash',
      snapshotId: 'snap-7',
      complete: true,
      mismatches: [],
      notes: [],
      auditEntryId: 'audit-rec',
    };
    const response = (await postRecover(
      {
        tokenVerifier: new FakeTokenVerifier(),
        orchestrator: {
          recoverInterruptedApply: async (scope) => {
            requestedScopes.push(scope);
            return summary;
          },
        },
      },
      { authToken: VALID_TOKEN, body: { scope: SCOPE } },
    )) as { status: number; body: { recovery: typeof summary | null } };
    expect(response.status).toBe(200);
    expect(response.body.recovery).toEqual(summary);
    expect(requestedScopes).toEqual([SCOPE]);
  });

  it('returns an explicit null recovery when nothing is pending', async () => {
    const response = (await postRecover(
      {
        tokenVerifier: new FakeTokenVerifier(),
        orchestrator: { recoverInterruptedApply: async () => null },
      },
      { authToken: VALID_TOKEN, body: { scope: SCOPE } },
    )) as { status: number; body: { recovery: unknown } };
    expect(response.status).toBe(200);
    expect(response.body.recovery).toBeNull();
  });

  it('validates scope shape before touching the orchestrator', async () => {
    let calls = 0;
    const deps = {
      tokenVerifier: new FakeTokenVerifier(),
      orchestrator: {
        recoverInterruptedApply: async () => {
          calls += 1;
          return null;
        },
      },
    };
    for (const body of [
      undefined,
      {},
      { scope: {} },
      { scope: { scheduleId: '', ownerType: 'BUSINESS', ownerId: 'o' } },
      { scope: { scheduleId: 's', ownerType: 'GALAXY', ownerId: 'o' } },
      { scope: { scheduleId: 's', ownerType: 'BUSINESS' } },
    ]) {
      await expect(postRecover(deps, { authToken: VALID_TOKEN, body })).rejects.toMatchObject({
        code: 'INVALID_QUERY',
      });
    }
    expect(calls).toBe(0);
  });

  // N4 REGRESSION (audit CYCLE_32787032785_INTEGRATION observation 4, repaired
  // by INT-C3-1 item g): a non-string locationId must be rejected INVALID_QUERY
  // instead of being silently dropped from the scope.
  it('rejects non-string locationId values with INVALID_QUERY (N4 regression)', async () => {
    let calls = 0;
    const deps = {
      tokenVerifier: new FakeTokenVerifier(),
      orchestrator: {
        recoverInterruptedApply: async () => {
          calls += 1;
          return null;
        },
      },
    };
    for (const locationId of [42, null, { id: 'loc-1' }, ['loc-1'], '']) {
      const body = {
        scope: { scheduleId: 's', ownerType: 'BUSINESS', ownerId: 'o', locationId },
      };
      await expect(postRecover(deps, { authToken: VALID_TOKEN, body })).rejects.toMatchObject({
        code: 'INVALID_QUERY',
      });
    }
    expect(calls).toBe(0); // strict shape validation precedes the orchestrator
  });

  it('passes a string locationId through to the orchestrator scope unchanged', async () => {
    const requestedScopes: ScheduleScope[] = [];
    const response = (await postRecover(
      {
        tokenVerifier: new FakeTokenVerifier(),
        orchestrator: {
          recoverInterruptedApply: async (scope) => {
            requestedScopes.push(scope);
            return null;
          },
        },
      },
      {
        authToken: VALID_TOKEN,
        body: {
          scope: { scheduleId: 'sched-l', ownerType: 'STAFF', ownerId: 'staff-1', locationId: 'loc-9' },
        },
      },
    )) as { status: number };
    expect(response.status).toBe(200);
    expect(requestedScopes[0]?.locationId).toBe('loc-9');
  });
});
