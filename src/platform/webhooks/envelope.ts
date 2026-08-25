/**
 * Webhook envelope model (INT-C2-1 item c; Technical Contract §6).
 *
 * Binding platform facts encoded here (Contract §6, webhooks):
 * - deliveries are JWT-signed with the app public key (verification is an
 *   INJECTED port — this layer fabricates no crypto);
 * - duplicates and out-of-order delivery are EXPECTED;
 * - dedup key = envelope `id`; ordering key = `entityEventSequence`.
 *
 * The pipeline never inspects payload contents: `data` is an opaque passthrough
 * for registered handlers.
 */
import { PlatformError } from '../../shared/errors';

export interface WebhookEnvelope {
  /**
   * Wix delivery envelope id — globally unique per logical delivery; duplicate
   * redeliveries share it. THE dedup key (Contract §6).
   */
  id: string;
  /** Event type discriminator used for handler routing (e.g. booking lifecycle). */
  eventType?: string;
  /** Entity id when known; component of the default ordering scope. */
  entityId?: string;
  /**
   * Per-entity event sequence used to restore order across out-of-order
   * delivery (Contract §6). Optional: envelopes without one bypass ordering
   * and process in arrival order (documented pipeline behavior).
   */
  entityEventSequence?: number;
  /** Opaque payload passthrough; never interpreted by the ingestion pipeline. */
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of a parsed delivery body into a WebhookEnvelope.
 * Malformed envelopes reject with INVALID_QUERY BEFORE any store interaction
 * (fail closed; the adapter answers the platform without dispatching).
 */
export function parseWebhookEnvelope(value: unknown): WebhookEnvelope {
  if (!isRecord(value)) {
    throw new PlatformError('INVALID_QUERY', 'webhook envelope must be a JSON object');
  }
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    throw new PlatformError('INVALID_QUERY', 'webhook envelope requires a non-empty string id');
  }
  const seq = value.entityEventSequence;
  if (
    seq !== undefined &&
    seq !== null &&
    (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0)
  ) {
    throw new PlatformError(
      'INVALID_QUERY',
      'entityEventSequence must be a non-negative safe integer when present',
    );
  }
  return {
    id: value.id,
    ...(typeof value.eventType === 'string' ? { eventType: value.eventType } : {}),
    ...(typeof value.entityId === 'string' ? { entityId: value.entityId } : {}),
    ...(typeof seq === 'number' ? { entityEventSequence: seq } : {}),
    data: value.data,
  };
}
