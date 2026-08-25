/**
 * Webhook ingestion pipeline (INT-C2-1 item c; Blueprint §4 flow 4; Technical
 * Contract §6).
 *
 * BINDING PLATFORM CONSTRAINTS (Contract §6, restated for every maintainer):
 * - **1250 ms response deadline** — ingest performs no network I/O beyond the
 *   injected ports; adapters must respond within the deadline. Duplicate and
 *   buffered paths are O(store) fast acks.
 * - **≤ 12 retries** — Wix redelivery is the recovery driver: a dispatch that
 *   crashes stays claimed-but-incomplete, so the next redelivery re-dispatches
 *   (at-least-once); handlers converge because they are idempotent per
 *   deliveryKey.
 * - **Duplicates expected** — dedup on envelope `id`; completed envelopes are
 *   acknowledged without touching any handler again.
 * - **Out-of-order expected** — order restored per ordering scope via
 *   `entityEventSequence`; gap-held envelopes are durably buffered and acked.
 *
 * ORDERING SEMANTICS (deterministic):
 * - The scope head starts UNKNOWN (null). With no baseline, arrivals are
 *   durably BUFFERED — the pipeline never guesses which sequence "should" be
 *   first. A baseline is established explicitly via `bootstrapOrderingHead`
 *   (a caller/lane decision, e.g. subscription setup) or lazily by
 *   `drainBuffered` flushing ascending from the lowest held sequence.
 * - With a head H: seq === H+1 dispatches immediately and auto-drains now-
 *   contiguous successors; seq <= H is SUPERSEDED (already reflected); gaps
 *   buffer until filled or drained.
 * - Lost-predecessor safety valve: `drainBuffered` flushes held envelopes in
 *   ascending order. Counter drift from any flushed gap self-heals through the
 *   authoritative BookingCountGateway reconciliation (Blueprint §4 flow 4).
 *
 * CRASH / EXACTLY-ONCE MODEL:
 *   claim → dispatch(handlers, deliveryKey) → advance head → markCompleted.
 *   A crash anywhere before markCompleted leaves the envelope reclaimable;
 *   redelivery re-runs handlers (at-least-once invocation), whose per-key
 *   idempotency yields exactly-once EFFECTIVE processing. Proven by the
 *   deterministic chaos suite (tests/platform/webhooks-chaos.spec.ts).
 */
import { parseWebhookEnvelope } from './envelope';
import type { WebhookEnvelope } from './envelope';
import type {
  BufferedEnvelope,
  UnverifiedWebhookDelivery,
  WebhookHandler,
  WebhookIngestionStore,
  WebhookSignatureVerifier,
} from './ports';

export type IngestOutcome =
  | 'DISPATCHED'
  | 'BUFFERED'
  | 'DUPLICATE_ACKNOWLEDGED'
  | 'SUPERSEDED_SKIPPED'
  | 'SIGNATURE_REJECTED';

export interface IngestResult {
  outcome: IngestOutcome;
  envelopeId: string;
  /** Handler ids this envelope was delivered to during THIS ingest call. */
  dispatchedHandlerIds: string[];
  /** True when this ingest resumed a previously crashed in-flight claim. */
  resumed: boolean;
}

export type OrderingScopeFn = (envelope: WebhookEnvelope) => string;

/** Default scope: per entity within an event type; fully-untyped → global. */
export const defaultOrderingScopeFor: OrderingScopeFn = (envelope) =>
  `${envelope.eventType ?? '_unknown'}:${envelope.entityId ?? '_'}`;

export interface WebhookIngestionPipelineOptions {
  store: WebhookIngestionStore;
  signatureVerifier: WebhookSignatureVerifier;
  handlers: readonly WebhookHandler[];
  /** Override the default per-entity ordering scope derivation. */
  orderingScopeFor?: OrderingScopeFn;
}

export class WebhookIngestionPipeline {
  private readonly store: WebhookIngestionStore;
  private readonly signatureVerifier: WebhookSignatureVerifier;
  private readonly handlers: readonly WebhookHandler[];
  private readonly orderingScopeFor: OrderingScopeFn;

  constructor(options: WebhookIngestionPipelineOptions) {
    this.store = options.store;
    this.signatureVerifier = options.signatureVerifier;
    this.handlers = [...options.handlers];
    this.orderingScopeFor = options.orderingScopeFor ?? defaultOrderingScopeFor;
  }

