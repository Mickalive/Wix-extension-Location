/**
 * Deterministic webhook ingestion chaos suite (INT-C2-1 item c; Blueprint §4
 * flow 4; Technical Contract §6). No randomness, no timers: "chaos" is fully
 * scripted. Proves the mandated convergence behaviors:
 *
 *  1. same envelope id delivered twice ⇒ handler runs ONCE;
 *  2. out-of-order entityEventSequence ⇒ ordered convergence;
 *  3. replay after a simulated mid-dispatch crash ⇒ exactly-once EFFECTIVE
 *     processing (state identical to a clean single-pass run);
 *  4. crash AFTER the effect applied but BEFORE completion ⇒ replay cannot
 *     double-apply (idempotency window coverage);
 *  5. signature rejection fails closed with ZERO store mutation / dispatches;
 *  6. stale sequences behind the head are superseded without re-processing;
 *  7. lost predecessors: explicit drain flushes ascending deterministically;
 *  8. mixed chaos (duplicates + reorder + crash interleaved) converges to the
 *     golden sequential result.
 */
import { describe, expect, it } from 'vitest';
import {
  WebhookIngestionPipeline,
  parseWebhookEnvelope,
} from '../../src/platform/webhooks';
import type {
  UnverifiedWebhookDelivery,
  WebhookHandler,
  WebhookHandlerContext,
  WebhookSignatureVerifier,
} from '../../src/platform/webhooks';
import { FakeWebhookIngestionStore } from '../../src/platform/adapters/fakes/webhookIngestionStore';
import { SimulatedProcessCrash } from '../../src/platform/adapters/fakes/simulatedProcessCrash';
import type { WebhookEnvelope } from '../../src/platform/webhooks';

const SCOPE = 'booking.created:booking-1';

function delivery(): UnverifiedWebhookDelivery {
  return { rawBody: 'raw-jwt-passthrough', headers: {} };
}

function envelope(id: string, sequence?: number): WebhookEnvelope {
  return parseWebhookEnvelope({
    id,
    eventType: 'booking.created',
    entityId: 'booking-1',
    ...(sequence !== undefined ? { entityEventSequence: sequence } : {}),
    data: { bookingId: 'booking-1' },
  });
}

/** Signature verifier double: accepts everything unless flipped. */
class FakeSignatureVerifier implements WebhookSignatureVerifier {
  calls = 0;
  acceptNext = true;

  async verify(_delivery: UnverifiedWebhookDelivery): Promise<boolean> {
    this.calls += 1;
    const ok = this.acceptNext;
    this.acceptNext = true;
    return ok;
  }
}

/**
 * Idempotent counter-maintainer (the Contract §6 "handlers idempotent" rule):
 * applies each deliveryKey's effect exactly once regardless of invocation
 * count. State is a sorted log of applied sequences — comparable across runs.
 */
class CounterMaintainerHandler implements WebhookHandler {
  readonly handlerId = 'counter-maintainer';
  readonly appliedKeys = new Set<string>();
  readonly appliedLog: number[] = [];
  invocations = 0;

  handles(envelope: WebhookEnvelope): boolean {
    return envelope.eventType === 'booking.created';
  }

  async handle(context: WebhookHandlerContext): Promise<void> {
    this.invocations += 1;
    if (this.appliedKeys.has(context.deliveryKey)) return; // idempotent replay
    this.appliedKeys.add(context.deliveryKey);
    const seq = context.envelope.entityEventSequence ?? -1;
    this.appliedLog.push(seq);
  }

  state(): string {
    return [...this.appliedKeys].sort().join('|');
  }

  /** Effect-level view: WHICH envelopes had their effect applied (order-independent). */
  appliedEnvelopeIds(): string[] {
    return [...this.appliedKeys].map((k) => k.split('::')[0] ?? k).sort();
  }
}

/**
 * Wrapper injecting a simulated process crash. The fault is TRANSIENT (fires
 * once, later attempts let through) and TARGETED via a predicate over
 * (context, attempt-number-for-that-deliveryKey).
 */
class CrashingHandler<I extends WebhookHandler> implements WebhookHandler {
  readonly invocations = new Map<string, number>();
  private hasCrashed = false;

  constructor(
    readonly handlerId: string,
    readonly inner: I,
    private readonly crashWhen: (context: WebhookHandlerContext, attemptForKey: number) => boolean,
  ) {}

  handles(envelope: WebhookEnvelope): boolean {
    return this.inner.handles(envelope);
  }

