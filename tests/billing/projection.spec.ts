/**
 * Plan-state projection & reconciliation machine (BILL-C3-1; Contract §7
 * lifecycle, §11 C2; Blueprint §4 flow 5).
 *
 * Proves the binding acceptance criteria:
 * - snapshot-beats-stale-events (reconciliation supremacy + durable dedup);
 * - duplicate/out-of-order/replayed events converge idempotently;
 * - every §7 lifecycle branch asserted BOTH ways: cancelled-until-expiry
 *   keeps paid identifiers, dunning window stays PAID, auto-renewal
 *   cancellation downgrades only at period end given a confirming snapshot,
 *   trial→paid conversion fires NO event (reconciliation mandatory),
 *   clone markers never leak across instances, UNKNOWN_PLAN_IDENTIFIER
 *   persists per accepted semantics.
 *
 * Fixture identifiers are obviously synthetic (`prod-test-*`, `inst-*`,
 * `evt-test-*`) — real Wix identifiers are never fabricated (constitution).
 */
import { describe, expect, it } from 'vitest';
import { createBillingPlanProjector } from '../../src/billing/projection/projector';
import type { BillingPlanProjector } from '../../src/billing/projection/projector';
import {
  emptyPlanView,
  foldEventLayer,
  resolveFromPlanView,
  seedPlanViewFromSnapshot,
} from '../../src/billing/projection/fold';
import type {
  BillingEventEnvelope,
  BillingEventType,
  InstallationBillingPayload,
} from '../../src/billing/projection/types';
import type { AppInstanceBillingSnapshot } from '../../src/billing/types';

const TEST_OVERRIDES = {
  'prod-test-tier-1': 'TIER_1',
  'prod-test-tier-2-3': 'TIER_2_3',
  'prod-test-tier-4-10': 'TIER_4_10',
  'prod-test-tier-11-plus': 'TIER_11_PLUS',
} as const;

let nextId = 0;

function env(
  eventType: BillingEventType,
  payload: BillingEventEnvelope['payload'],
  opts?: { id?: string; seq?: number | string | null; instanceId?: string },
): BillingEventEnvelope {
  nextId += 1;
  return {
    id: opts?.id ?? `evt-test-${nextId}`,
    eventType,
    payload,
    entityEventSequence: opts?.seq !== undefined ? opts.seq : nextId,
    instanceId: opts?.instanceId ?? null,
    receivedAt: null,
  };
}

function purchased(
  productId: string,
  opts?: { id?: string; seq?: number | string | null; instanceId?: string },
): BillingEventEnvelope {
  return env('PAID_PLAN_PURCHASED', { vendorProductId: productId }, opts);
}

function renewalCancelled(opts?: {
  id?: string;
  seq?: number | string | null;
  instanceId?: string;
}): BillingEventEnvelope {
  return env('PAID_PLAN_AUTO_RENEWAL_CANCELLED', {}, opts);
}

function installationUpdated(
  payload: InstallationBillingPayload,
  opts?: { id?: string; seq?: number | string | null; instanceId?: string },
): BillingEventEnvelope {
  return env('APP_INSTALLATION_UPDATED', payload, opts);
}

function projectorFor(instanceId?: string): BillingPlanProjector {
  return createBillingPlanProjector({ instanceId, overrides: TEST_OVERRIDES });
}

