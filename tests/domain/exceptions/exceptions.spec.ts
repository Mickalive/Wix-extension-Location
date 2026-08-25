/**
 * Exception suite: closures over weekly windows, auto-expiring bounded
 * overrides, CLOSED-beats-OVERRIDE precedence, same-tier override
 * intersection (audit §6 verified-good behaviors preserved through the B1–B4
 * repair rebuild).
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../../src/domain';
import {
  ANCHOR_DATES,
  baseRuleSet,
  depsWith,
  factsAt,
  weeklyWindow,
} from '../helpers/builders';

describe('closures', () => {
  const rules = baseRuleSet({
    serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] },
    exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.WED, kind: 'CLOSED' }],
  });

  it('a closure overrides the weekly schedule for its exact date', () => {
    const outcome = evaluateRules(factsAt('WED', 600, 660), rules, depsWith());
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DATE_CLOSED');
    expect(outcome.explanations[0]?.ruleId).toBe('exceptions');
  });

  it('bounded closures expire automatically around their date', () => {
    // Tuesday has no weekly windows configured for svc-1 → closed by week;
    // what matters here is WED closure does not leak into THU when hours exist.
    const withThu = baseRuleSet({
      serviceWindows: {
        'svc-1': [weeklyWindow('WED', 540, 1020), weeklyWindow('THU', 540, 1020)],
      },
      exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.WED, kind: 'CLOSED' }],
    });
    expect(evaluateRules(factsAt('THU', 600, 660), withThu, depsWith()).decision).toBe('allow');
  });
});

describe('overrides', () => {
  const rules = baseRuleSet({
    serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] }, // 09:00–17:00
    exceptions: [
      {
        exceptionId: 'exc-override',
        date: ANCHOR_DATES.WED,
        kind: 'OVERRIDE',
        windows: [weeklyWindow('WED', 600, 720)], // that day only: 10:00–12:00
      },
    ],
  });

  it('an override REPLACES the weekly windows on its date', () => {
    expect(evaluateRules(factsAt('WED', 600, 660), rules, depsWith()).decision).toBe('allow');
    // Inside weekly hours but outside the override → blocked.
    expect(evaluateRules(factsAt('WED', 540, 600), rules, depsWith()).decision).toBe('block');
    expect(evaluateRules(factsAt('WED', 840, 900), rules, depsWith()).decision).toBe('block');
  });

  it('a bounded override expires automatically the day after', () => {
    const withThu = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('THU', 540, 1020)] },
      exceptions: [
        {
          exceptionId: 'exc-override',
          date: ANCHOR_DATES.WED,
          kind: 'OVERRIDE',
          windows: [weeklyWindow('WED', 600, 720)],
        },
      ],
    });
    // Thursday keeps its normal weekly behavior — no override leakage.
    expect(evaluateRules(factsAt('THU', 960, 1020), withThu, depsWith()).decision).toBe('allow');
  });

  it('CLOSED beats OVERRIDE when both exist for the same date', () => {
    const both = baseRuleSet({
      exceptions: [
        {
          exceptionId: 'exc-override',
          date: ANCHOR_DATES.WED,
          kind: 'OVERRIDE',
          windows: [weeklyWindow('WED', 600, 720)],
        },
        { exceptionId: 'exc-closure', date: ANCHOR_DATES.WED, kind: 'CLOSED' },
      ],
    });
    const outcome = evaluateRules(factsAt('WED', 600, 660), both, depsWith());
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DATE_CLOSED');
  });

  it('same-tier overrides INTERSECT (never expand)', () => {
    const two = baseRuleSet({
      exceptions: [
        {
          exceptionId: 'exc-a',
          date: ANCHOR_DATES.WED,
          kind: 'OVERRIDE',
          windows: [weeklyWindow('WED', 540, 780)], // 09:00–13:00
        },
        {
          exceptionId: 'exc-b',
          date: ANCHOR_DATES.WED,
          kind: 'OVERRIDE',
          windows: [weeklyWindow('WED', 660, 900)], // 11:00–15:00
        },
      ],
    });
    expect(evaluateRules(factsAt('WED', 660, 720), two, depsWith()).decision).toBe('allow'); // inside 11–13
    expect(evaluateRules(factsAt('WED', 540, 660), two, depsWith()).decision).toBe('block');
    expect(evaluateRules(factsAt('WED', 780, 840), two, depsWith()).decision).toBe('block');
  });

  it('an override applies even without any weekly configuration; other days stay open', () => {
    const only = baseRuleSet({
      exceptions: [
        {
          exceptionId: 'exc-a',
          date: ANCHOR_DATES.WED,
          kind: 'OVERRIDE',
          windows: [weeklyWindow('WED', 600, 660)],
        },
      ],
    });
    expect(evaluateRules(factsAt('WED', 600, 660), only, depsWith()).decision).toBe('allow');
    expect(evaluateRules(factsAt('WED', 660, 720), only, depsWith()).decision).toBe('block');
    // No weekly config and no exception on Saturday → unconstrained.
    expect(evaluateRules(factsAt('SAT', 300, 360), only, depsWith()).decision).toBe('allow');
  });
});
