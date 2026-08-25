/**
 * INT-C4-1(a) — enforcement composition root end-to-end.
 *
 * Proves the BILL-C3-1e handoff: projector state (webhook refinement +
 * periodic Get App Instance reconciliation) flows through
 * `composeValidationEntitlement` into REAL validation-plugin handler
 * entitlement decisions, with ZERO webhook-type imports in the enforcement
 * consumer modules (composition root + src/platform/validation-plugin/**).
 *
 * Fixture zone America/New_York, Wednesday 2026-08-12 (mirrors the platform
 * rig conventions): local 13:00 == 17:00Z. All identifiers are obviously
 * synthetic; the vendorProductId→plan mapping stands in for the
 * operator-configured deploy-time table (never fabricated as real).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  composeValidationEntitlement,
  createCompactingProjector,
  intervalPollTrigger,
} from '../../src/platform/composition';
import type { ValidationEntitlementComposition } from '../../src/platform/composition';
import { createValidationHandlers, InMemoryDegradationSink } from '../../src/platform/validation-plugin';
import type { ValidationHandlerResult, ValidationHandlers } from '../../src/platform/validation-plugin';
import { FakeClock } from '../../src/platform/adapters/fakes/clock';
import { FakeBookingCountGateway } from '../../src/platform/adapters/fakes/bookingCountGateway';
import { FakeRulesConfigStore } from '../../src/platform/adapters/fakes/rulesConfigStore';
import { rawItem, rawRequest, SITE_ZONE } from './helpers/validationPluginRig';
import type { ExistingBookingFact, RuleSet } from '../../src/domain';
import type {
  AppInstanceBillingSnapshot,
  BillableCountResult,
  EntitlementWarning,
  EntitlementWarningCode,
  ManagedLocationRecord,
} from '../../src/billing/types';

// ------------------------------------------------------------- test doubles

const INSTANCE_ID = 'inst-composition-test';
/** Obviously synthetic stand-in for the operator-configured mapping. */
const OVERRIDES = { 'prod-test-2-3': 'TIER_2_3' } as const;

class FakeListingPort {
  constructor(private readonly records: ManagedLocationRecord[]) {}
  async listManagedLocations(): Promise<ManagedLocationRecord[]> {
    return this.records.map((r) => ({ ...r }));
  }
}

class FakeBillableCountPort {
  constructor(private readonly result: BillableCountResult) {}
  async countBillable(): Promise<BillableCountResult> {
    return { ...this.result, billableLocationIds: [...this.result.billableLocationIds] };
  }
}

class FakeWarningLedger {
  readonly recorded: EntitlementWarningCode[] = [];
  async record(code: EntitlementWarningCode): Promise<void> {
    this.recorded.push(code);
  }
  async clear(): Promise<void> {}
  async clearAll(): Promise<void> {}
  async load(): Promise<EntitlementWarning[]> {
    return [];
  }
}

class QueuedSnapshotFetcher {
  private queue: (AppInstanceBillingSnapshot | null)[] = [];
  private thrown: Error | null = null;

  enqueue(snapshot: AppInstanceBillingSnapshot | null): void {
    this.queue.push(snapshot);
  }

  failNextWith(error: Error): void {
    this.thrown = error;
  }

  async fetchCurrentSnapshot(): Promise<AppInstanceBillingSnapshot | null> {
    if (this.thrown) {
      const error = this.thrown;
      this.thrown = null;
      throw error;
    }
    const next = this.queue.shift();
    return next === undefined ? null : next;
  }
}

function managedLocations(): ManagedLocationRecord[] {
  return [
    { locationId: 'loc-default', archived: false, isDefault: true },
    { locationId: 'loc-2', archived: false },
    { locationId: 'loc-3', archived: false },
  ];
}

/** Location window for loc-2 that blocks the anchor slot (13:00 local Wed). */
function rulesetBlockingLoc2Anchor(): RuleSet {
  return {
    ruleSetId: 'ruleset-comp',
    revision: 'rev-1',
    version: 1,
    locationWindows: {
      'loc-2': [{ weekday: 'WED', start: '09:00', end: '10:00' }],
    },
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };
}

function compose(options: { fetcher?: QueuedSnapshotFetcher; onError?: (error: unknown) => void } = {}): {
  composition: ValidationEntitlementComposition;
  fetcher: QueuedSnapshotFetcher;
} {
  const fetcher = options.fetcher ?? new QueuedSnapshotFetcher();
  const composition = composeValidationEntitlement({
    listings: new FakeListingPort(managedLocations()),
    billableCount: new FakeBillableCountPort({
      count: 2,
      billableLocationIds: ['loc-2', 'loc-default'],
    }),
    warnings: new FakeWarningLedger(),
    overrides: { ...OVERRIDES },
    instanceId: INSTANCE_ID,
    snapshotFetcher: fetcher,
    ...(options.onError !== undefined ? { onReconciliationError: options.onError } : {}),
    // Long-lived-process shape: bounded dedup retention (INT-C4-1b). Limits
    // stay generous here — THIS suite exercises wiring; floods and eviction
    // semantics are proven in projector-compaction.spec.ts.
    createProjector: () =>
      createCompactingProjector({ instanceId: INSTANCE_ID, overrides: { ...OVERRIDES } }),
  });
  return { composition, fetcher };
}

