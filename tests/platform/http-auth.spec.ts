/**
 * Auth matrix for every token-verified HTTP endpoint (INT-C2-1 item b;
 * Technical Contract §6: HTTP endpoints have NO built-in permissions model).
 *
 * Acceptance criteria proven here, for EACH of the five endpoints:
 *  - valid token  ⇒ handler executes (dependency interaction observable);
 *  - missing token ⇒ typed fail-closed UnauthorizedRequestError and ZERO
 *    store/lookup/orchestrator/journal interaction (counters stay at zero);
 *  - invalid token (verifier ⇒ null) ⇒ same fail-closed rejection;
 *  - expired token — modelled per the port contract by the verifier returning
 *    null — ⇒ same fail-closed rejection;
 *  - verifier infrastructure failure ⇒ fail-closed rejection (never authorize).
 */
import { describe, expect, it } from 'vitest';
import {
  getActiveRuleSet,
  getMutationStatus,
  postApplyPlan,
  postRecover,
  putRuleSet,
} from '../../src/platform/http';
import type { ConfirmedPlanReference } from '../../src/platform/http';
import { FakeRulesConfigStore } from '../../src/platform/adapters/fakes/rulesConfigStore';
import {
  CALLER_SUBJECT,
  FakeTokenVerifier,
  VALID_TOKEN,
  makeApplyPlanSpy,
  makeConfigStoreSpy,
  makeConfirmedPlanSpy,
  expectUnauthorized,
} from './helpers/httpTestDoubles';
import type { RuleSetDTO, ScheduleScope } from '../../src/shared/types';

const SCOPE: ScheduleScope = { scheduleId: 'sched-1', ownerType: 'BUSINESS', ownerId: 'owner-1' };

