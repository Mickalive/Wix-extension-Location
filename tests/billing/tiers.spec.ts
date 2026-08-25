/**
 * Plan-tier table invariants (BILL-C2-1-REPAIR; Contract §7, directives/BILLING.md).
 * Four paid plans + free; identical features across tiers — only the managed
 * active location allowance differs.
 */
import { describe, expect, it } from 'vitest';
import { PLAN_TIERS, isUnlimited, maxLocationsForTier } from '../../src/billing/pure/tiers';
import type { PlanTier } from '../../src/billing/types';

const ALL_TIERS: readonly PlanTier[] = [
  'FREE',
  'TIER_1',
  'TIER_2_3',
  'TIER_4_10',
  'TIER_11_PLUS',
];

describe('PLAN_TIERS', () => {
  it('exposes exactly the four contract plans plus free at the contract prices with marketplace-safe labels', () => {
    expect(Object.keys(PLAN_TIERS).sort()).toEqual([...ALL_TIERS].sort());

    expect(PLAN_TIERS.FREE.monthlyPriceUsd).toBe(0);
    expect(PLAN_TIERS.TIER_1.monthlyPriceUsd).toBe(9.99);
    expect(PLAN_TIERS.TIER_2_3.monthlyPriceUsd).toBe(19.99);
    expect(PLAN_TIERS.TIER_4_10.monthlyPriceUsd).toBe(34.99);
    expect(PLAN_TIERS.TIER_11_PLUS.monthlyPriceUsd).toBe(49.99);

    // Marketplace plan names must fit the 23-character limit (Contract §7).
    for (const tier of ALL_TIERS) {
      expect(PLAN_TIERS[tier].label.length).toBeLessThanOrEqual(23);
    }
    expect(PLAN_TIERS.TIER_1.label).toBe('1 Location');
    expect(PLAN_TIERS.TIER_11_PLUS.label).toBe('11+ Locations');
  });

  it('ranks location allowances monotonically: 1 / 1 / 3 / 10 / unlimited', () => {
    const ladder = ALL_TIERS.map(maxLocationsForTier);
    expect(ladder).toEqual([1, 1, 3, 10, Number.POSITIVE_INFINITY]);

    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i]!).toBeGreaterThanOrEqual(ladder[i - 1]!);
    }
  });

  it('keeps feature availability identical across tiers (no per-tier feature flags exist)', () => {
    // A tier definition may only carry identity, label, price and allowance.
    // Any additional key would be a feature difference — forbidden by the
    // constitution and directives/BILLING.md.
    const CORE_KEYS = ['label', 'maxLocations', 'monthlyPriceUsd', 'tier'];
    for (const tier of ALL_TIERS) {
      const definition = PLAN_TIERS[tier];
      expect(Object.keys(definition).sort()).toEqual(CORE_KEYS);

      const { tier: tierName, label, monthlyPriceUsd, maxLocations } = definition;
      expect({ tier: tierName, label, monthlyPriceUsd, maxLocations }).toEqual(definition);
    }
  });

  it('marks only TIER_11_PLUS as unlimited', () => {
    expect(isUnlimited('TIER_11_PLUS')).toBe(true);
    expect(isUnlimited('FREE')).toBe(false);
    expect(isUnlimited('TIER_1')).toBe(false);
    expect(isUnlimited('TIER_2_3')).toBe(false);
    expect(isUnlimited('TIER_4_10')).toBe(false);
  });
});
