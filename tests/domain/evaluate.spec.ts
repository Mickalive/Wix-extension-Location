/**
 * Evaluator orchestration suite.
 *
 * B2 REPAIR (audit CYCLE_32692407760_RULES): this file sits directly under
 * tests/domain/, so its import specifiers are depth-2 ('../../src/domain' and
 * './helpers/*'). The cycle-1 candidate used depth-3 specifiers that resolved
 * ABOVE the repo root, leaving the suite unloadable.
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../src/domain';
import type { RuleOutcome } from '../../src/domain';
import {
  baseRuleSet,
  degradedEntitlement,
  depsWith,
  existingBooking,
  factsAt,
  healthyEntitlement,
  weeklyWindow,
} from './helpers/builders';

describe('evaluateRules — happy path', () => {
  it('allows a compliant booking with an explicit allow explanation', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] },
      }),
      depsWith(),
    );
    expect(outcome).toEqual({
      decision: 'allow',
      explanations: [
        {
          decision: 'allow',
          ruleId: 'ruleset',
          code: 'BOOKING_ALLOWED',
          customerMessage: expect.any(String),
        },
      ],
    });
  });
});

describe('evaluateRules — fail-closed classification (never throws)', () => {
  it('blocks an invalid RuleSet with RULESET_INVALID', () => {
    const invalid = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] }, // end before start
    });
    const outcome = evaluateRules(factsAt('WED', 600, 660), invalid, depsWith());
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('RULESET_INVALID');
  });

  it('blocks malformed slots with INVALID_SLOT', () => {
    const cases = [
      factsAt('WED', 600, 660, { slotStart: undefined }),
      factsAt('WED', 600, 660, { slotEnd: undefined }),
      factsAt('WED', 600, 660, { slotStart: 'yesterday' }),
      factsAt('WED', 660, 600), // inverted interval
    ];
    for (const facts of cases) {
      const outcome = evaluateRules(facts, baseRuleSet(), depsWith());
      expect(outcome.decision).toBe('block');
      expect(outcome.explanations[0]?.code).toBe('INVALID_SLOT');
    }
  });

  it('blocks slots longer than 24h with INVALID_SLOT', () => {
    const outcome = evaluateRules(
      factsAt('MON', 0, 1440, { slotEnd: '2026-08-12T04:01:00.000Z' }), // >24h
      baseRuleSet(),
      depsWith(),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('INVALID_SLOT');
  });

  it('classifies unexpected internal failures as EVALUATION_ERROR without throwing', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => {
          throw new Error('snapshot store exploded');
        },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('EVALUATION_ERROR');
  });

  it('maps an invalid IANA zone to fail-closed INVALID_SLOT (malformed request)', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660, { timezone: 'Mars/Olympus' }),
      baseRuleSet(),
      depsWith(),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('INVALID_SLOT');
  });
});

describe('evaluateRules — entitlement coverage', () => {
  it('blocks locations outside the healthy allowance', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ entitlement: healthyEntitlement(['loc-other']) }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]).toMatchObject({
      ruleId: 'entitlement',
      code: 'LOCATION_NOT_COVERED',
    });
  });

  it('fails OPEN with a visible notice when billing signals are degraded', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ entitlement: degradedEntitlement() }),
    );
    expect(outcome.decision).toBe('allow');
    expect(outcome.explanations.map((e) => e.code)).toContain('ENTITLEMENT_DEGRADED_FAIL_OPEN');
  });

  it('never checks entitlement for proposals without a locationId (CUSTOM/CUSTOMER)', () => {
    // Contract §5.3: location.id arrives only for OWNER_BUSINESS locations;
    // customer-location bookings must not be blocked by coverage.
    const outcome = evaluateRules(
      factsAt('WED', 600, 660, { locationId: null }),
      baseRuleSet(),
      depsWith({ entitlement: healthyEntitlement([]) }), // empty allowance!
    );
    expect(outcome.decision).toBe('allow');
  });
});

describe('evaluateRules — violation accumulation', () => {
  it('reports EVERY violated rule in one outcome', () => {
    const rules = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 600)] }, // proposal at 10:00 is outside
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
    });
    const outcome = evaluateRules(
      factsAt('WED', 600, 660), // outside windows AND over the cap AND duplicate
      rules,
      depsWith({
        countForQuery: () => 1,
        existingBookings: () => [
          // Genuinely overlaps the proposal (10:00–11:00 EDT == 14:00Z–15:00Z).
          existingBooking({
            startUtc: '2026-08-12T14:30:00.000Z',
            endUtc: '2026-08-12T15:30:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('block');
    const codes = outcome.explanations.map((e) => e.code);
    expect(codes).toContain('OUTSIDE_BOOKING_HOURS');
    expect(codes).toContain('QUOTA_EXCEEDED');
    expect(codes).toContain('DUPLICATE_BOOKING');
  });
});

describe('explanation well-formedness', () => {
  const scenarios: Array<[string, RuleOutcome]> = (() => {
    const rules = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] },
      exceptions: [{ exceptionId: 'exc-x', date: '2026-08-13', kind: 'CLOSED' }],
      limits: [{ limitId: 'lim-d', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
    });
    return [
      ['allow', evaluateRules(factsAt('WED', 600, 660), rules, depsWith())],
      [
        'outside-hours',
        evaluateRules(factsAt('WED', 1020, 1080), rules, depsWith()),
      ],
      [
        'closed-date',
        evaluateRules(factsAt('THU', 600, 660), rules, depsWith()),
      ],
      [
        'duplicate',
        evaluateRules(factsAt('WED', 600, 660), rules, depsWith({ existingBookings: () => [existingBooking()] })),
      ],
      [
        'invalid-slot',
        evaluateRules(factsAt('WED', 600, 600), rules, depsWith()),
      ],
    ] as Array<[string, RuleOutcome]>;
  })();

  it.each(scenarios)('%s outcome explanations are well-formed and id-free', (_name, outcome) => {
    expect(['allow', 'block']).toContain(outcome.decision);
    expect(outcome.explanations.length).toBeGreaterThan(0);
    for (const e of outcome.explanations) {
      expect(e.ruleId.length).toBeGreaterThan(0);
      expect(e.code.length).toBeGreaterThan(0);
      expect(e.customerMessage.length).toBeGreaterThan(0);
      // No internal-id leakage into customer-facing text.
      expect(e.customerMessage).not.toContain('svc-1');
      expect(e.customerMessage).not.toContain('loc-1');
      expect(e.customerMessage).not.toContain('lim-d');
      expect(e.customerMessage).not.toContain('exc-x');
      expect(e.customerMessage).not.toContain('ruleset-1');
      expect(e.customerMessage).not.toContain('person-1');
    }
  });
});

describe('determinism property (Contract §8.1)', () => {
  it('100 repeated evaluations of each scenario produce identical outcomes', () => {
    const rules = baseRuleSet({
      locationWindows: { 'loc-1': [weeklyWindow('WED', 540, 1020)] },
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 600, 1080)] },
      exceptions: [{ exceptionId: 'exc-x', date: '2026-08-13', kind: 'CLOSED' }],
      limits: [{ limitId: 'lim-d', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
    });
    const inputs = [
      factsAt('WED', 600, 660),
      factsAt('THU', 600, 660), // closed exception day
      factsAt('WED', 1410, 1440), // midnight-end under partial window → blocked
      factsAt('FRI', 600, 660, { identityKey: 'person-1' }), // unconfigured weekday
    ];
    const baseline = inputs.map((facts) =>
      JSON.stringify(evaluateRules(facts, rules, depsWith({ countForQuery: () => 1 }))),
    );
    const pairs = inputs.map((facts, s) => ({ facts, expected: baseline[s] }));
    for (let i = 0; i < 100; i += 1) {
      for (const { facts, expected } of pairs) {
        expect(JSON.stringify(evaluateRules(facts, rules, depsWith({ countForQuery: () => 1 })))).toBe(
          expected,
        );
      }
    }
  });
});
