/**
 * Local-date decomposition suite — REPAIRED per audit
 * CYCLE_32692407760_RULES B3 finding (3). The old expectation asserted EST
 * (UTC−5) for an instant AFTER US DST began on 2026-03-08; per Contract §4.7
 * the IANA database is authoritative and New York is EDT (UTC−4) from
 * 2026-03-08 07:00Z. The implementation was already correct.
 */
import { describe, expect, it } from 'vitest';
import {
  assertValidLocalDate,
  dateOfInstant,
  localWallOf,
  minutesOfDayOfInstant,
  nextLocalDate,
  weekdayOfDate,
} from '../../../src/domain';

describe('localWallOf — site-zone decomposition (Contract §4.7)', () => {
  it('B3(3): 2026-03-09T02:30Z is 22:30 on March 8 in New York — EDT, not EST', () => {
    // B3 REPAIR — Contract §4.7: US DST began Sunday 2026-03-08 (02:00 EST →
    // 03:00 EDT at 07:00Z). At 2026-03-09T02:30:00Z New York is EDT (UTC−4),
    // so the wall clock is 22:30 on LOCAL date 2026-03-08 = minute 1350.
    // The cycle-1 expectation (21:30 / 1290 "EST") ignored the DST start.
    const wall = localWallOf('America/New_York', Date.UTC(2026, 2, 9, 2, 30, 0));
    expect(wall.date).toBe('2026-03-08');
    expect(wall.minutesOfDay).toBe(1350);
  });

  it('buckets days by the SITE zone, not UTC, across the spring-forward boundary', () => {
    // 06:59:59Z is still EST (01:59:59 local); 07:00:00Z jumps to 03:00 EDT.
    expect(dateOfInstant('America/New_York', Date.UTC(2026, 2, 8, 6, 59, 59))).toBe('2026-03-08');
    expect(minutesOfDayOfInstant('America/New_York', Date.UTC(2026, 2, 8, 6, 59, 59))).toBe(119);
    expect(dateOfInstant('America/New_York', Date.UTC(2026, 2, 8, 7, 0, 0))).toBe('2026-03-08');
    expect(minutesOfDayOfInstant('America/New_York', Date.UTC(2026, 2, 8, 7, 0, 0))).toBe(180);
  });

  it('keeps UTC date and site date distinct near midnight', () => {
    // The exact trap behind B3(3): a UTC instant can belong to the previous
    // site-local day. 2026-08-13T03:30Z is 23:30 on Aug 12 in New York.
    expect(dateOfInstant('America/New_York', Date.UTC(2026, 7, 13, 3, 30, 0))).toBe('2026-08-12');
    expect(minutesOfDayOfInstant('America/New_York', Date.UTC(2026, 7, 13, 3, 30, 0))).toBe(1410);
  });

  it('handles half-hour zones (Lord Howe +10:30/+11:00)', () => {
    const wall = localWallOf('Australia/Lord_Howe', Date.UTC(2026, 9, 3, 15, 30, 0));
    expect(wall.date).toBe('2026-10-04');
    expect(wall.minutesOfDay).toBe(150); // 02:30 LHDT (+11) after the shift
  });
});

describe('civil date primitives', () => {
  it('maps dates to weekdays without host-zone influence', () => {
    expect(weekdayOfDate('2026-08-12')).toBe('WED');
    expect(weekdayOfDate('2026-03-08')).toBe('SUN'); // US DST start date
    expect(weekdayOfDate('1970-01-01')).toBe('THU');
  });

  it('computes nextLocalDate across month and leap-year boundaries', () => {
    expect(nextLocalDate('2026-02-28')).toBe('2026-03-01'); // 2026 is not leap
    expect(nextLocalDate('2028-02-28')).toBe('2028-02-29'); // 2028 is leap
    expect(nextLocalDate('2026-12-31')).toBe('2027-01-01');
  });

  it('assertValidLocalDate rejects impossible or malformed dates', () => {
    expect(() => assertValidLocalDate('2026-02-30')).toThrow(RangeError);
    expect(() => assertValidLocalDate('2026-13-01')).toThrow(RangeError);
    expect(() => assertValidLocalDate('2026-1-1')).toThrow(RangeError);
    expect(() => assertValidLocalDate('20260812')).toThrow(RangeError);
    expect(assertValidLocalDate('2026-08-12')).toBe('2026-08-12');
  });

  it('throws a typed RangeError for non-IANA zones (fail-closed upstream)', () => {
    expect(() => localWallOf('Not/AZone', Date.UTC(2026, 7, 12))).toThrow(RangeError);
  });
});