  async handle(context: WebhookHandlerContext): Promise<void> {
    const attemptForKey = (this.invocations.get(context.deliveryKey) ?? 0) + 1;
    this.invocations.set(context.deliveryKey, attemptForKey);
    if (!this.hasCrashed && this.crashWhen(context, attemptForKey)) {
      this.hasCrashed = true;
      throw new SimulatedProcessCrash('webhook-ingest', attemptForKey - 1, context.deliveryKey);
    }
    await this.inner.handle(context);
  }
}

interface Rig {
  store: FakeWebhookIngestionStore;
  signatures: FakeSignatureVerifier;
  pipeline: WebhookIngestionPipeline;
  handlers: WebhookHandler[];
}

function makeRig(...handlers: WebhookHandler[]): Rig {
  const store = new FakeWebhookIngestionStore();
  const signatures = new FakeSignatureVerifier();
  const pipeline = new WebhookIngestionPipeline({
    store,
    signatureVerifier: signatures,
    handlers,
  });
  return { store, signatures, pipeline, handlers };
}

describe('duplicate deliveries (Contract §6: duplicates expected)', () => {
  it('same envelope id delivered twice ⇒ handler runs once, second ingest fast-acks', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    const first = await rig.pipeline.ingest(delivery(), envelope('env-1', 1));
    expect(first.outcome).toBe('DISPATCHED');
    const second = await rig.pipeline.ingest(delivery(), envelope('env-1', 1));

    expect(second.outcome).toBe('DUPLICATE_ACKNOWLEDGED');
    expect(second.dispatchedHandlerIds).toEqual([]);
    expect(handler.invocations).toBe(1); // THE core duplicate guarantee
    expect(handler.appliedLog).toEqual([1]); // effect applied exactly once
    expect(rig.store.completedIds.has('env-1')).toBe(true);
  });
});

describe('out-of-order entityEventSequence (Contract §6 ordering)', () => {
  it('sequences 3,1,2 converge in strict order [1,2,3]', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    const r3 = await rig.pipeline.ingest(delivery(), envelope('env-3', 3));
    expect(r3.outcome).toBe('BUFFERED'); // gap held durably, acked fast

    const r1 = await rig.pipeline.ingest(delivery(), envelope('env-1', 1));
    expect(r1.outcome).toBe('DISPATCHED');

    const r2 = await rig.pipeline.ingest(delivery(), envelope('env-2', 2));
    expect(r2.outcome).toBe('DISPATCHED'); // auto-drains buffered seq 3 too

    // ORDERED CONVERGENCE: handler observed 1, then 2, then 3.
    expect(handler.appliedLog).toEqual([1, 2, 3]);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(3);
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
    for (const id of ['env-1', 'env-2', 'env-3']) {
      expect(rig.store.completedIds.has(id)).toBe(true);
    }
  });

  it('without a baseline the pipeline holds arrivals rather than guessing', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);

    const r7 = await rig.pipeline.ingest(delivery(), envelope('env-7', 7));
    expect(r7.outcome).toBe('BUFFERED');
    expect(handler.invocations).toBe(0); // never guessed that 7 was first

    // Explicit bootstrap establishes the checkpoint and releases contiguous work.
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 6);
    expect(handler.appliedLog).toEqual([7]);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(7);
  });

  it('bootstrap never regresses an existing head', async () => {
    const rig = makeRig(new CounterMaintainerHandler());
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 5);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 2); // ignored (monotonic)
    expect(await rig.store.getLastSequence(SCOPE)).toBe(5);
  });

  it('stale replays behind the head are superseded without re-processing', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 5);

    const stale = await rig.pipeline.ingest(delivery(), envelope('env-old', 3));
    expect(stale.outcome).toBe('SUPERSEDED_SKIPPED');
    expect(handler.invocations).toBe(0);
    expect(rig.store.completedIds.has('env-old')).toBe(true); // future dups fast-path
  });

  it('lost predecessors: drainBuffered flushes ascending deterministically', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    // seq 1 permanently lost (retries exhausted); 2 and 3 arrive.
    await rig.pipeline.ingest(delivery(), envelope('env-2b', 2));
    await rig.pipeline.ingest(delivery(), envelope('env-3b', 3));
    expect(handler.invocations).toBe(0);

    const drained = await rig.pipeline.drainBuffered(SCOPE);
    expect(drained.map((r) => r.outcome)).toEqual(['DISPATCHED', 'DISPATCHED']);
    expect(handler.appliedLog).toEqual([2, 3]); // ascending, deterministic
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
  });
});

