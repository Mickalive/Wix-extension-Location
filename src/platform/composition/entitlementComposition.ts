/**
 * Enforcement composition root (INT-C4-1 item a; BILL-C3-1 sub-item e
 * handoff; Blueprint §4 flows 5 → 1; Contract §7).
 *
 * Wires the accepted billing exports into the enforcement path:
 *
 *   projector (webhook events + periodic snapshots)
 *     → projectedSnapshotSource(projector)      [billing/projection]
 *     → createEntitlementGate({ instance, … })  [billing/enforcement]
 *     → ValidationPluginDeps.entitlementGate    [validation-plugin handlers]
 *       + GET /meter response source            [http/meterEndpoint]
 *
 * so booking-time enforcement consumes RECONCILED plan state while this
 * module — and every validation-plugin consumer downstream of it — imports
 * ZERO webhook types: the only surface crossing into billing is the accepted
 * `AppInstanceBillingSnapshot` shape behind `BillingInstancePort`
 * (test-pinned in tests/platform/composition-root.spec.ts). Webhook envelope
 * semantics live exclusively in the ingestion seam that FEEDS the projector
 * (the webhook pipeline caller + ./projectorCompaction.ts).
 *
 * The returned gate satisfies the canonical domain `EntitlementGate` port
 * verbatim (plus the billing lane's dashboard `meter()` reading), so it drops
 * straight into `ValidationPluginDeps.entitlementGate`.
 *
 * PERIODIC RECONCILIATION (Contract §7): trial→paid conversion fires no
 * event, so {@link composeValidationEntitlement} also builds the injectable
 * poll seam ({@link createReconciliationSeam}) around the same projector.
 * Use the compacting projector from ./projectorCompaction.ts so every poll
 * additionally retires dedup memory in long-lived serverless processes.
 *
 * Purity: no Wix imports; every runtime dependency is an accepted export or
 * an injected port. Canonical billing/domain shapes are consumed UNFORKED.
 */

import { createEntitlementGate } from '../../billing/enforcement/entitlementGate';
import type {
  BillableCountPort,
  BillableMeterReading,
  EntitlementWarningLedger,
  ManagedLocationListingPort,
} from '../../billing/enforcement/entitlementGate';
import type { VendorProductOverrides } from '../../billing/pure/entitlement';
import { createBillingPlanProjector } from '../../billing/projection/projector';
import { projectedSnapshotSource } from '../../billing/projection/snapshotSource';
import type { BillingPlanProjector } from '../../billing/projection/projector';
import type { EntitlementGate } from '../../domain/ports';
import { createReconciliationSeam } from './reconciliation';
import type {
  AppInstanceSnapshotFetcher,
  ReconciliationSeam,
} from './reconciliation';

/**
 * The composed gate: canonical enforcement port + dashboard meter reading.
 * Structurally identical to `createEntitlementGate`'s return type; spelled
 * out so consumers depend on THIS root, not on billing internals.
 */
export interface ComposedEntitlementGate extends EntitlementGate {
  meter(): Promise<BillableMeterReading>;
}

export interface ComposeEntitlementGateDeps {
  /** Plan-state projection (plain or compacting — both satisfy the shape). */
  projector: BillingPlanProjector;
  listings: ManagedLocationListingPort;
  billableCount: BillableCountPort;
  warnings: EntitlementWarningLedger;
  /** Real vendorProductId → plan mapping; operator-configured, empty default. */
  overrides?: VendorProductOverrides;
}

/**
 * Builds the enforcement/dashboard gate from a projector via the accepted
 * narrow port. Every gate call re-reads the CURRENT projection, so decisions
 * always reflect the freshest reconciled/event-refined state.
 */
export function composeEntitlementGate(deps: ComposeEntitlementGateDeps): ComposedEntitlementGate {
  return createEntitlementGate({
    instance: projectedSnapshotSource(deps.projector),
    listings: deps.listings,
    billableCount: deps.billableCount,
    warnings: deps.warnings,
    ...(deps.overrides !== undefined ? { overrides: deps.overrides } : {}),
  });
}

export interface ValidationEntitlementComposition {
  /** Assign to `ValidationPluginDeps.entitlementGate`; also feeds GET /meter. */
  gate: ComposedEntitlementGate;
  /** Feed webhook envelopes here (ingestion seam); never imported by handlers. */
  projector: BillingPlanProjector;
  /** Mandatory §7 poll seam (trial→paid conversion fires no event). */
  reconciliation: ReconciliationSeam;
}

export interface ComposeValidationEntitlementDeps {
  listings: ManagedLocationListingPort;
  billableCount: BillableCountPort;
  warnings: EntitlementWarningLedger;
  overrides?: VendorProductOverrides;
  /** Instance scope guard forwarded to the projector (clone isolation). */
  instanceId?: string;
  /** Get App Instance adapter for the mandatory periodic reconciliation. */
  snapshotFetcher: AppInstanceSnapshotFetcher;
  /** Observability hook for reconciliation fetch failures (never silent). */
  onReconciliationError?: (error: unknown) => void;
  /** Optional projector factory (defaults to the plain accepted core). */
  createProjector?: () => BillingPlanProjector;
}

/**
 * One-call composition root: projector → snapshot source → gate (+ meter) →
 * reconciliation seam. Hand `composition.gate` to
 * `createValidationHandlers({ entitlementGate: composition.gate, … })` and to
 * `getEntitlementMeter({ entitlementGate: composition.gate, … })`.
 */
export function composeValidationEntitlement(
  deps: ComposeValidationEntitlementDeps,
): ValidationEntitlementComposition {
  const projector = deps.createProjector ? deps.createProjector() : createDefaultProjector(deps);
  const gate = composeEntitlementGate({
    projector,
    listings: deps.listings,
    billableCount: deps.billableCount,
    warnings: deps.warnings,
    ...(deps.overrides !== undefined ? { overrides: deps.overrides } : {}),
  });
  const reconciliation = createReconciliationSeam({
    projector,
    fetcher: deps.snapshotFetcher,
    ...(deps.onReconciliationError !== undefined
      ? { onError: deps.onReconciliationError }
      : {}),
  });
  return { gate, projector, reconciliation };
}

function createDefaultProjector(
  deps: ComposeValidationEntitlementDeps,
): BillingPlanProjector {
  // Long-lived warm processes should pass the bounded variant from
  // ./projectorCompaction.ts via `createProjector`; the default stays the
  // plain accepted core so short-lived invocations keep zero extra state.
  return createBillingPlanProjector({
    ...(deps.instanceId !== undefined ? { instanceId: deps.instanceId } : {}),
  });
}
