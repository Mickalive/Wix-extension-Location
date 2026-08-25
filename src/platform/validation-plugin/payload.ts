/**
 * Structural parsing of a Bookings Validation plugin request into typed,
 * documented-field-only items (INT-C3-1 item b/d; Technical Contract §5.3).
 *
 * BINDING PAYLOAD CONTRACT (Contract §5.3, verbatim field paths):
 * - Per item, ONLY these fields are mapped:
 *     bookedEntity.slot.serviceId
 *     bookedEntity.slot.scheduleId
 *     bookedEntity.slot.startDate          (UTC instant)
 *     bookedEntity.slot.endDate            (UTC instant)
 *     bookedEntity.slot.timezone           (booking timezone, §4.7)
 *     bookedEntity.slot.location.id        (present for OWNER_BUSINESS only)
 *     bookedEntity.slot.location.locationType
 *   and — behind the explicit UNPROVEN-payload flag (Invariant C1) —
 *     metadata.identity.{memberId|wixUserId|anonymousVisitorId|appId}
 * - ALL contactDetails fields are redacted by the platform; whether
 *   `contactDetails.contactId` survives sanitization is UNPROVEN. This parser
 *   therefore IGNORES every undocumented field: unknown content can never
 *   reach a BookingFact, a count query or a duplicate key.
 * - Bulk create validates per item with cap `maxItems 12`; OMITTED ITEMS
 *   DEFAULT TO VALID on the platform side — so the handler layer must return
 *   an explicit result for EVERY index (enforced in handlers.ts + tests).
 *
 * Structural failures throw typed INVALID_QUERY PlatformErrors BEFORE any
 * dependency is consulted. Field-format problems (e.g. malformed instants) are
 * deliberately NOT rejected here: the pure evaluator classifies them as
 * fail-closed INVALID_SLOT outcomes with customer-safe messages.
 *
 * Purity: no Wix imports. The real wire envelope is mapped onto the canonical
 * `{ items: [...] }` shape by the T-VP0 thin adapter (see ./README.md).
 */

import { PlatformError } from '../../shared/errors';

/** Contract §5.3 bulk cap: "Bulk create validates per item, cap maxItems 12". */
export const MAX_BULK_ITEMS = 12;

/** Identity kinds documented for metadata.identity (Contract §5.3). Fixed precedence order. */
const IDENTITY_KINDS = ['memberId', 'wixUserId', 'anonymousVisitorId', 'appId'] as const;

export type MetadataIdentityKind = (typeof IDENTITY_KINDS)[number];

export interface MetadataIdentity {
  kind: MetadataIdentityKind;
  value: string;
}

/**
 * One parsed bulk item. Only documented payload fields survive; everything
 * else the platform sent is dropped at this boundary.
 */
export interface ParsedSlotItem {
  /** Position in the bulk request; the handler result MUST cover it explicitly. */
  index: number;
  serviceId: string;
  scheduleId: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  /**
   * Raw location object reduced to its two documented fields. `id` stays
   * unknown-typed ON PURPOSE: it may only become a locationId when
   * `locationType === 'OWNER_BUSINESS'` (Contract §5.3) — see
   * {@link ownerBusinessLocationId}.
   */
  location: { id: unknown; locationType: string | null } | null;
  /** Observed metadata.identity (structural passthrough). CONSUMPTION is gated by the identity policy in handlers.ts — never use this field directly. */
  metadataIdentity: MetadataIdentity | null;
}

export interface ParsedValidationRequest {
  items: ParsedSlotItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): PlatformError {
  return new PlatformError('INVALID_QUERY', message);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`item slot.${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Extracts the location id ONLY for OWNER_BUSINESS locations (Contract §5.3:
 * `location.id` arrives for OWNER_BUSINESS only). CUSTOM/CUSTOMER bookings —
 * and any unexpected locationType — yield null, matching the domain's
 * "no locationId" entitlement/window path.
 */
export function ownerBusinessLocationId(item: ParsedSlotItem): string | null {
  if (item.location === null) return null;
  if (item.location.locationType !== 'OWNER_BUSINESS') return null;
  if (typeof item.location.id !== 'string' || item.location.id === '') return null;
  return item.location.id;
}

/**
 * Observes metadata.identity WITHOUT consuming it: recognition is structural;
 * the decision to use it as a duplicate identity key lives exclusively behind
 * the UNPROVEN-payload flag in handlers.ts (Invariant C1 / gate T-VP3).
 */
function observeMetadataIdentity(metadata: unknown): MetadataIdentity | null {
  if (!isRecord(metadata)) return null;
  const identity = metadata.identity;
  if (!isRecord(identity)) return null;
  for (const kind of IDENTITY_KINDS) {
    const value = identity[kind];
    if (typeof value === 'string' && value !== '') {
      return { kind, value };
    }
  }
  return null;
}

function parseItem(index: number, raw: unknown): ParsedSlotItem {
  if (!isRecord(raw)) {
    throw invalid(`items[${index}] must be an object`);
  }
  const bookedEntity = raw.bookedEntity;
  if (!isRecord(bookedEntity)) {
    throw invalid(`items[${index}].bookedEntity must be an object`);
  }
  const slot = bookedEntity.slot;
  if (!isRecord(slot)) {
    throw invalid(`items[${index}].bookedEntity.slot must be an object`);
  }

  let location: ParsedSlotItem['location'] = null;
  if (slot.location !== undefined && slot.location !== null) {
    if (!isRecord(slot.location)) {
      throw invalid(`items[${index}].bookedEntity.slot.location must be an object when present`);
    }
    // Documented fields only; id/type kept raw for the OWNER_BUSINESS gate.
    location = { id: slot.location.id, locationType: typeof slot.location.locationType === 'string' ? slot.location.locationType : null };
  }

  const scheduleId = slot.scheduleId;
  if (scheduleId !== undefined && scheduleId !== null && typeof scheduleId !== 'string') {
    throw invalid(`items[${index}].bookedEntity.slot.scheduleId must be a string when present`);
  }

  return {
    index,
    serviceId: requireNonEmptyString(slot.serviceId, 'serviceId'),
    scheduleId: typeof scheduleId === 'string' ? scheduleId : null,
    startDate: requireNonEmptyString(slot.startDate, 'startDate'),
    endDate: requireNonEmptyString(slot.endDate, 'endDate'),
    timezone: requireNonEmptyString(slot.timezone, 'timezone'),
    location,
    metadataIdentity: observeMetadataIdentity(raw.metadata),
  };
}

/**
 * Structurally validates a raw request body into documented-field-only items.
 * Throws INVALID_QUERY before any store/gateway interaction on: non-object
 * bodies, missing/non-array/empty `items`, more than MAX_BULK_ITEMS items, or
 * per-item structural violations.
 */
export function parseValidationRequest(body: unknown): ParsedValidationRequest {
  if (!isRecord(body)) {
    throw invalid('validation request body must be a JSON object');
  }
  const items = body.items;
  if (!Array.isArray(items)) {
    throw invalid('validation request body must contain an items array');
  }
  if (items.length === 0) {
    throw invalid('items must contain at least one booking item');
  }
  if (items.length > MAX_BULK_ITEMS) {
    throw invalid(`bulk validation accepts at most ${MAX_BULK_ITEMS} items (Contract §5.3 maxItems), received ${items.length}`);
  }
  return { items: items.map((raw, index) => parseItem(index, raw)) };
}
