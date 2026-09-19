/**
 * Structural parsing of Wix Bookings Validation service-plugin requests into
 * the narrow facts consumed by the rule engine.
 *
 * Current Wix contract:
 * - request.items[].booking.bookedEntity.slot for CREATE/CANCEL
 * - request.items[].targetSlot for RESCHEDULE
 * - CREATE items correlate by itemIndex
 * - CANCEL/RESCHEDULE items correlate by booking.id
 *
 * The parser deliberately drops contact details and unrelated booking fields.
 */

import { PlatformError } from '../../shared/errors';
import type { ValidationTarget } from './targets';

export const MAX_CREATE_ITEMS = 40;
export const MAX_CANCEL_OR_RESCHEDULE_ITEMS = 8;
/** Largest supported request size; kept for compatibility with existing imports. */
export const MAX_BULK_ITEMS = MAX_CREATE_ITEMS;

const IDENTITY_KINDS = ['memberId', 'wixUserId', 'anonymousVisitorId', 'appId'] as const;

export type MetadataIdentityKind = (typeof IDENTITY_KINDS)[number];

export interface MetadataIdentity {
  kind: MetadataIdentityKind;
  value: string;
}

export interface ParsedSlotItem {
  /** Position in request.items, used internally by the pure handler. */
  index: number;
  serviceId: string;
  scheduleId: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  location: { id: unknown; locationType: string | null } | null;
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
    throw invalid(`${field} must be a non-empty string`);
  }
  return value;
}

function isCreateTarget(target: ValidationTarget): boolean {
  return target === 'CREATE' || target === 'CREATE_MULTI_SERVICE';
}

function isRescheduleTarget(target: ValidationTarget): boolean {
  return target === 'RESCHEDULE' || target === 'RESCHEDULE_MULTI_SERVICE';
}

export function maxItemsForTarget(target: ValidationTarget): number {
  return isCreateTarget(target)
    ? MAX_CREATE_ITEMS
    : MAX_CANCEL_OR_RESCHEDULE_ITEMS;
}

export function ownerBusinessLocationId(item: ParsedSlotItem): string | null {
  if (item.location === null) return null;
  if (item.location.locationType !== 'OWNER_BUSINESS') return null;
  if (typeof item.location.id !== 'string' || item.location.id === '') return null;
  return item.location.id;
}

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

function slotForTarget(
  index: number,
  raw: Record<string, unknown>,
  booking: Record<string, unknown>,
  target: ValidationTarget,
): Record<string, unknown> {
  if (isRescheduleTarget(target)) {
    const targetSlot = raw.targetSlot;
    if (!isRecord(targetSlot)) {
      throw invalid(`items[${index}].targetSlot must be an object`);
    }
    return targetSlot;
  }

  const bookedEntity = booking.bookedEntity;
  if (!isRecord(bookedEntity)) {
    throw invalid(`items[${index}].booking.bookedEntity must be an object`);
  }
  const slot = bookedEntity.slot;
  if (!isRecord(slot)) {
    throw invalid(`items[${index}].booking.bookedEntity.slot must be an object`);
  }
  return slot;
}

function parseItem(
  index: number,
  rawValue: unknown,
  target: ValidationTarget,
): ParsedSlotItem {
  if (!isRecord(rawValue)) {
    throw invalid(`items[${index}] must be an object`);
  }

  const booking = rawValue.booking;
  if (!isRecord(booking)) {
    throw invalid(`items[${index}].booking must be an object`);
  }

  if (!isCreateTarget(target)) {
    requireNonEmptyString(booking.id, `items[${index}].booking.id`);
  }

  const slot = slotForTarget(index, rawValue, booking, target);

  let location: ParsedSlotItem['location'] = null;
  if (slot.location !== undefined && slot.location !== null) {
    if (!isRecord(slot.location)) {
      throw invalid(
        `items[${index}].slot.location must be an object when present`,
      );
    }
    location = {
      id: slot.location.id,
      locationType:
        typeof slot.location.locationType === 'string'
          ? slot.location.locationType
          : null,
    };
  }

  const scheduleId = slot.scheduleId;
  if (
    scheduleId !== undefined &&
    scheduleId !== null &&
    typeof scheduleId !== 'string'
  ) {
    throw invalid(
      `items[${index}].slot.scheduleId must be a string when present`,
    );
  }

  return {
    index,
    serviceId: requireNonEmptyString(
      slot.serviceId,
      `items[${index}].slot.serviceId`,
    ),
    scheduleId: typeof scheduleId === 'string' ? scheduleId : null,
    startDate: requireNonEmptyString(
      slot.startDate,
      `items[${index}].slot.startDate`,
    ),
    endDate: requireNonEmptyString(
      slot.endDate,
      `items[${index}].slot.endDate`,
    ),
    timezone: requireNonEmptyString(
      slot.timezone,
      `items[${index}].slot.timezone`,
    ),
    location,
    metadataIdentity: observeMetadataIdentity(rawValue.metadata),
  };
}

/**
 * Parses the request exactly according to the selected Wix validation target.
 * Structural failures intentionally happen before dependency access.
 */
export function parseValidationRequest(
  body: unknown,
  target: ValidationTarget = 'CREATE',
): ParsedValidationRequest {
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

  const maxItems = maxItemsForTarget(target);
  if (items.length > maxItems) {
    throw invalid(
      `${target} validation maxItems ${maxItems}; received ${items.length}`,
    );
  }

  return {
    items: items.map((raw, index) => parseItem(index, raw, target)),
  };
}
