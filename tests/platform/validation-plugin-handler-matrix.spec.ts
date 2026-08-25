/**
 * Handler matrix for the validation-plugin enforcement path (INT-C3-1
 * acceptance criterion 2; Contract §5.3/Blueprint §5). Proves across ALL six
 * targets:
 *  - valid facts ⇒ the pure `evaluateRules` outcome is returned VERBATIM with
 *    its explanations (deep equality against a direct domain call);
 *  - internal error / deadline expiry on CREATE/CANCEL (+multi) ⇒ fail-CLOSED:
 *    explicit block-with-retry-hint per item, incident logged + surfaced;
 *  - internal error / deadline expiry on RESCHEDULE (+multi) ⇒ fail-OPEN:
 *    explicit pass-through plus an ENFORCEMENT_FAIL_OPEN degradation record;
 *    the result NEVER claims enforcement;
 *  - dependency degradations (duplicate-input read failure) are visible, never
 *    silent, and never fabricate blocks;
 *  - no active RuleSet ⇒ explicit valid results for every index.
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../src/domain';
import type { BookingFacts, EvaluationDeps, PolicyDecision, RuleSet } from '../../src/domain';
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
import { FAIL_CLOSED_CODE, FAIL_CLOSED_MESSAGE } from '../../src/platform/validation-plugin';

const ALL_TARGETS = [
  'CREATE',
  'CREATE_MULTI_SERVICE',
  'CANCEL',
  'CANCEL_MULTI_SERVICE',
  'RESCHEDULE',
  'RESCHEDULE_MULTI_SERVICE',
] as const;

const FAIL_CLOSED_TARGETS = ['CREATE', 'CREATE_MULTI_SERVICE', 'CANCEL', 'CANCEL_MULTI_SERVICE'] as const;
const FAIL_OPEN_TARGETS = ['RESCHEDULE', 'RESCHEDULE_MULTI_SERVICE'] as const;

function factsFor(start: string, end: string): BookingFacts {
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

/** Direct pure-domain reference evaluation with identical inputs. */
function directOutcome(facts: BookingFacts, rules: RuleSet, entitlement: PolicyDecision): ReturnType<typeof evaluateRules> {
  const deps: EvaluationDeps = {
    entitlement,
    countForQuery: () => 0,
    existingBookings: () => [],
  };
  return evaluateRules(facts, rules, deps);
}

describe('valid facts ⇒ verbatim pure-domain outcome (all six targets)', () => {
  it.each(ALL_TARGETS)('%s returns the allow outcome deep-equal to the direct domain call', async (target) => {
    const rig = makeRig(); // default-open RuleSet, healthy entitlement, no duplicates
    const result = await rig.handlers[target](rawRequest([rawItem()]));

    expect(result.target).toBe(target);
    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(result.results).toHaveLength(1);

    const item = result.results[0]!;
    expect(item.valid).toBe(true);
    expect(item.disposition).toBe('RULES_EVALUATED');
    expect(item.invalidReason).toBeNull();
    expect(item.outcome).toEqual(
      directOutcome(factsFor(ANCHOR_START, ANCHOR_END), openRuleSet(), await rig.gate.allowedLocationIds()),
    );
    expect(item.outcome?.decision).toBe('allow');
    expect(item.outcome?.explanations[0]?.code).toBe('BOOKING_ALLOWED');
    expect(result.degradations).toEqual([]);
  });

  it('returns the block outcome verbatim incl. customer-safe message and machine code', async () => {
    const rules = openRuleSet({
      locationWindows: { 'loc-1': [{ weekday: 'WED', start: '13:00', end: '17:00' }] },
    });
    const rig = makeRig({ ruleSet: rules });
    const result = await rig.handlers.CREATE(rawRequest([rawItem({ start: OUTSIDE_START, end: OUTSIDE_END })]));

    const item = result.results[0]!;
    expect(item.valid).toBe(false);
    expect(item.outcome).toEqual(
      directOutcome(factsFor(OUTSIDE_START, OUTSIDE_END), rules, await rig.gate.allowedLocationIds()),
    );
    // The FIRST blocking explanation drives the typed invalidReason mapping.
    expect(item.invalidReason?.code).toBe('OUTSIDE_BOOKING_HOURS');
    expect(item.invalidReason?.message).toBe(
      'The selected time is outside opening hours. Please choose another time.',
    );
    // Explanations preserved verbatim for the explain/audit trail.
    expect(
      item.outcome?.explanations.every((e) => typeof e.customerMessage === 'string' && e.customerMessage.length > 0),
    ).toBe(true);
  });
});

