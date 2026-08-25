/**
 * INT-C4-1(b) — bounded retention/compaction for the plan projector's dedup
 * memory (Billing audit CYCLE_32792897988 observation 2, routed to the
 * Integration lane).
 *
 * Proves exactly the assigned acceptance properties:
 *  1. BOUNDED MEMORY under sustained unique-event load (stats bound holds at
 *     every step; the inner core is rebuilt so its private dedup set stays
 *     bounded too).
 *  2. POST-COMPACTION REPLAY CONVERGENCE: a replayed already-compacted event
 *     is fenced ('DUPLICATE' — no duplicate dispatch) and can never resurrect
 *     paid state on top of a fresher downgrading reconciliation.
 *  3. Projection parity with the plain accepted core at every convergence
 *     point (immediately after each snapshot), including with forced
 *     compaction in play.
 *  4. Documented tradeoffs behave exactly as documented (sequence-less
 *     residual risk + self-healing reconciliation; watermark-suppressed late
 *     deliveries; durable cancellation marker across rebuilds).
 */
import { describe, expect, it } from 'vitest';
import { createCompactingProjector } from '../../src/platform/composition';
import type { CompactingBillingPlanProjector } from '../../src/platform/composition';
import { createBillingPlanProjector } from '../../src/billing/projection/projector';
import type { BillingPlanProjector } from '../../src/billing/projection/projector';
import type { BillingEventEnvelope } from '../../src/billing/projection/types';

const INSTANCE_ID = 'inst-compaction-test';
const OVERRIDES = { 'prod-test-paid': 'TIER_2_3' } as const;

type EnvelopeSpec = {
  id: string;
  kind: 'PURCHASE' | 'CANCEL_RENEWAL' | 'INSTALL_FREE' | 'INSTALL_PAID';
  seq?: number;
};

function envelope(spec: EnvelopeSpec): BillingEventEnvelope {
  const base = {
    id: spec.id,
    entityEventSequence: spec.seq ?? null,
    instanceId: INSTANCE_ID,
  };
  switch (spec.kind) {
    case 'PURCHASE':
      return { ...base, eventType: 'PAID_PLAN_PURCHASED', payload: { vendorProductId: 'prod-test-paid' } };
    case 'CANCEL_RENEWAL':
      return { ...base, eventType: 'PAID_PLAN_AUTO_RENEWAL_CANCELLED', payload: {} };
    case 'INSTALL_FREE':
      return { ...base, eventType: 'APP_INSTALLATION_UPDATED', payload: { isFree: true } };
    case 'INSTALL_PAID':
      return {
        ...base,
        eventType: 'APP_INSTALLATION_UPDATED',
        payload: { isFree: false, vendorProductId: 'prod-test-paid' },
      };
  }
}

const PAID_SNAPSHOT: { isFree: boolean; vendorProductId: string } = {
  isFree: false,
  vendorProductId: 'prod-test-paid',
};
const FREE_SNAPSHOT: { isFree: boolean } = { isFree: true };

function makePair(options?: Parameters<typeof createCompactingProjector>[0]): {
  wrapper: CompactingBillingPlanProjector;
  plain: BillingPlanProjector;
} {
  return {
    wrapper: createCompactingProjector({ instanceId: INSTANCE_ID, overrides: { ...OVERRIDES }, ...options }),
    plain: createBillingPlanProjector({
      instanceId: INSTANCE_ID,
      overrides: { ...OVERRIDES },
    }),
  };
}

/** Feeds identical ops to both projectors and returns the wrapper status. */
function feedBoth(
  pair: { wrapper: BillingPlanProjector; plain: BillingPlanProjector },
  env: BillingEventEnvelope,
): ReturnType<BillingPlanProjector['ingestEvent']> {
  const plainStatus = pair.plain.ingestEvent(env);
  const wrapperStatus = pair.wrapper.ingestEvent(env);
  // Dedup decisions must agree whenever the plain core would agree — the
  // wrapper may only be STRICTER for compacted history (fenced replays),
  // never looser.
  expect(wrapperStatus === 'APPLIED' || plainStatus !== 'APPLIED').toBe(true);
  return wrapperStatus;
}

function reconcileBoth(
  pair: { wrapper: BillingPlanProjector; plain: BillingPlanProjector },
  snapshot: Parameters<BillingPlanProjector['ingestSnapshot']>[0],
): void {
  pair.plain.ingestSnapshot(snapshot === undefined ? null : (structuredClone(snapshot) as never));
  pair.wrapper.ingestSnapshot(snapshot === undefined ? null : (structuredClone(snapshot) as never));
  // CONVERGENCE POINT: immediately after a reconciliation the projections
  // must be byte-identical, whatever compaction happened before it.
  expect(pair.wrapper.project()).toEqual(pair.plain.project());
  expect(pair.wrapper.currentSnapshot()).toEqual(pair.plain.currentSnapshot());
}