describe('crash mid-dispatch + redelivery (gate T-BK chaos; at-least-once ⇒ exactly-once effective)', () => {
  it('replay after simulated crash converges to the clean single-pass state', async () => {
    // Golden run uses the SAME envelope ids as the chaotic twin so delivery
    // keys (and therefore handler states) are directly comparable.
    const golden = new CounterMaintainerHandler();
    const goldenRig = makeRig(golden);
    await goldenRig.pipeline.bootstrapOrderingHead(SCOPE, 0);
    await goldenRig.pipeline.ingest(delivery(), envelope('env-1', 1));
    const goldenState = golden.state();

    // Chaotic twin: crashes during the FIRST dispatch of env-1.
    const maintainer = new CounterMaintainerHandler();
    const crashing = new CrashingHandler(
      'crasher',
      new CounterMaintainerHandler(),
      (_ctx, attemptForKey) => attemptForKey === 1,
    );
    const innerOfCrasher = crashing.inner;
    const rig = makeRig(maintainer, crashing);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    // First ingest: maintainer applied its effect, then the crash killed dispatch.
    await expect(
      rig.pipeline.ingest(delivery(), envelope('env-1', 1)),
    ).rejects.toBeInstanceOf(SimulatedProcessCrash);
    expect(maintainer.invocations).toBe(1); // ran before the crash...
    expect(rig.store.completedIds.has('env-1')).toBe(false); // ...but NOT completed
    expect(rig.store.inFlight.has('env-1')).toBe(true); // claimed, in-flight

    // Wix redelivers (≤12 retries): resume path re-drives both handlers.
    const resumed = await rig.pipeline.ingest(delivery(), envelope('env-1', 1));
    expect(resumed.outcome).toBe('DISPATCHED');
    expect(resumed.resumed).toBe(true);
    expect(maintainer.invocations).toBe(2); // at-least-once INVOCATION...

    // ...but exactly-once EFFECT: chaotic state equals the golden run.
    expect(maintainer.state()).toBe(goldenState);
    // The crasher's inner handler records keys under the OUTER handler id, so
    // compare at the effect level (which envelopes got applied, exactly once):
    expect(innerOfCrasher.appliedEnvelopeIds()).toEqual(golden.appliedEnvelopeIds());
    expect(innerOfCrasher.invocations).toBe(1); // one key, applied once
    expect(rig.store.completedIds.has('env-1')).toBe(true);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(1);

    // Post-recovery duplicates stay inert.
    const dup = await rig.pipeline.ingest(delivery(), envelope('env-1', 1));
    expect(dup.outcome).toBe('DUPLICATE_ACKNOWLEDGED');
    expect(maintainer.invocations).toBe(2);
  });

  it('crash AFTER head advance but BEFORE completion cannot double-apply', async () => {
    const maintainer = new CounterMaintainerHandler();
    const rig = makeRig(maintainer);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    // Store-level fault injection: die AFTER setLastSequence durably advanced
    // the head but BEFORE markEnvelopeCompleted — the post-advance crash window.
    const realSetLast = rig.store.setLastSequence.bind(rig.store);
    let crashedOnce = false;
    rig.store.setLastSequence = async (scope, seq) => {
      await realSetLast(scope, seq);
      if (!crashedOnce) {
        crashedOnce = true;
        throw new SimulatedProcessCrash('webhook-ingest', 0, 'post-advance');
      }
    };

    await expect(
      rig.pipeline.ingest(delivery(), envelope('env-x', 1)),
    ).rejects.toBeInstanceOf(SimulatedProcessCrash);
    expect(maintainer.invocations).toBe(1); // effect already applied pre-crash
    expect(await rig.store.getLastSequence(SCOPE)).toBe(1); // head advanced

    const resumed = await rig.pipeline.ingest(delivery(), envelope('env-x', 1));
    expect(resumed.resumed).toBe(true);
    expect(maintainer.invocations).toBe(2); // re-invoked (at-least-once)
    expect(maintainer.appliedLog).toEqual([1]); // but applied EXACTLY ONCE
    expect(rig.store.completedIds.has('env-x')).toBe(true);
  });

  it('resume after crash releases successors buffered meanwhile', async () => {
    const maintainer = new CounterMaintainerHandler();
    const crashing = new CrashingHandler(
      'crasher-b',
      new CounterMaintainerHandler(),
      (_ctx, attemptForKey) => attemptForKey === 1, // first attempt of env-a
    );
    const rig = makeRig(maintainer, crashing);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    await expect(
      rig.pipeline.ingest(delivery(), envelope('env-a', 1)),
    ).rejects.toBeInstanceOf(SimulatedProcessCrash);

    // Successor arrives while env-a is still in-flight → buffered (gap vs head 0+1).
    const b = await rig.pipeline.ingest(delivery(), envelope('env-b', 2));
    expect(b.outcome).toBe('BUFFERED');

    const resumed = await rig.pipeline.ingest(delivery(), envelope('env-a', 1));
    expect(resumed.resumed).toBe(true);
    // Resume advanced the head to 1 AND auto-drained env-b:
    expect(maintainer.appliedLog.filter((s) => s === 2)).toHaveLength(1);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(2);
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
  });
});