  /**
   * Ingest one delivery: verify signature → dedup claim → order/dispatch →
   * complete. Signature rejections happen BEFORE any store interaction
   * (fail closed, zero mutation). `envelopeInput` may be pre-parsed by the
   * adapter or raw JSON — BOTH pass through full `parseWebhookEnvelope`
   * structural validation (audit CYCLE_32787032785 observation 3 hardening:
   * no duck-typing bypass; a malformed pre-parsed envelope can never skip
   * validation).
   */
  async ingest(
    delivery: UnverifiedWebhookDelivery,
    envelopeInput: unknown | WebhookEnvelope,
  ): Promise<IngestResult> {
    const authentic = await this.signatureVerifier.verify(delivery);
    if (!authentic) {
      return {
        outcome: 'SIGNATURE_REJECTED',
        envelopeId: '<unverified>',
        dispatchedHandlerIds: [],
        resumed: false,
      };
    }

    const envelope = parseWebhookEnvelope(envelopeInput);

    const claim = await this.store.claimEnvelope(envelope.id);
    if (claim === 'ALREADY_COMPLETED') {
      // Fast ack inside the 1250 ms deadline; handler state untouched.
      return {
        outcome: 'DUPLICATE_ACKNOWLEDGED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: [],
        resumed: false,
      };
    }
    const resumed = claim === 'RECLAIM_IN_FLIGHT';

    if (resumed) {
      // Previous attempt crashed mid-dispatch: re-drive the handlers directly.
      // Head consistency is preserved below via monotonic max-advance, and
      // handler-side idempotency keeps effects exactly-once. Advancing the
      // head here also releases any successor that buffered meanwhile.
      await this.dispatchToHandlers(envelope);
      const advancedTo = await this.advanceHeadPast(envelope);
      await this.store.markEnvelopeCompleted(envelope.id);
      const seq = envelope.entityEventSequence;
      if (seq !== undefined) {
        // Defensive cleanup for the crash-during-drain window, where the
        // envelope may still sit in its scope's reorder buffer.
        await this.store.removeBuffered(this.orderingScopeFor(envelope), seq);
      }
      if (advancedTo !== null) {
        await this.drainContiguousSuccessors(this.orderingScopeFor(envelope), advancedTo);
      }
      return {
        outcome: 'DISPATCHED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: this.matchingHandlers(envelope),
        resumed: true,
      };
    }

    const seq = envelope.entityEventSequence;
    if (seq === undefined) {
      // No ordering metadata: process in arrival order (documented fallback).
      await this.dispatchToHandlers(envelope);
      await this.store.markEnvelopeCompleted(envelope.id);
      return {
        outcome: 'DISPATCHED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: this.matchingHandlers(envelope),
        resumed: false,
      };
    }

    const scope = this.orderingScopeFor(envelope);
    const head = await this.store.getLastSequence(scope);

    if (head !== null && seq <= head) {
      // Stale replay behind the head: already reflected; ack as done so Wix
      // stops retrying and future duplicates hit the fast path.
      await this.store.markEnvelopeCompleted(envelope.id);
      return {
        outcome: 'SUPERSEDED_SKIPPED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: [],
        resumed: false,
      };
    }

    if (head !== null && seq > head + 1) {
      // Park UNCLAIMED in the reorder buffer: a redelivery of a buffered
      // envelope must re-run the ordering gate, never resume out of order.
      await this.store.releaseEnvelope(envelope.id);
      await this.store.bufferEnvelope(scope, envelope);
      return {
        outcome: 'BUFFERED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: [],
        resumed: false,
      };
    }

    if (head === null) {
      // No baseline yet: hold durably rather than guess the true first
      // sequence. Bootstrap/drain establishes the head (see module docs).
      await this.store.releaseEnvelope(envelope.id);
      await this.store.bufferEnvelope(scope, envelope);
      return {
        outcome: 'BUFFERED',
        envelopeId: envelope.id,
        dispatchedHandlerIds: [],
        resumed: false,
      };
    }

    // seq === head + 1: in-order arrival.
    await this.dispatchToHandlers(envelope);
    await this.store.setLastSequence(scope, seq);
    await this.store.markEnvelopeCompleted(envelope.id);
    await this.drainContiguousSuccessors(scope, seq);
    return {
      outcome: 'DISPATCHED',
      envelopeId: envelope.id,
      dispatchedHandlerIds: this.matchingHandlers(envelope),
      resumed: false,
    };
  }