function baseRuleSet(): RuleSetDTO {
  return {
    ruleSetId: 'rs-1',
    revision: 'rev-1',
    version: 1,
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
}

function confirmedReference(): ConfirmedPlanReference {
  return {
    diffHash: 'hash-abc',
    plan: {
      planId: 'plan-1',
      scope: SCOPE,
      ruleVersion: 1,
      changes: [],
      createdAt: '2026-08-24T12:00:00.000Z',
      createdBy: 'merchant-admin',
      reason: 'confirmed diff',
    },
    confirmedBy: 'merchant-admin',
    confirmedAt: '2026-08-24T12:00:00.000Z',
  };
}

interface EndpointFixture {
  name: string;
  /** Builds fresh deps; `depInteractions` counts store/orchestrator touches. */
  make: () => {
    verifier: FakeTokenVerifier;
    call: (authToken: string | null) => Promise<unknown>;
    depInteractions: () => number;
  };
}

const ENDPOINTS: EndpointFixture[] = [
  {
    name: 'GET active RuleSet',
    make: () => {
      const verifier = new FakeTokenVerifier();
      const inner = new FakeRulesConfigStore({ initialRuleSet: baseRuleSet() });
      const spy = makeConfigStoreSpy(inner);
      return {
        verifier,
        call: (authToken) =>
          getActiveRuleSet({ tokenVerifier: verifier, configStore: spy }, { authToken }),
        depInteractions: () => spy.loadCalls() + spy.saveCalls(),
      };
    },
  },
  {
    name: 'PUT RuleSet',
    make: () => {
      const verifier = new FakeTokenVerifier();
      const inner = new FakeRulesConfigStore({ initialRuleSet: baseRuleSet() });
      const spy = makeConfigStoreSpy(inner);
      const body = { ruleSet: baseRuleSet(), expectedRevision: 'rev-1' };
      return {
        verifier,
        call: (authToken) =>
          putRuleSet({ tokenVerifier: verifier, configStore: spy }, { authToken, body }),
        depInteractions: () => spy.loadCalls() + spy.saveCalls(),
      };
    },
  },
  {
    name: 'POST apply-plan',
    make: () => {
      const verifier = new FakeTokenVerifier();
      const backing = new Map<string, ConfirmedPlanReference>([['hash-abc', confirmedReference()]]);
      const lookup = makeConfirmedPlanSpy(backing);
      const orchestrator = makeApplyPlanSpy();
      return {
        verifier,
        call: (authToken) =>
          postApplyPlan(
            { tokenVerifier: verifier, confirmedPlanLookup: lookup, orchestrator },
            { authToken, body: { confirmedDiffHash: 'hash-abc' } },
          ),
        depInteractions: () => lookup.calls() + orchestrator.calls(),
      };
    },
  },
  {
    name: 'GET mutation status',
    make: () => {
      const verifier = new FakeTokenVerifier();
      let loads = 0;
      const journal = {
        loadByPlanId: async (planId: string) => {
          loads += 1;
          if (planId !== 'plan-1') return null;
          return {
            planId: 'plan-1',
            scope: SCOPE,
            state: 'SNAPSHOT_PERSISTED' as const,
            snapshot: { snapshotId: 'snap-1', takenAt: '', scope: SCOPE, events: [] },
            plan: confirmedReference().plan,
            confirmedChangeIds: [],
            updatedAt: '2026-08-24T12:00:00.000Z',
          };
        },
      };
      return {
        verifier,
        call: (authToken) =>
          getMutationStatus(
            { tokenVerifier: verifier, journal },
            { authToken, query: { planId: 'plan-1' } },
          ),
        depInteractions: () => loads,
      };
    },
  },
  {
    name: 'POST recover',
    make: () => {
      const verifier = new FakeTokenVerifier();
      let recovers = 0;
      const orchestrator = {
        recoverInterruptedApply: async () => {
          recovers += 1;
          return null;
        },
      };
      return {
        verifier,
        call: (authToken) =>
          postRecover(
            { tokenVerifier: verifier, orchestrator },
            { authToken, body: { scope: SCOPE } },
          ),
        depInteractions: () => recovers,
      };
    },
  },
];

describe('token verification matrix across all five HTTP endpoints', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint.name}: valid token executes the handler`, async () => {
      const deps = endpoint.make();
      const response = await deps.call(VALID_TOKEN);
      expect(response).toBeDefined();
      expect(deps.verifier.calls).toEqual([VALID_TOKEN]);
      expect(deps.depInteractions()).toBeGreaterThan(0);
    });

    it(`${endpoint.name}: missing token fails closed with typed error and ZERO store mutation`, async () => {
      const deps = endpoint.make();
      let caught: unknown = null;
      try {
        await deps.call(null);
      } catch (error) {
        caught = error;
      }
      expectUnauthorized(caught, 'TOKEN_MISSING');
      expect(deps.depInteractions()).toBe(0);
    });

    it(`${endpoint.name}: invalid token fails closed with typed error and ZERO store mutation`, async () => {
      const deps = endpoint.make();
      let caught: unknown = null;
      try {
        await deps.call('forged-token');
      } catch (error) {
        caught = error;
      }
      expectUnauthorized(caught, 'TOKEN_INVALID');
      expect(deps.depInteractions()).toBe(0);
    });

    it(`${endpoint.name}: expired token (port maps expiry to null) fails closed`, async () => {
      const deps = endpoint.make();
      deps.verifier.invalidate(VALID_TOKEN); // expired tokens resolve to null
      let caught: unknown = null;
      try {
        await deps.call(VALID_TOKEN);
      } catch (error) {
        caught = error;
      }
      expectUnauthorized(caught, 'TOKEN_INVALID');
      expect(deps.depInteractions()).toBe(0);
    });

    it(`${endpoint.name}: verifier outage fails closed instead of authorizing`, async () => {
      const deps = endpoint.make();
      deps.verifier.throwWith = new Error('getTokenInfo unavailable');
      let caught: unknown = null;
      try {
        await deps.call(VALID_TOKEN);
      } catch (error) {
        caught = error;
      }
      expectUnauthorized(caught, 'TOKEN_VERIFIER_FAILED');
      expect((caught as { cause?: unknown }).cause).toBeInstanceOf(Error);
      expect(deps.depInteractions()).toBe(0);
    });
  }

  it('verified caller subject flows into PUT attribution', async () => {
    const put = ENDPOINTS[1]!.make();
    const response = (await put.call(VALID_TOKEN)) as {
      status: number;
      body: { savedBy: string; ruleSet: { revision: string } };
    };
    expect(response.status).toBe(200);
    expect(response.body.savedBy).toBe(CALLER_SUBJECT);
    expect(response.body.ruleSet.revision).toBe('rev-2');
  });

  it('whitespace-only token counts as missing', async () => {
    const deps = ENDPOINTS[0]!.make();
    let caught: unknown = null;
    try {
      await deps.call('   ');
    } catch (error) {
      caught = error;
    }
    expectUnauthorized(caught, 'TOKEN_MISSING');
    expect(deps.depInteractions()).toBe(0);
  });
});
