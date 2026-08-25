/**
 * In-memory fake {@link WebhookIngestionStore} (Blueprint §3; Contract §8.2).
 * Reference implementation and shared test harness for the webhook ingestion
 * pipeline until a real data-collection-backed adapter exists (requires
 * human-owned credentials — Contract §16). Lease-less claim semantics mirror
 * the pipeline contract: completion is the only terminal state.
 */
import type {
  BufferedEnvelope,
  EnvelopeClaim,
  WebhookEnvelope,
  WebhookIngestionStore,
} from '../../webhooks';

export class FakeWebhookIngestionStore implements WebhookIngestionStore {
  /** Envelope ids currently claimed but not completed (in-flight). */
  readonly inFlight = new Set<string>();
  readonly completedIds = new Set<string>();
  private readonly heads = new Map<string, number>();
  private readonly buffers = new Map<string, Map<number, WebhookEnvelope>>();

  async claimEnvelope(envelopeId: string): Promise<EnvelopeClaim> {
    if (this.completedIds.has(envelopeId)) return 'ALREADY_COMPLETED';
    if (this.inFlight.has(envelopeId)) return 'RECLAIM_IN_FLIGHT';
    this.inFlight.add(envelopeId);
    return 'FIRST_CLAIM';
  }

  async releaseEnvelope(envelopeId: string): Promise<void> {
    this.inFlight.delete(envelopeId);
  }

  async markEnvelopeCompleted(envelopeId: string): Promise<void> {
    this.inFlight.delete(envelopeId);
    this.completedIds.add(envelopeId);
  }

  async getLastSequence(orderingScope: string): Promise<number | null> {
    const head = this.heads.get(orderingScope);
    return head === undefined ? null : head;
  }

  async setLastSequence(orderingScope: string, sequence: number): Promise<void> {
    const current = this.heads.get(orderingScope);
    // Monotonic guard mirrors durable-store semantics (never regress a head).
    if (current !== undefined && current > sequence) {
      throw new Error(
        `FakeWebhookIngestionStore: refusing to regress head of ${orderingScope} from ${current} to ${sequence}`,
      );
    }
    this.heads.set(orderingScope, sequence);
  }

  async bufferEnvelope(orderingScope: string, envelope: WebhookEnvelope): Promise<void> {
    const seq = envelope.entityEventSequence;
    if (seq === undefined) {
      throw new Error('FakeWebhookIngestionStore: cannot buffer an envelope without a sequence');
    }
    let buffer = this.buffers.get(orderingScope);
    if (!buffer) {
      buffer = new Map<number, WebhookEnvelope>();
      this.buffers.set(orderingScope, buffer);
    }
    buffer.set(seq, structuredClone(envelope));
  }

  async listBuffered(orderingScope: string): Promise<BufferedEnvelope[]> {
    const buffer = this.buffers.get(orderingScope);
    if (!buffer) return [];
    return [...buffer.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sequence, envelope]) => ({ sequence, envelope: structuredClone(envelope) }));
  }

  async removeBuffered(orderingScope: string, sequence: number): Promise<void> {
    this.buffers.get(orderingScope)?.delete(sequence);
  }
}
