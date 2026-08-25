/**
 * Slot wall-clock resolution in the site IANA zone (Technical Contract §4.7).
 *
 * B1 REPAIR (audit CYCLE_32692407760_RULES): `isValidWindowStartMinute` is
 * imported from '../model/primitives' where it is actually exported. The
 * cycle-1 candidate pointed this import at './intlZone', which does not export
 * it (TS2305 + cascading TypeError at runtime).
 *
 * B4 REPAIR: an end instant landing EXACTLY on next-day local midnight
 * normalizes to endMinute 1440 so it can fit a configured window that ends at
 * the exclusive day boundary ([x, 1440]). Genuine overnight spans (end lands
 * after midnight, endDate !== targetDate) keep crossesMidnight=true and stay
 * blocked as overnight_slot by the evaluator.
 */

import {
  isValidWindowStartMinute,
  MINUTES_PER_DAY,
} from '../model/primitives';
import { localWallOf } from './intlZone';
import type { IanaZone, Instant, LocalDate } from '../../shared/types';

const INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

/**
 * Parses a strict ISO-8601 Zulu instant into epoch milliseconds.
 * The domain accepts Zulu only: platform adapters convert site-local input to
 * UTC before evaluation, keeping the core deterministic. Throws RangeError on
 * anything else.
 */
export function parseInstantMillis(value: string): number {
  if (typeof value !== 'string') {
    throw new RangeError('Instant must be a string');
  }
  const m = INSTANT_PATTERN.exec(value);
  if (!m) {
    throw new RangeError(`Invalid UTC instant: ${JSON.stringify(value)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  return Date.UTC(year, month - 1, day, hour, minute, second, millis);
}

export interface ResolvedSlot {
  /** Site-zone local date containing the slot START. */
  targetDate: LocalDate;
  /** Site-zone local date containing the slot END. */
  endDate: LocalDate;
  /** Minutes-of-day of the slot start in the site zone (0..1439). */
  startMinute: number;
  /**
   * Effective EXCLUSIVE end minute for window fitting (1..1440). Per the B4
   * repair, an end instant landing exactly on next-day local midnight yields
   * 1440 instead of 0 so it fits windows ending at the day boundary.
   */
  endMinute: number;
  /**
   * True when the slot genuinely spans past local midnight WITHOUT landing on
   * it (endDate !== targetDate and the end minute-of-day is not 00:00).
   * Such slots are never window-fittable in v1 and are blocked as
   * overnight_slot.
   */
  crossesMidnight: boolean;
}

/**
 * Resolves proposal slot instants into site-zone wall-clock facts for window
 * fitting. Throws RangeError for unparseable instants or end <= start; the
 * evaluator maps those to fail-closed INVALID_SLOT outcomes.
 */
export function resolveSlot(
  slotStart: Instant,
  slotEnd: Instant,
  timezone: IanaZone,
): ResolvedSlot {
  const startMs = parseInstantMillis(slotStart);
  const endMs = parseInstantMillis(slotEnd);
  if (!(endMs > startMs)) {
    throw new RangeError('Slot end must be strictly after slot start');
  }
  const startWall = localWallOf(timezone, startMs);
  const endWall = localWallOf(timezone, endMs);
  if (!isValidWindowStartMinute(startWall.minutesOfDay)) {
    // Post-condition guard on the Intl decomposition (defends against any
    // host quirk emitting hour "24").
    throw new RangeError('Resolved start minute out of range');
  }

  let endMinute = endWall.minutesOfDay;
  let crossesMidnight = false;
  if (endWall.date !== startWall.date) {
    if (endWall.minutesOfDay === 0) {
      // B4 REPAIR: end exactly at local midnight == minute 1440 of the target
      // day (exclusive), NOT minute 0 of the next day. Only this exact case
      // normalizes; any later next-day minute stays a genuine overnight span.
      endMinute = MINUTES_PER_DAY;
    } else {
      crossesMidnight = true;
    }
  }

  return {
    targetDate: startWall.date,
    endDate: endWall.date,
    startMinute: startWall.minutesOfDay,
    endMinute,
    crossesMidnight,
  };
}
