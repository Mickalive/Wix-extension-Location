/**
 * Enforcement-gate behavior (BILL-C2-1-REPAIR; Contract §7 fail-open posture,
 * §11 C5; Blueprint §4 flow 5, §5 error model).
 *
 * Proves the canonical `EntitlementGate` port implementation: healthy
 * PolicyDecision shape, fail-open + persisted warnings on billing/listing/
 * counting failures, recovery clearing of transient warnings, persistent
 * UNKNOWN_PLAN_IDENTIFIER across gate instances sharing one ledger, and the
 * over-limit upgrade state without spurious warnings.
 */
import { describe, expect, it } from 'vitest';
import {
  createEntitlementGate,
  FAIL_OPEN_RESOLUTION,
  TRANSIENT_WARNING_CODES,
} from '../../src/billing/enforcement/entitlementGate';
import type {
  BillableCountPort,
  BillingInstancePort,
  EntitlementWarningLedger,
  ManagedLocationListingPort,
} from '../../src/billing/enforcement/entitlementGate';
import type {
  AppInstanceBillingSnapshot,
  BillableCountResult,
  EntitlementWarning,
  EntitlementWarningCode,
  ManagedLocationRecord,
} from '../../src/billing/types';

const NOW = '2026-08-24T00:00:00.000Z';

const TEST_OVERRIDES = {
  'prod-test-tier-1': 'TIER_1',
  'prod-test-tier-2-3': 'TIER_2_3',
} as const;

/** In-memory ledger mirroring the upsert-by-code semantics of the persisted collection. */
class InMemoryWarningLedger implements EntitlementWarningLedger {
  private readonly entries = new Map<EntitlementWarningCode, EntitlementWarning>();

