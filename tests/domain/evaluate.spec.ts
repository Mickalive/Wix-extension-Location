/**
 * Evaluator orchestration suite.
 *
 * B2 REPAIR (audit CYCLE_32692407760_RULES): this file sits directly under
 * tests/domain/, so its import specifiers are depth-2 ('../../src/domain' and
 * './helpers/*'). The cycle-1 candidate used depth-3 specifiers that resolved
 * ABOVE the repo root, leaving the suite unloadable.
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_RULE_IDS,
  OUTCOME_CODES,
  evaluateRules,
} from '../../src/domain';
import type {
  BookingFacts,
  EvaluationDeps,
  EvaluationTarget,
  RuleOutcome,
  RuleSet,
} from '../../src/domain';
import {
  ANCHOR_DATES,
  baseRuleSet,
  degradedEntitlement,
  depsWith,
  existingBooking,
  factsAt,
  healthyEntitlement,
  weeklyWindow,
} from './helpers/builders';
import {
  ALL_TARGETS,
  FALL_BACK_DATE,
  SPRING_FORWARD_DATE,
  factsOnDate,
} from './helpers/targetScenarios';

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

  // -------------------------------------------------------------------------
  // RULES-C5-1 (b): the SAME completeness invariant sweeps the WHOLE target
  // matrix. Every outcome under ANY explicit CREATE/CANCEL/RESCHEDULE context
  // carries full {ruleId, code, customerMessage} explanations; customer text
  // is jargon-free (no internal identifiers, no machine codes, real prose).
  // Blueprint §6: "explanation completeness (every decision explains itself)"
  // is a standing property — it must cover the matrix it guards.
  // -------------------------------------------------------------------------
  const MATRIX_RULE_IDS: readonly string[] = Object.values(ENGINE_RULE_IDS);
  const MACHINE_CODES: readonly string[] = Object.values(OUTCOME_CODES);
  /** Fixture identifiers that must never leak into customer-facing text. */
  const INTERNAL_ID_SUBSTRINGS = [
    'svc-', 'loc-', 'lim-', 'exc-', 'bk-', 'ruleset-', 'person-', 'rev-',
  ];

  interface MatrixScenario {
    name: string;
    rules?: RuleSet; // defaults to the shared all-families rule set below
    facts: BookingFacts;
    deps: EvaluationDeps;
  }

  // One rich rule set exercising every availability family at once:
  // location ∩ service intersection yields split windows 09:00–12:00 +
  // 14:00–17:00 on Wednesday; Thursday is CLOSED by exception.
  const allFamiliesRules = baseRuleSet({
    locationWindows: { 'loc-1': [weeklyWindow('WED', 540, 1020)] },
    serviceWindows: {
      'svc-1': [weeklyWindow('WED', 540, 720), weeklyWindow('WED', 840, 1020)],
    },
    exceptions: [{ exceptionId: 'exc-x', date: ANCHOR_DATES.THU, kind: 'CLOSED' }],
    limits: [{ limitId: 'lim-d', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
  });
  // Sunday windows for the DST transition-day scenarios (07:00–23:00 local).
  const dstRules = baseRuleSet({
    serviceWindows: { 'svc-1': [weeklyWindow('SUN', 420, 1380)] },
  });

  const matrixScenarios: MatrixScenario[] = [
    { name: 'allow/am-window', facts: factsAt('WED', 600, 660), deps: depsWith() },
    { name: 'allow/pm-window', facts: factsAt('WED', 900, 960), deps: depsWith() },
    { name: 'block/split-gap', facts: factsAt('WED', 720, 780), deps: depsWith() },
    { name: 'block/before-open-half-open-edge', facts: factsAt('WED', 480, 540), deps: depsWith() },
    { name: 'block/closed-exception-date', facts: factsAt('THU', 600, 660), deps: depsWith() },
    {
      name: 'block/quota-at-cap',
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ countForQuery: () => 1 }),
    },
    {
      name: 'notice/count-unavailable',
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ countForQuery: () => null }),
    },
    {
      name: 'block/duplicate-same-service',
      facts: factsAt('WED', 810, 870),
      deps: depsWith({ existingBookings: () => [existingBooking()] }),
    },
    {
      name: 'block/identity-cross-service',
      facts: factsAt('WED', 810, 870, { identityKey: 'person-1' }),
      deps: depsWith({
        existingBookings: () => [
          existingBooking({ serviceId: 'svc-2', identityKey: 'person-1' }),
        ],
      }),
    },
    { name: 'classify/invalid-slot-inverted', facts: factsAt('WED', 660, 600), deps: depsWith() },
    {
      name: 'classify/missing-slots',
      facts: factsAt('WED', 600, 660, { slotStart: undefined }),
      deps: depsWith(),
    },
    {
      name: 'classify/invalid-ruleset',
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] }, // end before start
      }),
      facts: factsAt('WED', 600, 660),
      deps: depsWith(),
    },
    {
      name: 'block/uncovered-location',
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ entitlement: healthyEntitlement(['loc-other']) }),
    },
    {
      name: 'notice/degraded-entitlement',
      facts: factsAt('WED', 600, 660),
      deps: depsWith({ entitlement: degradedEntitlement() }),
    },
    {
      name: 'block/violation-accumulation',
      facts: factsAt('WED', 600, 660),
      deps: depsWith({
        countForQuery: () => 1,
        existingBookings: () => [
          existingBooking({
            startUtc: '2026-08-12T14:30:00.000Z',
            endUtc: '2026-08-12T15:30:00.000Z',
          }),
        ],
      }),
    },
    {
      // Spring-forward: start 01:30 EST (06:30Z) exists; end 04:00 EDT
      // (08:00Z); the slot spans the skipped hour yet resolves cleanly.
      name: 'dst/spring-forward-span-allowed',
      rules: dstRules,
      facts: factsOnDate(SPRING_FORWARD_DATE, 90, 240),
      deps: depsWith(),
    },
    {
      // Spring-forward GAP start: requested 02:30 does not exist and advances
      // to the transition instant 03:00 EDT (07:00Z); end 04:00 EDT (08:00Z).
      name: 'dst/spring-forward-gap-start-allowed',
      rules: dstRules,
      facts: factsOnDate(SPRING_FORWARD_DATE, 150, 240),
      deps: depsWith(),
    },
    {
      // Fall-back ambiguity: 01:00–01:30 resolve to their FIRST occurrence
      // (EDT, 05:00Z–05:30Z); end 02:00 EST (07:00Z) is unique.
      name: 'dst/fall-back-ambiguous-allowed',
      rules: baseRuleSet({
        serviceWindows: { 'svc-1': [weeklyWindow('SUN', 60, 1380)] },
      }),
      facts: factsOnDate(FALL_BACK_DATE, 60, 120),
      deps: depsWith(),
    },
    {
      // Same ambiguous fall-back morning against a NARROW window: blocked.
      name: 'dst/fall-back-blocked-outside-window',
      rules: dstRules,
      facts: factsOnDate(FALL_BACK_DATE, 60, 120),
      deps: depsWith(),
    },
  ];

  const matrixOutcomes: Array<{
    name: string;
    target: EvaluationTarget;
    outcome: RuleOutcome;
  }> = matrixScenarios.flatMap((scenario) =>
    ALL_TARGETS.map((target) => ({
      name: scenario.name,
      target,
      outcome: evaluateRules(scenario.facts, scenario.rules ?? allFamiliesRules, {
        ...scenario.deps,
        targetContext: { target },
      }),
    })),
  );

  it('matrix sweep: every outcome under ANY target carries complete, jargon-free explanations', () => {
    // Sanity: the sweep really covers the whole matrix.
    expect(matrixScenarios.length).toBeGreaterThanOrEqual(15);
    expect(matrixOutcomes).toHaveLength(matrixScenarios.length * ALL_TARGETS.length);
    for (const target of ALL_TARGETS) {
      expect(
        matrixOutcomes.some((o) => o.target === target && o.outcome.decision === 'block'),
        `expected blocking outcomes under ${target}`,
      ).toBe(true);
      expect(
        matrixOutcomes.some((o) => o.target === target && o.outcome.decision === 'allow'),
        `expected allowing outcomes under ${target}`,
      ).toBe(true);
    }
    // Non-vacuity: the invariant must be exercised by a real block population.
    const blockCount = matrixOutcomes.filter((o) => o.outcome.decision === 'block').length;
    expect(blockCount).toBeGreaterThanOrEqual(20);

    for (const { name, target, outcome } of matrixOutcomes) {
      expect(['allow', 'block'], `${name}/${target}`).toContain(outcome.decision);
      expect(outcome.explanations.length, `${name}/${target}`).toBeGreaterThan(0);
      for (const e of outcome.explanations) {
        const where = `${name}/${target} [${e.code}]`;
        expect(e.ruleId.length, where).toBeGreaterThan(0);
        expect(MATRIX_RULE_IDS, where).toContain(e.ruleId); // closed family vocabulary
        expect(e.code.length, where).toBeGreaterThan(0);
        expect(e.customerMessage.length, where).toBeGreaterThan(0);
        // Jargon-free customer text: prose sentences, never ids or codes.
        expect(e.customerMessage, where).toContain(' ');
        expect(e.customerMessage.endsWith('.'), where).toBe(true);
        for (const id of INTERNAL_ID_SUBSTRINGS) {
          expect(e.customerMessage, where).not.toContain(id);
        }
        for (const code of MACHINE_CODES) {
          expect(e.customerMessage, where).not.toContain(code);
        }
        expect(e.customerMessage, where).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
      }
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

  // -------------------------------------------------------------------------
  // RULES-C5-1 (a): the determinism property sweeps ALL THREE
  // EvaluationTargets. For every (scenario, target) pair, repeated
  // evaluations under an EXPLICIT target context produce byte-identical
  // outcomes. The corpus includes split-window scenarios and DST
  // spring-forward/fall-back fixtures so the guarantee covers the hardest
  // zone math in the matrix, not just default-dep CREATE inputs.
  // -------------------------------------------------------------------------
  it('target-matrix sweep: repeated evaluations under explicit CREATE/CANCEL/RESCHEDULE contexts are identical per scenario', () => {
    interface DeterminismScenario {
      name: string;
      rules: RuleSet;
      facts: BookingFacts;
      /** Fresh deps per evaluation — catches accidental closure state too. */
      depsFactory(): EvaluationDeps;
    }

    const ownBooking = {
      bookingId: 'bk-own',
      serviceId: 'svc-1',
      locationId: 'loc-1',
      startUtc: '2026-08-12T14:30:00.000Z', // 10:30–11:30 EDT, overlaps proposal
      endUtc: '2026-08-12T15:30:00.000Z',
      status: 'CONFIRMED' as const,
      identityKey: null,
    };
    const splitRules = baseRuleSet({
      serviceWindows: {
        'svc-1': [weeklyWindow('WED', 540, 720), weeklyWindow('WED', 840, 1020)],
      },
    });
    const dstWideRules = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('SUN', 60, 1380)] },
    });
    const dstNarrowRules = baseRuleSet({
      serviceWindows: { 'svc-1': [weeklyWindow('SUN', 420, 1380)] },
    });

    const corpus: DeterminismScenario[] = [
      {
        name: 'split/am-inside',
        rules: splitRules,
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith(),
      },
      {
        name: 'split/pm-inside',
        rules: splitRules,
        facts: factsAt('WED', 900, 960),
        depsFactory: () => depsWith(),
      },
      {
        name: 'split/gap-blocked',
        rules: splitRules,
        facts: factsAt('WED', 720, 780),
        depsFactory: () => depsWith(),
      },
      {
        name: 'split/boundary-start-allowed',
        rules: splitRules,
        facts: factsAt('WED', 540, 600),
        depsFactory: () => depsWith(),
      },
      {
        name: 'split/midnight-end-fits-window',
        rules: baseRuleSet({
          serviceWindows: { 'svc-1': [weeklyWindow('WED', 840, 1440)] },
        }),
        facts: factsAt('WED', 1410, 1440), // ends exactly at next-day midnight → minute 1440
        depsFactory: () => depsWith(),
      },
      {
        // Spring-forward span: 01:30 EST (06:30Z) → 04:00 EDT (08:00Z).
        name: 'dst/spring-forward-span',
        rules: dstWideRules,
        facts: factsOnDate(SPRING_FORWARD_DATE, 90, 240),
        depsFactory: () => depsWith(),
      },
      {
        // Gap start: requested 02:30 advances to 03:00 EDT (07:00Z).
        name: 'dst/spring-forward-gap-start',
        rules: dstWideRules,
        facts: factsOnDate(SPRING_FORWARD_DATE, 150, 240),
        depsFactory: () => depsWith(),
      },
      {
        // Fall-back ambiguity: first occurrence (EDT) wins; end 02:00 EST.
        name: 'dst/fall-back-ambiguous',
        rules: dstWideRules,
        facts: factsOnDate(FALL_BACK_DATE, 60, 120),
        depsFactory: () => depsWith(),
      },
      {
        name: 'dst/fall-back-outside-narrow-window',
        rules: dstNarrowRules,
        facts: factsOnDate(FALL_BACK_DATE, 60, 120),
        depsFactory: () => depsWith(),
      },
      {
        name: 'caps/at-cap-blocked',
        rules: baseRuleSet({
          limits: [{ limitId: 'lim-d', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING'] }],
        }),
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith({ countForQuery: () => 1 }),
      },
      {
        name: 'caps/count-unavailable-notice',
        rules: baseRuleSet({
          limits: [{ limitId: 'lim-d', dimension: 'DAY', maxCount: 2, includedStatuses: ['PENDING'] }],
        }),
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith({ countForQuery: () => null }),
      },
      {
        name: 'exceptions/closed-date',
        rules: baseRuleSet({
          exceptions: [{ exceptionId: 'exc-x', date: ANCHOR_DATES.THU, kind: 'CLOSED' }],
        }),
        facts: factsAt('THU', 600, 660),
        depsFactory: () => depsWith(),
      },
      {
        name: 'duplicates/overlap-blocked',
        rules: baseRuleSet(),
        facts: factsAt('WED', 810, 870),
        depsFactory: () => depsWith({ existingBookings: () => [existingBooking()] }),
      },
      {
        // Same deps under every target: CREATE blocks on the mover's own
        // booking, CANCEL allows, RESCHEDULE excludes the subject id.
        name: 'reschedule/self-overlap-subject-exclusion',
        rules: baseRuleSet(),
        facts: factsAt('WED', 600, 660),
        depsFactory: () =>
          depsWith({
            existingBookings: () => [ownBooking],
            targetContext: { target: 'RESCHEDULE', subjectBookingId: 'bk-own' },
          }),
      },
      {
        name: 'entitlement/uncovered-location',
        rules: baseRuleSet(),
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith({ entitlement: healthyEntitlement(['loc-other']) }),
      },
      {
        name: 'entitlement/degraded-notice',
        rules: baseRuleSet(),
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith({ entitlement: degradedEntitlement() }),
      },
      {
        name: 'classification/invalid-slot',
        rules: baseRuleSet(),
        facts: factsAt('WED', 660, 600),
        depsFactory: () => depsWith(),
      },
      {
        name: 'classification/invalid-ruleset',
        rules: baseRuleSet({
          serviceWindows: { 'svc-1': [weeklyWindow('WED', 800, 700)] },
        }),
        facts: factsAt('WED', 600, 660),
        depsFactory: () => depsWith(),
      },
    ];

    expect(corpus.length).toBeGreaterThanOrEqual(15); // corpus cannot silently shrink

    for (const target of ALL_TARGETS) {
      // Baseline pass with FRESHLY built deps per scenario.
      const baselines = corpus.map((scenario) => {
        const deps = scenario.depsFactory();
        deps.targetContext = { ...deps.targetContext, target };
        return JSON.stringify(evaluateRules(scenario.facts, scenario.rules, deps));
      });
      // Property: 100 further repetitions, deps rebuilt each time, must
      // reproduce the baseline byte-for-byte.
      for (let i = 0; i < 100; i += 1) {
        corpus.forEach((scenario, s) => {
          const deps = scenario.depsFactory();
          deps.targetContext = { ...deps.targetContext, target };
          const actual = JSON.stringify(evaluateRules(scenario.facts, scenario.rules, deps));
          expect(actual, `${scenario.name}/${target} repetition ${i}`).toBe(baselines[s]);
        });
      }
    }
  });
});
