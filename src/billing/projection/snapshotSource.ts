/**
 * Narrow port exposing the plan-state projection as the snapshot source of
 * `createEntitlementGate` (BILL-C3-1e; Blueprint §4 flow 5 → flow 1 handoff).
 *
 * The Integration lane's enforcement path (INT-C3-1) wires:
 *
 *   const projector = createBillingPlanProjector({ instanceId });
 *   const gate = createEntitlementGate({
 *     instance: projectedSnapshotSource(projector),
 *     ...
 *   });
 *
 * …and thereby consumes RECONCILED entitlement state without ever importing
 * a webhook type: the only surface crossing this port is the accepted
 * `AppInstanceBillingSnapshot` shape behind the canonical `BillingInstancePort`.
 * Transport failures remain the platform pipeline's concern (adapters throw
 * upstream; this port reads pure in-memory state and never throws).
 *
 * Purity: no Wix imports.
 */

import type { BillingInstancePort } from '../enforcement/entitlementGate';
import type { BillingPlanProjector } from './projector';

/**
 * Adapt a projector to the gate's `BillingInstancePort`. Every call re-reads
 * the CURRENT projection, so gate decisions always reflect the freshest
 * reconciled/event-refined state without re-resolving anything here.
 */
export function projectedSnapshotSource(projector: BillingPlanProjector): BillingInstancePort {
  return {
    async getAppInstanceSnapshot() {
      return projector.currentSnapshot();
    },
  };
}
