/**
 * Shared test doubles for the pure HTTP handler suites (INT-C2-1 item b).
 * Test-only: no product code imports this file. Every double records its call
 * count so tests can prove fail-closed behavior (zero store mutation on auth
 * rejection).
 */
import { expect } from 'vitest';
import type {
  ConfirmedPlanLookup,
  ConfirmedPlanReference,
  TokenVerifier,
  VerifiedCallerToken,
} from '../../../src/platform/http';
import { UnauthorizedRequestError } from '../../../src/platform/http';
import type {
  MutationPlan,
  RollbackResult,
  RuleSetDTO,
  VerifyResult,
} from '../../../src/shared/types';

export const VALID_TOKEN = 'test-caller-token';
export const CALLER_SUBJECT = 'user-dashboard-admin';

/** Configurable fake TokenVerifier modelling the port's fail-closed contract. */
export class FakeTokenVerifier implements TokenVerifier {
  calls: string[] = [];
  /** Tokens that resolve to a verified identity. */
  private readonly validTokens = new Set<string>([VALID_TOKEN]);
  /** When set, verify throws (infrastructure outage simulation). */
  throwWith: Error | null = null;

  invalidate(token: string): void {
    this.validTokens.delete(token);
  }

  async verify(authToken: string): Promise<VerifiedCallerToken | null> {
    this.calls.push(authToken);
    if (this.throwWith) {
      const err = this.throwWith;
      this.throwWith = null;
      throw err;
    }
    // Port contract: invalid AND expired tokens both map to null (fail closed).
    if (!this.validTokens.has(authToken)) return null;
    return { subject: CALLER_SUBJECT };
  }
}

export function expectUnauthorized(
  error: unknown,
  reason: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'TOKEN_VERIFIER_FAILED',
): void {
  expect(error).toBeInstanceOf(UnauthorizedRequestError);
  const err = error as UnauthorizedRequestError;
  expect(err.code).toBe('UNAUTHORIZED'); // additive Director amendment (run 32787032785)
  expect(err.retriable).toBe(false);
  expect(err.reason).toBe(reason);
  expect(err.details).toMatchObject({ authenticated: false });
}

/** Call-counting spy over a RulesConfigStore-shaped pair of methods. */
export function makeConfigStoreSpy(inner: {
  loadActiveRuleSet(): Promise<RuleSetDTO | null>;
  saveRuleSet(next: RuleSetDTO, expectedRevision: string): Promise<RuleSetDTO>;
}): {
  loadActiveRuleSet: () => Promise<RuleSetDTO | null>;
  saveRuleSet: (next: RuleSetDTO, expectedRevision: string) => Promise<RuleSetDTO>;
  loadCalls: () => number;
  saveCalls: () => number;
} {
  let loads = 0;
  let saves = 0;
  return {
    loadActiveRuleSet: async () => {
      loads += 1;
      return inner.loadActiveRuleSet();
    },
    saveRuleSet: async (next, expectedRevision) => {
      saves += 1;
      return inner.saveRuleSet(next, expectedRevision);
    },
    loadCalls: () => loads,
    saveCalls: () => saves,
  };
}

export function makeConfirmedPlanSpy(
  backing: Map<string, ConfirmedPlanReference>,
): ConfirmedPlanLookup & { calls: () => number } {
  let calls = 0;
  return {
    async findByDiffHash(diffHash: string) {
      calls += 1;
      return backing.get(diffHash) ?? null;
    },
    calls: () => calls,
  };
}

export interface ApplyPlanSummaryLike {
  planId: string;
  status: 'APPLIED' | 'ROLLED_BACK';
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  verify: VerifyResult | null;
  rollback: RollbackResult | null;
  auditEntryId: string;
}

export function makeApplyPlanSpy(): {
  applyPlan: (plan: MutationPlan) => Promise<ApplyPlanSummaryLike>;
  calls: () => number;
  appliedPlans: () => MutationPlan[];
} {
  let calls = 0;
  const plans: MutationPlan[] = [];
  return {
    async applyPlan(plan: MutationPlan) {
      calls += 1;
      plans.push(structuredClone(plan));
      return {
        planId: plan.planId,
        status: 'APPLIED' as const,
        appliedCount: plan.changes.length,
        skippedCount: 0,
        failedCount: 0,
        verify: {
          planId: plan.planId,
          verified: true,
          checkedAt: '2026-08-24T12:00:00.000Z',
          mismatches: [],
        },
        rollback: null,
        auditEntryId: `audit-${plan.planId}`,
      };
    },
    calls: () => calls,
    appliedPlans: () => plans,
  };
}
