/**
 * Shared scenario fixtures for the cycle-5 target-matrix property suites
 * (RULES-C5-1: determinism/explanation-completeness across ALL THREE
 * EvaluationTargets, CANCEL-tail drift guard, matrix↔code consistency).
 *
 * ADDITIVE ONLY: existing suites keep importing `builders.ts` unchanged.
 * Zone/date construction uses the pure domain helpers themselves; every
 * assertion made WITH these fixtures is against deterministic pure behavior
 * (no host clock, no host zone — America/New_York is passed explicitly).
 */
import { instantForLocalWall, nextLocalDate } from '../../../src/domain';
import type { BookingFacts, EvaluationTarget } from '../../../src/domain';

export const SITE_ZONE = 'America/New_York';

/**
 * US DST 2026 transition days (both are Sundays in America/New_York):
 *  - Spring forward 2026-03-08: 02:00 EST (07:00Z) → 03:00 EDT (07:00Z);
 *    local wall times 02:00–02:59 DO NOT EXIST (gap policy: advance to the
 *    transition instant, e.g. 02:30 → 03:00 EDT = 07:00Z).
 *  - Fall back 2026-11-01: 02:00 EDT (06:00Z) → 01:00 EST (06:00Z);
 *    local wall times 01:00–01:59 occur TWICE (ambiguity policy: first
 *    occurrence EDT wins; the second occurrence is never produced).
 */
export const SPRING_FORWARD_DATE = '2026-03-08';
export const FALL_BACK_DATE = '2026-11-01';

/**
 * The three canonical evaluation targets. The six platform validation targets
 * collapse onto these operations (`*_MULTI_SERVICE` shares its base
 * operation's semantics; src/domain/ports.ts `EvaluationTarget`).
 */
export const ALL_TARGETS: readonly EvaluationTarget[] = ['CREATE', 'CANCEL', 'RESCHEDULE'];

function instantAt(date: string, minutesOfDay: number): string {
  if (minutesOfDay === 1440) {
    // Exclusive end-of-day sentinel: next-day local midnight.
    return instantForLocalWall(SITE_ZONE, nextLocalDate(date), 0);
  }
  return instantForLocalWall(SITE_ZONE, date, minutesOfDay);
}

/**
 * `builders.factsAt` for an ARBITRARY local date — needed for DST transition
 * days, which fall outside the August 2026 anchor week. Same shape and
 * conventions otherwise (site-zone wall minutes; 1440 = exclusive midnight
 * end; hand-checkable UTC correspondence documented per scenario).
 */
export function factsOnDate(
  date: string,
  startMinute: number,
  endMinute: number,
  overrides: Partial<BookingFacts> = {},
): BookingFacts {
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
