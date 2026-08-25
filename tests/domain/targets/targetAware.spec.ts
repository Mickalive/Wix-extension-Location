/**
 * Target-aware evaluation semantics (RULES-C4-1).
 *
 * Source of mandate:
 *  - reports/audits/CYCLE_32792897988_INTEGRATION.md §4–5 Observation A
 *    (both adversarial probes reproduced by the independent auditor);
 *  - docs/WIX_TECHNICAL_CONTRACT.md §5.3 (per-target validation semantics:
 *    CREATE/CANCEL fail-closed, RESCHEDULE fail-open; all six targets exist
 *    and are called);
 *  - docs/NEXT_CYCLE.json cycle-4 canonical_contracts_notice (strictly
 *    additive ports.ts evolution with a safe default).
 *
 * PART 1 — DEFAULT CONTRACT PIN. Every scenario in `describe` block 1
 * evaluates WITHOUT `targetContext`, i.e. through the safe default that must
 * reproduce pre-cycle-4 behavior BIT-FOR-BIT. Outcomes are pinned as exact
 * deep-equal objects (customerMessage strings included) so any drift in the
 * default path fails loudly. This file was executed GREEN against the
 * unmodified cycle-3 tree BEFORE the target-aware implementation landed —
 * that run is the empirical half of the "CREATE behavior unchanged"
 * acceptance criterion (the other half being the untouched pre-existing
 * suites, which never pass targetContext either).
 *
 * PART 2 — OBSERVATION-A REGRESSIONS + PER-TARGET MATRIX. Both audit probes,
 * their mandated controls, and the rule-family matrix behaviors documented in
 * src/domain/README.md ("Target-aware evaluation").
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../../src/domain';
import type { CountQuery, EvaluationDeps, RuleOutcome } from '../../../src/domain';
import {
  ANCHOR_DATES,
  baseRuleSet,
  degradedEntitlement,
  depsWith,
  existingBooking,
  factsAt,
  healthyEntitlement,
  weeklyWindow,
} from '../helpers/builders';

/** Attaches a target context to prepared deps without rebuilding them. */
function withTarget(deps: EvaluationDeps, targetContext: NonNullable<EvaluationDeps['targetContext']>): EvaluationDeps {
  return { ...deps, targetContext };
}

