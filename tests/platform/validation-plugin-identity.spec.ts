/**
 * Identity-free-first duplicate inputs (INT-C3-1 item d; Invariant C1).
 *
 * Whether metadata.identity actually arrives in production payloads is
 * UNPROVEN until gate T-VP3. Proves:
 *  - DEFAULT (flag OFF): metadata.identity is never consumed as a duplicate
 *    identity key — an overlapping different-service booking with the SAME
 *    observed identity does NOT produce IDENTITY_TIME_CONFLICT;
 *  - flag explicitly ON: the same scenario DOES produce IDENTITY_TIME_CONFLICT;
 *  - the identity-free path (same-service overlap) blocks regardless of the
 *    flag — it never depended on identity.
 */
import { describe, expect, it } from 'vitest';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
} from './helpers/validationPluginRig';
import type { ExistingBookingFact } from '../../src/domain';

const OVERLAPPING_OTHER_SERVICE: ExistingBookingFact[] = [
  {
    bookingId: 'bk-other',
    serviceId: 'svc-OTHER', // different service ⇒ identity-free path silent
    startUtc: '2026-08-12T17:30:00.000Z', // overlaps 17:00–18:00Z proposal
    endUtc: '2026-08-12T18:30:00.000Z',
    status: 'CONFIRMED',
    identityKey: 'memberId:mem-1', // same identity as the proposal below
  },
];

const OVERLAPPING_SAME_SERVICE: ExistingBookingFact[] = [
  {
    bookingId: 'bk-same',
    serviceId: 'svc-1',
    startUtc: '2026-08-12T17:30:00.000Z',
    endUtc: '2026-08-12T18:30:00.000Z',
    status: 'CONFIRMED',
    identityKey: null,
  },
];

const IDENTITY_ITEM = rawItem({ identity: { memberId: 'mem-1' } });

describe('metadata.identity consumption gated behind the UNPROVEN-payload flag', () => {
  it('DEFAULT OFF: same observed identity does NOT create an identity conflict', async () => {
    const rig = makeRig({ existingBookings: OVERLAPPING_OTHER_SERVICE }); // policy defaults off

    const result = await rig.handlers.CREATE(rawRequest([IDENTITY_ITEM]));
    expect(result.results[0]?.valid).toBe(true); // identity-free path found nothing
    const codes = result.results[0]?.outcome?.explanations.map((e) => e.code) ?? [];
    expect(codes).not.toContain('IDENTITY_TIME_CONFLICT');
  });

  it('flag ON: the identical scenario yields IDENTITY_TIME_CONFLICT', async () => {
    const rig = makeRig({
      existingBookings: OVERLAPPING_OTHER_SERVICE,
      identityPolicy: { consumeMetadataIdentity: true }, // explicit operator decision post-T-VP3
    });

    const result = await rig.handlers.CREATE(rawRequest([IDENTITY_ITEM]));
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.invalidReason?.code).toBe('IDENTITY_TIME_CONFLICT');
  });

  it.each([false, true])('identity-free duplicate protection fires regardless of the flag (%s)', async (flagOn) => {
    const rig = makeRig({
      existingBookings: OVERLAPPING_SAME_SERVICE,
      ...(flagOn ? { identityPolicy: { consumeMetadataIdentity: true } } : {}),
    });

    const result = await rig.handlers.CREATE(rawRequest([IDENTITY_ITEM]));
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.invalidReason?.code).toBe('DUPLICATE_BOOKING');
  });

  it('absent metadata.identity stays identity-free even with the flag ON', async () => {
    const rig = makeRig({
      existingBookings: OVERLAPPING_OTHER_SERVICE.map((b) => ({ ...b })),
      identityPolicy: { consumeMetadataIdentity: true },
    });

    const result = await rig.handlers.CREATE(rawRequest([rawItem()])); // no identity in payload
    expect(result.results[0]?.valid).toBe(true);
    expect(result.results[0]?.invalidReason).toBeNull();
  });
});