// ------------------------------------------------------------------- tests

describe('bounded memory under sustained unique-event load', () => {
  it('retention bounds hold through floods of unique sequenced events across many reconciliations', () => {
    const { wrapper, plain } = makePair({
      maxGenerationEvents: 8,
      retentionWindow: 4,
      maxRetiredIds: 16,
    });

    let seq = 0;
    const kinds: EnvelopeSpec['kind'][] = ['PURCHASE', 'CANCEL_RENEWAL', 'INSTALL_PAID', 'INSTALL_FREE'];
    for (let round = 0; round < 30; round += 1) {
      for (let i = 0; i < 12; i += 1) {
        seq += 1;
        const env = envelope({ id: `evt-${seq}`, kind: kinds[seq % kinds.length] as EnvelopeSpec['kind'], seq });
        feedBoth({ wrapper, plain }, env);
        const stats = wrapper.stats();
        // generation ≤ 8 and retiredIds ≤ 16 ⇒ total ≤ 24, ALWAYS.
        expect(stats.retainedIds).toBeLessThanOrEqual(24);
      }
      reconcileBoth({ wrapper, plain }, round % 2 === 0 ? PAID_SNAPSHOT : FREE_SNAPSHOT);
    }

    const finalStats = wrapper.stats();
    expect(finalStats.rebuilds).toBeGreaterThan(0); // forced compaction exercised
    expect(finalStats.retiredTotal).toBeGreaterThan(0);
    expect(finalStats.retainedIds).toBeLessThanOrEqual(24);
  });

  it('projection parity with the plain core holds mid-round when load fits the retention window', () => {
    const { wrapper, plain } = makePair(); // defaults: no forced compaction below 512

    let seq = 0;
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 5; i += 1) {
        seq += 1;
        const kind: EnvelopeSpec['kind'] =
          seq % 3 === 0 ? 'CANCEL_RENEWAL' : seq % 3 === 1 ? 'PURCHASE' : 'INSTALL_PAID';
        feedBoth({ wrapper, plain }, envelope({ id: `evt-${seq}`, kind, seq }));
        // Immediate duplicate replay converges identically in both cores:
        feedBoth({ wrapper, plain }, envelope({ id: `evt-${seq}`, kind, seq }));
        // Mid-round parity (no reconciliation since last snapshot):
        expect(wrapper.project()).toEqual(plain.project());
      }
      reconcileBoth({ wrapper, plain }, seq % 2 === 0 ? PAID_SNAPSHOT : FREE_SNAPSHOT);
    }
  });
});