/** Counter fake that records every query it is asked (caps.spec.ts pattern). */
function recordingCounter(results: Array<number | null>): {
  deps: EvaluationDeps;
  queries: CountQuery[];
} {
  const queries: CountQuery[] = [];
  let call = 0;
  return {
    queries,
    deps: depsWith({
      countForQuery: (q) => {
        queries.push(q);
        const value = results[call];
        call += 1;
        return value === undefined ? 0 : value;
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// PART 1 — default contract pin (no targetContext anywhere in this block)
// ---------------------------------------------------------------------------

describe('default deps (no targetContext) reproduce pre-cycle-4 outcomes bit-for-bit', () => {
  interface PinnedScenario {
    name: string;
    facts: Parameters<typeof evaluateRules>[0];
    rules: Parameters<typeof evaluateRules>[1];
    deps: EvaluationDeps;
    expected: RuleOutcome;
  }

  const scenarios: PinnedScenario[] = [
    {
      name: 'happy allow',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] } }),
      deps: depsWith(),
      expected: {
        decision: 'allow',
        explanations: [
          {
            decision: 'allow',
            ruleId: 'ruleset',
            code: 'BOOKING_ALLOWED',
            customerMessage: 'This booking meets all active booking rules.',
          },
        ],
      },
    },
    {
      name: 'outside booking hours',
      facts: factsAt('WED', 1020, 1080),
      rules: baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 1020)] } }),
      deps: depsWith(),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'weekly-windows',
            code: 'OUTSIDE_BOOKING_HOURS',
            customerMessage: 'The selected time is outside opening hours. Please choose another time.',
          },
        ],
      },
    },
    {
      name: 'closed exception date',
      facts: factsAt('THU', 600, 660),
      rules: baseRuleSet({
        exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.THU, kind: 'CLOSED' }],
      }),
      deps: depsWith(),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'exceptions',
            code: 'DATE_CLOSED',
            customerMessage: 'This date is not open for booking.',
          },
        ],
      },
    },
    {
      name: 'quota exceeded at cap',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
      }),
      deps: depsWith({ countForQuery: () => 1 }),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'limits',
            code: 'QUOTA_EXCEEDED',
            customerMessage: 'This time is fully booked. Please choose another time.',
          },
        ],
      },
    },
    {
      name: 'duplicate same-service overlap',
      facts: factsAt('WED', 810, 870), // 17:30Z–18:30Z vs existing 17:00Z–18:00Z
      rules: baseRuleSet(),
      deps: depsWith({ existingBookings: () => [existingBooking()] }),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'duplicates',
            code: 'DUPLICATE_BOOKING',
            customerMessage: 'You already have a booking that overlaps this time.',
          },
        ],
      },
    },
    {
      name: 'identity-keyed cross-service conflict',
      facts: factsAt('WED', 810, 870, { identityKey: 'person-1' }),
      rules: baseRuleSet(),
      deps: depsWith({
        existingBookings: () => [
          existingBooking({
            serviceId: 'svc-2',
            startUtc: '2026-08-12T17:00:00.000Z',
            endUtc: '2026-08-12T18:00:00.000Z',
            identityKey: 'person-1',
          }),
        ],
      }),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'duplicates',
            code: 'IDENTITY_TIME_CONFLICT',
            customerMessage: 'This time overlaps another booking with the same details.',
          },
        ],
      },
    },
    {
      name: 'invalid slot classification',
      facts: factsAt('WED', 660, 600), // inverted interval
      rules: baseRuleSet(),
      deps: depsWith(),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'ruleset',
            code: 'INVALID_SLOT',
            customerMessage: 'The selected time is not a valid booking slot.',
          },
        ],
      },
    },
    {
      name: 'ruleset-invalid classification',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] }, // end before start
      }),
      deps: depsWith(),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'ruleset',
            code: 'RULESET_INVALID',
            customerMessage: 'Booking rules are temporarily unavailable. Please try again shortly.',
          },
        ],
      },
    },
    {
      name: 'degraded entitlement fail-open notice',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet(),
      deps: depsWith({ entitlement: degradedEntitlement() }),
      expected: {
        decision: 'allow',
        explanations: [
          {
            decision: 'allow',
            ruleId: 'entitlement',
            code: 'ENTITLEMENT_DEGRADED_FAIL_OPEN',
            customerMessage: 'Location coverage could not be verified and was allowed as a precaution.',
          },
        ],
      },
    },
    {
      name: 'uncovered location block',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet(),
      deps: depsWith({ entitlement: healthyEntitlement(['loc-other']) }),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'entitlement',
            code: 'LOCATION_NOT_COVERED',
            customerMessage: 'Online booking is not available for this location.',
          },
        ],
      },
    },
    {
      name: 'violation accumulation (windows + cap + duplicate)',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 600)] },
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
      }),
      deps: depsWith({
        countForQuery: () => 1,
        existingBookings: () => [
          existingBooking({
            startUtc: '2026-08-12T14:30:00.000Z',
            endUtc: '2026-08-12T15:30:00.000Z',
          }),
        ],
      }),
      expected: {
        decision: 'block',
        explanations: [
          {
            decision: 'block',
            ruleId: 'weekly-windows',
            code: 'OUTSIDE_BOOKING_HOURS',
            customerMessage: 'The selected time is outside opening hours. Please choose another time.',
          },
          {
            decision: 'block',
            ruleId: 'limits',
            code: 'QUOTA_EXCEEDED',
            customerMessage: 'This time is fully booked. Please choose another time.',
          },
          {
            decision: 'block',
            ruleId: 'duplicates',
            code: 'DUPLICATE_BOOKING',
            customerMessage: 'You already have a booking that overlaps this time.',
          },
        ],
      },
    },
    {
      name: 'count-unavailable fail-open notice',
      facts: factsAt('WED', 600, 660),
      rules: baseRuleSet({
        limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
      }),
      deps: depsWith({ countForQuery: () => null }),
      expected: {
        decision: 'allow',
        explanations: [
          {
            decision: 'allow',
            ruleId: 'limits',
            code: 'COUNT_UNAVAILABLE_FAIL_OPEN',
            customerMessage: 'Availability counting is temporarily unavailable; the limit check was skipped.',
          },
        ],
      },
    },
  ];

  it.each(scenarios.map((s) => [s.name, s] as const))('%s', (_name, s) => {
    expect(evaluateRules(s.facts, s.rules, s.deps)).toEqual(s.expected);
  });

  it('pins the exact scenario corpus size so pins cannot silently shrink', () => {
    expect(scenarios).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — Observation-A regressions and the per-target matrix
// ---------------------------------------------------------------------------

describe('Observation-A probe 1 — CANCEL of the only booking on an at-capacity day', () => {
  const atCapacityRules = baseRuleSet({
    limits: [
      { limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['CONFIRMED'] },
    ],
  });

  it('allows the cancellation even though the counter includes the booking being cancelled', () => {
    // The day cap counts exactly ONE booking: the one now being cancelled.
    // Cancelling frees capacity — the cap must not block its own release.
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      atCapacityRules,
      depsWith({
        countForQuery: () => 1, // includes the booking being cancelled
        existingBookings: () => [
          existingBooking({
            bookingId: 'bk-being-cancelled',
            startUtc: '2026-08-12T14:00:00.000Z',
            endUtc: '2026-08-12T15:00:00.000Z',
          }),
        ],
        targetContext: { target: 'CANCEL' },
      }),
    );
    expect(outcome.decision).toBe('allow');
    const codes = outcome.explanations.map((e) => e.code);
    expect(codes).not.toContain('QUOTA_EXCEEDED');
    expect(codes).not.toContain('DUPLICATE_BOOKING');
  });

  it('DEFECT BASELINE control: identical inputs without targetContext still block (audit reproduction)', () => {
    // Reproduces CYCLE_32792897988_INTEGRATION §4 probe 1 verbatim: uniform
    // evaluation lets the cap stage (and duplicates) block the cancellation.
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      atCapacityRules,
      depsWith({
        countForQuery: () => 1,
        existingBookings: () => [
          existingBooking({
            bookingId: 'bk-being-cancelled',
            startUtc: '2026-08-12T14:00:00.000Z',
            endUtc: '2026-08-12T15:00:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('block');
    const codes = outcome.explanations.map((e) => e.code);
    expect(codes).toContain('QUOTA_EXCEEDED');
    expect(codes).toContain('DUPLICATE_BOOKING');
  });

  it('issues ZERO count queries for CANCEL — the family is skipped, not merely satisfied', () => {
    const { deps, queries } = recordingCounter([1]);
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      atCapacityRules,
      withTarget(deps, { target: 'CANCEL' }),
    );
    expect(outcome.decision).toBe('allow');
    expect(queries).toHaveLength(0);
  });
});

describe('Observation-A probe 2 — RESCHEDULE overlapping the booker’s own still-existing booking', () => {
  // Proposed slot Wed 10:00–11:00 EDT == 14:00Z–15:00Z. The mover's own
  // current booking occupies 10:30–11:30 EDT (14:30Z–15:30Z) — genuinely
  // overlapping the proposal until Wix itself moves it.
  const ownBooking = existingBooking({
    bookingId: 'bk-own',
    startUtc: '2026-08-12T14:30:00.000Z',
    endUtc: '2026-08-12T15:30:00.000Z',
  });
  const thirdPartyOverlap = existingBooking({
    bookingId: 'bk-other',
    startUtc: '2026-08-12T14:30:00.000Z',
    endUtc: '2026-08-12T15:30:00.000Z',
  });

  it('does NOT flag DUPLICATE_BOOKING when only the subject booking overlaps', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [ownBooking],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(outcome.decision).toBe('allow');
    expect(outcome.explanations.map((e) => e.code)).not.toContain('DUPLICATE_BOOKING');
  });

  it('DOES flag DUPLICATE_BOOKING once a second conflicting booking exists (mandated clause)', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [ownBooking, thirdPartyOverlap],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DUPLICATE_BOOKING');
  });

  it('CONTROL: a genuine third-party overlap still blocks RESCHEDULE', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [thirdPartyOverlap],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DUPLICATE_BOOKING');
  });

  it('exclusion is conservative: an overlapping fact WITHOUT a bookingId is never excluded', () => {
    const unidentifiable = existingBooking({
      bookingId: undefined, // cannot prove it is the subject
      startUtc: '2026-08-12T14:30:00.000Z',
      endUtc: '2026-08-12T15:30:00.000Z',
    });
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [unidentifiable],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DUPLICATE_BOOKING');
  });

  it('a mismatched subject id excludes nothing (genuine overlap still blocks)', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [ownBooking],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-someone-else' },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DUPLICATE_BOOKING');
  });

  it('identity-keyed cross-service conflicts still fire on RESCHEDULE (own booking excluded)', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660, { identityKey: 'person-1' }),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          ownBooking, // excluded by id
          existingBooking({
            bookingId: 'bk-cross',
            serviceId: 'svc-2',
            startUtc: '2026-08-12T14:30:00.000Z',
            endUtc: '2026-08-12T15:30:00.000Z',
            identityKey: 'person-1',
          }),
        ],
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('IDENTITY_TIME_CONFLICT');
  });
});