describe('internal failure ⇒ binding target semantics (Contract §5.3)', () => {
  it.each(FAIL_CLOSED_TARGETS)(
    '%s fails CLOSED: every item blocked with retry hint, incident logged + surfaced',
    async (target) => {
      const rig = makeRig({ configStoreError: new Error('data collection unavailable') });
      // The guard converts the failure into explicit results — never a throw.
      const result = await rig.handlers[target](rawRequest([rawItem(), rawItem({ serviceId: 'svc-2' })]));

      expect(result.enforcementClaim).toBe('FAIL_CLOSED_BLOCKED');
      expect(result.results).toHaveLength(2);
      for (const [index, item] of result.results.entries()) {
        expect(item.index).toBe(index);
        expect(item.valid).toBe(false);
        expect(item.outcome).toBeNull();
        expect(item.disposition).toBe('INTERNAL_FAILURE_FAIL_CLOSED');
        expect(item.invalidReason).toEqual({ code: FAIL_CLOSED_CODE, message: FAIL_CLOSED_MESSAGE });
      }
      expect(result.degradations.map((d) => d.kind)).toEqual(['ENFORCEMENT_FAIL_CLOSED']);
      expect(result.degradations[0]?.target).toBe(target);
      expect(result.degradations[0]?.detail).toContain('data collection unavailable');
      expect(rig.sink.records.map((r) => r.kind)).toEqual(['ENFORCEMENT_FAIL_CLOSED']);
    },
  );

  it.each(FAIL_OPEN_TARGETS)(
    '%s fails OPEN: pass-through plus ENFORCEMENT_FAIL_OPEN record; never claims enforcement',
    async (target) => {
      const rig = makeRig({ configStoreError: new Error('ruleset store exploded') });
      const result = await rig.handlers[target](rawRequest([rawItem()]));

      expect(result.enforcementClaim).toBe('FAIL_OPEN_NOT_ENFORCED');
      expect(result.results).toHaveLength(1);
      const item = result.results[0]!;
      expect(item.valid).toBe(true); // explicit pass-through
      expect(item.outcome).toBeNull(); // rules were NOT evaluated
      expect(item.disposition).toBe('INTERNAL_FAILURE_FAIL_OPEN');
      expect(item.invalidReason).toBeNull();

      expect(result.degradations.map((d) => d.kind)).toEqual(['ENFORCEMENT_FAIL_OPEN']);
      expect(result.degradations[0]?.detail).toContain('NOT enforced');
      expect(rig.sink.records.map((r) => r.kind)).toEqual(['ENFORCEMENT_FAIL_OPEN']);
    },
  );

  it('deadline expiry follows the same split: CREATE blocks with retry hint, RESCHEDULE passes through', async () => {
    const hung = makeRig({ hangingConfigStore: true, deadlineMs: 5 });

    const createResult = await hung.handlers.CREATE(rawRequest([rawItem()]));
    expect(createResult.enforcementClaim).toBe('FAIL_CLOSED_BLOCKED');
    expect(createResult.results[0]?.invalidReason?.message).toBe(FAIL_CLOSED_MESSAGE);
    expect(createResult.degradations.map((d) => d.kind)).toEqual(['ENFORCEMENT_FAIL_CLOSED']);

    const rescheduleResult = await hung.handlers.RESCHEDULE(rawRequest([rawItem()]));
    expect(rescheduleResult.enforcementClaim).toBe('FAIL_OPEN_NOT_ENFORCED');
    expect(rescheduleResult.results[0]?.valid).toBe(true);
    expect(rescheduleResult.degradations.map((d) => d.kind)).toEqual(['ENFORCEMENT_FAIL_OPEN']);
  });

  it('a generous deadline never triggers on fast dependencies', async () => {
    const rig = makeRig({ deadlineMs: 5000 });
    const ok = await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(ok.enforcementClaim).toBe('ENFORCED');
    expect(ok.results[0]?.valid).toBe(true);
  });

  it('a failing duplicate-input read degrades VISIBLY without blocking (native protection remains)', async () => {
    const rig = makeRig({
      existingBookings: [
        {
          bookingId: 'bk-ex',
          serviceId: 'svc-1',
          startUtc: '2026-08-12T17:30:00.000Z',
          endUtc: '2026-08-12T18:30:00.000Z',
          status: 'CONFIRMED',
        },
      ],
      existingError: new Error('bookings reader down'),
    });

    const result = await rig.handlers.CREATE(rawRequest([rawItem()]));
    // Without the failure this exact scenario is a DUPLICATE_BOOKING block;
    // degraded inputs must NOT fabricate that block silently.
    expect(result.results[0]?.valid).toBe(true);
    expect(result.degradations.map((d) => d.kind)).toContain('DUPLICATE_INPUT_FAILURE');
    expect(rig.sink.records.map((r) => r.kind)).toContain('DUPLICATE_INPUT_FAILURE');
    expect(rig.existingCalls()).toBe(1);
  });

  it('the same duplicate scenario BLOCKS when the input port is healthy (control)', async () => {
    const rig = makeRig({
      existingBookings: [
        {
          bookingId: 'bk-ex',
          serviceId: 'svc-1',
          startUtc: '2026-08-12T17:30:00.000Z',
          endUtc: '2026-08-12T18:30:00.000Z',
          status: 'CONFIRMED',
        },
      ],
    });
    const result = await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.invalidReason?.code).toBe('DUPLICATE_BOOKING');
    expect(result.degradations).toEqual([]);
  });
});

describe('no active RuleSet ⇒ explicit valid results (nothing to enforce)', () => {
  it.each(['CREATE', 'RESCHEDULE'] as const)('%s answers every index explicitly', async (target) => {
    const rig = makeRig({ ruleSet: null });
    const result = await rig.handlers[target](rawRequest([rawItem(), rawItem({ serviceId: 'svc-2' })]));
    expect(result.enforcementClaim).toBe('ENFORCED');
    expect(result.results).toHaveLength(2);
    for (const [index, item] of result.results.entries()) {
      expect(item.index).toBe(index);
      expect(item.valid).toBe(true);
      expect(item.disposition).toBe('NO_ACTIVE_RULESET');
      expect(item.outcome).toBeNull();
    }
    expect(rig.countingGateway.calls).toBe(0);
  });
});
