/**
 * Duplicate-protection suite — REPAIRED per audit CYCLE_32692407760_RULES B3
 * findings (1)+(2), A4, and the cycle-1 acceptance criterion 5 gap.
 *
 * B3(1)/(2) root cause: the cycle-1 fixtures confused LOCAL WALL TIME with
 * UTC, so the "existing booking" and the proposal never actually overlapped
 * and the identity-key conflict path had zero passing coverage. Per Contract
 * §4.7 the site zone is America/New_York; on the fixture week (Aug 10–16,
 * 2026) it is EDT = UTC−4, so local 13:30–14:30 == 17:30Z–18:30Z. The
 * repaired fixtures below place the existing bookings at instants that
 * GENUINELY overlap the proposal (existing 17:00Z–18:00Z vs proposal
 * 17:30Z–18:30Z).
 *
 * A4: every negative control now overlaps the proposal in time, so the ONLY
 * discriminating variable is the asserted dimension (day / key inequality /
 * key absence).
 */
import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../../src/domain';
import {
  ANCHOR_DATES,
  baseRuleSet,
  depsWith,
  existingBooking,
  factsAt,
} from '../helpers/builders';

const PROPOSAL_START_Z = '2026-08-12T17:30:00.000Z'; // 13:30 EDT Wednesday
const PROPOSAL_END_Z = '2026-08-12T18:30:00.000Z'; // 14:30 EDT Wednesday

describe('duplicates — identity-free protection', () => {
  it('blocks a second same-service/day overlapping slot (genuinely overlapping instants)', () => {
    // B3(1) repair: existing booking 17:00Z–18:00Z (= 13:00–14:00 EDT) truly
    // overlaps the proposal factsAt(WED,810,870) = 17:30Z–18:30Z
    // (= 13:30–14:30 EDT). Contract §4.7: wall times are interpreted in the
    // site zone; the cycle-1 fixture wrongly treated 13:30 as UTC.
    const rules = baseRuleSet();
    const outcome = evaluateRules(
      factsAt('WED', 810, 870),
      rules,
      depsWith({
        existingBookings: () => [
          existingBooking({
            serviceId: 'svc-1',
            startUtc: '2026-08-12T17:00:00.000Z',
            endUtc: '2026-08-12T18:00:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations).toEqual([
      {
        decision: 'block',
        ruleId: 'duplicates',
        code: 'DUPLICATE_BOOKING',
        customerMessage: expect.any(String),
      },
    ]);
    expect(PROPOSAL_START_Z).toBe(factsAt('WED', 810, 870).slotStart);
    expect(PROPOSAL_END_Z).toBe(factsAt('WED', 810, 870).slotEnd);
  });

  it('treats back-to-back half-open intervals as non-conflicting', () => {
    // Existing ends exactly when the proposal starts (17:30Z): no overlap.
    const outcome = evaluateRules(
      factsAt('WED', 810, 870),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            startUtc: '2026-08-12T16:30:00.000Z',
            endUtc: '2026-08-12T17:30:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('allow');
  });

  it('catches an existing booking fully contained in the proposal', () => {
    const outcome = evaluateRules(
      factsAt('WED', 810, 870),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            startUtc: '2026-08-12T17:45:00.000Z',
            endUtc: '2026-08-12T18:15:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations[0]?.code).toBe('DUPLICATE_BOOKING');
  });

  it('ignores canceled existing bookings (cancellation frees the slot)', () => {
    const outcome = evaluateRules(
      factsAt('WED', 810, 870),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({ status: 'CANCELED' }),
        ],
      }),
    );
    expect(outcome.decision).toBe('allow');
  });

  it('does not cross days — identical wall clock on a different site day allows', () => {
    // A4 repair: this control genuinely overlaps in WALL TIME (13:00–14:00 on
    // Tuesday vs 13:30–14:30 on Wednesday) but sits on a different site-zone
    // day, so DAY is the only discriminator that can flip the outcome.
    const outcome = evaluateRules(
      factsAt('WED', 810, 870),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            startUtc: '2026-08-11T17:00:00.000Z',
            endUtc: '2026-08-11T18:00:00.000Z',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('allow');
    expect(ANCHOR_DATES.WED).toBe('2026-08-12'); // guard: fixture dates as documented
  });
});

describe('duplicates — identity-keyed cross-service conflict', () => {
  it('blocks across services when the SAME key is supplied (end-to-end IDENTITY_TIME_CONFLICT)', () => {
    // B3(2) repair + acceptance criterion 5: one person (same identity key)
    // holding two DIFFERENT services over genuinely overlapping instants —
    // existing svc-2 17:00Z–18:00Z vs proposal svc-1 17:30Z–18:30Z.
    const outcome = evaluateRules(
      factsAt('WED', 810, 870, { serviceId: 'svc-1', identityKey: 'person-1' }),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            serviceId: 'svc-2',
            startUtc: '2026-08-12T17:00:00.000Z',
            endUtc: '2026-08-12T18:00:00.000Z',
            identityKey: 'person-1',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('block');
    expect(outcome.explanations).toEqual([
      {
        decision: 'block',
        ruleId: 'duplicates',
        code: 'IDENTITY_TIME_CONFLICT',
        customerMessage: expect.any(String),
      },
    ]);
  });

  it('ignores other people’s keys — key INEQUALITY is the only difference', () => {
    // A4 repair: identical overlap and services as the conflict test above;
    // only the existing booking's key differs.
    const outcome = evaluateRules(
      factsAt('WED', 810, 870, { identityKey: 'person-1' }),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            serviceId: 'svc-2',
            startUtc: '2026-08-12T17:00:00.000Z',
            endUtc: '2026-08-12T18:00:00.000Z',
            identityKey: 'person-2',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('allow');
  });

  it('stays inert when no key is supplied — key ABSENCE is the only difference', () => {
    // A4 repair: identical overlap and services as the conflict test above;
    // only the proposal's key is absent (identity-free path cannot fire
    // cross-service).
    const outcome = evaluateRules(
      factsAt('WED', 810, 870, { identityKey: null }),
      baseRuleSet(),
      depsWith({
        existingBookings: () => [
          existingBooking({
            serviceId: 'svc-2',
            startUtc: '2026-08-12T17:00:00.000Z',
            endUtc: '2026-08-12T18:00:00.000Z',
            identityKey: 'person-1',
          }),
        ],
      }),
    );
    expect(outcome.decision).toBe('allow');
  });
});
