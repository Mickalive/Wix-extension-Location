/**
 * Pure plan-recognition decision table (BILL-C2-1-REPAIR; Contract §7, §11 C2).
 *
 * Every branch: null snapshot, isFree, missing/empty plan identifier, trial,
 * dunning window (advisory-only expiration), known/unknown identifiers and
 * clone independence. Fixture identifiers are obviously synthetic — real Wix
 * vendorProductId values are operator-configured at deploy time and are never
 * fabricated in code or tests.
 */
import { describe, expect, it } from 'vitest';
import { resolveEntitlement } from '../../src/billing/pure/entitlement';
import type { AppInstanceBillingSnapshot } from '../../src/billing/types';

const TEST_OVERRIDES = {
  'prod-test-tier-1': 'TIER_1',
  'prod-test-tier-2-3': 'TIER_2_3',
  'prod-test-tier-4-10': 'TIER_4_10',
  'prod-test-tier-11-plus': 'TIER_11_PLUS',
} as const;

function paidSnapshot(overrides: {
  vendorProductId: string;
  freeTrialStatus?: string;
  billingExpirationDate?: string;
}): AppInstanceBillingSnapshot {
  return {
    isFree: false,
    vendorProductId: overrides.vendorProductId,
    freeTrialStatus: overrides.freeTrialStatus ?? null,
    billingExpirationDate: overrides.billingExpirationDate ?? null,
  };
}

describe('resolveEntitlement (pure decision table)', () => {
  it('resolves a null snapshot to FREE with a reliable restriction and no warning', () => {
    // "Genuinely absent billing section" — adapters must THROW on transport
    // failure instead of producing null (see counter/ports.ts docstring).
    const resolution = resolveEntitlement(null);

    expect(resolution).toEqual({
      tier: 'FREE',
      isPaid: false,
      maxLocations: 1,
      restrictionReliable: true,
      warnings: [],
    });
  });

  it('resolves isFree=true to FREE even when cancelled plan identifiers linger', () => {
    const resolution = resolveEntitlement({
      isFree: true,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });

    expect(resolution.tier).toBe('FREE');
    expect(resolution.isPaid).toBe(false);
    expect(resolution.warnings).toEqual([]);
  });

  it('resolves a paid-looking snapshot without a vendorProductId to FREE (missing ⇒ free)', () => {
    const resolution = resolveEntitlement({ isFree: false, vendorProductId: null });

    expect(resolution.tier).toBe('FREE');
    expect(resolution.isPaid).toBe(false);
    expect(resolution.restrictionReliable).toBe(true);
  });

  it('resolves an empty-string vendorProductId to FREE', () => {
    const resolution = resolveEntitlement({ isFree: false, vendorProductId: '' });

    expect(resolution.tier).toBe('FREE');
    expect(resolution.isPaid).toBe(false);
  });

  it('counts an in-progress free trial as paid through its plan identifier', () => {
    // Contract §7: free-trial users count as paid
    // (isFree:false + freeTrialInfo.status=IN_PROGRESS + plan identifier).
    const resolution = resolveEntitlement(
      paidSnapshot({ vendorProductId: 'prod-test-tier-1', freeTrialStatus: 'IN_PROGRESS' }),
      { overrides: TEST_OVERRIDES },
    );

    expect(resolution.tier).toBe('TIER_1');
    expect(resolution.isPaid).toBe(true);
    expect(resolution.restrictionReliable).toBe(true);
    expect(resolution.warnings).toEqual([]);
  });

  it('keeps a paid subscription active through the dunning window (expired date + isFree=false ⇒ PAID)', () => {
    // Invariant C2: expirationDate is advisory-only; isFree:false stays paid.
    const resolution = resolveEntitlement(
      paidSnapshot({
        vendorProductId: 'prod-test-tier-4-10',
        billingExpirationDate: '2026-01-01T00:00:00.000Z',
      }),
      { overrides: TEST_OVERRIDES },
    );

    expect(resolution.tier).toBe('TIER_4_10');
    expect(resolution.isPaid).toBe(true);
    expect(resolution.maxLocations).toBe(10);
  });

  it('never grants paid coverage from a future expiration date once isFree=true', () => {
    const resolution = resolveEntitlement({
      isFree: true,
      vendorProductId: 'prod-test-tier-2-3',
      billingExpirationDate: '2027-01-01T00:00:00.000Z',
    });

    expect(resolution.tier).toBe('FREE');
    expect(resolution.isPaid).toBe(false);
  });

  it('maps a configured identifier to the 2–3 location tier', () => {
    const resolution = resolveEntitlement(
      paidSnapshot({ vendorProductId: 'prod-test-tier-2-3' }),
      { overrides: TEST_OVERRIDES },
    );

    expect(resolution.tier).toBe('TIER_2_3');
    expect(resolution.maxLocations).toBe(3);
    expect(resolution.restrictionReliable).toBe(true);
  });

  it('maps configured identifiers to the 4–10 and unlimited 11+ tiers', () => {
    const mid = resolveEntitlement(paidSnapshot({ vendorProductId: 'prod-test-tier-4-10' }), {
      overrides: TEST_OVERRIDES,
    });
    const top = resolveEntitlement(paidSnapshot({ vendorProductId: 'prod-test-tier-11-plus' }), {
      overrides: TEST_OVERRIDES,
    });

    expect(mid.tier).toBe('TIER_4_10');
    expect(mid.maxLocations).toBe(10);
    expect(top.tier).toBe('TIER_11_PLUS');
    expect(top.maxLocations).toBe(Number.POSITIVE_INFINITY);
  });

  it('fails safe on an unknown paid identifier: smallest paid allowance plus a persistent warning', () => {
    // directives/BILLING.md: fail safely rather than silently over-serving.
    const resolution = resolveEntitlement({
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
      packageName: 'Mystery Plan',
    });

    expect(resolution.tier).toBe('TIER_1');
    expect(resolution.isPaid).toBe(true);
    expect(resolution.maxLocations).toBe(1);
    expect(resolution.restrictionReliable).toBe(false);
    expect(resolution.warnings).toHaveLength(1);
    expect(resolution.warnings[0]?.code).toBe('UNKNOWN_PLAN_IDENTIFIER');
    expect(resolution.warnings[0]?.message).toContain('Mystery Plan');
  });

  it('resolves cloned instances independently from their own signals (clone markers change nothing)', () => {
    const base = resolveEntitlement(paidSnapshot({ vendorProductId: 'prod-test-tier-2-3' }), {
      overrides: TEST_OVERRIDES,
    });
    const clone = resolveEntitlement(
      {
        ...paidSnapshot({ vendorProductId: 'prod-test-tier-2-3' }),
        originInstanceId: 'origin-test-instance',
        copiedFromTemplate: true,
      },
      { overrides: TEST_OVERRIDES },
    );

    expect(clone).toEqual(base);
    expect(clone.tier).toBe('TIER_2_3');
  });
});