describe('signature verification is fail-closed and injected (no fabricated crypto)', () => {
  it('rejected signature ⇒ SIGNATURE_REJECTED with zero store mutation and zero dispatch', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    rig.signatures.acceptNext = false;

    const result = await rig.pipeline.ingest(delivery(), envelope('env-sig', 1));

    expect(result.outcome).toBe('SIGNATURE_REJECTED');
    expect(handler.invocations).toBe(0);
    expect(rig.store.inFlight.size).toBe(0);
    expect(rig.store.completedIds.size).toBe(0);
    expect(await rig.store.getLastSequence(SCOPE)).toBeNull();
  });

  it('malformed envelopes reject INVALID_QUERY before any store interaction', async () => {
    const rig = makeRig(new CounterMaintainerHandler());
    for (const bad of [undefined, {}, { id: '' }, { id: 'x', entityEventSequence: 1.5 }, 'text']) {
      await expect(rig.pipeline.ingest(delivery(), bad)).rejects.toMatchObject({
        code: 'INVALID_QUERY',
      });
    }
    expect(rig.store.completedIds.size).toBe(0);
    expect(rig.store.inFlight.size).toBe(0);
  });
});

describe('mixed deterministic chaos converges to the golden sequential result', () => {
  it('duplicates + reorder + crash interleaved end equal to the clean run', async () => {
    // --- golden sequential run (identical envelope ids to the chaos twin) ---
    const golden = new CounterMaintainerHandler();
    const goldenRig = makeRig(golden);
    await goldenRig.pipeline.bootstrapOrderingHead(SCOPE, 0);
    for (const seq of [1, 2, 3, 4]) {
      await goldenRig.pipeline.ingest(delivery(), envelope(`c-${seq}`, seq));
    }
    const goldenState = golden.state();
    expect(golden.appliedLog).toEqual([1, 2, 3, 4]);

    // --- chaotic twin: crash on c-2's first dispatch, duplicates of c-3,
    //     c-4 arriving before c-2's successful redelivery ---
    const chaotic = new CounterMaintainerHandler();
    const crashing = new CrashingHandler(
      'chaos-crash',
      new CounterMaintainerHandler(),
      (ctx, attemptForKey) => attemptForKey === 1 && ctx.envelope.id === 'c-2',
    );
    const chaosInner = crashing.inner;
    const rig = makeRig(chaotic, crashing);
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    await rig.pipeline.ingest(delivery(), envelope('c-1', 1)); // ok
    await expect(
      rig.pipeline.ingest(delivery(), envelope('c-2', 2)),
    ).rejects.toBeInstanceOf(SimulatedProcessCrash); // crash mid-dispatch
    await rig.pipeline.ingest(delivery(), envelope('c-4', 4)); // buffered (gap)
    await rig.pipeline.ingest(delivery(), envelope('c-3', 3)); // buffered (gap)
    await rig.pipeline.ingest(delivery(), envelope('c-3', 3)); // buffered redelivery: re-gated, NOT dispatched
    await rig.pipeline.ingest(delivery(), envelope('c-3', 3)); // and again
    await rig.pipeline.ingest(delivery(), envelope('c-2', 2)); // redelivery resumes, drains 3 then 4

    expect(chaotic.state()).toBe(goldenState);
    expect(chaosInner.appliedEnvelopeIds()).toEqual(golden.appliedEnvelopeIds());
    expect(chaotic.appliedLog).toEqual([1, 2, 3, 4]); // ordered convergence held
    expect(await rig.store.getLastSequence(SCOPE)).toBe(4);
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
  });
});
describe('envelopes without entityEventSequence bypass ordering (documented fallback)', () => {
  it('process in arrival order and dedup by envelope id', async () => {
    const handler = new CounterMaintainerHandler();
    const rig = makeRig(handler);
    const plain = parseWebhookEnvelope({ id: 'plain-1', eventType: 'booking.created', data: {} });

    const first = await rig.pipeline.ingest(delivery(), plain);
    expect(first.outcome).toBe('DISPATCHED');
    const dup = await rig.pipeline.ingest(delivery(), plain);
    expect(dup.outcome).toBe('DUPLICATE_ACKNOWLEDGED');
    expect(handler.invocations).toBe(1);
  });
});
