/**
 * Target-aware ENFORCEMENT wiring (INT-C5-1) — activates the cycle-4 domain
 * semantics at runtime through the REAL `createValidationHandlers` path.
 *
 * Source of mandate:
 *  - docs/NEXT_CYCLE.json cycle-5 lanes.integration (INT-C5-1) — the Director-
 *    coordinated follow-up reserved by the cycle-4 cross_lane_compatibility
 *    sequencing note;
 *  - reports/audits/CYCLE_32881643441_RULES.md §1–5 (accepted additive target
 *    context; consumers verified UNFORKED — i.e. dormant at runtime) and §6
 *    observation B (same-day self-count residual routed to the platform);
 *  - reports/audits/CYCLE_32792897988_INTEGRATION.md §4–5 observation A (the
 *    original adversarial probes);
 *  - docs/WIX_TECHNICAL_CONTRACT.md §5.3 (per-target validation semantics;
 *    omitted items default valid; fail-closed vs fail-open).
 *
 * DISCIPLINE (mirrors tests/domain/targets/targetAware.spec.ts): this file was
 * EXECUTED against the unmodified cycle-5-base tree BEFORE the handlers.ts
 * wiring landed:
 *  - PART 1 pins passed on the unmodified tree — they capture pre-change
 *    handler behavior byte-for-byte (CREATE-family byte-equality, the
 *    no-subject-facts RESCHEDULE residual, classification fail-closed paths)
 *    and must keep passing after the change;
 *  - PART 2 activations FAILED on the unmodified tree (CANCEL blocked on an
 *    at-capacity day; RESCHEDULE flagged the mover's own booking; self-count
 *    residual) — the executable proof of the dormant-semantics gap — and pass
 *    only once `deps.targetContext` is supplied on every `evaluateRules` call.
 *
 * C1 discipline: the subject-booking-facts seam is INJECTABLE and DEFAULTS to
 * unavailable. No product code reads any payload field that gate T-VP3/T-VP5
 * has not proven; tests inject facts directly, simulating what an
 * evidence-backed adapter would supply AFTER those gates pass.
 */
import { describe, expect, it } from 'vitest';
import type {
  BookingStatus,
  CountQuery,
  EvaluationDeps,
  ExistingBookingFact,
  RuleOutcome,
  RuleSet,
} from '../../src/domain';
import { evaluateRules } from '../../src/domain';
import type { SeededBooking } from '../../src/platform/adapters/fakes/bookingCountGateway';
import type {
  SubjectBookingFactsPort,
  ValidationHandlerResult,
} from '../../src/platform/validation-plugin';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
  ANCHOR_START,
  ANCHOR_END,
  OUTSIDE_START,
  OUTSIDE_END,
  SITE_ZONE,
} from './helpers/validationPluginRig';

// ---------------------------------------------------------------- fixtures

/** Exact allow outcome pinned by the accepted domain contract (cycle-4 Part 1). */
const ALLOW_OUTCOME: RuleOutcome = {
  decision: 'allow',
  explanations: [
    {
      decision: 'allow',
      ruleId: 'ruleset',
      code: 'BOOKING_ALLOWED',
      customerMessage: 'This booking meets all active booking rules.',
    },
  ],
};

function windowedRuleSet(): RuleSet {
  return openRuleSet({
    locationWindows: { 'loc-1': [{ weekday: 'WED', start: '13:00', end: '17:00' }] },
  });
}

function invalidRuleSet(): RuleSet {
  // Fails validateRuleSet (end before start) ⇒ fail-closed RULESET_INVALID.
  return openRuleSet({
    serviceWindows: { 'svc-1': [{ weekday: 'WED', start: '13:33', end: '13:00' }] },
  });
}

function capRuleSet(
  dimension: 'DAY' | 'SERVICE' | 'LOCATION',
  targetId: string | undefined,
  maxCount: number,
  statuses: BookingStatus[],
): RuleSet {
  return openRuleSet({
    limits: [
      {
        limitId: 'lim-under-test',
        dimension,
        ...(dimension === 'DAY' ? {} : { targetId }),
        maxCount,
        includedStatuses: [...statuses],
      } as NonNullable<RuleSet['limits'][number]>,
    ],
  });
}

