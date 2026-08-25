/**
 * Projection fidelity folds (BILL-C4-1 b/c/d; accepted-audit observations 1,
 * 3 and 4 of `reports/audits/CYCLE_32792897988_BILLING.md` section 6).
 *
 * - Observation 1: installation payloads CAN carry the optional expiration
 *   alias (`billingExpirationDate`) because `InstallationBillingPayload`
 *   aliases `AppInstanceBillingSnapshot`; transitions NEVER read it (C2) and
 *   the rendered refinement omits it. The corrected docstring claims exactly
 *   this — these tests prove the claims behaviorally, both ways.
 * - Observation 3: `packageName` fidelity. Preservation through post-snapshot
 *   refinement already holds (merge discipline never clobbers known values),
 *   so the fold documents+tests WHY the only two drop cases are
 *   correct-by-design: (i) fields the resolver never reads are omitted from
 *   the rendered shape; (ii) a newer confirming snapshot supersedes an older
 *   name (reconciliation supremacy). Unknown-plan warning text fidelity is
 *   proven through the PUBLIC gate API.
 * - Observation 4: a never-reconciled zero-event projector reports
 *   `'EVENT_DERIVED'` — documented as naming the SUPPLYING LAYER (the event
 *   layer's empty view folds to the conservative FREE default), with the
 *   precise initial-state discriminators pinned by test.
 *
 * Fixture identifiers are obviously synthetic (`prod-test-*`, `evt-*`,
 * `inst-*`) — real Wix identifiers are never fabricated (constitution).
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
import { projectedSnapshotSource } from '../../src/billing/projection/snapshotSource';
import type {
  BillingEventEnvelope,
  BillingEventType,
  InstallationBillingPayload,
} from '../../src/billing/projection/types';
import type {
  AppInstanceBillingSnapshot,
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

let nextId = 0;

function env(
  eventType: BillingEventType,
  payload: BillingEventEnvelope['payload'],
  opts?: { id?: string; seq?: number },
): BillingEventEnvelope {
  nextId += 1;
  return {
    id: opts?.id ?? `evt-fidelity-${nextId}`,
    eventType,
    payload,
    entityEventSequence: opts?.seq ?? nextId,
    instanceId: null,
    receivedAt: null,
  };
}

function purchased(
  productId: string,
  packageName?: string,
  opts?: { id?: string; seq?: number },
): BillingEventEnvelope {
  return env('PAID_PLAN_PURCHASED', { vendorProductId: productId, packageName }, opts);
}

function installationUpdated(
  payload: InstallationBillingPayload,
  opts?: { id?: string; seq?: number },
): BillingEventEnvelope {
  return env('APP_INSTALLATION_UPDATED', payload, opts);
}

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
  return {
    async listManagedLocations(): Promise<ManagedLocationRecord[]> {
      return records;
    },
  };
}

function countPort(result?: BillableCountResult): BillableCountPort {
  return {
    async countBillable(): Promise<BillableCountResult> {
      return result ?? { count: 0, billableLocationIds: [] };
    },
  };
}

function rec(locationId: string, isDefault?: boolean): ManagedLocationRecord {
  return { locationId, archived: false, isDefault };
}

async function unknownPlanWarningOf(projector: ReturnType<typeof createBillingPlanProjector>): Promise<string | null> {
  const decision = await createEntitlementGate({
    // The narrow port IS a BillingInstancePort (compile-checked assignment):
    instance: projectedSnapshotSource(projector) as BillingInstancePort,
    listings: listingPort([rec('loc-m', true), rec('loc-a'), rec('loc-b')]),
    billableCount: countPort(),
    warnings: new InMemoryWarningLedger(),
    overrides: TEST_OVERRIDES,
  }).allowedLocationIds();
  return decision.warning ?? null;
}

describe('observation 1 — installation payloads CAN carry the expiration alias; transitions never read it (C2)', () => {
  it('accepts billingExpirationDate on an installation payload and never lets it flip the tier, either way', () => {
    // Way 1: long-past advisory date + isFree:false ⇒ PAID stands (dunning window).
    const dunning = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    dunning.ingestEvent(
      installationUpdated(
        {
          isFree: false,
          vendorProductId: 'prod-test-tier-4-10',
          billingExpirationDate: '2020-01-01T00:00:00.000Z', // long past — must stay irrelevant
        },
        { id: 'evt-alias-past', seq: 1 },
      ),
    );
    expect(dunning.project().resolution.tier).toBe('TIER_4_10');
    expect(dunning.project().resolution.isPaid).toBe(true);

    // Way 2: future advisory date + isFree:true ⇒ FREE stands (dates can
    // never GRANT coverage either).
    const lapsed = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    lapsed.ingestEvent(
      installationUpdated(
        {
          isFree: true,
          vendorProductId: 'prod-test-tier-4-10',
          billingExpirationDate: '2099-01-01T00:00:00.000Z',
        },
        { id: 'evt-alias-future', seq: 1 },
      ),
    );
    expect(lapsed.project().resolution.tier).toBe('FREE');
    expect(lapsed.project().resolution.isPaid).toBe(false);
  });

  it('the rendered refinement carries exactly the resolver-consumed triple — advisory/trial/clone fields are omitted', () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestEvent(
      installationUpdated(
        {
          isFree: false,
          vendorProductId: 'prod-test-tier-2-3',
          packageName: null,
          billingExpirationDate: '2027-01-01T00:00:00.000Z',
          freeTrialStatus: 'IN_PROGRESS',
          originInstanceId: 'inst-other',
          copiedFromTemplate: true,
        },
        { id: 'evt-alias-render', seq: 1 },
      ),
    );

    const rendered: AppInstanceBillingSnapshot | null = projector.currentSnapshot();
    expect(rendered).not.toBeNull();
    // The alias fields rode along in the payload but none survive the render:
    expect(Object.keys(rendered as AppInstanceBillingSnapshot).sort()).toEqual([
      'isFree',
      'packageName',
      'vendorProductId',
    ]);
    expect(rendered).toEqual({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: null,
    });
  });
});

describe('observation 3 — packageName fidelity (unknown-plan warning text)', () => {
  it('snapshot-seeded packageName survives post-snapshot refinement events and reaches the gate warning text', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
      packageName: 'Mystery Plan',
    });

    // Post-snapshot lifecycle traffic refines identifiers but must NOT clobber
    // the known name (merge discipline: absent values never overwrite known ones).
    projector.ingestEvent(purchased('prod-test-unmapped-two', undefined, { id: 'evt-refine', seq: 1 }));
    expect(projector.currentSnapshot()?.packageName).toBe('Mystery Plan');

    const warning = await unknownPlanWarningOf(projector);
    expect(warning).toContain('unmapped plan identifier');
    expect(warning).toContain('"Mystery Plan"'); // warning-text fidelity preserved
  });

  it('event-carried packageName reaches the gate warning text without any snapshot', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestEvent(purchased('prod-test-unmapped', 'Pro Annual', { id: 'evt-name', seq: 1 }));

    const warning = await unknownPlanWarningOf(projector);
    expect(warning).toContain('"Pro Annual"');
  });

  it('a newer confirming snapshot that stops reporting packageName supersedes the older name — reconciliation supremacy, not silent loss', async () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
      packageName: 'Old Name',
    });

    // A fresher FULL-STATE observation that does not report a name replaces
    // the stale one. This is the documented supremacy semantics (a snapshot
    // is the freshest full-state observation), not a rendering defect.
    projector.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-unmapped' });
    expect(projector.project().source).toBe('SNAPSHOT_RECONCILED');
    expect(projector.currentSnapshot()?.packageName ?? null).toBeNull();

    const warning = await unknownPlanWarningOf(projector);
    expect(warning).toContain('unmapped plan identifier'); // still flagged for the operator…
    expect(warning).not.toContain('Old Name'); // …with the superseded name correctly gone
  });
});

describe("observation 4 — initial source label on a never-reconciled zero-event projector ('EVENT_DERIVED', documented)", () => {
  it("reports 'EVENT_DERIVED' before anything was derived: the label names the supplying layer, with precise initial-state discriminators", () => {
    const projector = createBillingPlanProjector({ overrides: TEST_OVERRIDES });
    const initial = projector.project();

    // Documented labeling: before any input, the EVENT layer's empty view
    // supplies the resolution — the conservative FREE default of the accepted
    // decision table (under-serves rather than over-serves). It is NOT
    // 'SNAPSHOT_RECONCILED' because nothing was ever reconciled.
    expect(initial.source).toBe('EVENT_DERIVED');
    expect(initial.reconciledAtLeastOnce).toBe(false);
    expect(initial.generationEventCount).toBe(0);
    expect(initial.resolution).toEqual({
      tier: 'FREE',
      isPaid: false,
      maxLocations: 1,
      restrictionReliable: true,
      warnings: [],
    });

    // The precise initial-state discriminator pair documented on
    // ProjectionSource — operators distinguish "truly initial" by THIS,
    // not by the layer label:
    expect(initial.reconciledAtLeastOnce === false && initial.generationEventCount === 0).toBe(
      true,
    );

    // Contrast: the same layer label once real events were derived…
    projector.ingestEvent(purchased('prod-test-tier-1', undefined, { id: 'evt-first', seq: 1 }));
    const refined = projector.project();
    expect(refined.source).toBe('EVENT_DERIVED');
    expect(refined.generationEventCount).toBe(1);
    expect(refined.resolution.tier).toBe('TIER_1');

    // …and 'SNAPSHOT_RECONCILED' appears only after reconciliation.
    projector.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-1' });
    const reconciled = projector.project();
    expect(reconciled.source).toBe('SNAPSHOT_RECONCILED');
    expect(reconciled.reconciledAtLeastOnce).toBe(true);
    expect(reconciled.generationEventCount).toBe(0);
  });
});