  /**
   * Establishes the ordering baseline for a scope when it is still unknown
   * (idempotent: never moves an existing head backwards). Baseline choice is a
   * caller/lane decision — e.g. 0 for entities created after subscription, or
   * a reconciled checkpoint. Then drains anything now contiguous.
   */
  async bootstrapOrderingHead(orderingScope: string, lastKnownSequence: number): Promise<void> {
    const current = await this.store.getLastSequence(orderingScope);
    if (current === null || current < lastKnownSequence) {
      await this.store.setLastSequence(orderingScope, lastKnownSequence);
    }
    await this.drainContiguousSuccessors(orderingScope, lastKnownSequence);
  }

  /**
   * Safety valve for permanently lost predecessors (retries exhausted): flush
   * held envelopes in ascending sequence order starting from the LOWEST held
   * sequence. Any resulting counter drift self-heals via authoritative
   * reconciliation (Blueprint §4 flow 4). Returns per-envelope results.
   */
  async drainBuffered(orderingScope: string): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    for (;;) {
      const buffered = await this.store.listBuffered(orderingScope);
      const lowest: BufferedEnvelope | undefined = buffered[0];
      if (!lowest) break;

      const head = await this.store.getLastSequence(orderingScope);
      if (head !== null && lowest.sequence <= head) {
        // Already reflected while it sat buffered; drop without dispatching.
        await this.store.removeBuffered(orderingScope, lowest.sequence);
        await this.store.markEnvelopeCompleted(lowest.envelope.id);
        results.push({
          outcome: 'SUPERSEDED_SKIPPED',
          envelopeId: lowest.envelope.id,
          dispatchedHandlerIds: [],
          resumed: false,
        });
        continue;
      }

      // Re-claim before dispatch (buffer holds only unclaimed envelopes).
      await this.store.claimEnvelope(lowest.envelope.id);
      await this.dispatchToHandlers(lowest.envelope);
      await this.store.setLastSequence(orderingScope, lowest.sequence);
      await this.store.markEnvelopeCompleted(lowest.envelope.id);
      await this.store.removeBuffered(orderingScope, lowest.sequence);
        results.push({
          outcome: 'DISPATCHED',
          envelopeId: lowest.envelope.id,
          dispatchedHandlerIds: this.matchingHandlers(lowest.envelope),
          resumed: false,
        });
    }
    return results;
  }

  // -------------------------------------------------------------- internals

  private matchingHandlers(envelope: WebhookEnvelope): string[] {
    return this.handlers.filter((h) => h.handles(envelope)).map((h) => h.handlerId);
  }

  /** At-least-once dispatch in deterministic registration order. */
  private async dispatchToHandlers(envelope: WebhookEnvelope): Promise<void> {
    for (const handler of this.handlers) {
      if (!handler.handles(envelope)) continue;
      await handler.handle({
        envelope,
        deliveryKey: `${envelope.id}::${handler.handlerId}`,
      });
    }
  }

  /** Monotonic head advance used on resume paths (never regresses). Returns the resulting head, or null when the envelope carried no sequence. */
  private async advanceHeadPast(envelope: WebhookEnvelope): Promise<number | null> {
    const seq = envelope.entityEventSequence;
    if (seq === undefined) return null;
    const scope = this.orderingScopeFor(envelope);
    const head = await this.store.getLastSequence(scope);
    if (head === null || head < seq) {
      await this.store.setLastSequence(scope, seq);
      return seq;
    }
    return head;
  }

  /** Releases buffered successors that became contiguous after an advance. */
  private async drainContiguousSuccessors(scope: string, advancedTo: number): Promise<void> {
    let expected = advancedTo + 1;
    for (;;) {
      const buffered = await this.store.listBuffered(scope);
      const next: BufferedEnvelope | undefined = buffered.find((b) => b.sequence === expected);
      if (!next) break;
      // The buffer holds only unclaimed envelopes: re-claim before dispatch.
      const claim = await this.store.claimEnvelope(next.envelope.id);
      if (claim === 'ALREADY_COMPLETED') {
        await this.store.removeBuffered(scope, expected);
        expected += 1;
        continue;
      }
      await this.dispatchToHandlers(next.envelope);
      await this.store.setLastSequence(scope, expected);
      await this.store.markEnvelopeCompleted(next.envelope.id);
      await this.store.removeBuffered(scope, expected);
      expected += 1;
    }
  }
}
