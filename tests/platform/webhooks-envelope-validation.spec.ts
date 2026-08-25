/**
 * N3 REGRESSION (audit CYCLE_32787032785_INTEGRATION observation 3, repaired
 * by INT-C3-1 item g): pre-parsed webhook envelopes must pass FULL
 * `parseWebhookEnvelope` structural validation — the former duck-typing
 * bypass (`isWebhookEnvelope`) let a caller-supplied object with a negative or
 * non-integer `entityEventSequence` skip validation entirely.
 *
 * Pins:
 *  - malformed PRE-PARSED envelopes reject INVALID_QUERY via pipeline.ingest;
 *  - valid pre-parsed envelopes behave exactly as before (dispatch parity);
 *  - parseWebhookEnvelope is idempotent for already-validated envelopes.
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

const SCOPE = 'booking.created:booking-1';

function delivery(): UnverifiedWebhookDelivery {
  return { rawBody: 'raw-jwt-passthrough', headers: {} };
}

class AcceptAllSignatures implements WebhookSignatureVerifier {
  async verify(): Promise<boolean> {
    return true;
  }
}

class RecordingHandler implements WebhookHandler {
  readonly handlerId = 'recorder';
  readonly log: string[] = [];

  handles(e: { eventType?: string }): boolean {
    return e.eventType === 'booking.created';
  }

  async handle(ctx: WebhookHandlerContext): Promise<void> {
    this.log.push(`${ctx.envelope.id}#${ctx.envelope.entityEventSequence}`);
  }
}

function makePipeline(handler: RecordingHandler): WebhookIngestionPipeline {
  return new WebhookIngestionPipeline({
    store: new FakeWebhookIngestionStore(),
    signatureVerifier: new AcceptAllSignatures(),
    handlers: [handler],
  });
}

describe('N3 regression: pre-parsed envelopes pass full structural validation', () => {
  it.each([
    ['negative sequence', -1],
    ['non-integer sequence', 1.5],
    ['string sequence', '3' as unknown as number],
  ])('rejects a pre-parsed envelope with %s (INVALID_QUERY, zero dispatch)', async (_label, badSequence) => {
    const handler = new RecordingHandler();
    const pipeline = makePipeline(handler);

    await expect(
      pipeline.ingest(delivery(), {
        id: 'e-bad',
        eventType: 'booking.created',
        entityId: 'booking-1',
        entityEventSequence: badSequence,
        data: {},
      }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });

    expect(handler.log).toEqual([]);
  });

  it('rejects a pre-parsed envelope with an empty id', async () => {
    const handler = new RecordingHandler();
    const pipeline = makePipeline(handler);
    await expect(
      pipeline.ingest(delivery(), { id: '', data: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(handler.log).toEqual([]);
  });

  it('valid pre-parsed envelopes keep their exact prior behavior (dispatch parity)', async () => {
    const handler = new RecordingHandler();
    const pipeline = makePipeline(handler);
    await pipeline.bootstrapOrderingHead(SCOPE, 0);

    // Pre-parsed object (as an adapter that already parsed the body would pass).
    const outcome = await pipeline.ingest(delivery(), {
      id: 'e-ok',
      eventType: 'booking.created',
      entityId: 'booking-1',
      entityEventSequence: 1,
      data: { bookingId: 'booking-1' },
    });

    expect(outcome.outcome).toBe('DISPATCHED');
    expect(outcome.envelopeId).toBe('e-ok');
    expect(handler.log).toEqual(['e-ok#1']);
  });

  it('parseWebhookEnvelope is idempotent for already-validated envelopes', () => {
    const once = parseWebhookEnvelope({
      id: 'e-idem',
      eventType: 'booking.created',
      entityId: 'b-1',
      entityEventSequence: 4,
      data: { k: 'v' },
    });
    expect(parseWebhookEnvelope(once)).toEqual(once);
  });
});