describe('per-target matrix — CANCEL evaluates classification families ONLY', () => {
  it('ignores weekly windows that exclude the slot (control: CREATE blocks)', () => {
    const rules = baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 570)] } });
    const cancelOutcome = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(cancelOutcome.decision).toBe('allow');

    const createOutcome = evaluateRules(factsAt('WED', 600, 660), rules, depsWith());
    expect(createOutcome.decision).toBe('block');
    expect(createOutcome.explanations[0]?.code).toBe('OUTSIDE_BOOKING_HOURS');
  });

  it('ignores CLOSED exception dates (control: CREATE blocks)', () => {
    const rules = baseRuleSet({
      exceptions: [{ exceptionId: 'exc-holiday', date: ANCHOR_DATES.WED, kind: 'CLOSED' }],
    });
    const cancelOutcome = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(cancelOutcome.decision).toBe('allow');

    const createOutcome = evaluateRules(factsAt('WED', 600, 660), rules, depsWith());
    expect(createOutcome.decision).toBe('block');
    expect(createOutcome.explanations[0]?.code).toBe('DATE_CLOSED');
  });

  it('never blocks on entitlement coverage — not even an uncovered location (control: CREATE blocks)', () => {
    const entitlement = healthyEntitlement(['loc-other']); // loc-1 NOT covered
    const cancelOutcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ entitlement, targetContext: { target: 'CANCEL' } }),
    );
    expect(cancelOutcome).toEqual({
      decision: 'allow',
      explanations: [
        {
          decision: 'allow',
          ruleId: 'ruleset',
          code: 'BOOKING_ALLOWED',
          customerMessage: 'This booking meets all active booking rules.',
        },
      ],
    });

    const createOutcome = evaluateRules(factsAt('WED', 600, 660), baseRuleSet(), depsWith({ entitlement }));
    expect(createOutcome.decision).toBe('block');
    expect(createOutcome.explanations[0]?.code).toBe('LOCATION_NOT_COVERED');
  });

  it('emits no entitlement notice for CANCEL even under degraded billing signals', () => {
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      baseRuleSet(),
      depsWith({ entitlement: degradedEntitlement(), targetContext: { target: 'CANCEL' } }),
    );
    expect(outcome.decision).toBe('allow');
    expect(outcome.explanations.map((e) => e.code)).toEqual(['BOOKING_ALLOWED']);
  });

  it('keeps §5.3 fail-closed classification: invalid RuleSet still blocks CANCEL', () => {
    const invalid = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] },
    });
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      invalid,
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('RULESET_INVALID');
  });

  it('keeps §5.3 fail-closed classification: malformed slots still block CANCEL', () => {
    const outcome = evaluateRules(
      factsAt('WED', 660, 600),
      baseRuleSet(),
      depsWith({ targetContext: { target: 'CANCEL' } }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('INVALID_SLOT');
  });
});

