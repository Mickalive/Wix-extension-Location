/**
 * Duplicate-booking protection — identity-free FIRST (Contract §11 C1).
 *
 * v1 matching semantics (documented in src/domain/README.md):
 *  - Identity-free: an existing ACTIVE booking for the SAME SERVICE whose
 *    start falls on the proposal's site-zone day and whose interval overlaps
 *    the proposal (half-open) blocks the proposal regardless of who books.
 *  - Identity-keyed (only when the proposal supplies an identityKey): an
 *    overlapping existing booking with the SAME key but a DIFFERENT service
 *    signals one person trying to hold two services at once
 *    (IDENTITY_TIME_CONFLICT). Same-service overlaps are already caught
 *    identity-free.
 *  - Interval overlap is half-open: back-to-back bookings (existing ends
 *    exactly when the proposal starts) do NOT conflict; contained intervals
 *    DO.
 *  - Known v1 limitation (audit A2): bucketing uses the EXISTING booking's
 *    START in the site zone, so a native overnight booking that starts the
 *    previous day but overlaps the proposal is not caught. Consistent with
 *    the caps' start-bucket convention; documented, not hidden.
 */

import { dateOfInstant } from '../time/intlZone';
import { parseInstantMillis } from '../time/wallClock';
import type { BookingStatus, IanaZone, Instant } from '../../shared/types';

export interface ExistingBookingFact {
  bookingId?: string;
  serviceId: string;
  locationId?: string | null;
  startUtc: Instant;
  endUtc: Instant;
  status?: BookingStatus;
  identityKey?: string | null;
}

/**
 * Statuses that occupy the calendar for duplicate purposes. DECLINED never
 * held the slot; CANCELED freed it; WAITING_LIST holds no slot natively.
 */
const DUPLICATE_COUNTED_STATUSES: readonly BookingStatus[] = [
  'CREATED',
  'PENDING',
  'CONFIRMED',
  'UPDATED',
];

/** Half-open interval overlap: (aStart < bEnd) && (bStart < aEnd). */
export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export type DuplicateConflictKind = 'DUPLICATE_BOOKING' | 'IDENTITY_TIME_CONFLICT';

export interface DuplicateProposal {
  serviceId: string;
  slotStartMs: number;
  slotEndMs: number;
  targetDate: string;
  identityKey?: string | null;
}

/**
 * Returns the strongest conflict between the proposal and any existing
 * booking, or null when no duplicate rule fires.
 */
export function findDuplicateConflict(
  proposal: DuplicateProposal,
  existingBookings: readonly ExistingBookingFact[],
  timezone: IanaZone,
): DuplicateConflictKind | null {
  let sawIdentityConflict = false;
  for (const existing of existingBookings) {
    if (
      existing.status !== undefined &&
      !DUPLICATE_COUNTED_STATUSES.includes(existing.status)
    ) {
      continue;
    }
    let existingStartMs: number;
    let existingEndMs: number;
    try {
      existingStartMs = parseInstantMillis(existing.startUtc);
      existingEndMs = parseInstantMillis(existing.endUtc);
    } catch {
      continue; // malformed existing records can never block a customer
    }
    // Start-bucket convention: the existing booking must START on the
    // proposal's site-zone day (see A2 limitation note above).
    if (dateOfInstant(timezone, existingStartMs) !== proposal.targetDate) continue;
    if (
      !intervalsOverlap(
        proposal.slotStartMs,
        proposal.slotEndMs,
        existingStartMs,
        existingEndMs,
      )
    ) {
      continue;
    }
    if (existing.serviceId === proposal.serviceId) {
      return 'DUPLICATE_BOOKING'; // identity-free path wins; strongest signal
    }
    if (
      proposal.identityKey !== null &&
      proposal.identityKey !== undefined &&
      proposal.identityKey === existing.identityKey
    ) {
      sawIdentityConflict = true;
    }
  }
  return sawIdentityConflict ? 'IDENTITY_TIME_CONFLICT' : null;
}
