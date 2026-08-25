/**
 * IANA time-zone math built directly on the platform `Intl` database — the
 * single source of truth for zones per Technical Contract §4.7. All functions
 * are deterministic given their inputs: no host-local-zone behavior, no
 * clocks, no environment reads, no Wix SDK imports.
 *
 * DST policies implemented here (Contract §4.7):
 *  - Spring-forward nonexistent local times ADVANCE to the next valid local
 *    time (the transition instant itself).
 *  - Fall-back ambiguous times resolve to their FIRST occurrence; the second
 *    occurrence is never produced (it is not bookable).
 */

import {
  assertValidLocalDate,
  daysFromCivil,
  civilFromDays,
  formatCivilDate,
  MINUTES_PER_DAY,
} from '../model/primitives';
import type { IanaZone, Instant, LocalDate } from '../../shared/types';

interface ZoneWallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: IanaZone): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(zone);
  if (cached !== undefined) return cached;
  // Throws RangeError for a non-IANA zone — documented, typed upstream as an
  // evaluation failure by evaluate.ts (fail-closed).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partsFormatterCache.set(zone, fmt);
  return fmt;
}

function zoneWallParts(zone: IanaZone, utcMs: number): ZoneWallParts {
  // formatToParts accepts epoch milliseconds directly — no host-zone Date
  // object is ever constructed inside the pure domain.
  const raw = formatterFor(zone).formatToParts(utcMs);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = raw.find((p) => p.type === type);
    if (!part) throw new RangeError(`Intl format missing part '${type}' for zone ${zone}`);
    return part.value;
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

/**
 * Offset of `zone` from UTC in milliseconds at instant `utcMs`
 * (positive east of UTC). Sub-second precision is truncated.
 */
export function zoneOffsetMillis(zone: IanaZone, utcMs: number): number {
  const p = zoneWallParts(zone, utcMs);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

export interface LocalWall {
  date: LocalDate;
  minutesOfDay: number;
}

/** Site-zone wall clock (date + minutes-of-day) for an instant. */
export function localWallOf(zone: IanaZone, utcMs: number): LocalWall {
  const p = zoneWallParts(zone, utcMs);
  return {
    date: formatCivilDate(p.year, p.month, p.day),
    minutesOfDay: p.hour * 60 + p.minute,
  };
}

/** Site-zone local date (YYYY-MM-DD) for an instant. */
export function dateOfInstant(zone: IanaZone, utcMs: number): LocalDate {
  return localWallOf(zone, utcMs).date;
}

/** Site-zone minutes-of-day (0..1439) for an instant. */
export function minutesOfDayOfInstant(zone: IanaZone, utcMs: number): number {
  return localWallOf(zone, utcMs).minutesOfDay;
}

function absLocalMinutes(zone: IanaZone, utcMs: number): number {
  const wall = localWallOf(zone, utcMs);
  const days = daysFromCivil(
    Number(wall.date.slice(0, 4)),
    Number(wall.date.slice(5, 7)),
    Number(wall.date.slice(8, 10)),
  );
  return days * MINUTES_PER_DAY + wall.minutesOfDay;
}

/** Epoch milliseconds → strict ISO-8601 Zulu string (whole seconds precision). */
export function epochMillisToInstant(ms: number): Instant {
  if (!Number.isFinite(ms)) throw new RangeError('Non-finite epoch millis');
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const secondsOfDay = totalSeconds - days * 86400;
  const c = civilFromDays(days);
  const hh = Math.floor(secondsOfDay / 3600);
  const mm = Math.floor((secondsOfDay % 3600) / 60);
  const ss = secondsOfDay % 60;
  const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return `${formatCivilDate(c.year, c.month, c.day)}T${pad(hh)}:${pad(mm)}:${pad(ss)}.000Z`;
}

/**
 * Earliest instant whose site-zone wall clock equals
 * (`date`, `minutesOfDay`), with Contract §4.7 DST semantics:
 *
 *  - existing local times resolve exactly;
 *  - spring-forward GAP times advance to the next valid local time — i.e. the
 *    transition instant itself (e.g. America/New_York 2026-03-08 02:30 →
 *    03:00 EDT = 07:00Z);
 *  - fall-back AMBIGUOUS times resolve to the first occurrence.
 *
 * Throws RangeError for invalid dates/zones or out-of-range minutes.
 */
export function instantForLocalWall(
  zone: IanaZone,
  date: LocalDate,
  minutesOfDay: number,
): Instant {
  assertValidLocalDate(date);
  if (!Number.isInteger(minutesOfDay) || minutesOfDay < 0 || minutesOfDay > MINUTES_PER_DAY - 1) {
    throw new RangeError(`Invalid minutes-of-day: ${minutesOfDay}`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const reqAbs = daysFromCivil(year, month, day) * MINUTES_PER_DAY + minutesOfDay;

  // First-order estimate: treat the guess (interpreted as-if-UTC) corrected by
  // the zone offset at that guess.
  const guessAsUtc = Date.UTC(year, month - 1, day, Math.floor(minutesOfDay / 60), minutesOfDay % 60);
  let t = guessAsUtc - zoneOffsetMillis(zone, guessAsUtc);

  // Iterate to a fixed point, bracketing any oscillation caused by a DST gap.
  let lo = Number.NEGATIVE_INFINITY; // largest seen instant with local < requested
  let hi = Number.POSITIVE_INFINITY; // smallest seen instant with local > requested
  for (let i = 0; i < 4; i += 1) {
    const abs = absLocalMinutes(zone, t);
    if (abs === reqAbs) return epochMillisToInstant(t);
    if (abs < reqAbs) {
      if (t > lo) lo = t;
      t += (reqAbs - abs) * 60000;
    } else {
      if (t < hi) hi = t;
      t -= (abs - reqAbs) * 60000;
    }
  }

  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    // Oscillation ⇒ the requested wall time does not exist (spring-forward
    // gap). Binary-search the transition: the smallest instant whose local
    // wall is >= the request IS the next valid local time (Contract §4.7).
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (absLocalMinutes(zone, mid) >= reqAbs) hi = mid;
      else lo = mid;
    }
    return epochMillisToInstant(hi);
  }

  // Defensive fallback (not reachable for real IANA zones with ≤2h shifts):
  // return the best-effort estimate rather than guessing wildly.
  return epochMillisToInstant(t);
}
