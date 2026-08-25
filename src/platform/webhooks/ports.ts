/**
 * Ingestion ports for the webhook pipeline (INT-C2-1 item c; Technical
 * Contract §6). All platform access is behind these seams — the pipeline and
 * every module under src/platform/webhooks stays free of `@wix/*` imports.
 *
 * Contract §6 constraints every implementation must honor:
 * - **1250 ms response deadline**: Wix requires a fast response. The pipeline
 *   performs no network I/O of its own; stores must be local/cheap, handlers
 *   must be quick, and BUFFERED / DUPLICATE paths are O(store) acks.
 * - **≤ 12 retries**: redelivery is the loss-recovery mechanism; a gap-held
 *   envelope is durably buffered and acknowledged so Wix need not retry it,
 *   while a crashed dispatch is re-driven by Wix redelivery.
 * - **Duplicates expected**: dedup on envelope `id` (claim/completed below).
 * - **Out-of-order expected**: order via `entityEventSequence` per scope.
 */
import type { WebhookEnvelope } from './envelope';

// ------------------------------------------------------------ signature port

export interface UnverifiedWebhookDelivery {
  /** Raw body exactly as received (signature inputs are adapter-owned). */
  rawBody: string;
  headers: Readonly<Record<string, string>>;
}

/**
 * Signature verification is an INJECTED PORT — no crypto claims are fabricated
 * in this layer. The production adapter verifies the Wix webhook JWT against
 * the app public key per current official guidance at scaffold time. Returning
 * false rejects the delivery fail-closed with zero store mutation.
 */
export interface WebhookSignatureVerifier {
  verify(delivery: UnverifiedWebhookDelivery): Promise<boolean>;
}

// ---------------------------------------------------------------- store port

/**
 * Claim result for an envelope id:
 * - FIRST_CLAIM: first delivery of this id — proceed through ordering/dispatch.
 * - RECLAIM_IN_FLIGHT: a previous attempt claimed the id but never completed
 *   (crash mid-dispatch). Redelivery RE-DISPATCHES (at-least-once); effective
 *   exactly-once comes from handler idempotency keyed on the stable
 *   deliveryKey (`<envelope id>::<handlerId>`, Contract §6: "handlers
 *   idempotent").
 * - ALREADY_COMPLETED: fully processed before — skip entirely (duplicate).
 */
export type EnvelopeClaim = 'FIRST_CLAIM' | 'RECLAIM_IN_FLIGHT' | 'ALREADY_COMPLETED';

export interface BufferedEnvelope {
  sequence: number;
  envelope: WebhookEnvelope;
}

/**
 * Durable ingestion state for serverless processes. One port so a single data
 * collection can back all three concerns later (Blueprint §1 platform/adapters).
 */
export interface WebhookIngestionStore {
  /**
   * Lease-less atomic claim: completion is the ONLY terminal state; an
   * in-flight claim is always reclaimable (crash tolerance).
   */
  claimEnvelope(envelopeId: string): Promise<EnvelopeClaim>;
  /**
   * Releases an in-flight claim WITHOUT recording completion. Used when an
   * envelope is parked in the reorder buffer: the buffer holds only UNCLAIMED
   * envelopes, so a later redelivery re-runs the normal ordering gate instead
   * of resuming dispatch out of order.
   */
  releaseEnvelope(envelopeId: string): Promise<void>;
  /** Marks the envelope fully processed; later deliveries become duplicates. */
  markEnvelopeCompleted(envelopeId: string): Promise<void>;

  /** Last contiguously dispatched sequence for the scope; null = no baseline yet. */
  getLastSequence(orderingScope: string): Promise<number | null>;
  /** Advances (or bootstraps) the scope head. Implementations must keep it monotonic. */
  setLastSequence(orderingScope: string, sequence: number): Promise<void>;

  /** Durably holds an out-of-order envelope until its predecessors complete. */
  bufferEnvelope(orderingScope: string, envelope: WebhookEnvelope): Promise<void>;
  /** Ascending-sequence listing of held envelopes for the scope. */
  listBuffered(orderingScope: string): Promise<BufferedEnvelope[]>;
  removeBuffered(orderingScope: string, sequence: number): Promise<void>;
}

// ------------------------------------------------------------- handler port

export interface WebhookHandlerContext {
  envelope: WebhookEnvelope;
  /**
   * Stable idempotency key `<envelope id>::<handlerId>`. Handlers MUST make
   * their effects idempotent per key (Contract §6) so at-least-once dispatch
   * converges to exactly-once EFFECTIVE processing across crashes/replays.
   */
  deliveryKey: string;
}

export interface WebhookHandler {
  /** Stable identifier; participates in the deliveryKey. */
  readonly handlerId: string;
  /** Routing predicate evaluated before any dispatch. */
  handles(envelope: WebhookEnvelope): boolean;
  handle(context: WebhookHandlerContext): Promise<void>;
}
