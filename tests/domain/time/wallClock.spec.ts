/**
 * Wall-clock resolution suite — REPAIRED per audit CYCLE_32692407760_RULES
 * B3 findings (4)+(5). Both old expectations violated Contract §4.7, which
 * mandates that spring-forward nonexistent local times ADVANCE TO THE NEXT
 * VALID LOCAL TIME (the transition instant) — not "requested + 60 minutes".
 * The implementation was already correct; the fixtures were wrong.
 */
import { describe, expect, it } from 'vitest';
import { instantForLocalWall, resolveSlot } from '../../../src/domain';
import { FakeClock } from '../helpers/fakeClock';

describe('instantForLocalWall — DST gap policy (Contract §4.7)', () => {
  it('advances a nonexistent 02:00 to the next valid local time 03:00 EDT (07:00Z)', () => {
    // US DST began 2026-03-08: 02:00 EST → 03:00 EDT at 07:00Z.
    expect(instantForLocalWall('America/New_York', '2026-03-08', 120)).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('B3(4): advances nonexistent 02:30 to the next valid local time 03:00 EDT (07:00Z)', () => {
    // B3 REPAIR — Contract §4.7: 02:30 does not exist on 2026-03-08 in
    // America/New_York; the next VALID local time is 03:00 EDT = 07:00Z.
    // The cycle-1 expectation (03:30 / 07:30Z) contradicted both §4.7 and the
    // sibling 02:00→03:00 case above; the implementation was already right.
    expect(instantForLocalWall('America/New_York', '2026-03-08', 150)).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('B3(5): Lord_Howe 02:05 on the 30-minute spring-forward advances to 02:30 LHDT (15:30Z)', () => {
    // B3 REPAIR — Contract §4.7: Australia/Lord_Howe shifts by THIRTY minutes
    // (02:00 LHST +10:30 → 02:30 LHDT +11:00) on 2026-10-04 (first Sunday of
    // October, transition at 2026-10-03T15:30Z). The next valid local time
    // after the nonexistent 02:05 is exactly 02:30 LHDT = 2026-10-03T15:30Z;
    // the cycle-1 expectation (02:35 / 15:35Z) was wrong.
    expect(instantForLocalWall('Australia/Lord_Howe', '2026-10-04', 125)).toBe(
      '2026-10-03T15:30:00.000Z',
    );
  });

  it('resolves fall-back ambiguous times to their FIRST occurrence (second not bookable)', () => {
    // Contract §4.7: on 2026-11-01 in America/New_York, 01:30 occurs twice
    // (01:30 EDT then 01:30 EST); the resolver must produce the first.
    expect(instantForLocalWall('America/New_York', '2026-11-01', 90)).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('resolves ordinary wall times exactly across zones', () => {
    expect(instantForLocalWall('America/New_York', '2026-08-12', 810)).toBe(
      '2026-08-12T17:30:00.000Z',
    );
    expect(instantForLocalWall('Australia/Sydney', '2026-06-10', 540)).toBe(
      '2026-06-09T23:00:00.000Z',
    ); // 09:00 AEST (+10) == previous day 23:00Z
    expect(instantForLocalWall('UTC', '2026-08-12', 0)).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('resolveSlot — site-zone slot decomposition', () => {
  it('decomposes a same-day slot into site-zone wall facts', () => {
    const resolved = resolveSlot(
      '2026-08-12T17:30:00.000Z',
      '2026-08-12T18:30:00.000Z',
      'America/New_York',
    );
    expect(resolved).toEqual({
      targetDate: '2026-08-12',
      endDate: '2026-08-12',
      startMinute: 810,
      endMinute: 870,
      crossesMidnight: false,
    });
  });

  it('B4: normalizes an end exactly at local midnight to exclusive minute 1440', () => {
    const resolved = resolveSlot(
      '2026-08-13T03:30:00.000Z', // 23:30 EDT Thursday Aug 12 (site-local)
      '2026-08-13T04:00:00.000Z', // 00:00 EDT Friday Aug 13 (site-local)
      'America/New_York',
    );
    expect(resolved.targetDate).toBe('2026-08-12');
    expect(resolved.endDate).toBe('2026-08-13');
    expect(resolved.startMinute).toBe(1410);
    expect(resolved.endMinute).toBe(1440); // NOT 0 — fits [x,1440] windows
    expect(resolved.crossesMidnight).toBe(false);
  });

  it('flags genuine overnight spans past midnight', () => {
    const resolved = resolveSlot(
      '2026-08-13T03:30:00.000Z', // 23:30 site-local
      '2026-08-13T04:30:00.000Z', // 00:30 NEXT day site-local
      'America/New_York',
    );
    expect(resolved.endMinute).toBe(30);
    expect(resolved.crossesMidnight).toBe(true);
  });

  it('rejects inverted or unparseable slots with RangeError', () => {
    expect(() =>
      resolveSlot('2026-08-12T18:00:00.000Z', '2026-08-12T17:00:00.000Z', 'America/New_York'),
    ).toThrow(RangeError);
    expect(() =>
      resolveSlot('not-an-instant', '2026-08-12T18:00:00.000Z', 'America/New_York'),
    ).toThrow(RangeError);
  });
});

describe('FakeClock port plumbing', () => {
  it('exposes the injected instant and zone without reading real time', () => {
    const clock = new FakeClock('2026-08-12T17:30:00.000Z', 'America/New_York');
    expect(clock.now()).toBe('2026-08-12T17:30:00.000Z');
    expect(clock.zone()).toBe('America/New_York');
  });
});