/** Deterministic PRNG (mulberry32) — no Math.random anywhere (CI determinism). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swappedA = out[i] as T;
    const swappedB = out[j] as T;
    out[i] = swappedB;
    out[j] = swappedA;
  }
  return out;
}

describe('BillingPlanProjector — initial state and basic transitions', () => {
  it('projects a conservative FREE default before any signal arrives', () => {
    const projection = projectorFor().project();

    expect(projection.source).toBe('EVENT_DERIVED');
    expect(projection.reconciledAtLeastOnce).toBe(false);
    expect(projection.generationEventCount).toBe(0);
    expect(projection.resolution).toEqual({
      tier: 'FREE',
      isPaid: false,
      maxLocations: 1,
      restrictionReliable: true,
      warnings: [],
    });
  });

  it('a Paid Plan Purchased event grants the mapped paid tier between reconciliations', () => {
    const projector = projectorFor();
    expect(projector.ingestEvent(purchased('prod-test-tier-2-3'))).toBe('APPLIED');

    const projection = projector.project();
    expect(projection.source).toBe('EVENT_DERIVED');
    expect(projection.generationEventCount).toBe(1);
    expect(projection.resolution.tier).toBe('TIER_2_3');
    expect(projection.resolution.isPaid).toBe(true);
    expect(projection.resolution.maxLocations).toBe(3);
  });

  it('counts a trial signup (which fires Paid Plan Purchased) as paid', () => {
    // Contract §7: trial signup fires Paid Plan Purchased; trial users count
    // as paid through their plan identifier.
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-1'));

    expect(projector.project().resolution.isPaid).toBe(true);
    expect(projector.project().resolution.tier).toBe('TIER_1');
  });

  it('never grants a paid tier from a purchase payload without a plan identifier', () => {
    // Merge discipline: missing/empty identifier = not reported (§7: missing ⇒ free).
    const projector = projectorFor();
    projector.ingestEvent(env('PAID_PLAN_PURCHASED', { vendorProductId: '' }));

    const projection = projector.project();
    expect(projection.resolution.tier).toBe('FREE');
    expect(projection.resolution.isPaid).toBe(false);
  });

  it('merges App Installation Updated defensively: reported fields overwrite, absent fields do not clobber', () => {
    const projector = projectorFor();
    projector.ingestEvent(
      installationUpdated({ isFree: false, vendorProductId: 'prod-test-tier-2-3' }),
    );
    expect(projector.project().resolution.tier).toBe('TIER_2_3');

    // A later update reporting ONLY isFree=true flips the free signal but
    // cannot silently invent a missing identifier.
    projector.ingestEvent(installationUpdated({ isFree: true }));
    expect(projector.project().resolution.tier).toBe('FREE');

    // An update reporting only a package name must not clobber the identifier.
    projector.ingestEvent(installationUpdated({ isFree: false, packageName: '2–3 Locations' }));
    const projection = projector.project();
    expect(projection.resolution.tier).toBe('TIER_2_3');
    expect(projection.resolution.warnings.some((w) => w.code === 'UNKNOWN_PLAN_IDENTIFIER')).toBe(
      false,
    );
  });
});

describe('BillingPlanProjector — idempotent convergence (duplicate / out-of-order / replay)', () => {
  it('suppresses duplicated envelope ids: the second delivery is a no-op', () => {
    const projector = projectorFor();
    const first = purchased('prod-test-tier-2-3', { id: 'evt-dup-1', seq: 1 });

    expect(projector.ingestEvent(first)).toBe('APPLIED');
    expect(projector.ingestEvent(first)).toBe('DUPLICATE');

    const projection = projector.project();
    expect(projection.generationEventCount).toBe(1);
    expect(projection.resolution.tier).toBe('TIER_2_3');
  });

  it('converges identically when events arrive out of order (fold order = sequence, then id)', () => {
    const forward = projectorFor();
    forward.ingestEvent(purchased('prod-test-tier-2-3', { id: 'e1', seq: 1 }));
    forward.ingestEvent(renewalCancelled({ id: 'e2', seq: 2 }));

    const backward = projectorFor();
    backward.ingestEvent(renewalCancelled({ id: 'e2', seq: 2 }));
    backward.ingestEvent(purchased('prod-test-tier-2-3', { id: 'e1', seq: 1 }));

    expect(backward.project()).toEqual(forward.project());
    expect(forward.project().autoRenewCancelled).toBe(true);
    expect(forward.project().resolution.tier).toBe('TIER_2_3');
  });

  it('resolves conflicting purchases by sequence rank regardless of arrival order', () => {
    // Upgrade 1-location → 4–10 delivered backwards: the LATER subscription wins.
    const arrivalA = projectorFor();
    arrivalA.ingestEvent(purchased('prod-test-tier-4-10', { id: 'e-new', seq: 20 }));
    arrivalA.ingestEvent(purchased('prod-test-tier-1', { id: 'e-old', seq: 10 }));

    const arrivalB = projectorFor();
    arrivalB.ingestEvent(purchased('prod-test-tier-1', { id: 'e-old', seq: 10 }));
    arrivalB.ingestEvent(purchased('prod-test-tier-4-10', { id: 'e-new', seq: 20 }));

    expect(arrivalB.project()).toEqual(arrivalA.project());
    expect(arrivalA.project().resolution.tier).toBe('TIER_4_10');
  });

  it('ranks numeric-string and number sequences on one numeric scale', () => {
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-1', { id: 'e-old', seq: '9' }));
    projector.ingestEvent(purchased('prod-test-tier-4-10', { id: 'e-new', seq: 10 }));

    expect(projector.project().resolution.tier).toBe('TIER_4_10');
  });

  it('converges even when envelopes carry no entityEventSequence (deterministic id tiebreak)', () => {
    const build = () => {
      const projector = projectorFor();
      // Delivery order varies per run; sequences are entirely absent, so the
      // documented id tiebreak decides — deterministically.
      const batch = [
        purchased('prod-test-tier-1', { id: 'n-aaa', seq: null }),
        renewalCancelled({ id: 'n-bbb', seq: null }),
        installationUpdated({ packageName: '1 Location' }, { id: 'n-ccc', seq: null }),
      ];
      for (const envelope of [...batch].reverse()) projector.ingestEvent(envelope);
      return projector.project();
    };

    expect(build()).toEqual(build());
  });

  it('is deterministic across 50 seeded shuffles of one event generation', () => {
    const generation: BillingEventEnvelope[] = [
      purchased('prod-test-tier-1', { id: 'g1', seq: 1 }),
      installationUpdated({ isFree: false, vendorProductId: 'prod-test-tier-1' }, { id: 'g2', seq: 2 }),
      purchased('prod-test-tier-2-3', { id: 'g3', seq: 3 }),
      installationUpdated({ packageName: '2–3 Locations' }, { id: 'g5', seq: 5 }),
      purchased('prod-test-tier-4-10', { id: 'g6', seq: 6 }),
      renewalCancelled({ id: 'g7', seq: 7 }), // latest lifecycle transition wins
    ];

    const rand = mulberry32(20260825);
    let reference: ReturnType<BillingPlanProjector['project']> | null = null;
    for (let run = 0; run < 50; run += 1) {
      const projector = projectorFor();
      for (const envelope of seededShuffle(generation, rand)) {
        projector.ingestEvent(envelope);
        // Replays interleaved anywhere must stay harmless.
        if (run % 2 === 0) projector.ingestEvent(envelope);
      }
      const projection = projector.project();
      if (reference === null) reference = projection;
      else expect(projection).toEqual(reference);
    }

    expect(reference).not.toBeNull();
    expect(reference?.resolution.tier).toBe('TIER_4_10'); // latest purchase (seq 6) wins
    expect(reference?.autoRenewCancelled).toBe(true); // cancellation (seq 7) folds after the purchase
    expect(reference?.generationEventCount).toBe(6); // duplicates collapsed
  });
});

describe('BillingPlanProjector — reconciliation supremacy (Contract §7)', () => {
  it('a snapshot overrides all previously accumulated event-derived state', () => {
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-2-3'));
    expect(projector.project().resolution.tier).toBe('TIER_2_3');

    projector.ingestSnapshot({ isFree: true }); // Wix reports free

    const projection = projector.project();
    expect(projection.source).toBe('SNAPSHOT_RECONCILED');
    expect(projection.reconciledAtLeastOnce).toBe(true);
    expect(projection.generationEventCount).toBe(0);
    expect(projection.resolution.tier).toBe('FREE');
  });

  it('snapshot beats STALE events: a replayed pre-snapshot delivery cannot resurrect old state', () => {
    const projector = projectorFor();
    const stale = purchased('prod-test-tier-4-10', { id: 'evt-stale-1', seq: 1 });
    projector.ingestEvent(stale);

    projector.ingestSnapshot({ isFree: true });
    expect(projector.ingestEvent(stale)).toBe('DUPLICATE'); // dedup memory survives reconciliation

    const projection = projector.project();
    expect(projection.source).toBe('SNAPSHOT_RECONCILED');
    expect(projection.resolution.tier).toBe('FREE');
  });

  it('unique events delivered AFTER a snapshot legitimately refine the projection', () => {
    const projector = projectorFor();
    projector.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-1' });
    expect(projector.project().source).toBe('SNAPSHOT_RECONCILED');

    projector.ingestEvent(purchased('prod-test-tier-2-3', { id: 'evt-fresh', seq: 99 }));

    const projection = projector.project();
    expect(projection.source).toBe('EVENT_DERIVED');
    expect(projection.generationEventCount).toBe(1);
    expect(projection.resolution.tier).toBe('TIER_2_3');
  });

  it('discovers trial→paid conversion ONLY through reconciliation because conversion fires NO event', () => {
    // Positive: the snapshot reveals the converted plan.
    const reconciled = projectorFor();
    reconciled.ingestEvent(purchased('prod-test-tier-1')); // trial-era purchase event
    reconciled.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-4-10' });
    expect(reconciled.project().resolution.tier).toBe('TIER_4_10');

    // Negative proof: without a snapshot, NO amount of unrelated webhook
    // traffic can discover the conversion — periodic reconciliation is
    // mandatory, not optional (Contract §7).
    const eventsOnly = projectorFor();
    eventsOnly.ingestEvent(purchased('prod-test-tier-1'));
    eventsOnly.ingestEvent(renewalCancelled());
    eventsOnly.ingestEvent(installationUpdated({ packageName: '2–3 Locations' }));
    expect(eventsOnly.project().resolution.tier).toBe('TIER_1');
  });

  it('reconciling the same snapshot twice is idempotent', () => {
    const projector = projectorFor();
    const snapshot: AppInstanceBillingSnapshot = {
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
    };
    projector.ingestSnapshot(snapshot);
    const first = projector.project();
    projector.ingestSnapshot(snapshot);
    const second = projector.project();

    expect(second).toEqual(first);
    expect(second.source).toBe('SNAPSHOT_RECONCILED');
  });

  it('treats a null snapshot as genuinely absent billing (accepted FREE semantics), refinable by events', () => {
    const projector = projectorFor();
    projector.ingestSnapshot(null);
    expect(projector.project().resolution.tier).toBe('FREE');
    expect(projector.project().reconciledAtLeastOnce).toBe(true);

    projector.ingestEvent(purchased('prod-test-tier-1', { id: 'evt-after-null', seq: 1 }));
    expect(projector.project().resolution.tier).toBe('TIER_1');
  });
});

describe('BillingPlanProjector — §7 lifecycle branches, both ways', () => {
  it('cancelled-until-expiry KEEPS paid identifiers (event way and confirming-snapshot way)', () => {
    // Way 1: the cancellation event alone keeps the paid identifiers.
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-2-3', { id: 'e-p', seq: 1 }));
    projector.ingestEvent(renewalCancelled({ id: 'e-c', seq: 2 }));

    const afterCancel = projector.project();
    expect(afterCancel.autoRenewCancelled).toBe(true);
    expect(afterCancel.resolution.isPaid).toBe(true);
    expect(afterCancel.resolution.tier).toBe('TIER_2_3');

    // Way 2: a confirming snapshot taken before period end still reports the
    // paid identifiers — coverage continues; the marker survives reconciliation.
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: '2–3 Locations',
    });
    const confirmed = projector.project();
    expect(confirmed.autoRenewCancelled).toBe(true);
    expect(confirmed.resolution.tier).toBe('TIER_2_3');
    expect(confirmed.resolution.isPaid).toBe(true);
  });

  it('downgrades from auto-renewal cancellation ONLY at period end given a confirming snapshot', () => {
    // Without a confirming snapshot: still paid (no mid-cycle downgrade exists).
    const pending = projectorFor();
    pending.ingestEvent(purchased('prod-test-tier-2-3', { id: 'e-p', seq: 1 }));
    pending.ingestEvent(renewalCancelled({ id: 'e-c', seq: 2 }));
    expect(pending.project().resolution.isPaid).toBe(true);

    // With the period-end snapshot reporting free: downgrade happens here.
    pending.ingestSnapshot({ isFree: true, vendorProductId: null });
    const ended = pending.project();
    expect(ended.resolution.tier).toBe('FREE');
    expect(ended.resolution.isPaid).toBe(false);
    expect(ended.autoRenewCancelled).toBe(true); // marker remains informational
  });

  it('keeps the dunning window PAID (expired advisory date + isFree:false) and never the reverse', () => {
    // Way 1: expired date but isFree:false ⇒ PAID (Invariant C2: dates advisory-only).
    const dunning = projectorFor();
    dunning.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-4-10',
      billingExpirationDate: '2026-01-01T00:00:00.000Z', // long past — ignored
    });
    const paid = dunning.project();
    expect(paid.resolution.tier).toBe('TIER_4_10');
    expect(paid.resolution.isPaid).toBe(true);
    expect(paid.resolution.maxLocations).toBe(10);

    // Way 2: future date can NEVER grant paid coverage once isFree:true.
    const lapsed = projectorFor();
    lapsed.ingestSnapshot({
      isFree: true,
      vendorProductId: 'prod-test-tier-4-10',
      billingExpirationDate: '2027-01-01T00:00:00.000Z',
    });
    expect(lapsed.project().resolution.tier).toBe('FREE');
  });

  it('keeps UNKNOWN_PLAN_IDENTIFIER persistent per accepted semantics across refinements until mapped', () => {
    const projector = projectorFor();

    // Unknown paid identifier ⇒ TIER_1 under-serve + persistent warning.
    projector.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
      packageName: 'Mystery Plan',
    });
    const unknown = projector.project();
    expect(unknown.resolution.tier).toBe('TIER_1');
    expect(unknown.resolution.restrictionReliable).toBe(false);
    expect(unknown.resolution.warnings.map((w) => w.code)).toEqual(['UNKNOWN_PLAN_IDENTIFIER']);

    // Post-snapshot lifecycle traffic does NOT heal or drop the warning:
    // the identifier is still unmapped.
    projector.ingestEvent(renewalCancelled({ id: 'e-c', seq: 1 }));
    const refined = projector.project();
    expect(refined.resolution.tier).toBe('TIER_1');
    expect(refined.resolution.warnings.map((w) => w.code)).toEqual(['UNKNOWN_PLAN_IDENTIFIER']);

    // Only the operator mapping the identifier (visible via reconciliation) clears it.
    projector.ingestSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-2-3' });
    const mapped = projector.project();
    expect(mapped.resolution.tier).toBe('TIER_2_3');
    expect(mapped.resolution.warnings).toEqual([]);
  });

  it('never leaks plan state across instances: foreign-instance events are ignored and clones resolve from their own signals', () => {
    // Foreign-instance deliveries are ignored entirely.
    const scoped = projectorFor('inst-b');
    expect(scoped.ingestEvent(purchased('prod-test-tier-4-10', { instanceId: 'inst-a' }))).toBe(
      'FOREIGN_INSTANCE',
    );
    expect(scoped.project().resolution.tier).toBe('FREE');

    // Same-envelope isolation: the origin instance's projector is unaffected
    // by what the clone's projector sees, and vice versa.
    const origin = projectorFor('inst-a');
    origin.ingestEvent(purchased('prod-test-tier-4-10', { instanceId: 'inst-a' }));

    // Clone markers never alter the clone's own resolution (§7/UQ6-defensive:
    // markers ride along in snapshots but grant nothing).
    scoped.ingestSnapshot({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      originInstanceId: 'inst-a',
      copiedFromTemplate: true,
    });
    const cloneProjection = scoped.project();
    expect(cloneProjection.resolution.tier).toBe('TIER_2_3'); // its OWN signal, not inst-a's plan

    expect(origin.project().resolution.tier).toBe('TIER_4_10');
    expect(cloneProjection.resolution.tier).not.toBe(origin.project().resolution.tier);
  });

  it('accepts envelopes without instanceId on a scoped projector (platform-scoped delivery)', () => {
    const scoped = projectorFor('inst-b');
    expect(scoped.ingestEvent(purchased('prod-test-tier-1'))).toBe('APPLIED');
    expect(scoped.project().resolution.tier).toBe('TIER_1');
  });
});

describe('BillingPlanProjector — input validation and immutability', () => {
  it('rejects structurally invalid envelopes BEFORE mutating any state', () => {
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-2-3', { id: 'e-ok', seq: 1 }));
    const before = projector.project();

    expect(() =>
      projector.ingestEvent(env('PAID_PLAN_PURCHASED', { vendorProductId: 'x' }, { id: '  ' })),
    ).toThrow(TypeError);
    expect(() =>
      projector.ingestEvent(env('NOT_A_BILLING_EVENT' as BillingEventType, {})),
    ).toThrow(TypeError);
    // Both rejections happened before any mutation:
    expect(projector.project()).toEqual(before);

    // An empty payload OBJECT is structurally valid (defensive shapes): the
    // event itself asserts "a plan was purchased" (isFree:false) while the
    // previously-known identifier is preserved.
    expect(projector.ingestEvent(env('PAID_PLAN_PURCHASED', {}, { id: 'e-empty', seq: 2 }))).toBe(
      'APPLIED',
    );
    const afterEmpty = projector.project();
    expect(afterEmpty.generationEventCount).toBe(2);
    expect(afterEmpty.resolution.isPaid).toBe(true);
    expect(afterEmpty.resolution.tier).toBe('TIER_2_3'); // identifier survived

    expect(projector.ingestEvent(purchased('prod-test-tier-1', { id: 'e-ok-2', seq: 3 }))).toBe(
      'APPLIED',
    );
  });

  it('rejects non-object snapshot input before mutating state', () => {
    const projector = projectorFor();
    expect(() =>
      projector.ingestSnapshot(42 as unknown as AppInstanceBillingSnapshot),
    ).toThrow(TypeError);
    expect(projector.project().reconciledAtLeastOnce).toBe(false);
  });

  it('returns fresh projection objects: callers cannot corrupt internal state', () => {
    const projector = projectorFor();
    projector.ingestEvent(purchased('prod-test-tier-2-3'));

    const projection = projector.project();
    projection.resolution.warnings.push({ code: 'BILLING_API_FAILURE', message: 'tampered' });
    projection.resolution.tier = 'FREE';

    const again = projector.project();
    expect(again.resolution.tier).toBe('TIER_2_3');
    expect(again.resolution.warnings).toEqual([]);
  });
});

describe('pure fold helpers (fold.ts)', () => {
  it('folds a set of envelopes onto a seeded view without mutating inputs', () => {
    const seed = seedPlanViewFromSnapshot({ isFree: false, vendorProductId: 'prod-test-tier-1' }, true);
    const seedCopy = { ...seed };
    const envelopes = [
      renewalCancelled({ id: 'a', seq: 2 }),
      purchased('prod-test-tier-2-3', { id: 'b', seq: 3 }),
    ];

    const view = foldEventLayer(seed, envelopes);

    // The NEW purchase (seq 3) supersedes the carried-in cancellation:
    // identifiers update and renewal is re-enabled (documented transition).
    expect(view).toEqual({
      isFree: false,
      vendorProductId: 'prod-test-tier-2-3',
      packageName: null,
      autoRenewCancelled: false,
    });
    expect(seed).toEqual(seedCopy); // inputs untouched
  });

  it('emptyPlanView starts from nothing reported', () => {
    expect(emptyPlanView()).toEqual({
      isFree: null,
      vendorProductId: null,
      packageName: null,
      autoRenewCancelled: false,
    });
  });

  it('resolveFromPlanView reuses the accepted decision table unforked (unknown id ⇒ TIER_1 + warning)', () => {
    const resolution = resolveFromPlanView({
      isFree: false,
      vendorProductId: 'prod-test-unmapped',
      packageName: null,
      autoRenewCancelled: false,
    });
    expect(resolution.tier).toBe('TIER_1');
    expect(resolution.restrictionReliable).toBe(false);
    expect(resolution.warnings[0]?.code).toBe('UNKNOWN_PLAN_IDENTIFIER');
  });
});