function existingFact(
  bookingId: string,
  startUtc: string,
  endUtc: string,
  overrides: Partial<ExistingBookingFact> = {},
): ExistingBookingFact {
  return {
    bookingId,
    serviceId: 'svc-1',
    locationId: 'loc-1',
    startUtc,
    endUtc,
    status: 'CONFIRMED',
    identityKey: null,
    ...overrides,
  };
}

function seeded(
  bookingId: string,
  status: BookingStatus,
  startUtc: string,
  overrides: Partial<SeededBooking> = {},
): SeededBooking {
  return {
    bookingId,
    serviceId: 'svc-1',
    locationId: 'loc-1',
    startUtc,
    status,
    ...overrides,
  };
}

/** Evidence-stub seam: simulates what a T-VP3-proven adapter would supply. */
const subjectIs = (bookingId: string): SubjectBookingFactsPort => () => ({ bookingId });

/** Direct pure-domain reference evaluation with NO target context (pre-cycle-4 semantics). */
function directLegacyOutcome(
  facts: Parameters<typeof evaluateRules>[0],
  rules: RuleSet,
  depsOverrides: Partial<EvaluationDeps> = {},
): RuleOutcome {
  const deps: EvaluationDeps = {
    entitlement: { allowedLocationIds: ['loc-1'], overLimit: false, degraded: false, warning: null },
    countForQuery: () => 0,
    existingBookings: () => [],
    ...depsOverrides,
  };
  return evaluateRules(facts, rules, deps);
}

function legacyFacts(start: string, end: string) {
  return {
    at: start,
    serviceId: 'svc-1',
    locationId: 'loc-1',
    slotStart: start,
    slotEnd: end,
    timezone: SITE_ZONE,
    identityKey: null,
  };
}

async function firstItem(handler: Promise<ValidationHandlerResult>) {
  const result = await handler;
  expect(result.results).toHaveLength(1);
  return { result, item: result.results[0]! };
}

// ---------------------------------------------------------------------------
// PART 1 — pins that MUST hold on the unmodified tree AND after the wiring
// ---------------------------------------------------------------------------