function makeHandlers(composition: ValidationEntitlementComposition): {
  handlers: ValidationHandlers;
  sink: InMemoryDegradationSink;
} {
  const clock = new FakeClock('2026-08-12T12:00:00.000Z', SITE_ZONE);
  const store = new FakeRulesConfigStore();
  store.setActive(rulesetBlockingLoc2Anchor());
  const sink = new InMemoryDegradationSink();
  const existingBookings = {
    loadExisting: async (): Promise<readonly ExistingBookingFact[]> => [],
  };
  const handlers = createValidationHandlers({
    configStore: store,
    entitlementGate: composition.gate,
    counts: new FakeBookingCountGateway(),
    existingBookings,
    clock,
    degradationSink: sink,
  });
  return { handlers, sink };
}

async function createAtLoc2(handlers: ValidationHandlers): Promise<ValidationHandlerResult> {
  const request = rawRequest([rawItem({ serviceId: 'svc-1', locationId: 'loc-2' })]);
  return (await handlers.CREATE(request)) as ValidationHandlerResult;
}

function purchaseEnvelope(sequence: number) {
  return {
    id: `evt-purchase-${sequence}`,
    eventType: 'PAID_PLAN_PURCHASED' as const,
    entityEventSequence: sequence,
    instanceId: INSTANCE_ID,
    payload: { vendorProductId: 'prod-test-2-3', packageName: '2–3 Locations (fixture)' },
  };
}

// ------------------------------------------------------------------- tests

describe('composition root: projector state flows into handler entitlement decisions', () => {
  it('end-to-end: a purchase webhook between polls changes enforcement coverage', async () => {
    const { composition } = compose();
    const { handlers } = makeHandlers(composition);

    // Before any signal: FREE allowance (1 location) ⇒ loc-2 UNCOVERED ⇒
    // rule evaluation skipped, explicit valid result for the index.
    const before = await createAtLoc2(handlers);
    expect(before.results[0]?.valid).toBe(true);
    expect(before.results[0]?.disposition).toBe('UNCOVERED_LOCATION_RULES_SKIPPED');

    // Purchase webhook refined BETWEEN polls (no reconciliation yet): the
    // gate re-reads the projection per call, so coverage expands immediately
    // (TIER_2_3 ⇒ 3 locations) and loc-2 is now EVALUATED — its window
    // blocks the out-of-hours anchor slot.
    expect(composition.projector.ingestEvent(purchaseEnvelope(1))).toBe('APPLIED');

    const after = await createAtLoc2(handlers);
    expect(after.results[0]?.disposition).toBe('RULES_EVALUATED');
    expect(after.results[0]?.valid).toBe(false);
    expect(after.results[0]?.invalidReason?.code).toBe('OUTSIDE_BOOKING_HOURS');
  });

  it('trial→paid conversion (fires NO event) is discovered ONLY via the §7 reconciliation poll', async () => {
    const fetcher = new QueuedSnapshotFetcher();
    const { composition } = compose({ fetcher });
    const { handlers } = makeHandlers(composition);

    // No events, no poll yet: FREE coverage ⇒ loc-2 uncovered/skipped.
    const before = await createAtLoc2(handlers);
    expect(before.results[0]?.disposition).toBe('UNCOVERED_LOCATION_RULES_SKIPPED');

    // The conversion happened Wix-side; only a snapshot can reveal it.
    fetcher.enqueue({ isFree: false, vendorProductId: 'prod-test-2-3' });
    await expect(composition.reconciliation.reconcileNow()).resolves.toBe(true);

    const after = await createAtLoc2(handlers);
    expect(after.results[0]?.disposition).toBe('RULES_EVALUATED');
    expect(after.results[0]?.invalidReason?.code).toBe('OUTSIDE_BOOKING_HOURS');

    // Downgrade-by-confirming-snapshot shrinks coverage again (§7: no
    // mid-cycle downgrade path exists other than reconciliation); the stored
    // ruleset configuration is untouched throughout.
    fetcher.enqueue({ isFree: true });
    await expect(composition.reconciliation.reconcileNow()).resolves.toBe(true);
    const downgraded = await createAtLoc2(handlers);
    expect(downgraded.results[0]?.disposition).toBe('UNCOVERED_LOCATION_RULES_SKIPPED');
  });

  it('a failed reconciliation poll leaves projection state untouched and is never silent', async () => {
    const fetcher = new QueuedSnapshotFetcher();
    const errors: unknown[] = [];
    const { composition } = compose({ fetcher, onError: (error) => errors.push(error) });
    composition.projector.ingestEvent(purchaseEnvelope(1));
    const projectionBefore = composition.projector.project();

    fetcher.failNextWith(new Error('Get App Instance transport outage'));
    await expect(composition.reconciliation.reconcileNow()).resolves.toBe(false);

    expect(composition.projector.project()).toEqual(projectionBefore);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('transport outage');
  });

  it('injectable poll trigger fires reconcileNow; unsubscribe detaches it', async () => {
    const fetcher = new QueuedSnapshotFetcher();
    const { composition } = compose({ fetcher });

    const trigger: { fire: (() => void) | null } = { fire: null };
    let unregistered = false;
    composition.reconciliation.onPollTrigger((fire) => {
      trigger.fire = fire;
      return () => {
        unregistered = true;
        trigger.fire = null;
      };
    });
    expect(typeof trigger.fire).toBe('function');

    // The host scheduler fires exactly like this:
    fetcher.enqueue({ isFree: false, vendorProductId: 'prod-test-2-3' });
    trigger.fire?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(composition.projector.project().reconciledAtLeastOnce).toBe(true);
    expect(composition.projector.currentSnapshot()).toEqual({
      isFree: false,
      packageName: null,
      vendorProductId: 'prod-test-2-3',
    });

    composition.reconciliation.dispose();
    expect(unregistered).toBe(true);
    expect(trigger.fire).toBeNull();
  });

  it('intervalPollTrigger validates its interval and wires an injected scheduler', () => {
    expect(() => intervalPollTrigger(0)).toThrow();
    expect(() => intervalPollTrigger(Number.POSITIVE_INFINITY)).toThrow();

    const handle = Symbol('timer-handle');
    let started = 0;
    let cleared = 0;
    let captured: (() => void) | null = null;
    const unsubscribe = intervalPollTrigger(50, {
      setInterval: (fn) => {
        started += 1;
        captured = fn;
        return handle;
      },
      clearInterval: (seen) => {
        cleared += 1;
        expect(seen).toBe(handle);
      },
    })(() => undefined);
    expect(started).toBe(1);
    expect(typeof captured).toBe('function');
    unsubscribe();
    expect(cleared).toBe(1);
  });

  it('the composed gate also serves the dashboard meter reading', async () => {
    const { composition } = compose();
    await expect(composition.gate.meter()).resolves.toEqual({ count: 2, degraded: false });
    const decision = await composition.gate.allowedLocationIds();
    // FREE allowance 1: default location first, then alphabetical; excess is
    // over-limit state, not an error.
    expect(decision.allowedLocationIds).toEqual(['loc-default']);
    expect(decision.overLimit).toBe(true);
    expect(decision.degraded).toBe(false);
  });
});

