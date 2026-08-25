/**
 * EntitlementGate consumption on the enforcement path (INT-C3-1 acceptance
 * criterion 4; ratified over-limit posture Contract §7/§11 C5). Proves:
 *  - locations OUTSIDE allowedLocationIds are UNCOVERED: rule evaluation is
 *    SKIPPED for them (gateway untouched) and an explicit valid result is
 *    returned — enforcement coverage restricted, never punitive;
 *  - a DEGRADED gate ⇒ fail-open coverage: uncovered locations are evaluated
 *    like covered ones and the warning is surfaced as a persisted incident;
 *  - a THROWING gate (billing API failure) NEVER blocks a booking;
 *  - over-limit healthy decisions still restrict coverage (upgrade CTA state,
 *    not an error).
 */
import { describe, expect, it } from 'vitest';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
  degradedEntitlement,
  healthyEntitlement,
} from './helpers/validationPluginRig';

/**
 * Detector ruleset: a DAY cap of 1 with one seeded booking in the anchor day
 * bucket blocks ANY evaluated item with QUOTA_EXCEEDED (count 1 >= maxCount).
 * If rule evaluation ran for an item, the item blocks; if evaluation was
 * skipped, the item stays valid. This makes "did the evaluator see this
 * item?" directly observable through outcomes AND gateway calls.
 * (maxCount must be >= 1 per the domain validator — hence the seeded booking.)
 */
const CAP_EVERYTHING = openRuleSet({
  limits: [{ limitId: 'cap-day', dimension: 'DAY', maxCount: 1, includedStatuses: ['PENDING', 'CONFIRMED'] }],
});

const ONE_BOOKING_TODAY = [
  { bookingId: 'b-seed', serviceId: 'svc-1', locationId: null, startUtc: '2026-08-12T18:00:00.000Z', status: 'CONFIRMED' as const },
];

describe('uncovered locations skip rule evaluation (ratified over-limit posture)', () => {
  it('skips evaluation for an uncovered location: explicit valid result, zero gateway reads', async () => {
    const rig = makeRig({ ruleSet: CAP_EVERYTHING, entitlement: healthyEntitlement(['loc-1']) });

    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-other' })]));
    const item = result.results[0]!;
    expect(item.valid).toBe(true); // not blocked, not punished — just not ours to enforce
    expect(item.disposition).toBe('UNCOVERED_LOCATION_RULES_SKIPPED');
    expect(item.outcome).toBeNull();
    expect(item.invalidReason).toBeNull();
    // Proof that evaluation was SKIPPED: no count query was ever planned.
    expect(rig.countingGateway.calls).toBe(0);
    expect(result.degradations).toEqual([]);
  });

  it('still evaluates COVERED locations with full rule strength (control)', async () => {
    const rig = makeRig({
      ruleSet: CAP_EVERYTHING,
      entitlement: healthyEntitlement(['loc-1']),
      seededBookings: ONE_BOOKING_TODAY,
    });
    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-1' })]));
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.invalidReason?.code).toBe('QUOTA_EXCEEDED');
    expect(rig.countingGateway.calls).toBe(1);
  });

  it('over-limit healthy decisions keep restricting coverage (upgrade CTA state, not an error)', async () => {
    const overLimit = { ...healthyEntitlement(['loc-1']), overLimit: true };
    const rig = makeRig({ ruleSet: CAP_EVERYTHING, entitlement: overLimit });
    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-unmanaged' })]));
    expect(result.results[0]?.disposition).toBe('UNCOVERED_LOCATION_RULES_SKIPPED');
    expect(result.degradations).toEqual([]); // over-limit is NOT a degradation
  });

  it('CUSTOM/CUSTOMER bookings (no location id) are always evaluated', async () => {
    const rig = makeRig({
      ruleSet: CAP_EVERYTHING,
      entitlement: healthyEntitlement(['loc-1']),
      seededBookings: ONE_BOOKING_TODAY,
    });
    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: null })]));
    expect(result.results[0]?.disposition).toBe('RULES_EVALUATED');
    expect(result.results[0]?.invalidReason?.code).toBe('QUOTA_EXCEEDED');
    expect(rig.countingGateway.calls).toBe(1);
  });
});

describe('degraded entitlement ⇒ fail-open coverage + persisted warning signal', () => {
  it('degraded coverage never skips: uncovered-location items are evaluated normally', async () => {
    const warning = 'billing state unavailable — failing open';
    const rig = makeRig({
      ruleSet: CAP_EVERYTHING,
      entitlement: degradedEntitlement(warning),
      seededBookings: ONE_BOOKING_TODAY,
    });

    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-other' })]));
    // Fail-open coverage ⇒ the cap rule applies as if the location were covered.
    expect(result.results[0]?.disposition).toBe('RULES_EVALUATED');
    expect(result.results[0]?.invalidReason?.code).toBe('QUOTA_EXCEEDED');
    expect(rig.countingGateway.calls).toBe(1);

    // The degradation is surfaced in-result AND persisted via the sink.
    expect(result.degradations.map((d) => d.kind)).toEqual(['ENTITLEMENT_DEGRADED']);
    expect(result.degradations[0]?.detail).toContain(warning);
    expect(rig.sink.records.map((r) => r.kind)).toEqual(['ENTITLEMENT_DEGRADED']);
  });

  it('a THROWING billing gate never blocks a paying merchant (§7/C5)', async () => {
    const rig = makeRig({
      ruleSet: openRuleSet(), // default-open: absent billing failure the item allows
      entitlement: healthyEntitlement(['loc-1']),
    });
    rig.gate.failNextWith(new Error('Get App Instance 503'));

    const result = await rig.handlers.CREATE(rawRequest([rawItem({ locationId: 'loc-1' })]));
    expect(result.results[0]?.valid).toBe(true); // NEVER blocked by billing
    expect(result.enforcementClaim).toBe('ENFORCED');

    expect(result.degradations.map((d) => d.kind)).toEqual(['ENTITLEMENT_GATE_FAILURE']);
    expect(result.degradations[0]?.detail).toContain('Get App Instance 503');
    expect(rig.sink.records.map((r) => r.kind)).toEqual(['ENTITLEMENT_GATE_FAILURE']);
  });

  it('a throwing gate degrades coverage fail-open for previously-uncovered locations too', async () => {
    const rig = makeRig({
      ruleSet: openRuleSet(),
      entitlement: healthyEntitlement(['loc-1']),
    });
    rig.gate.failNextWith(new Error('billing unreachable'));

    // loc-other would be skipped under the healthy decision; under synthetic
    // degradation it is evaluated (and allowed by the default-open ruleset).
    const result = await rig.handlers.RESCHEDULE(rawRequest([rawItem({ locationId: 'loc-other' })]));
    expect(result.results[0]?.valid).toBe(true);
    expect(result.results[0]?.disposition).toBe('RULES_EVALUATED');
    expect(result.degradations.map((d) => d.kind)).toEqual(['ENTITLEMENT_GATE_FAILURE']);
  });
});