  async record(code: EntitlementWarningCode, message: string): Promise<void> {
    const existing = this.entries.get(code);
    if (existing) {
      existing.lastSeenAt = NOW;
      existing.occurrences += 1;
      return;
    }
    this.entries.set(code, {
      code,
      message,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      occurrences: 1,
    });
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

function instancePort(
  snapshot: AppInstanceBillingSnapshot | null,
  state: { failWith?: Error } = {},
): BillingInstancePort {
  return {
    async getAppInstanceSnapshot(): Promise<AppInstanceBillingSnapshot | null> {
      if (state.failWith) throw state.failWith;
      return snapshot;
    },
  };
}

function listingPort(
  records: ManagedLocationRecord[],
  state: { failWith?: Error } = {},
): ManagedLocationListingPort {
  return {
    async listManagedLocations(): Promise<ManagedLocationRecord[]> {
      if (state.failWith) throw state.failWith;
      return records;
    },
  };
}

function countPort(state: { result?: BillableCountResult; failWith?: Error } = {}): BillableCountPort {
  return {
    async countBillable(): Promise<BillableCountResult> {
      if (state.failWith) throw state.failWith;
      return state.result ?? { count: 0, billableLocationIds: [] };
    },
  };
}

function rec(locationId: string, isDefault?: boolean): ManagedLocationRecord {
  return { locationId, archived: false, isDefault };
}

describe('createEntitlementGate (canonical EntitlementGate port)', () => {
  it('produces the canonical healthy PolicyDecision with stable ordering and no warnings', async () => {
    const ledger = new InMemoryWarningLedger();
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }),
      listings: listingPort([rec('loc-b'), rec('loc-a')]),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    expect(decision).toEqual({
      allowedLocationIds: ['loc-a', 'loc-b'],
      overLimit: false,
      degraded: false,
      warning: null,
    });
    expect(await ledger.load()).toEqual([]);
  });

  it('fails OPEN on billing-instance failure: unlimited coverage, degraded flag, persisted warning', async () => {
    const ledger = new InMemoryWarningLedger();
    const instanceState: { failWith?: Error } = {
      failWith: new Error('instance API unreachable'),
    };
    const gate = createEntitlementGate({
      instance: instancePort(null, instanceState),
      listings: listingPort([rec('loc-d'), rec('loc-c'), rec('loc-b'), rec('loc-a')]),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    // Fail-open: a transient billing outage must never block a paying merchant.
    expect(decision.degraded).toBe(true);
    expect(decision.overLimit).toBe(false);
    expect(decision.allowedLocationIds).toEqual(['loc-a', 'loc-b', 'loc-c', 'loc-d']);
    expect(decision.warning).toContain('failing open');
    const warnings = await ledger.load();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('BILLING_API_FAILURE');
  });

  it('degrades without location ids when the listing fails, persisting the warning', async () => {
    const ledger = new InMemoryWarningLedger();
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }),
      listings: listingPort([], { failWith: new Error('listLocations down') }),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    expect(decision).toEqual({
      allowedLocationIds: [],
      overLimit: false,
      degraded: true,
      warning: 'Location listing unavailable — entitlement coverage temporarily unknown.',
    });
    const warnings = await ledger.load();
    expect(warnings[0]?.code).toBe('LOCATION_LISTING_FAILURE');
  });

  it('degrades the meter on counting failure and persists BILLABLE_COUNT_FAILURE', async () => {
    const ledger = new InMemoryWarningLedger();
    const countState: { failWith?: Error } = { failWith: new Error('count timeout') };
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }),
      listings: listingPort([rec('loc-a')]),
      billableCount: countPort(countState),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const reading = await gate.meter();

    expect(reading).toEqual({ count: null, degraded: true }); // fail-open: never blocks bookings
    const warnings = await ledger.load();
    expect(warnings[0]?.code).toBe('BILLABLE_COUNT_FAILURE');
  });

  it('clears transient warnings after recovery: a healthy call heals the degraded state', async () => {
    const ledger = new InMemoryWarningLedger();
    const instanceState: { failWith?: Error } = {
      failWith: new Error('instance API unreachable'),
    };
    const listingState: { failWith?: Error } = { failWith: new Error('listLocations down') };
    const countState: { failWith?: Error } = { failWith: new Error('count timeout') };
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }, instanceState),
      listings: listingPort([rec('loc-a')], listingState),
      billableCount: countPort(countState),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    await gate.allowedLocationIds(); // billing + listing failures recorded
    await gate.meter(); // counting failure recorded
    expect((await ledger.load()).map((w) => w.code).sort()).toEqual([
      'BILLABLE_COUNT_FAILURE',
      'BILLING_API_FAILURE',
      'LOCATION_LISTING_FAILURE',
    ]);

    delete instanceState.failWith;
    delete listingState.failWith;
    delete countState.failWith;

    const decision = await gate.allowedLocationIds();
    await gate.meter();

    expect(decision.degraded).toBe(false);
    expect(await ledger.load()).toEqual([]); // every TRANSIENT_WARNING_CODES entry cleared
    expect(TRANSIENT_WARNING_CODES).toContain('BILLING_API_FAILURE');
  });

  it('keeps UNKNOWN_PLAN_IDENTIFIER persistent in a shared ledger across gate instances', async () => {
    const sharedLedger = new InMemoryWarningLedger();
    const unknownSnapshot: AppInstanceBillingSnapshot = {
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
    };

    const gateA = createEntitlementGate({
      instance: instancePort(unknownSnapshot),
      listings: listingPort([rec('loc-a')]),
      billableCount: countPort(),
      warnings: sharedLedger,
      overrides: TEST_OVERRIDES,
    });
    await gateA.allowedLocationIds();

    // A second gate instance (e.g. another request/dashboard session) sharing
    // the same persisted ledger must still observe the warning — and a fully
    // healthy known-plan cycle must NOT clear it.
    const gateB = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }),
      listings: listingPort([rec('loc-a')]),
      billableCount: countPort(),
      warnings: sharedLedger,
      overrides: TEST_OVERRIDES,
    });
    const decisionB = await gateB.allowedLocationIds();

    const warnings = await sharedLedger.load();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('UNKNOWN_PLAN_IDENTIFIER');
    expect(warnings[0]?.occurrences).toBeGreaterThanOrEqual(1);
    // Layering contract: PolicyDecision.warning carries THIS decision's own
    // signals (gateB resolved a known plan ⇒ none), while the persistent
    // warning stays in the ledger for the dashboard to render.
    expect(decisionB.warning).toBeNull();
  });

  it('serves TIER_1 coverage for an unknown paid plan and flags the upgrade-blocking warning', async () => {
    const ledger = new InMemoryWarningLedger();
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-unmapped' }),
      listings: listingPort([rec('loc-m', true), rec('loc-b'), rec('loc-a')]),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    expect(decision.degraded).toBe(false);
    expect(decision.allowedLocationIds).toEqual(['loc-m']);
    expect(decision.overLimit).toBe(true);
    expect(decision.warning).toContain('unmapped plan identifier');
    expect((await ledger.load())[0]?.code).toBe('UNKNOWN_PLAN_IDENTIFIER');
  });

  it('exposes the over-limit upgrade state on a healthy paid path without inventing warnings', async () => {
    const ledger = new InMemoryWarningLedger();
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-1' }),
      listings: listingPort([rec('loc-m', true), rec('loc-b'), rec('loc-a')]),
      billableCount: countPort({ result: { count: 3, billableLocationIds: ['loc-a', 'loc-b', 'loc-m'] } }),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    expect(decision).toEqual({
      allowedLocationIds: ['loc-m'], // default first; excess management disabled, configuration preserved
      overLimit: true,
      degraded: false,
      warning: null, // over-limit is a normal upgrade-CTA state, not an incident
    });
    expect(await ledger.load()).toEqual([]);
  });
});

