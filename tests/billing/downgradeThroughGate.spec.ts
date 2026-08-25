/**
 * Downgrade-through-gate regression (BILL-C4-1a; Contract §7 lifecycle,
 * directives/BILLING.md downgrade safety; Blueprint §6 billing test strategy:
 * entitlement decision table + over-limit ordering stability).
 *
 * Proves END-TO-END through the PUBLIC gate API — `createEntitlementGate`
 * fed by `projectedSnapshotSource(projector)` — that the §7 "downgrade only
 * at period end via confirming snapshot" lifecycle is ENFORCED, not merely
 * projected:
 *
 * 1. a confirming snapshot downgrading the tier between reconciliations
 *    shrinks `allowedLocationIds` to the NEW allowance with stable ordering
 *    (default location first, then alphabetical by location id);
 * 2. an auto-renewal-cancellation event alone NEVER shrinks coverage (the
 *    merchant stays paid until period end — no mid-cycle downgrade exists);
 * 3. user configuration is never deleted: the backing store's per-location
 *    configuration and the management inventory stay byte-identical across
 *    every step, and repeated reconciliations keep the SAME restricted set
 *    (no progressive loss);
 * 4. the over-limit upgrade state surfaces (`overLimit: true`, reliable
 *    restriction, no incident warning);
 * 5. a subsequent confirming re-upgrade snapshot restores full coverage.
 *
 * Fixture identifiers are obviously synthetic (`prod-test-*`, `evt-*`,
 * `loc-*`) — real Wix identifiers are never fabricated (constitution).
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
  'prod-test-tier-4-10': 'TIER_4_10',
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

/**
 * The merchant's persisted world: per-location rule configuration plus the
 * managed-location inventory. The listing port is DERIVED from this store, so
 * if any code path "deleted" a location or its configuration to enforce a
 * downgrade, both `records()` and `serializedConfigs()` would visibly shrink.
 */
class ManagedLocationStore {
  private readonly configs = new Map<string, string>();
  private readonly inventory: ManagedLocationRecord[] = [];

  add(
    locationId: string,
    config: string,
    opts?: { isDefault?: boolean; archived?: boolean },
  ): void {
    this.configs.set(locationId, config);
    this.inventory.push({
      locationId,
      archived: opts?.archived === true,
      ...(opts?.isDefault === true ? { isDefault: true } : {}),
    });
  }

  listingPort(): ManagedLocationListingPort {
    const inventory = this.inventory;
    return {
      async listManagedLocations(): Promise<ManagedLocationRecord[]> {
        return inventory.map((record) => ({ ...record }));
      },
    };
  }

  inventorySize(): number {
    return this.inventory.length;
  }

  /** Insertion-ordered [locationId, configuration] pairs for deep comparison. */
  serializedConfigs(): Array<[string, string]> {
    return [...this.configs.entries()];
  }
}

function countPort(result?: BillableCountResult): BillableCountPort {
  return {
    async countBillable(): Promise<BillableCountResult> {
      return result ?? { count: 5, billableLocationIds: [] };
    },
  };
}

function renewalCancelledEnvelope(id: string) {
  return {
    id,
    eventType: 'PAID_PLAN_AUTO_RENEWAL_CANCELLED' as const,
    payload: {},
    entityEventSequence: 1 as const,
    instanceId: null,
    receivedAt: null,
  };
}

function gateOver(
  projector: BillingPlanProjector,
  store: ManagedLocationStore,
): ReturnType<typeof createEntitlementGate> {
  // The narrow port IS a BillingInstancePort (compile-checked assignment):
  const instance: BillingInstancePort = projectedSnapshotSource(projector);
  return createEntitlementGate({
    instance,
    listings: store.listingPort(),
    billableCount: countPort(),
    warnings: new InMemoryWarningLedger(),
    overrides: TEST_OVERRIDES,
  });
}

/** Five live locations + one archived; default first, then alphabetical ids. */
function fiveLocationStore(): ManagedLocationStore {
  const store = new ManagedLocationStore();
  store.add('loc-m', '{"windows":{"mon":[["09:00","12:00"],["14:00","18:00"]]}}', { isDefault: true });
  store.add('loc-a', '{"windows":{"tue":[["10:00","16:00"]]}}');
  store.add('loc-b', '{"exceptions":["2026-12-24"]}');
  store.add('loc-c', '{"caps":{"perDay":4}}');
  store.add('loc-d', '{"duplicateProtection":"identity-free"}');
  store.add('loc-z', '{"archivedSite":true}', { archived: true });
  return store;
}

