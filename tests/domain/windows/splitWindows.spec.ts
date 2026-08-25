/**
 * Weekly-window suite: split-day gap exclusivity, half-open boundaries,
 * total-week semantics, location ∩ service intersection, and the B4 midnight
 * regressions (audit CYCLE_32692407760_RULES finding B4 / acceptance
 * criterion 3).
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateRules,
  intersectWindowSets,
  normalizeWindows,
  windowsCover,
} from '../../../src/domain';
import {
  baseRuleSet,
  depsWith,
  factsAt,
  weeklyWindow,
} from '../helpers/builders';

describe('split daily windows', () => {
  const rules = baseRuleSet({
    serviceWindows: {
      'svc-1': [weeklyWindow('WED', 540, 720), weeklyWindow('WED', 840, 1080)],
    },
  });

  it('allows a slot inside the morning window and at the exact opening boundary', () => {
    expect(evaluateRules(factsAt('WED', 540, 600), rules, depsWith()).decision).toBe('allow');
    expect(evaluateRules(factsAt('WED', 660, 719), rules, depsWith()).decision).toBe('allow');
  });

  it('blocks the split gap 12:00–14:00 exclusively (half-open ends)', () => {
    // Window ends are exclusive: ending exactly at 12:00 is fine…
    expect(evaluateRules(factsAt('WED', 660, 720), rules, depsWith()).decision).toBe('allow');
    // …but starting at 12:00 (or anywhere in the gap) is outside.
    expect(evaluateRules(factsAt('WED', 720, 780), rules, depsWith()).decision).toBe('block');
    expect(evaluateRules(factsAt('WED', 750, 810), rules, depsWith()).decision).toBe('block');
  });

  it('blocks a slot straddling a window edge', () => {
    expect(evaluateRules(factsAt('WED', 690, 750), rules, depsWith()).decision).toBe('block');
  });
});

describe('total-week schedule semantics', () => {
  it('treats an unconfigured weekday as closed once ANY weekly config exists', () => {
    const rules = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] },
    });
    expect(evaluateRules(factsAt('THU', 600, 660), rules, depsWith()).decision).toBe('block');
    expect(evaluateRules(factsAt('WED', 600, 660), rules, depsWith()).decision).toBe('allow');
  });

  it('stays unconstrained when nothing is configured anywhere (fresh-install posture)', () => {
    expect(evaluateRules(factsAt('SAT', 300, 360), baseRuleSet(), depsWith()).decision).toBe(
      'allow',
    );
  });
});

describe('location ∩ service intersection', () => {
  const rules = baseRuleSet({
    locationWindows: { 'loc-1': [weeklyWindow('WED', 540, 1020)] }, // 09:00–17:00
    serviceWindows: { 'svc-1': [weeklyWindow('WED', 600, 1080)] }, // 10:00–18:00
  });

  it('allows only the intersection 10:00–17:00 — never the union', () => {
    expect(evaluateRules(factsAt('WED', 600, 660), rules, depsWith()).decision).toBe('allow');
    expect(evaluateRules(factsAt('WED', 900, 960), rules, depsWith()).decision).toBe('allow');
    expect(evaluateRules(factsAt('WED', 960, 1020), rules, depsWith()).decision).toBe('allow');

    // Location opens 09:00 but service starts 10:00 → no accidental expansion.
    expect(evaluateRules(factsAt('WED', 540, 600), rules, depsWith()).decision).toBe('block');
    // Service runs to 18:00 but location closes 17:00.
    expect(evaluateRules(factsAt('WED', 1020, 1080), rules, depsWith()).decision).toBe('block');
    expect(evaluateRules(factsAt('WED', 930, 1050), rules, depsWith()).decision).toBe('block');
  });

  it('applies a single source alone when the other tier has no windows', () => {
    const locOnly = baseRuleSet({
      locationWindows: { 'loc-1': [weeklyWindow('WED', 540, 600)] },
    });
    expect(evaluateRules(factsAt('WED', 540, 600), locOnly, depsWith()).decision).toBe('allow');
    expect(evaluateRules(factsAt('WED', 600, 660), locOnly, depsWith()).decision).toBe('block');
  });
});

describe('B4 regressions — slots ending exactly at local midnight', () => {
  const rules = baseRuleSet({
    locationWindows: { 'loc-1': [weeklyWindow('WED', 0, 1440)] }, // open all day Wednesday
  });

  it('ALLOWS 23:30–24:00 under a [0,1440) window (end lands on next-day 00:00)', () => {
    // B4 REPAIR regression: end instant == next-day local midnight must fit as
    // exclusive minute 1440 of WEDNESDAY, not minute 0 of THURSDAY.
    // 23:30 EDT Wed == 2026-08-13T03:30Z; 00:00 EDT Thu == 2026-08-13T04:00Z.
    const outcome = evaluateRules(
      factsAt('WED', 1410, 1440),
      rules,
      depsWith(),
    );
    expect(outcome.decision).toBe('allow');
    expect(factsAt('WED', 1410, 1440).slotEnd).toBe('2026-08-13T04:00:00.000Z');
  });

  it('BLOCKS 23:30–00:30 as overnight_slot (genuine span past midnight)', () => {
    // Companion regression: ending AFTER midnight stays blocked. Only the
    // discriminator differs from the ALLOW case above (the slot's end).
    const outcome = evaluateRules(
      factsAt('WED', 1410, 1439, {
        slotEnd: '2026-08-13T04:30:00.000Z', // 00:30 EDT Thursday
      }),
      rules,
      depsWith(),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations).toEqual([
      {
        decision: 'block',
        ruleId: 'weekly-windows',
        code: 'OUTSIDE_BOOKING_HOURS',
        customerMessage: expect.any(String),
      },
    ]);
    expect(outcome.explanations[0]?.customerMessage).toContain('closing time');
  });

  it('still blocks a midnight-ending slot when no window reaches 24:00', () => {
    const shortHours = baseRuleSet({
      locationWindows: { 'loc-1': [weeklyWindow('WED', 540, 1080)] },
    });
    expect(evaluateRules(factsAt('WED', 1410, 1440), shortHours, depsWith()).decision).toBe(
      'block',
    );
  });
});

describe('window interval algebra primitives', () => {
  it('normalizeWindows merges overlapping and touching windows (union)', () => {
    expect(
      normalizeWindows([
        { startMinute: 840, endMinute: 900 },
        { startMinute: 540, endMinute: 720 },
        { startMinute: 720, endMinute: 780 },
        { startMinute: 30, endMinute: 10 }, // invalid dropped
      ]),
    ).toEqual([
      { startMinute: 540, endMinute: 780 },
      { startMinute: 840, endMinute: 900 },
    ]);
  });

  it('intersectWindowSets never expands beyond either set', () => {
    expect(
      intersectWindowSets(
        [{ startMinute: 540, endMinute: 720 }],
        [{ startMinute: 660, endMinute: 1080 }],
      ),
    ).toEqual([{ startMinute: 660, endMinute: 720 }]);
    expect(
      intersectWindowSets(
        [{ startMinute: 0, endMinute: 100 }],
        [{ startMinute: 200, endMinute: 300 }],
      ),
    ).toEqual([]);
  });

  it('windowsCover enforces full half-open containment by the union', () => {
    const split = [
      { startMinute: 540, endMinute: 720 },
      { startMinute: 840, endMinute: 1080 },
    ];
    expect(windowsCover(split, 540, 720)).toBe(true);
    expect(windowsCover(split, 840, 1080)).toBe(true);
    expect(windowsCover(split, 600, 900)).toBe(false); // spans the gap
    expect(windowsCover(split, 720, 721)).toBe(false);
    expect(windowsCover([], 540, 600)).toBe(false);
  });
});