describe('accepted-audit observations folded at BILL-C3-1 (CYCLE_32787032785_BILLING)', () => {
  it('observation 1 — BILLING_API_FAILURE clears on billing recovery even while listing still fails', async () => {
    const ledger = new InMemoryWarningLedger();
    const instanceState: { failWith?: Error } = { failWith: new Error('instance API unreachable') };
    const listingState: { failWith?: Error } = { failWith: new Error('listLocations down') };
    const gate = createEntitlementGate({
      instance: instancePort({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }, instanceState),
      listings: listingPort([rec('loc-a')], listingState),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    // Step 1: billing fails while the listing is healthy ⇒ billing warning recorded.
    delete listingState.failWith;
    await gate.allowedLocationIds();
    expect((await ledger.load()).map((w) => w.code)).toEqual(['BILLING_API_FAILURE']);

    // Step 2: billing recovers but the listing now fails. Warning liveness is
    // PER-SOURCE: the healed billing failure must clear even though the
    // decision itself degrades on the listing path.
    delete instanceState.failWith;
    listingState.failWith = new Error('listLocations down again');

    const decision = await gate.allowedLocationIds();
    expect(decision.degraded).toBe(true); // listing degraded as expected
    expect((await ledger.load()).map((w) => w.code)).toEqual(['LOCATION_LISTING_FAILURE']);

    // Step 3: full recovery clears the remaining transient code.
    delete listingState.failWith;
    await gate.allowedLocationIds();
    expect(await ledger.load()).toEqual([]);
  });

  it('observation 2 — FAIL_OPEN_RESOLUTION carries an explicit null tier, never a tier placeholder', () => {
    // The former 'TIER_11_PLUS' placeholder implied a plan identification
    // that never happened; the sentinel now claims NO tier.
    expect(FAIL_OPEN_RESOLUTION.tier).toBeNull();
    expect(FAIL_OPEN_RESOLUTION.tier).not.toBe('TIER_11_PLUS');
    expect(Object.isFrozen(FAIL_OPEN_RESOLUTION)).toBe(true);
    expect(FAIL_OPEN_RESOLUTION.maxLocations).toBe(Number.POSITIVE_INFINITY);
    expect(FAIL_OPEN_RESOLUTION.isPaid).toBe(false);
    expect(FAIL_OPEN_RESOLUTION.restrictionReliable).toBe(false);
    expect(FAIL_OPEN_RESOLUTION.warnings).toEqual([]);
  });

  it('observation 2 — the billing-failed branch serves unlimited coverage from the sentinel without consuming a tier', async () => {
    const ledger = new InMemoryWarningLedger();
    const gate = createEntitlementGate({
      instance: instancePort(null, { failWith: new Error('instance API unreachable') }),
      listings: listingPort([rec('loc-b'), rec('loc-a'), rec('loc-m', true)]),
      billableCount: countPort(),
      warnings: ledger,
      overrides: TEST_OVERRIDES,
    });

    const decision = await gate.allowedLocationIds();

    // Behavior unchanged by the observation-2 retype: fail-open coverage.
    expect(decision.degraded).toBe(true);
    expect(decision.overLimit).toBe(false);
    expect(decision.allowedLocationIds).toEqual(['loc-m', 'loc-a', 'loc-b']);
    expect((await ledger.load())[0]?.code).toBe('BILLING_API_FAILURE');
  });
});