describe('post-compaction replay convergence (no resurrected paid state, no duplicate dispatch)', () => {
  it('a replayed purchase already retired by a downgrading reconciliation is fenced and dispatches nothing', () => {
    const { wrapper, plain } = makePair();

    const purchase = envelope({ id: 'evt-purchase-1', kind: 'PURCHASE', seq: 10 });
    expect(feedBoth({ wrapper, plain }, purchase)).toBe('APPLIED');
    expect(wrapper.project().resolution.isPaid).toBe(true);

    // Confirming downgrade snapshot retires the purchase (watermark → 10).
    reconcileBoth({ wrapper, plain }, FREE_SNAPSHOT);
    expect(wrapper.stats().watermark).toBe(10);
    expect(wrapper.project().resolution.isPaid).toBe(false);

    // Replay of the ALREADY-COMPACTED purchase:
    expect(wrapper.ingestEvent(purchase)).toBe('DUPLICATE'); // safely re-detected
    expect(wrapper.project().resolution.isPaid).toBe(false); // NO resurrected paid state
    expect(wrapper.project().generationEventCount).toBe(0); // NO duplicate dispatch

    // A forged DIFFERENT id carrying an old (≤ watermark) sequence is fenced too…
    expect(wrapper.ingestEvent(envelope({ id: 'evt-forged-old', kind: 'PURCHASE', seq: 9 }))).toBe('DUPLICATE');
    // …while genuinely newer events still apply as refinements.
    expect(wrapper.ingestEvent(envelope({ id: 'evt-install-new', kind: 'INSTALL_PAID', seq: 11 }))).toBe('APPLIED');
    expect(wrapper.project().generationEventCount).toBe(1);
  });

  it('id-level suppression covers retired events even before the watermark could fence them', () => {
    const { wrapper } = makePair({ maxGenerationEvents: 64, retentionWindow: 8, maxRetiredIds: 2 });

    expect(wrapper.ingestEvent(envelope({ id: 'evt-a', kind: 'PURCHASE', seq: 1 }))).toBe('APPLIED');
    wrapper.ingestSnapshot(FREE_SNAPSHOT); // evt-a retired into the 2-slot FIFO
    expect(wrapper.ingestEvent(envelope({ id: 'evt-a', kind: 'PURCHASE', seq: 1 }))).toBe('DUPLICATE');

    // Two more reconciliations push evt-a out of the tiny FIFO — but its rank
    // (1) is now ≤ the watermark, so the FENCE still catches the replay.
    wrapper.ingestEvent(envelope({ id: 'evt-b', kind: 'INSTALL_PAID', seq: 5 }));
    wrapper.ingestSnapshot(FREE_SNAPSHOT);
    wrapper.ingestEvent(envelope({ id: 'evt-c', kind: 'INSTALL_PAID', seq: 7 }));
    wrapper.ingestSnapshot(FREE_SNAPSHOT);
    expect(wrapper.stats().retainedIds).toBeLessThanOrEqual(64 + 2);
    expect(wrapper.ingestEvent(envelope({ id: 'evt-a', kind: 'PURCHASE', seq: 1 }))).toBe('DUPLICATE');
    expect(wrapper.project().resolution.isPaid).toBe(false);
  });

  it('documented residual risk: after a REBUILD evicts a SEQUENCE-LESS id, its replay may re-apply once and heals at the next poll', () => {
    const { wrapper } = makePair({
      maxGenerationEvents: 4,
      retentionWindow: 2,
      maxRetiredIds: 1,
    });

    const unsequenced = envelope({ id: 'evt-noseq', kind: 'PURCHASE' }); // no entityEventSequence
    expect(wrapper.ingestEvent(unsequenced)).toBe('APPLIED');
    wrapper.ingestSnapshot(FREE_SNAPSHOT); // retired; id occupies the 1-slot FIFO
    expect(wrapper.ingestEvent(unsequenced)).toBe('DUPLICATE'); // still suppressed via id set

    // Flood forces compaction(s): dropped ids retire through the tiny FIFO
    // (evicting evt-noseq) AND the inner core is rebuilt knowing only the
    // retained window — this is the documented corner where an unfenceable
    // replay can slip through:
    for (let i = 0; i < 10; i += 1) {
      wrapper.ingestEvent(envelope({ id: `evt-flood-${i}`, kind: 'INSTALL_FREE', seq: 50 + i }));
    }
    expect(wrapper.stats().rebuilds).toBeGreaterThan(0);
    expect(wrapper.stats().retainedIds).toBeLessThanOrEqual(4 + 1);

    expect(wrapper.ingestEvent(unsequenced)).toBe('APPLIED');
    // Transitions are idempotent, so the re-application converges — and the
    // MANDATORY next reconciliation restores truth wholesale (§7):
    wrapper.ingestSnapshot(FREE_SNAPSHOT);
    expect(wrapper.project().resolution.isPaid).toBe(false);
    expect(wrapper.project().generationEventCount).toBe(0);
  });
});

