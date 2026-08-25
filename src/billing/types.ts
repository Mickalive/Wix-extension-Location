/**
 * Billing-lane DTOs, plan-tier model and warning-signal types.
 *
 * Scope: BILL-C2-1-REPAIR (repair of BILL-C1-1, audit
 * `reports/audits/CYCLE_32692407760_BILLING.md`). Types align with the
 * accepted canonical contracts (`src/shared/types.ts`,
 * `src/domain/ports.ts`) — the enforcement gate consumes the canonical
 * `EntitlementGate` / `PolicyDecision` shapes verbatim; no forked shapes.
 *
 * Purity: no Wix SDK imports anywhere in the billing lane. Real Wix access
 * arrives only through ports implemented by the Integration lane
 * (Contract §7, Blueprint §1/§2).
 */

import type { Instant } from '../shared/types';

/**
 * Commercial tiers (Contract §7): four recurring monthly plans plus the free
 * state. Feature availability is IDENTICAL across paid tiers — only the
 * maximum number of managed active Wix Bookings locations differs.
 */
export type PlanTier = 'FREE' | 'TIER_1' | 'TIER_2_3' | 'TIER_4_10' | 'TIER_11_PLUS';

/**
 * Typed, defensive adapter view of the Get App Instance response
 * (Contract §7 "Plan identification"). The Integration lane owns the real
 * Wix adapter that produces this snapshot; every field is optional so older
 * or partially populated payloads stay representable (Invariant C4 spirit).
 */
export interface AppInstanceBillingSnapshot {
  /** Primary paid/free signal (with `vendorProductId`). */
  isFree?: boolean | null;
  /**
   * Signed instance parameter identifying the purchased plan.
   * Missing/empty ⇒ free (Contract §7). Never fabricated — real identifiers
   * are operator-configured at deploy time via the overrides table.
   */
  vendorProductId?: string | null;
  /** Human-readable plan name, used only for warning messages. */
  packageName?: string | null;
  /**
   * ADVISORY ONLY (Invariant C2 — triple-sourced conflict). Intentionally
   * never consulted for tier flips: `isFree:false` stays paid through the
   * dunning window; `isFree:true` stays free regardless of dates.
   */
  billingExpirationDate?: Instant | null;
  /** Free-trial status (e.g. `IN_PROGRESS`). Trial users count as paid via `isFree:false` + plan identifier. */
  freeTrialStatus?: string | null;
  /** Clone-detection markers (Contract §7); never affect resolution of this instance. */
  originInstanceId?: string | null;
  copiedFromTemplate?: boolean | string | null;
}

/**
 * A location as the billing lane may manage it. Comes from the Integration
 * lane's paginated `listLocations` adapter (liveness pre-filtering is the
 * adapter's job; coverage filters defensively again).
 */
export interface ManagedLocationRecord {
  locationId: string;
  archived: boolean;
  isDefault?: boolean;
}

/** Persistent warning codes surfaced on the dashboard (fail-open posture, Contract §7/§11 C5). */
export type EntitlementWarningCode =
  | 'BILLING_API_FAILURE'
  | 'LOCATION_LISTING_FAILURE'
  | 'BILLABLE_COUNT_FAILURE'
  | 'UNKNOWN_PLAN_IDENTIFIER';

/** A warning signal produced by pure resolution logic (no timestamps yet). */
export interface EntitlementSignal {
  code: EntitlementWarningCode;
  message: string;
}

/** A warning as persisted by the warning ledger (timestamps/occurrences added there). */
export interface EntitlementWarning extends EntitlementSignal {
  firstSeenAt: Instant;
  lastSeenAt: Instant;
  occurrences: number;
}

/**
 * Outcome of pure plan recognition. `restrictionReliable` is `false` only
 * when a paid subscription was recognized but its allowance had to be guessed
 * (unknown plan identifier) — the restriction is then conservative, flagged,
 * and must be surfaced prominently rather than treated as settled fact.
 */
export interface EntitlementResolution {
  tier: PlanTier;
  isPaid: boolean;
  /** Maximum managed active Bookings locations; `Number.POSITIVE_INFINITY` for 11+. */
  maxLocations: number;
  restrictionReliable: boolean;
  warnings: EntitlementSignal[];
}

/** Result of the billable-location count (pure core and adapter driver share it). */
export interface BillableCountResult {
  /**
   * Billable-location count with the ratified single-location floor applied:
   * a computed count of 0 is billed as 1 (Contract §7). This is a billing
   * COUNT floor only — `billableLocationIds` remains the true computed set
   * (possibly empty) and grants nothing by itself.
   */
  count: number;
  /** Distinct billable location ids, sorted ascending for determinism. */
  billableLocationIds: string[];
}
