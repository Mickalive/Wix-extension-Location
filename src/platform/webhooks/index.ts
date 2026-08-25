/**
 * Webhook ingestion pipeline — public surface (INT-C2-1 item c).
 *
 * MODULE DOCS — binding Technical Contract §6 constraints honored here:
 * - **Signature**: webhook deliveries are JWT-signed with the app public key.
 *   Verification is an INJECTED port (`WebhookSignatureVerifier`); this layer
 *   fabricates no crypto and rejects fail-closed on `false`.
 * - **1250 ms response deadline**: ingest does no network I/O beyond injected
 *   ports; duplicate/buffered paths are O(store) fast acks.
 * - **≤ 12 retries**: Wix redelivery re-drives crashed dispatches (claimed but
 *   never completed envelopes are reclaimable).
 * - **Duplicates expected**: dedup on envelope `id`; completed ⇒ fast ack.
 * - **Out-of-order expected**: order via `entityEventSequence` per scope;
 *   gaps buffer durably; bootstrap/drain policies documented in pipeline.ts.
 * - **Handlers idempotent** (Contract §6): dispatch is at-least-once keyed by
 *   `<envelope id>::<handlerId>` so effects converge exactly-once.
 */
export type { WebhookEnvelope } from './envelope';
export { parseWebhookEnvelope } from './envelope';
export type {
  BufferedEnvelope,
  EnvelopeClaim,
  UnverifiedWebhookDelivery,
  WebhookHandler,
  WebhookHandlerContext,
  WebhookIngestionStore,
  WebhookSignatureVerifier,
} from './ports';
export {
  defaultOrderingScopeFor,
  WebhookIngestionPipeline,
} from './pipeline';
export type {
  IngestOutcome,
  IngestResult,
  OrderingScopeFn,
  WebhookIngestionPipelineOptions,
} from './pipeline';