// ------------------------------------------------- webhook-type import ban

const WEBHOOK_TYPE_MARKERS: RegExp[] = [
  /billing\/projection\/types/,
  /\bBillingEventEnvelope\b/,
  /\bBillingEventType\b/,
  /\bEventIngestStatus\b/,
  /\bPaidPlanPurchasedPayload\b/,
  /\bPaidPlanAutoRenewalCancelledPayload\b/,
  /\bInstallationBillingPayload\b/,
];

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('zero webhook-type imports in the enforcement consumer modules', () => {
  it('composition root + validation-plugin sources never reference billing webhook types', () => {
    const consumerFiles = [
      join(process.cwd(), 'src', 'platform', 'composition', 'entitlementComposition.ts'),
      ...listTsFiles(join(process.cwd(), 'src', 'platform', 'validation-plugin')),
    ];
    // 1 composition root + 6 validation-plugin modules currently in tree.
    expect(consumerFiles.length).toBeGreaterThanOrEqual(7);
    for (const file of consumerFiles) {
      const source = readFileSync(file, 'utf8');
      for (const marker of WEBHOOK_TYPE_MARKERS) {
        expect(
          marker.test(source),
          `${file} must not reference webhook types (/${marker.source}/)`,
        ).toBe(false);
      }
    }
  });

  it('the ingestion seam (projectorCompaction) is the ONLY composition module speaking envelope semantics', () => {
    const compositionDir = join(process.cwd(), 'src', 'platform', 'composition');
    const files = listTsFiles(compositionDir);
    const seamFiles = files.filter((file) => file.endsWith('projectorCompaction.ts'));
    const otherFiles = files.filter((file) => !seamFiles.includes(file));
    expect(seamFiles).toHaveLength(1);
    for (const file of otherFiles) {
      const source = readFileSync(file, 'utf8');
      expect(
        /\bBillingEventEnvelope\b/.test(source),
        `${file} must not speak envelope semantics`,
      ).toBe(false);
    }
  });
});
