/**
 * Fixture builders for the rules-domain suites.
 *
 * Fixture week: Monday 2026-08-10 .. Sunday 2026-08-16 — America/New_York is
 * on EDT (UTC−4) for the whole week (US DST 2026: Mar 8 .. Nov 1), so wall
 * time ↔ UTC correspondence is stable and hand-checkable:
 *     local 13:30 EDT == 17:30Z.
 *
 * Builders may use domain zone math to CONSTRUCT fixtures, but every test
 * asserts against hand-computed UTC strings as independent ground truth.
 */
import {
  formatLocalTime,
  instantForLocalWall,
  nextLocalDate,
} from '../../../src/domain';
import type {
  BookingFacts,
  EvaluationDeps,
  ExistingBookingFact,
  PolicyDecision,
  RuleSet,
  Weekday,
  WeeklyWindowDTO,
} from '../../../src/domain';

export const SITE_ZONE = 'America/New_York';

/** Anchor dates of the fixture week (all real Wednesdays/Sundays etc.). */
export const ANCHOR_DATES: Record<Weekday, string> = {
  MON: '2026-08-10',
  TUE: '2026-08-11',
  WED: '2026-08-12',
  THU: '2026-08-13',
  FRI: '2026-08-14',
  SAT: '2026-08-15',
  SUN: '2026-08-16',
};

function instantAt(date: string, minutesOfDay: number): string {
  if (minutesOfDay === 1440) {
    // Exclusive end-of-day sentinel: next-day local midnight.
    return instantForLocalWall(SITE_ZONE, nextLocalDate(date), 0);
  }
  return instantForLocalWall(SITE_ZONE, date, minutesOfDay);
}

/**
 * BookingFacts for a proposed slot on `weekday` spanning
 * [startMinute, endMinute) site-local wall time. `endMinute` may be 1440
 * (exclusive midnight end). Hand-checked example (audit B3):
 *   factsAt('WED', 810, 870) === 2026-08-12T17:30:00.000Z .. 18:30:00.000Z
 *   (13:30–14:30 EDT).
 */
export function factsAt(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
  overrides: Partial<BookingFacts> = {},
): BookingFacts {
  const date = ANCHOR_DATES[weekday];
  return {
    at: instantAt(date, startMinute),
    serviceId: 'svc-1',
    locationId: 'loc-1',
    slotStart: instantAt(date, startMinute),
    slotEnd: instantAt(date, endMinute),
    timezone: SITE_ZONE,
    ...overrides,
  };
}

/** A minimal VALID RuleSet with nothing configured (default-open posture). */
export function baseRuleSet(overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    ruleSetId: 'ruleset-1',
    revision: 'rev-1',
    version: 1,
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
    ...overrides,
  };
}

export function weeklyWindow(
  weekday: Weekday,
  startMinute: number,
  endMinute: number,
): WeeklyWindowDTO {
  return { weekday, start: formatLocalTime(startMinute), end: formatLocalTime(endMinute) };
}

export function existingBooking(
  overrides: Partial<ExistingBookingFact> = {},
): ExistingBookingFact {
  return {
    bookingId: 'bk-ex',
    serviceId: 'svc-1',
    locationId: 'loc-1',
    startUtc: '2026-08-12T17:00:00.000Z',
    endUtc: '2026-08-12T18:00:00.000Z',
    status: 'CONFIRMED',
    identityKey: null,
    ...overrides,
  };
}

export function healthyEntitlement(allowed: string[] = ['loc-1']): PolicyDecision {
  return { allowedLocationIds: allowed, overLimit: false, degraded: false, warning: null };
}

export function degradedEntitlement(): PolicyDecision {
  return {
    allowedLocationIds: [],
    overLimit: true,
    degraded: true,
    warning: 'billing API unavailable — fail-open coverage',
  };
}

/** EvaluationDeps with permissive defaults; override any single knob. */
export function depsWith(overrides: Partial<EvaluationDeps> = {}): EvaluationDeps {
  return {
    entitlement: healthyEntitlement(),
    countForQuery: () => 0,
    existingBookings: () => [],
    ...overrides,
  };
}
