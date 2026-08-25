/**
 * Pure plan recognition / entitlement resolution (Contract §7 "Plan
 * identification", §11 C2; directives/BILLING.md fail-safe requirement).
 *
 * Decision table (all branches covered by tests/billing/entitlement.spec.ts):
 *   - `null` snapshot            ⇒ FREE, restriction reliable, no warning.
 *     ("Genuinely absent billing section." Adapters MUST throw on transport
 *     failure instead of fabricating `null` — see counter/ports docstring.)
 *   - `isFree === true`          ⇒ FREE. Cancelled-until-expiry identifiers
 *     may linger; they are ignored once Wix reports the instance free.
 *   - no/empty `vendorProductId` ⇒ FREE (Contract §7: missing/empty ⇒ free).
 *     A trial status alone never grants a paid tier.
 *   - known plan identifier      ⇒ that tier, paid, restriction reliable.
 *   - unknown plan identifier    ⇒ TIER_1 (smallest paid allowance — fail
 *     SAFE: under-serve rather than over-serve) + persistent
 *     UNKNOWN_PLAN_IDENTIFIER warning + restrictionReliable:false.
 *
 * Invariant C2: `billingExpirationDate` is advisory-only and is intentionally
 * NEVER read here. `isFree:false` stays paid through the dunning window;
 * `isFree:true` stays free regardless of any date. Clone markers
 * (`originInstanceId` / `copiedFromTemplate`) never change this instance's
 * resolution — clones resolve independently from their own signals.
 *
 * Purity: no I/O, no clock, no Wix imports.
 */

import { maxLocationsForTier } from './tiers';
import type {
  AppInstanceBillingSnapshot,
  EntitlementResolution,
  EntitlementSignal,
  PlanTier,
} from '../types';

/** Operator-configured mapping of real Wix vendorProductId values to tiers. */
export type VendorProductOverrides = Readonly<Record<string, PlanTier>>;

/**
 * Empty by default: account-specific Wix identifiers are never fabricated in
 * code or tests (constitution). The human owner configures the real product
 * ids at deploy time; until then every paid identifier resolves through the
 * documented unknown-plan policy below.
 */
export const DEFAULT_VENDOR_PRODUCT_OVERRIDES: VendorProductOverrides = {};

export interface ResolveEntitlementOptions {
  overrides?: VendorProductOverrides;
}

function freeResolution(): EntitlementResolution {
  return {
    tier: 'FREE',
    isPaid: false,
    maxLocations: maxLocationsForTier('FREE'),
    restrictionReliable: true,
    warnings: [],
  };
}

/**
 * Resolve the entitlement state from an app-instance billing snapshot
 * (or `null` when Wix genuinely reports no billing data).
 */
export function resolveEntitlement(
  snapshot: AppInstanceBillingSnapshot | null,
  options?: ResolveEntitlementOptions,
): EntitlementResolution {
  if (snapshot === null) return freeResolution();
  if (snapshot.isFree === true) return freeResolution();

  const vendorProductId = snapshot.vendorProductId;
  if (typeof vendorProductId !== 'string' || vendorProductId.trim().length === 0) {
    return freeResolution();
  }

  const overrides = options?.overrides ?? DEFAULT_VENDOR_PRODUCT_OVERRIDES;
  const tier: PlanTier | undefined = overrides[vendorProductId];
  if (tier !== undefined) {
    return {
      tier,
      isPaid: true,
      maxLocations: maxLocationsForTier(tier),
      restrictionReliable: true,
      warnings: [],
    };
  }

  // Unknown PAID identifier: fail safe (never silently over-serve).
  const planName =
    typeof snapshot.packageName === 'string' && snapshot.packageName.length > 0
      ? ` "${snapshot.packageName}"`
      : '';
  const warning: EntitlementSignal = {
    code: 'UNKNOWN_PLAN_IDENTIFIER',
    message:
      `Paid subscription recognized with an unmapped plan identifier${planName}; ` +
      'coverage is limited to the 1-location tier until the identifier is configured.',
  };
  return {
    tier: 'TIER_1',
    isPaid: true,
    maxLocations: maxLocationsForTier('TIER_1'),
    restrictionReliable: false,
    warnings: [warning],
  };
}