describe('per-target matrix — RESCHEDULE evaluates availability against the PROPOSED slot', () => {
  it('blocks when caps are exceeded on the proposed day and allows one-under', () => {
    const rules = baseRuleSet({
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
    });

    const blocked = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({
        countForQuery: () => 1,
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(blocked.decision).toBe('block');
    expect(blocked.explanations[0]?.code).toBe('QUOTA_EXCEEDED');

    const allowed = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({
        countForQuery: () => 0,
        targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
      }),
    );
    expect(allowed.decision).toBe('allow');
  });

  it('bounds cap counts by the PROPOSED slot’s site-zone day (not any legacy slot)', () => {
    const rules = baseRuleSet({
      limits: [{ limitId: 'lim-day', dimension: 'DAY', maxCount: 4, includedStatuses: ['PENDING'] }],
    });
    const { deps, queries } = recordingCounter([0]);
    const outcome = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      withTarget(deps, { target: 'RESCHEDULE', subjectBookingId: 'bk-own' }),
    );
    expect(outcome.decision).toBe('allow');
    // Wednesday 2026-08-12 in New York (EDT, UTC−4): local midnight == 04:00Z.
    expect(queries[queries.length - 1]?.fromUtc).toBe('2026-08-12T04:00:00.000Z');
    expect(queries[queries.length - 1]?.toUtc).toBe('2026-08-13T04:00:00.000Z');
  });

  it('still requires the proposed slot to fit weekly windows (control: in-window allows)', () => {
    const rules = baseRuleSet({ serviceWindows: { 'svc-1': [weeklyWindow('WED', 540, 570)] } });

    const outside = evaluateRules(
      factsAt('WED', 600, 660),
      rules,
      depsWith({ targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' } }),
    );
    expect(outside.decision).toBe('block');
    expect(outside.explanations[0]?.code).toBe('OUTSIDE_BOOKING_HOURS');

    const inside = evaluateRules(
      factsAt('WED', 540, 570),
      rules,
      depsWith({ targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' } }),
    );
    expect(inside.decision).toBe('allow');
  });
});