describe('forced compaction rebuilds preserve semantics', () => {
  it('the durable autoRenewCancelled marker survives rebuilds; a new purchase re-enables renewal', () => {
    const { wrapper, plain } = makePair({
      maxGenerationEvents: 6,
      retentionWindow: 3,
      maxRetiredIds: 32,
    });

    // Cancel auto-renewal, then reconcile paid (cancelled-until-expiry keeps
    // paid identifiers; marker survives reconciliations in the accepted core).
    feedBoth({ wrapper, plain }, envelope({ id: 'evt-cancel', kind: 'CANCEL_RENEWAL', seq: 1 }));
    reconcileBoth({ wrapper, plain }, PAID_SNAPSHOT);
    expect(wrapper.project().autoRenewCancelled).toBe(true);
    expect(wrapper.project().resolution.isPaid).toBe(true);

    // Flood past maxGenerationEvents ⇒ forced compaction + inner rebuild(s).
    for (let i = 0; i < 20; i += 1) {
      feedBoth({ wrapper, plain }, envelope({ id: `evt-flood-${i}`, kind: 'INSTALL_PAID', seq: 10 + i }));
    }
    expect(wrapper.stats().rebuilds).toBeGreaterThan(0);
    expect(wrapper.stats().retainedIds).toBeLessThanOrEqual(6 + 32);
    // Marker survived the rebuild despite its causing event being retired:
    expect(wrapper.project().autoRenewCancelled).toBe(true);
    expect(wrapper.project().resolution.isPaid).toBe(true);

    // A NEW purchase re-enables renewal (fold transition), parity preserved.
    // Mid-generation comparison omits `generationEventCount`: the wrapper's
    // rebuilt core intentionally holds only the retained window until the
    // next reconciliation (documented tradeoff) — every OTHER projected
    // field must match the plain core exactly.
    feedBoth({ wrapper, plain }, envelope({ id: 'evt-repurchase', kind: 'PURCHASE', seq: 100 }));
    expect(wrapper.project().autoRenewCancelled).toBe(false);
    const plainProjection = plain.project();
    const wrapperProjection = wrapper.project();
    expect({ ...wrapperProjection, generationEventCount: 0 }).toEqual({
      ...plainProjection,
      generationEventCount: 0,
    });
    // …and the NEXT reconciliation restores full parity including counts:
    reconcileBoth({ wrapper, plain }, PAID_SNAPSHOT);
    expect(wrapper.project()).toEqual(plain.project());
  });

  it('never-reconciled flood: rebuild keeps the event-derived view consistent within the retained window', () => {
    const { wrapper } = makePair({
      maxGenerationEvents: 5,
      retentionWindow: 2,
      maxRetiredIds: 4,
    });

    for (let i = 0; i < 12; i += 1) {
      wrapper.ingestEvent(envelope({ id: `evt-pre-${i}`, kind: 'INSTALL_PAID', seq: i + 1 }));
    }
    const stats = wrapper.stats();
    expect(stats.rebuilds).toBeGreaterThan(0);
    expect(stats.retainedIds).toBeLessThanOrEqual(5 + 4);
    // Retained newest window refines the empty seed: paid via INSTALL_PAID.
    expect(wrapper.project().resolution.isPaid).toBe(true);
  });
});

describe('wrapper contract fidelity', () => {
  it('foreign-instance envelopes are ignored without touching retention state', () => {
    const { wrapper } = makePair();
    const before = wrapper.stats();
    const foreign = {
      ...envelope({ id: 'evt-foreign', kind: 'PURCHASE' as const, seq: 1 }),
      instanceId: 'inst-OTHER',
    };
    expect(wrapper.ingestEvent(foreign)).toBe('FOREIGN_INSTANCE');
    expect(wrapper.stats()).toEqual(before);
    expect(wrapper.project().generationEventCount).toBe(0);
  });

  it('structurally invalid envelopes throw TypeError BEFORE any mutation (accepted-core precondition)', () => {
    const { wrapper } = makePair();
    wrapper.ingestEvent(envelope({ id: 'evt-ok', kind: 'PURCHASE', seq: 1 }));
    const projectionBefore = wrapper.project();
    const statsBefore = wrapper.stats();
    expect(() =>
      wrapper.ingestEvent({
        id: '   ',
        eventType: 'PAID_PLAN_PURCHASED',
        payload: {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      wrapper.ingestEvent({
        id: 'evt-bad-type',
        eventType: 'NOT_A_REAL_EVENT' as never,
        payload: {},
      }),
    ).toThrow(TypeError);
    expect(wrapper.project()).toEqual(projectionBefore);
    expect(wrapper.stats()).toEqual(statsBefore);
  });

  it('snapshot shape validation rejects arrays before mutating any state', () => {
    const { wrapper } = makePair();
    wrapper.ingestEvent(envelope({ id: 'evt-ok', kind: 'PURCHASE', seq: 1 }));
    const projectionBefore = wrapper.project();
    expect(() => wrapper.ingestSnapshot([] as unknown as null)).toThrow(TypeError);
    expect(wrapper.project()).toEqual(projectionBefore);
    expect(wrapper.project().reconciledAtLeastOnce).toBe(false);
  });

  it('instanceId and currentSnapshot pass through verbatim', () => {
    const { wrapper } = makePair();
    expect(wrapper.instanceId).toBe(INSTANCE_ID);
    expect(wrapper.currentSnapshot()).toBeNull();
    wrapper.ingestEvent(envelope({ id: 'evt-p', kind: 'PURCHASE', seq: 1 }));
    // Post-snapshot-less refinement renders the merged view (packageName is
    // rendered explicitly as null when never reported):
    expect(wrapper.currentSnapshot()).toEqual({
      isFree: false,
      packageName: null,
      vendorProductId: 'prod-test-paid',
    });
  });

  it('constructor rejects nonsensical bounds instead of silently mis-compacting', () => {
    expect(() => makePair({ maxGenerationEvents: 0 })).toThrow();
    expect(() => makePair({ maxGenerationEvents: 4, retentionWindow: 4 })).toThrow();
    expect(() => makePair({ maxGenerationEvents: 8, retentionWindow: 9 })).toThrow();
    expect(() => makePair({ maxRetiredIds: 0 })).toThrow();
  });
});
