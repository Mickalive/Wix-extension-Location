/**
 * Webhook ingestion pipeline — public-surface contract suite (INT-C2-1 item c).
 *
 * NOTE ON FILENAME: this spec was authored from a debug scratch file because
 * the candidate shell permits no file deletion/renaming; the Director renamed
 * it to `webhooks-pipeline-contract.spec.ts` at integration (run 32787032785)
 * per audit CYCLE_32787032785_INTEGRATION observation 2, without content
 * changes. Content is maintained production test surface.
 *
 * Covers cross-cutting pipeline contracts not owned by the chaos suite:
 *  - redelivery of gap-buffered envelopes RE-RUNS the ordering gate (pins the
 *    invariant that the reorder buffer holds only unclaimed envelopes);
 *  - duplicate buffering is an upsert (successor dispatches exactly once);
 *  - parked envelopes superseded by checkpoint advancement are dropped, never
 *    dispatched;
 *  - default ordering-scope derivation table;
 *  - monotonic-head guard of the reference store.
 */
import { describe, expect, it } from 'vitest';
import {
  WebhookIngestionPipeline,
  defaultOrderingScopeFor,
  parseWebhookEnvelope,
} from '../../src/platform/webhooks';
import type {
  UnverifiedWebhookDelivery,
  WebhookHandler,
  WebhookHandlerContext,
  WebhookSignatureVerifier,
} from '../../src/platform/webhooks';
import { FakeWebhookIngestionStore } from '../../src/platform/adapters/fakes/webhookIngestionStore';

const SCOPE = 'booking.created:booking-1';

function delivery(): UnverifiedWebhookDelivery {
  return { rawBody: 'raw-jwt-passthrough', headers: {} };
}

function envelope(id: string, sequence: number) {
  return {
    id,
    eventType: 'booking.created',
    entityId: 'booking-1',
    entityEventSequence: sequence,
    data: { bookingId: 'booking-1' },
  };
}

class RecordingHandler implements WebhookHandler {
  readonly handlerId = 'recorder';
  readonly log: string[] = [];
  readonly appliedKeys = new Set<string>();

  handles(e: { eventType?: string }): boolean {
    return e.eventType === 'booking.created';
  }

  async handle(ctx: WebhookHandlerContext): Promise<void> {
    if (this.appliedKeys.has(ctx.deliveryKey)) return;
    this.appliedKeys.add(ctx.deliveryKey);
    this.log.push(`${ctx.envelope.id}#${ctx.envelope.entityEventSequence}`);
  }
}

class AcceptAllSignatures implements WebhookSignatureVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}

interface Rig {
  store: FakeWebhookIngestionStore;
  handler: RecordingHandler;
  pipeline: WebhookIngestionPipeline;
}

function makeRig(): Rig {
  const store = new FakeWebhookIngestionStore();
  const handler = new RecordingHandler();
  const pipeline = new WebhookIngestionPipeline({
    store,
    signatureVerifier: new AcceptAllSignatures(),
    handlers: [handler],
  });
  return { store, handler, pipeline };
}

describe('redelivery of gap-buffered envelopes re-runs the ordering gate', () => {
  it('stays BUFFERED without dispatching while the predecessor is missing', async () => {
    const rig = makeRig();
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);
    await rig.pipeline.ingest(delivery(), envelope('e-1', 1)); // head -> 1

    const first = await rig.pipeline.ingest(delivery(), envelope('e-3', 3)); // gap -> buffered
    expect(first.outcome).toBe('BUFFERED');

    // Wix redelivers the SAME envelope id while it sits buffered:
    const redelivered = await rig.pipeline.ingest(delivery(), envelope('e-3', 3));
    expect(redelivered.outcome).toBe('BUFFERED'); // re-gated, NOT resumed
    expect(redelivered.resumed).toBe(false);

    // Ordering held: e-3 must NOT have jumped the missing e-2.
    expect(rig.handler.log).toEqual(['e-1#1']);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(1);
  });

  it('duplicate buffering is an upsert: the successor dispatches exactly once once contiguous', async () => {
    const rig = makeRig();
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    await rig.pipeline.ingest(delivery(), envelope('e-4', 4)); // buffered
    await rig.pipeline.ingest(delivery(), envelope('e-4', 4)); // buffered again (upsert)
    await rig.pipeline.ingest(delivery(), envelope('e-4', 4)); // and again

    await rig.pipeline.ingest(delivery(), envelope('e-1', 1)); // head -> 1
    await rig.pipeline.ingest(delivery(), envelope('e-2', 2)); // head -> 2
    const last = await rig.pipeline.ingest(delivery(), envelope('e-3', 3)); // drains 3 AND 4

    expect(last.outcome).toBe('DISPATCHED');
    expect(rig.handler.log).toEqual(['e-1#1', 'e-2#2', 'e-3#3', 'e-4#4']);
    expect(await rig.store.getLastSequence(SCOPE)).toBe(4);
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
    expect(rig.store.completedIds.has('e-4')).toBe(true);
  });

  it('a parked envelope superseded by checkpoint advancement is dropped, never dispatched', async () => {
    const rig = makeRig();
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 0);

    await rig.pipeline.ingest(delivery(), envelope('s-5', 5)); // buffered (gap)
    // Reconciliation/bootstrap advances the checkpoint past 5 while it sits parked.
    await rig.pipeline.bootstrapOrderingHead(SCOPE, 7);

    const drained = await rig.pipeline.drainBuffered(SCOPE);
    expect(drained.map((r) => r.outcome)).toEqual(['SUPERSEDED_SKIPPED']);
    expect(rig.handler.log).toEqual([]); // never dispatched
    expect(await rig.store.listBuffered(SCOPE)).toEqual([]);
  });
});

describe('default ordering-scope derivation', () => {
  it('scopes per entity within an event type, with documented fallbacks', () => {
    expect(
      defaultOrderingScopeFor(
        parseWebhookEnvelope({ id: 'a', eventType: 'booking.created', entityId: 'b-1', data: {} }),
      ),
    ).toBe('booking.created:b-1');
    expect(
      defaultOrderingScopeFor(parseWebhookEnvelope({ id: 'b', eventType: 'booking.created', data: {} })),
    ).toBe('booking.created:_');
    expect(
      defaultOrderingScopeFor(parseWebhookEnvelope({ id: 'c', entityId: 'b-1', data: {} })),
    ).toBe('_unknown:b-1');
    expect(defaultOrderingScopeFor(parseWebhookEnvelope({ id: 'd', data: {} }))).toBe('_unknown:_');
  });
});

describe('reference store monotonic-head guard', () => {
  it('refuses to regress a scope head (durable-store semantics)', async () => {
    const store = new FakeWebhookIngestionStore();
    await store.setLastSequence(SCOPE, 5);
    await expect(store.setLastSequence(SCOPE, 2)).rejects.toThrow(/regress/);
    expect(await store.getLastSequence(SCOPE)).toBe(5);
  });
});