describe('PART 1 — CREATE-family outcomes are byte-identical through the real handlers', () => {
  it('happy allow pins the exact outcome object (deep equality)', async () => {
    const rig = makeRig(); // default-open RuleSet, healthy entitlement, no duplicates
    const { result, item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(result.target).toBe('CREATE');
    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(result.degradations).toEqual([]);
    expect(item.index).toBe(0);
    expect(item.valid).toBe(true);
    expect(item.disposition).toBe('RULES_EVALUATED');
    expect(item.invalidReason).toBeNull();
    expect(item.outcome).toEqual(ALLOW_OUTCOME);
    // Byte-equality against the direct legacy (context-free) domain call.
    expect(item.outcome).toEqual(directLegacyOutcome(legacyFacts(ANCHOR_START, ANCHOR_END), openRuleSet()));
  });

  it('outside-hours block pins the exact outcome, typed code and customer message', async () => {
    const rules = windowedRuleSet();
    const rig = makeRig({ ruleSet: rules });
    const { item } = await firstItem(
      rig.handlers.CREATE(rawRequest([rawItem({ start: OUTSIDE_START, end: OUTSIDE_END })])),
    );

    expect(item.valid).toBe(false);
    expect(item.disposition).toBe('RULES_EVALUATED');
    expect(item.invalidReason).toEqual({
      code: 'OUTSIDE_BOOKING_HOURS',
      message: 'The selected time is outside opening hours. Please choose another time.',
    });
    expect(item.outcome).toEqual({
      decision: 'block',
      explanations: [
        {
          decision: 'block',
          ruleId: 'weekly-windows',
          code: 'OUTSIDE_BOOKING_HOURS',
          customerMessage: 'The selected time is outside opening hours. Please choose another time.',
        },
      ],
    });
    expect(item.outcome).toEqual(
      directLegacyOutcome(legacyFacts(OUTSIDE_START, OUTSIDE_END), rules),
    );
  });

  it('quota-exceeded block pins the exact outcome (cap machinery intact)', async () => {
    const rules = capRuleSet('DAY', undefined, 1, ['PENDING']);
    const rig = makeRig({
      ruleSet: rules,
      seededBookings: [seeded('b1', 'PENDING', ANCHOR_START)],
    });
    const { item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
    expect(item.outcome).toEqual({
      decision: 'block',
      explanations: [
        {
          decision: 'block',
          ruleId: 'limits',
          code: 'QUOTA_EXCEEDED',
          customerMessage: 'This time is fully booked. Please choose another time.',
        },
      ],
    });
  });

  it('duplicate block pins the exact outcome', async () => {
    const rig = makeRig({
      existingBookings: [existingFact('bk-ex', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z')],
    });
    const { item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    expect(item.outcome).toEqual({
      decision: 'block',
      explanations: [
        {
          decision: 'block',
          ruleId: 'duplicates',
          code: 'DUPLICATE_BOOKING',
          customerMessage: 'You already have a booking that overlaps this time.',
        },
      ],
    });
  });

  it('uncovered-location skip pins the explicit valid item verbatim', async () => {
    const rig = makeRig(); // healthyEntitlement covers only loc-1
    const { result, item } = await firstItem(
      rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-z' })])),
    );

    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(item).toEqual({
      index: 0,
      valid: true,
      outcome: null,
      disposition: 'UNCOVERED_LOCATION_RULES_SKIPPED',
      invalidReason: null,
    });
  });

  it('degraded entitlement pins the fail-open notice outcome plus surfaced degradation', async () => {
    const rig = makeRig({ entitlement: { allowedLocationIds: [], overLimit: false, degraded: true, warning: 'billing API unavailable — fail-open coverage' } });
    const { result, item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(item.valid).toBe(true);
    expect(item.outcome).toEqual({
      decision: 'allow',
      explanations: [
        {
          decision: 'allow',
          ruleId: 'entitlement',
          code: 'ENTITLEMENT_DEGRADED_FAIL_OPEN',
          customerMessage: 'Location coverage could not be verified and was allowed as a precaution.',
        },
      ],
    });
    expect(result.degradations.map((d) => d.kind)).toEqual(['ENTITLEMENT_DEGRADED']);
  });

  it('invalid-slot classification pins the exact fail-closed outcome', async () => {
    const rig = makeRig();
    const { item } = await firstItem(
      rig.handlers.CREATE(rawRequest([rawItem({ start: ANCHOR_END, end: ANCHOR_START })])),
    );

    expect(item.valid).toBe(false);
    expect(item.invalidReason).toEqual({
      code: 'INVALID_SLOT',
      message: 'The selected time is not a valid booking slot.',
    });
    expect(item.outcome).toEqual({
      decision: 'block',
      explanations: [
        {
          decision: 'block',
          ruleId: 'ruleset',
          code: 'INVALID_SLOT',
          customerMessage: 'The selected time is not a valid booking slot.',
        },
      ],
    });
  });

  it('ruleset-invalid classification pins the exact fail-closed outcome', async () => {
    const rig = makeRig({ ruleSet: invalidRuleSet() });
    const { item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('RULESET_INVALID');
    expect(item.outcome).toEqual({
      decision: 'block',
      explanations: [
        {
          decision: 'block',
          ruleId: 'ruleset',
          code: 'RULESET_INVALID',
          customerMessage: 'Booking rules are temporarily unavailable. Please try again shortly.',
        },
      ],
    });
  });
});

describe('PART 1 — RESCHEDULE residual without subject facts stays exactly today (documented degradation)', () => {
  // The mover's own still-existing booking overlaps the proposal until Wix
  // moves it. Without PROVABLE subject facts the exclusion is inert — this is
  // the disclosed residual (domain README residual 2), identical on both
  // trees. Activation happens ONLY behind injected facts (PART 2).
  const OWN = existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z');

  it('default deps: RESCHEDULE overlapping the own booking still blocks DUPLICATE_BOOKING', async () => {
    const rig = makeRig({ existingBookings: [OWN] });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));

    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    expect(item.outcome).toEqual(
      directLegacyOutcome(legacyFacts(ANCHOR_START, ANCHOR_END), openRuleSet(), {
        existingBookings: () => [OWN],
      }),
    );
  });

  it('an explicitly EMPTY seam result behaves exactly like no seam (never guesses)', async () => {
    const emptySeam: SubjectBookingFactsPort = () => ({});
    const rig = makeRig({ existingBookings: [OWN], subjectBookingFacts: emptySeam });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('an empty-string or non-string booking id is treated as unavailable', async () => {
    for (const junk of ['', 42, null] as unknown as string[]) {
      const rig = makeRig({ existingBookings: [OWN], subjectBookingFacts: () => ({ bookingId: junk }) });
      const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
      expect(item.valid).toBe(false);
      expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    }
  });

  it('a THROWING seam degrades visibly to unavailable and never alters the verdict', async () => {
    const rig = makeRig({
      existingBookings: [OWN],
      subjectBookingFacts: () => {
        throw new Error('subject facts adapter exploded');
      },
    });
    const { result, item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));

    // Verdict identical to the default-seam run above.
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(result.degradations.map((d) => d.kind)).toEqual(['SUBJECT_FACTS_FAILURE']);
    expect(result.degradations[0]?.detail).toContain('subject facts adapter exploded');
    expect(rig.sink.records.map((r) => r.kind)).toEqual(['SUBJECT_FACTS_FAILURE']);
  });
});

describe('PART 1 — CANCEL targets keep §5.3 fail-closed classification families', () => {
  it('invalid RuleSet still blocks CANCEL with RULESET_INVALID (claim stays ENFORCED)', async () => {
    const rig = makeRig({ ruleSet: invalidRuleSet() });
    const { result, item } = await firstItem(rig.handlers.CANCEL(rawRequest([rawItem()])));

    expect(result.enforcementClaim).toBe('ENFORCED'); // a rule outcome, not an internal failure
    expect(item.valid).toBe(false);
    expect(item.disposition).toBe('RULES_EVALUATED');
    expect(item.invalidReason?.code).toBe('RULESET_INVALID');
    expect(item.outcome?.decision).toBe('block');
  });

  it.each(['CANCEL', 'CANCEL_MULTI_SERVICE'] as const)(
    '%s still blocks malformed slots with INVALID_SLOT',
    async (target) => {
      const rig = makeRig();
      const { item } = await firstItem(
        rig.handlers[target](rawRequest([rawItem({ start: ANCHOR_END, end: ANCHOR_START })])),
      );
      expect(item.valid).toBe(false);
      expect(item.disposition).toBe('RULES_EVALUATED');
      expect(item.invalidReason?.code).toBe('INVALID_SLOT');
    },
  );

  it('internal evaluator corruption still classifies CANCEL fail-closed with EVALUATION_ERROR', async () => {
    // A RuleSet whose exceptions accessor throws escapes validateRuleSet and
    // lands in the evaluator's outer catch ⇒ EVALUATION_ERROR (fail-closed).
    const poisoned = openRuleSet();
    Object.defineProperty(poisoned, 'exceptions', {
      get() {
        throw new Error('exceptions store corrupted');
      },
      enumerable: true,
      configurable: true,
    });
    const rig = makeRig({
      configStoreOverride: {
        loadActiveRuleSet: async () => poisoned,
        saveRuleSet: async () => {
          throw new Error('not used in this fixture');
        },
      },
    });
    const { result, item } = await firstItem(rig.handlers.CANCEL(rawRequest([rawItem()])));

    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(item.valid).toBe(false);
    expect(item.disposition).toBe('RULES_EVALUATED');
    expect(item.invalidReason).toEqual({
      code: 'EVALUATION_ERROR',
      message: 'Booking could not be validated. Please try again shortly.',
    });
  });

  it('internal-failure semantics are unchanged under an injected seam (honest claims per §5.3)', async () => {
    const closed = makeRig({
      configStoreError: new Error('store down'),
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const cancelResult = await closed.handlers.CANCEL(rawRequest([rawItem()]));
    expect(cancelResult.enforcementClaim).toBe('FAIL_CLOSED_BLOCKED');
    expect(cancelResult.results[0]?.disposition).toBe('INTERNAL_FAILURE_FAIL_CLOSED');

    const open = makeRig({
      configStoreError: new Error('store down'),
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const rescheduleResult = await open.handlers.RESCHEDULE(rawRequest([rawItem()]));
    expect(rescheduleResult.enforcementClaim).toBe('FAIL_OPEN_NOT_ENFORCED');
    expect(rescheduleResult.results[0]?.valid).toBe(true);
    expect(rescheduleResult.results[0]?.disposition).toBe('INTERNAL_FAILURE_FAIL_OPEN');
  });
});

// ---------------------------------------------------------------------------
// PART 2 — activations: FAILED on the unmodified (dormant) tree, pass only
// once handlers.ts supplies deps.targetContext on EVERY evaluateRules call
// ---------------------------------------------------------------------------

describe('PART 2 — Observation-A probe 1 END-TO-END: CANCEL frees capacity', () => {
  const atCapacity = () => ({
    ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
    // Authoritative counter includes exactly the booking now being cancelled.
    seededBookings: [seeded('bk-being-cancelled', 'CONFIRMED', ANCHOR_START)],
    // The snapshot still contains it, overlapping its own vacated slot.
    existingBookings: [existingFact('bk-being-cancelled', ANCHOR_START, ANCHOR_END)],
  });

  it.each(['CANCEL', 'CANCEL_MULTI_SERVICE'] as const)(
    '%s of the only booking on an at-capacity day is ALLOWED with explicit per-item results',
    async (target) => {
      const rig = makeRig(atCapacity());
      const { result, item } = await firstItem(rig.handlers[target](rawRequest([rawItem()])));

      expect(result.target).toBe(target);
      expect(result.enforcementClaim).toBe('ENFORCED');
      expect(result.degradations).toEqual([]);
      expect(item).toEqual({
        index: 0,
        valid: true,
        outcome: ALLOW_OUTCOME,
        disposition: 'RULES_EVALUATED',
        invalidReason: null,
      });
      // The cap family was SKIPPED, not merely satisfied: the authoritative
      // count (1 ≥ maxCount 1) would have blocked any consumed lookup.
      expect(item.outcome?.explanations.map((e) => e.code)).not.toContain('QUOTA_EXCEEDED');
    },
  );

  it('DEFECT BASELINE control: identical inputs still block CREATE (cap machinery intact)', async () => {
    const rig = makeRig(atCapacity());
    const { item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));

    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('CANCEL ignores windows that exclude the slot (control: CREATE blocks)', async () => {
    const rig = makeRig({ ruleSet: windowedRuleSet() });
    const allowed = await firstItem(
      rig.handlers.CANCEL(rawRequest([rawItem({ start: OUTSIDE_START, end: OUTSIDE_END })])),
    );
    expect(allowed.item.valid).toBe(true);
    expect(allowed.item.outcome).toEqual(ALLOW_OUTCOME);

    const create = makeRig({ ruleSet: windowedRuleSet() });
    const blocked = await firstItem(
      create.handlers.CREATE(rawRequest([rawItem({ start: OUTSIDE_START, end: OUTSIDE_END })])),
    );
    expect(blocked.item.valid).toBe(false);
    expect(blocked.item.invalidReason?.code).toBe('OUTSIDE_BOOKING_HOURS');
  });
});

describe('PART 2 — Observation-A probe 2 END-TO-END: RESCHEDULE excludes the mover’s own booking', () => {
  // Proposed slot Wed 13:00–14:00 EDT (17:00–18:00Z). The mover's own current
  // booking occupies 13:30–14:30 EDT — genuinely overlapping the proposal
  // until Wix itself moves it.
  const OWN = existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z');
  const THIRD_PARTY = existingFact('bk-other', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z');

  it.each(['RESCHEDULE', 'RESCHEDULE_MULTI_SERVICE'] as const)(
    '%s WITH supplied subject id does NOT flag DUPLICATE_BOOKING against its own slot',
    async (target) => {
      const rig = makeRig({ existingBookings: [OWN], subjectBookingFacts: subjectIs('bk-own') });
      const { result, item } = await firstItem(rig.handlers[target](rawRequest([rawItem()])));

      expect(result.enforcementClaim).toBe('ENFORCED');
      expect(item.valid).toBe(true);
      expect(item.outcome).toEqual(ALLOW_OUTCOME);
      expect(item.outcome?.explanations.map((e) => e.code)).not.toContain('DUPLICATE_BOOKING');
    },
  );

  it('DOES block once a second conflicting booking exists (mandated clause)', async () => {
    const rig = makeRig({
      existingBookings: [OWN, THIRD_PARTY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('CONTROL: a genuine third-party overlap still blocks despite the subject exclusion', async () => {
    const rig = makeRig({
      existingBookings: [THIRD_PARTY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('CONTROL: a mismatched subject id excludes nothing', async () => {
    const rig = makeRig({ existingBookings: [OWN], subjectBookingFacts: subjectIs('bk-someone-else') });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('bulk RESCHEDULE applies the exclusion per item: own overlap passes, third-party blocks', async () => {
    // OWN occupies 17:30–18:30Z (overlapping item 0 ONLY); the third party
    // occupies 19:30–20:30Z (overlapping item 1 ONLY). One request proves the
    // exclusion is applied per item, not per request.
    const rig = makeRig({
      existingBookings: [
        OWN,
        existingFact('bk-other', '2026-08-12T19:30:00.000Z', '2026-08-12T20:30:00.000Z'),
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const result = await rig.handlers.RESCHEDULE(
      rawRequest([
        rawItem(), // overlaps ONLY the subject's own booking ⇒ allowed
        rawItem({ start: '2026-08-12T19:00:00.000Z', end: '2026-08-12T20:00:00.000Z' }),
      ]),
    );
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.valid).toBe(true);
    expect(result.results[1]?.valid).toBe(false);
    expect(result.results[1]?.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('the seam is never consulted for CREATE (no exclusion leaks into create semantics)', async () => {
    let consultations = 0;
    const spyingSeam: SubjectBookingFactsPort = () => {
      consultations += 1;
      return { bookingId: 'bk-own' };
    };
    const rig = makeRig({ existingBookings: [OWN], subjectBookingFacts: spyingSeam });
    const { item } = await firstItem(rig.handlers.CREATE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    expect(consultations).toBe(0);
  });
});

describe('PART 2 — Rules-audit observation B: same-day self-count adjustment behind PROVABLE subject facts', () => {
  // Proposed slot Wed 13:00–14:00 EDT buckets the site-zone day
  // [2026-08-12T04:00:00.000Z, 2026-08-13T04:00:00.000Z). The subject's OLD
  // slot (13:30–14:30 EDT) starts inside that bucket: an authoritative count
  // that includes the mover would block a same-day reschedule on an
  // at-capacity day even though total occupancy is unchanged.
  const OWN_SAME_DAY = existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z');

  it('subtracts the provable subject contribution: same-day reschedule onto an at-capacity day is ALLOWED', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-own', 'CONFIRMED', '2026-08-12T17:30:00.000Z')], // count = 1 = cap
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(true);
    expect(item.outcome).toEqual(ALLOW_OUTCOME);
  });

  it('DEGRADE-BASELINE: without subject facts the same day still blocks (exactly today)', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-own', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [OWN_SAME_DAY],
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('adjustment is exactly −1: a genuine additional booking still hits the cap', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [
        seeded('bk-own', 'CONFIRMED', '2026-08-12T17:30:00.000Z'),
        seeded('bk-other', 'CONFIRMED', '2026-08-12T17:30:00.000Z'),
      ], // count = 2 ⇒ adjusted 1 ≥ cap 1
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('status must be PROVABLY included: subject outside the declared status set is not subtracted', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['PENDING']),
      seededBookings: [seeded('bk-pending', 'PENDING', '2026-08-12T17:30:00.000Z')], // count = 1 = cap
      existingBookings: [
        existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z', { status: 'CONFIRMED' }),
      ],
      subjectBookingFacts: subjectIs('bk-own'), // CONFIRMED ∉ [PENDING] ⇒ unprovable
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('a subject fact WITHOUT a declared status can never prove contribution (never guesses)', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-other', 'CONFIRMED', '2026-08-12T17:30:00.000Z')], // count = 1 = cap
      existingBookings: [
        existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z', { status: undefined }),
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('SERVICE dimension: subtracts only when the subject provably sits in the queried service bucket', async () => {
    // Same-service move: the subject IS the counted booking ⇒ adjusted ⇒ allow.
    const sameService = makeRig({
      ruleSet: capRuleSet('SERVICE', 'svc-1', 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-own', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const allowed = await firstItem(sameService.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(allowed.item.valid).toBe(true);

    // Cross-service move: the svc-1 bucket cannot contain the svc-2 subject ⇒
    // no adjustment ⇒ the genuine svc-1 conflict still enforces the cap.
    const crossService = makeRig({
      ruleSet: capRuleSet('SERVICE', 'svc-1', 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-genuine', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [
        existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z', { serviceId: 'svc-2' }),
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const blocked = await firstItem(crossService.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(blocked.item.valid).toBe(false);
    expect(blocked.item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('LOCATION dimension: subtracts only when the subject provably sits in the queried location bucket', async () => {
    const sameLocation = makeRig({
      ruleSet: capRuleSet('LOCATION', 'loc-1', 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-own', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const allowed = await firstItem(sameLocation.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(allowed.item.valid).toBe(true);

    const crossLocation = makeRig({
      ruleSet: capRuleSet('LOCATION', 'loc-1', 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-genuine', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [
        existingFact('bk-own', '2026-08-12T17:30:00.000Z', '2026-08-12T18:30:00.000Z', { locationId: 'loc-2' }),
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const blocked = await firstItem(crossLocation.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(blocked.item.valid).toBe(false);
    expect(blocked.item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('start-bucket convention: a subject starting OUTSIDE the proposed day bucket is not subtracted', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-genuine', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [
        existingFact('bk-own', '2026-08-11T20:00:00.000Z', '2026-08-11T21:00:00.000Z'), // previous day
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('a subject fact with an unparseable start instant can never prove contribution', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-genuine', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [
        existingFact('bk-own', 'not-an-instant', 'also-not-an-instant'),
      ],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('a subject id ABSENT from the snapshot adjusts nothing (unprovable ⇒ degrade as today)', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-genuine', 'CONFIRMED', '2026-08-12T17:30:00.000Z')],
      existingBookings: [],
      subjectBookingFacts: subjectIs('bk-ghost'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(false);
    expect(item.invalidReason?.code).toBe('QUOTA_EXCEEDED');
  });

  it('a contradictory zero count is clamped at zero (never negative, never crashes)', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [], // authoritative count 0 while the snapshot claims contribution
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));
    expect(item.valid).toBe(true);
    expect(item.outcome).toEqual(ALLOW_OUTCOME);
  });

  it('failed count reads stay degraded: the adjustment never fabricates numbers over failures', async () => {
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      counterError: new Error('count gateway down'),
      existingBookings: [OWN_SAME_DAY],
      subjectBookingFacts: subjectIs('bk-own'),
    });
    const { result, item } = await firstItem(rig.handlers.RESCHEDULE(rawRequest([rawItem()])));

    expect(item.valid).toBe(true); // caps degrade fail-open per rule configuration
    expect(item.outcome?.explanations.map((e) => e.code)).toContain('COUNT_UNAVAILABLE_FAIL_OPEN');
    expect(result.degradations.map((d) => d.kind)).toContain('COUNT_GATEWAY_FAILURE');
  });

  it('CANCEL never consults nor consumes the adjustment (family skipped for cancellations)', async () => {
    let consultations = 0;
    const spyingSeam: SubjectBookingFactsPort = () => {
      consultations += 1;
      return { bookingId: 'bk-being-cancelled' };
    };
    const rig = makeRig({
      ruleSet: capRuleSet('DAY', undefined, 1, ['CONFIRMED']),
      seededBookings: [seeded('bk-being-cancelled', 'CONFIRMED', ANCHOR_START)],
      existingBookings: [existingFact('bk-being-cancelled', ANCHOR_START, ANCHOR_END)],
      subjectBookingFacts: spyingSeam,
    });
    const { item } = await firstItem(rig.handlers.CANCEL(rawRequest([rawItem()])));
    expect(item.valid).toBe(true);
    expect(item.outcome).toEqual(ALLOW_OUTCOME);
    expect(consultations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Guard: the canonical ports.ts contract is consumed UNFORKED — the handler
// result for a CREATE evaluation must remain deep-equal to a direct
// context-free evaluateRules call for every sampled scenario above (asserted
// inline), and the count-query PLAN must be untouched by the adjustment
// (prefetch planning remains purely mechanical).
// ---------------------------------------------------------------------------

describe('guard — prefetch planning is untouched by target awareness', () => {
  it('CANCEL prefetches the same planned queries as before (mechanical planning unchanged)', async () => {
    const rules = capRuleSet('DAY', undefined, 1, ['CONFIRMED']);
    const rig = makeRig({
      ruleSet: rules,
      seededBookings: [seeded('bk-being-cancelled', 'CONFIRMED', ANCHOR_START)],
      existingBookings: [existingFact('bk-being-cancelled', ANCHOR_START, ANCHOR_END)],
    });
    await rig.handlers.CANCEL(rawRequest([rawItem()]));
    // One planned DAY-cap query for the one evaluated item — identical to the
    // pre-change mechanical plan (only its CONSUMPTION became target-aware).
    expect(rig.countingGateway.calls).toBe(1);
    const query: CountQuery = rig.countingGateway.queries[0]!;
    expect(query.fromUtc).toBe('2026-08-12T04:00:00.000Z'); // Wed local midnight, EDT
    expect(query.toUtc).toBe('2026-08-13T04:00:00.000Z');
    expect(query.includedStatuses).toEqual(['CONFIRMED']);
  });
});
