/**
 * Plan-tier table (Contract §7; directives/BILLING.md).
 *
 * Exactly four recurring monthly plans plus the free state. Feature
 * availability is IDENTICAL across paid tiers — only `maxLocations` (the
 * maximum number of managed active Wix Bookings locations) differs.
 * Labels are marketplace plan names and each fits the 23-character limit.
 *
 * Purity: static data only, no Wix imports.
 */

import type { PlanTier } from '../types';

export interface PlanTierDefinition {
  readonly tier: PlanTier;
  /** Marketplace plan name (≤23 chars, Contract §7). */
  readonly label: string;
  readonly monthlyPriceUsd: number;
  /** Maximum managed active Bookings locations; `Number.POSITIVE_INFINITY` = unlimited (11+). */
  readonly maxLocations: number;
}

export const PLAN_TIERS: Readonly<Record<PlanTier, PlanTierDefinition>> = {
  FREE: {
    tier: 'FREE',
    label: 'Free',
    monthlyPriceUsd: 0,
    maxLocations: 1,
  },
  TIER_1: {
    tier: 'TIER_1',
    label: '1 Location',
    monthlyPriceUsd: 9.99,
    maxLocations: 1,
  },
  TIER_2_3: {
    tier: 'TIER_2_3',
    label: '2–3 Locations',
    monthlyPriceUsd: 19.99,
    maxLocations: 3,
  },
  TIER_4_10: {
    tier: 'TIER_4_10',
    label: '4–10 Locations',
    monthlyPriceUsd: 34.99,
    maxLocations: 10,
  },
  TIER_11_PLUS: {
    tier: 'TIER_11_PLUS',
    label: '11+ Locations',
    monthlyPriceUsd: 49.99,
    maxLocations: Number.POSITIVE_INFINITY,
  },
};

/** Maximum managed active locations for a tier. */
export function maxLocationsForTier(tier: PlanTier): number {
  return PLAN_TIERS[tier].maxLocations;
}

/** True only for the unlimited (11+ locations) tier. */
export function isUnlimited(tier: PlanTier): boolean {
  return tier === 'TIER_11_PLUS';
}
