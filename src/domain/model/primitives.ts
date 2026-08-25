/**
 * Pure primitive value helpers for the rules domain: local dates, wall-clock
 * minutes, weekday enumeration, reserved rule identifiers and window interval
 * algebra.
 *
 * Purity (Contract §8.1): stdlib-only and deterministic. No clocks, no
 * environment reads, no I/O, no Wix SDK imports. All date arithmetic uses the
 * proleptic Gregorian civil-day algorithms below so results never depend on
 * the host time zone.
 */

import type { LocalDate, Weekday } from '../../shared/types';

/** Minutes in one wall-clock day. 1440 is legal ONLY as an exclusive window end. */
export const MINUTES_PER_DAY = 1440;

/** Canonical weekday order used across the rules domain. */
export const WEEKDAYS: readonly Weekday[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const;

/**
 * Engine-owned rule identifiers that user-supplied configuration ids
 * (limitId / exceptionId) must never collide with, because explanations key
 * off ruleId and an id collision would make audit trails ambiguous.
 *
 * A3 repair (audit CYCLE_32692407760_RULES): validate.ts imports THIS constant
 * instead of hardcoding its own copy, eliminating drift risk.
 */
export const RESERVED_RULE_IDS = [
  'weekly-windows',
  'entitlement',
  'ruleset',
  'limits',
] as const;

export type ReservedRuleId = (typeof RESERVED_RULE_IDS)[number];

export function isReservedRuleId(value: string): boolean {
  return (RESERVED_RULE_IDS as readonly string[]).includes(value);
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/**
 * Days since 1970-01-01 for a proleptic-Gregorian civil date
 * (Howard Hinnant's `days_from_civil`). Deterministic, host-timezone-free.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const mp = (month + 9) % 12; // Mar=0 .. Feb=11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Inverse of {@link daysFromCivil} (Howard Hinnant's `civil_from_days`). */
export function civilFromDays(days: number): {
  year: number;
  month: number;
  day: number;
} {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) /
      365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? y + 1 : y, month, day };
}

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** Formats a civil date as YYYY-MM-DD without touching the host clock. */
export function formatCivilDate(year: number, month: number, day: number): LocalDate {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Type guard for strict `YYYY-MM-DD` local dates with a real calendar day. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through the civil algorithms rejects e.g. 2026-02-30.
  const back = civilFromDays(daysFromCivil(year, month, day));
  return back.year === year && back.month === month && back.day === day;
}

/** Throws RangeError when `value` is not a strict real-calendar YYYY-MM-DD. */
export function assertValidLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`Invalid local date: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Parses `HH:mm` into minutes-of-day. `24:00` parses to 1440 and is legal
 * only as an exclusive window END (enforced by {@link isValidMinuteWindow}).
 * Returns null for anything else.
 */
export function parseLocalTime(value: string): number | null {
  const m = LOCAL_TIME_PATTERN.exec(value);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (mm < 0 || mm > 59) return null;
  if (hh < 0 || hh > 24) return null;
  if (hh === 24 && mm !== 0) return null;
  return hh * 60 + mm;
}

/** Inverse of {@link parseLocalTime}; 1440 renders as the exclusive end "24:00". */
export function formatLocalTime(minutesOfDay: number): string {
  if (!Number.isInteger(minutesOfDay) || minutesOfDay < 0 || minutesOfDay > MINUTES_PER_DAY) {
    throw new RangeError(`Invalid minutes-of-day: ${minutesOfDay}`);
  }
  return `${pad2(Math.floor(minutesOfDay / 60))}:${pad2(minutesOfDay % 60)}`;
}

/** A start minute may be any whole minute of the day except the exclusive end sentinel. */
export function isValidWindowStartMinute(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MINUTES_PER_DAY - 1
  );
}

export interface MinuteWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * A window is valid when its start is a real wall minute, its end lies in
 * [1, 1440], and it has positive duration. 1440 ("24:00") is legal only as an
 * exclusive end.
 */
export function isValidMinuteWindow(window: MinuteWindow): boolean {
  return (
    isValidWindowStartMinute(window.startMinute) &&
    Number.isInteger(window.endMinute) &&
    window.endMinute >= 1 &&
    window.endMinute <= MINUTES_PER_DAY &&
    window.endMinute > window.startMinute
  );
}

/** Sorts by start and merges overlapping or touching windows (union semantics). */
export function normalizeWindows(
  windows: readonly MinuteWindow[],
): MinuteWindow[] {
  const valid = windows.filter(isValidMinuteWindow);
  const sorted = [...valid].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
  const merged: MinuteWindow[] = [];
  for (const w of sorted) {
    const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last !== undefined && w.startMinute <= last.endMinute) {
      if (w.endMinute > last.endMinute) {
        merged[merged.length - 1] = { startMinute: last.startMinute, endMinute: w.endMinute };
      }
      continue;
    }
    merged.push({ startMinute: w.startMinute, endMinute: w.endMinute });
  }
  return merged;
}

/**
 * Intersection of two normalized (sorted, disjoint) window sets. Used for the
 * location ∩ service weekly intersection and same-tier override intersection:
 * intersections must never accidentally expand availability.
 */
export function intersectWindowSets(
  a: readonly MinuteWindow[],
  b: readonly MinuteWindow[],
): MinuteWindow[] {
  const out: MinuteWindow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const wa = a[i];
    const wb = b[j];
    if (wa === undefined || wb === undefined) break;
    const start = Math.max(wa.startMinute, wb.startMinute);
    const end = Math.min(wa.endMinute, wb.endMinute);
    if (start < end) out.push({ startMinute: start, endMinute: end });
    if (wa.endMinute <= wb.endMinute) i += 1;
    else j += 1;
  }
  return out;
}

/**
 * True when the half-open minute interval [start, end) is fully covered by the
 * union of the (normalized) windows. An empty window set covers nothing.
 */
export function windowsCover(
  windows: readonly MinuteWindow[],
  start: number,
  end: number,
): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end > MINUTES_PER_DAY || start >= end) return false;
  let cursor = start;
  for (const w of windows) {
    if (w.endMinute <= cursor) continue;
    if (w.startMinute > cursor) return false;
    cursor = w.endMinute;
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

/** Weekday for a strict local date (host-timezone-free civil arithmetic). */
export function weekdayOfDate(date: LocalDate): Weekday {
  assertValidLocalDate(date);
  const days = daysFromCivil(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  );
  // 1970-01-01 was a Thursday.
  const idx = ((days % 7) + 7) % 7;
  const byEpochDay: readonly Weekday[] = ['THU', 'FRI', 'SAT', 'SUN', 'MON', 'TUE', 'WED'];
  const weekday = byEpochDay[idx];
  if (weekday === undefined) {
    throw new RangeError(`Unresolvable weekday for ${date}`);
  }
  return weekday;
}

/** The calendar day after `date`. */
export function nextLocalDate(date: LocalDate): LocalDate {
  assertValidLocalDate(date);
  const days = daysFromCivil(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8, 10)),
  );
  const next = civilFromDays(days + 1);
  return formatCivilDate(next.year, next.month, next.day);
}
