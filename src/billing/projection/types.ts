/**
 * Plan-state projection types (BILL-C3-1; Contract §7 lifecycle, §11 C2;
 * Blueprint §4 flow 5 "plan webhooks + periodic Get App Instance
 * reconciliation -> entitlement state machine").
 *
 * Scope: ENVELOPE SEMANTICS ONLY. Transport, JWT signature verification,
 * retry/delivery and raw payload parsing stay in the platform pipeline
 * (Integration lane). Everything here is pure and Wix-import-free.
 *
 * Binding platform facts baked into these shapes (Contract §6/§7):
 * - Webhook duplicates and out-of-order delivery are EXPECTED; dedup happens
 *   on the envelope `id` and ordering on `entityEventSequence`.
 * - Trial signup fires Paid Plan Purchased, but trial→paid conversion fires
 *   NO event — periodic Get App Instance reconciliation is mandatory.
 * - Auto-renewal cancellation fires immediately; the merchant stays paid
 *   until period end (no mid-cycle downgrade path exists).
 * - Webhook `expiresOn` is ADVISORY ONLY (Invariant C2): the payload types
 *   below deliberately carry NO expiration fields, so projection logic is
 *   structurally unable to consult dates. Dunning/expiry behavior is driven
 *   exclusively by snapshot `isFree` signals.
 */

import type { Instant } from '../../shared/types';
import type { AppInstanceBillingSnapshot, EntitlementResolution } from '../types';

/** The app-billing webhook set relevant to plan state (Contract §5.2/§7). */
export type BillingEventType =
  | 'PAID_PLAN_PURCHASED'
  | 'PAID_PLAN_AUTO_RENEWAL_CANCELLED'
  | 'APP_INSTALLATION_CREATED'
  | 'APP_INSTALLATION_UPDATED';

/** Paid Plan Purchased payload (fields the projection may consume). */
export interface PaidPlanPurchasedPayload {
  vendorProductId?: string | null;
  packageName?: string | null;
}

/** Paid Plan Auto Renewal Cancelled payload. Identifiers, when present, are informational only. */
export interface PaidPlanAutoRenewalCancelledPayload {
  vendorProductId?: string | null;
  packageName?: string | null;
}

/**
 * Defensive billing view of App Installation Created/Updated payloads.
 * UQ6 (Contract §13): the exact payload field set is UNVERIFIED — every
 * field is optional and nothing about presence is asserted. Absent/null
 * fields mean "not reported", never "reported empty".
 */
export type InstallationBillingPayload = AppInstanceBillingSnapshot;

export type BillingEventPayload =
  | PaidPlanPurchasedPayload
  | PaidPlanAutoRenewalCancelledPayload
  | InstallationBillingPayload;

/**
 * Normalized webhook envelope (semantics only — see module docstring).
 * `id` is the dedup key (binding, Contract §6); `entityEventSequence` is the
 * ordering hint. `instanceId`, when present, scopes the event to one app
 * instance so clone/template siblings can never leak state across instances.
 */
export interface BillingEventEnvelope {
  readonly id: string;
  readonly eventType: BillingEventType;
  readonly entityEventSequence?: string | number | null;
  readonly instanceId?: string | null;
  /** Advisory delivery timestamp; NEVER consulted by projection logic. */
  readonly receivedAt?: Instant | null;
  readonly payload: BillingEventPayload;
}

/** Result of ingesting one envelope (platform pipelines log/observe this). */
export type EventIngestStatus = 'APPLIED' | 'DUPLICATE' | 'FOREIGN_INSTANCE';

/**
 * The event-derived plan view: the mutable facts webhook transitions write.
 * Merge discipline (all transitions): a string overwrites only when non-empty
 * after trimming; booleans overwrite only when definitely provided. Absent
 * values never clobber known ones.
 */
export interface EventDerivedPlanView {
  /** Last definitely-reported free/paid signal; `null` = not reported yet. */
  isFree: boolean | null;
  vendorProductId: string | null;
  packageName: string | null;
  /**
   * Durable lifecycle marker: once auto-renewal is cancelled it stays
   * cancelled until a NEW purchase re-enables renewal. Preserved across
   * snapshot reconciliations; NEVER changes the tier by itself (§7: the
   * merchant stays paid until period end).
   */
  autoRenewCancelled: boolean;
}

/** Which layer currently supplies the projection's resolution. */
export type ProjectionSource = 'SNAPSHOT_RECONCILED' | 'EVENT_DERIVED';

/**
 * The current output of the plan-state machine (Blueprint §4 flow 5). The
 * embedded `resolution` reuses the accepted `EntitlementResolution` shape
 * verbatim — projection never forks recognition logic.
 */
export interface EntitlementProjection {
  source: ProjectionSource;
  resolution: EntitlementResolution;
  autoRenewCancelled: boolean;
  /** True once at least one Get App Instance snapshot has been reconciled. */
  reconciledAtLeastOnce: boolean;
  /** Unique events ingested since the last snapshot reconciliation. */
  generationEventCount: number;
}