describe('downgrade-through-gate (BILL-C4-1a; Contract §7 enforced lifecycle)', () => {
  it('tier downgrade via confirming snapshot shrinks coverage with stable ordering, preserves configuration, surfaces over-limit, and re-upgrade restores', async () => {
    const store = fiveLocationStore();
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    const gate = gateOver(projector, store);

    // Step 1 — confirmed paid state: TIER_4_10 covers all five live locations.
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-4-10',
      packageName: '4–10 Locations',
    });
    const paid = await gate.allowedLocationIds();
    expect(paid).toEqual({
      allowedLocationIds: ['loc-m', 'loc-a', 'loc-b', 'loc-c', 'loc-d'],
      overLimit: false,
      degraded: false,
      warning: null,
    });
    const configAtPaid = store.serializedConfigs();

    // Step 2 — auto-renewal cancelled mid-cycle: coverage must NOT shrink.
    // §7: the merchant stays paid until period end; no mid-cycle downgrade
    // path exists, so enforcement keeps serving the full allowance.
    expect(projector.ingestEvent(renewalCancelledEnvelope('evt-cancel-1'))).toBe('APPLIED');
    expect(projector.project().autoRenewCancelled).toBe(true);
    const duringCancel = await gate.allowedLocationIds();
    expect(duringCancel.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b', 'loc-c', 'loc-d']);
    expect(duringCancel.overLimit).toBe(false);
    expect(duringCancel.degraded).toBe(false);
    expect(store.serializedConfigs()).toEqual(configAtPaid);

    // Step 3 — period-end confirming snapshot downgrades the tier to 2–3.
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });
    const downgraded = await gate.allowedLocationIds();
    // Coverage shrank EXACTLY to the new allowance of 3, in stable order:
    // default location first, then alphabetical by location id. Excess
    // locations (c, d) fall out of MANAGEMENT; the archived location stays
    // excluded on both sides of the transition.
    expect(downgraded.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
    expect(downgraded.overLimit).toBe(true); // upgrade state surfaces
    expect(downgraded.degraded).toBe(false); // reliable restriction, not a degraded guess
    expect(downgraded.warning ?? null).toBeNull(); // over-limit is an upgrade-CTA state, not an incident

    // User configuration NEVER deleted: every location's stored configuration
    // and the full management inventory survive the downgrade untouched.
    expect(store.serializedConfigs()).toEqual(configAtPaid);
    expect(store.inventorySize()).toBe(6);

    // Repeated reconciliations keep the SAME restricted set — no progressive
    // data loss across calls.
    expect(await gate.allowedLocationIds()).toEqual(downgraded);

    // Step 4 — confirming re-upgrade snapshot restores full coverage from the
    // preserved configuration (nothing had to be recreated).
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-4-10',
      packageName: '4–10 Locations',
    });
    const restored = await gate.allowedLocationIds();
    expect(restored).toEqual({
      allowedLocationIds: ['loc-m', 'loc-a', 'loc-b', 'loc-c', 'loc-d'],
      overLimit: false,
      degraded: false,
      warning: null,
    });
    expect(store.serializedConfigs()).toEqual(configAtPaid);
  });

  it('period-end lapse to free shrinks coverage to the single default location; a confirming re-upgrade snapshot restores it', async () => {
    const store = fiveLocationStore();
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    const gate = gateOver(projector, store);

    // Confirmed TIER_2_3 state (allowance 3).
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });
    const paid = await gate.allowedLocationIds();
    expect(paid.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
    const configAtPaid = store.serializedConfigs();

    // Cancellation event alone keeps the paid coverage (§7).
    projector.ingestEvent(renewalCancelledEnvelope('evt-cancel-2'));
    expect((await gate.allowedLocationIds()).allowedLocationIds).toEqual([
      'loc-m',
      'loc-a',
      'loc-b',
    ]);

    // Period-end confirming snapshot reports the instance free ⇒ allowance 1.
    projector.ingestSnapshot({ isFree: true, vendorProductId: null });
    const lapsed = await gate.allowedLocationIds();
    expect(lapsed.allowedLocationIds).toEqual(['loc-m']); // default location survives the shrink
    expect(lapsed.overLimit).toBe(true); // the other managed locations need an upgrade
    expect(lapsed.degraded).toBe(false);
    expect(lapsed.warning ?? null).toBeNull(); // no incident warning: normal upgrade-CTA state

    // Configuration fully preserved through the lapse; no warnings recorded
    // (over-limit is not an error and nothing was unknown).
    expect(store.serializedConfigs()).toEqual(configAtPaid);
    expect(store.inventorySize()).toBe(6);

    // Confirming re-upgrade snapshot restores the 2–3 coverage.
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });
    const restored = await gate.allowedLocationIds();
    expect(restored.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
    // Honest upgrade state: coverage returned to the full 3-allowance, but
    // this store holds five live locations, so loc-c/loc-d remain legitimately
    // beyond the allowance — over-limit stays surfaced, nothing was lost.
    expect(restored.overLimit).toBe(true);
    expect(restored.degraded).toBe(false);
    expect(store.serializedConfigs()).toEqual(configAtPaid);
  });
});
