/**
 * Narrow projection→gate port (BILL-C3-1e; Blueprint §4 flow 5 → flow 1).
 *
 * Proves that `createEntitlementGate` consumes RECONCILED plan state through
 * `projectedSnapshotSource` — the enforcement path (INT-C3-1) needs no
 * webhook types: the only surface crossing the port is the accepted
 * `AppInstanceBillingSnapshot` shape behind the canonical `BillingInstancePort`.
 */
import { describe, expect, it } from 'vitest';
import { createEntitlementGate } from '../../src/billing/enforcement/entitlementGate';
import type {
  BillableCountPort,
  BillingInstancePort,
  EntitlementWarningLedger,
  ManagedLocationListingPort,
} from '../../src/billing/enforcement/entitlementGate';
import { createBillingPlanProjector } from '../../src/billing/projection/projector';
import type { BillingPlanProjector } from '../../src/billing/projection/projector';
import { projectedSnapshotSource } from '../../src/billing/projection/snapshotSource';
import type {
  BillableCountResult,
  EntitlementWarning,
  EntitlementWarningCode,
  ManagedLocationRecord,
} from '../../src/billing/types';

const TEST_OVERRIDES = {
  'prod-test-tier-1': 'TIER_1',
  'prod-test-tier-2-3': 'TIER_2_3',
} as const;

const NOW = '2026-08-25T00:00:00.000Z';

class InMemoryWarningLedger implements EntitlementWarningLedger {
  private readonly entries = new Map<EntitlementWarningCode, EntitlementWarning>();

  async record(code: EntitlementWarningCode, message: string): Promise<void> {
    const existing = this.entries.get(code);
    if (existing) {
      existing.lastSeenAt = NOW;
      existing.occurrences += 1;
      return;
    }
    this.entries.set(code, { code, message, firstSeenAt: NOW, lastSeenAt: NOW, occurrences: 1 });
  }

  async clear(code: EntitlementWarningCode): Promise<void> {
    this.entries.delete(code);
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
  }

  async load(): Promise<EntitlementWarning[]> {
    return [...this.entries.values()];
  }
}

function listingPort(records: ManagedLocationRecord[]): ManagedLocationListingPort {
  return { async listManagedLocations() { return records; } };
}

function countPort(result?: BillableCountResult): BillableCountPort {
  return { async countBillable() { return result ?? { count: 0, billableLocationIds: [] }; } };
}

function rec(locationId: string, isDefault?: boolean): ManagedLocationRecord {
  return { locationId, archived: false, isDefault };
}

function gateOver(projector: BillingPlanProjector) {
  // The narrow port IS a BillingInstancePort (compile-checked here):
  const instance: BillingInstancePort = projectedSnapshotSource(projector);
  return createEntitlementGate({
    instance,
    listings: listingPort([rec('loc-b'), rec('loc-a'), rec('loc-m', true)]),
    billableCount: countPort(),
    warnings: new InMemoryWarningLedger(),
    overrides: TEST_OVERRIDES,
  });
}

describe('projectedSnapshotSource — reconciled state feeds the enforcement gate', () => {
  it('serves the reconciled snapshot verbatim; the gate resolves the mapped tier', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });

    const gate = gateOver(projector);
    const decision = await gate.allowedLocationIds();

    expect(decision.degraded).toBe(false);
    expect(decision.overLimit).toBe(false);
    expect(decision.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']); // allowance 3 of 3
  });

  it('lets the gate honor a purchase webhook between periodic reconciliations', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestEvent({
      id: 'evt-gate-1',
      eventType: 'PAID_PLAN_PURCHASED',
      payload: { vendorProductId: 'prod-test-tier-2-3' },
      entityEventSequence: 1,
      receivedAt: null,
    });

    const decision = await gateOver(projector).allowedLocationIds();

    // The merchant who just paid is covered immediately — no waiting for the
    // next Get App Instance poll.
    expect(decision.degraded).toBe(false);
    expect(decision.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
  });

  it('resolves FREE with a reliable restriction when nothing is known yet', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    const decision = await gateOver(projector).allowedLocationIds();

    expect(decision).toEqual({
      allowedLocationIds: ['loc-m'], // FREE allowance = 1 (default first)
      overLimit: true, // the other two managed locations fall outside the free allowance
      degraded: false,
      warning: null, // over-limit is a normal upgrade-CTA state, not an incident
    });
  });

  it('keeps over-limit coverage ordering stable from reconciled state (downgrade safety)', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-1' }); // downgrade to 1

    const decision = await gateOver(projector).allowedLocationIds();

    expect(decision.allowedLocationIds).toEqual(['loc-m']); // default first; others unmanaged, never deleted
    expect(decision.overLimit).toBe(true);
    expect(decision.degraded).toBe(false);
  });

  it('exposes UNKNOWN_PLAN_IDENTIFIER warnings from event-derived state to the gate', async () => {
    const ledger = new InMemoryWarningLedger();
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestEvent({
      id: 'evt-gate-unknown',
      eventType: 'PAID_PLAN_PURCHASED',
      payload: { vendorProductId: 'prod-test-unmapped' },
      entityEventSequence: 1,
      receivedAt: null,
    });

    const decision = await createEntitlementGate({
      instance: projectedSnapshotSource(projector),
      listings: listingPort([rec('loc-m', true), rec('loc-a')]),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    }).allowedLocationIds();

    expect(decision.overLimit).toBe(true); // TIER_1 under-serve for unmapped ids
    expect(decision.warning).toContain('unmapped plan identifier');
    expect((await ledger.load())[0]?.code).toBe('UNKNOWN_PLAN_IDENTIFIER');
  });
});
