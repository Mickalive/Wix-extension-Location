/**
 * Cached-counter behavior on the enforcement path (INT-C3-1 acceptance
 * criterion 5; Blueprint §4 flow 4). Proves:
 *  - caps block at-limit and allow one-under with declared statuses;
 *  - counter failure degrades caps per rule configuration: the domain emits
 *    its per-limit fail-open notice, the item stays valid, and a
 *    COUNT_GATEWAY_FAILURE incident is logged + surfaced (never silent,
 *    never thrown);
 *  - the short-TTL cache serves identical queries once within the TTL (inside
 *    a bulk exchange AND across consecutive validations) and re-fetches after
 *    expiry — all clock-driven and deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  makeRig,
  openRuleSet,
  rawItem,
  rawRequest,
} from './helpers/validationPluginRig';

const SERVICE_CAP_1 = openRuleSet({
  limits: [
    { limitId: 'cap-svc', dimension: 'SERVICE', targetId: 'svc-1', maxCount: 1, includedStatuses: ['PENDING', 'CONFIRMED'] },
  ],
});

describe('cap semantics through the plugin path', () => {
  it('one-under allows; at-limit blocks with the domain quota explanation', async () => {
    const under = makeRig({ ruleSet: SERVICE_CAP_1 });
    const allowed = await under.handlers.CREATE(rawRequest([rawItem()]));
    expect(allowed.results[0]?.valid).toBe(true);
    expect(allowed.results[0]?.outcome?.explanations[0]?.code).toBe('BOOKING_ALLOWED');

    const at = makeRig({
      ruleSet: SERVICE_CAP_1,
      seededBookings: [
        { bookingId: 'b1', serviceId: 'svc-1', locationId: 'loc-1', startUtc: '2026-08-12T18:00:00.000Z', status: 'PENDING' },
      ],
    });
    const blocked = await at.handlers.CREATE(rawRequest([rawItem()]));
    expect(blocked.results[0]?.valid).toBe(false);
    expect(blocked.results[0]?.invalidReason?.code).toBe('QUOTA_EXCEEDED');
    expect(blocked.results[0]?.invalidReason?.message).toBe('This time is fully booked. Please choose another time.');
  });

  it('cancelled bookings do not consume cap capacity (declared-status counting)', async () => {
    const rig = makeRig({
      ruleSet: SERVICE_CAP_1,
      seededBookings: [
        { bookingId: 'b1', serviceId: 'svc-1', startUtc: '2026-08-12T18:00:00.000Z', status: 'CANCELED' },
      ],
    });
    const result = await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(result.results[0]?.valid).toBe(true);
  });
});

describe('counter failure ⇒ visible degradation, never silent, never thrown', () => {
  it('degrades the cap fail-open with COUNT_GATEWAY_FAILURE logged + surfaced', async () => {
    const rig = makeRig({ ruleSet: SERVICE_CAP_1, counterError: new Error('count API timeout') });

    const result = await rig.handlers.CREATE(rawRequest([rawItem()]));
    // The item is NOT blocked by the unreachable counter...
    expect(result.results[0]?.valid).toBe(true);
    // ...but the degradation is explicit in the verbatim domain outcome...
    const codes = result.results[0]?.outcome?.explanations.map((e) => e.code) ?? [];
    expect(codes).toContain('COUNT_UNAVAILABLE_FAIL_OPEN');
    // ...and the incident is surfaced in-result AND persisted via the sink.
    expect(result.degradations.map((d) => d.kind)).toEqual(['COUNT_GATEWAY_FAILURE']);
    expect(result.degradations[0]?.detail).toContain('count API timeout');
    expect(result.degradations[0]?.countQueryKey).toBeDefined();
    expect(rig.sink.records.map((r) => r.kind)).toEqual(['COUNT_GATEWAY_FAILURE']);
  });

  it('a bulk of identical items triggers exactly ONE gateway read (in-request dedup)', async () => {
    const rig = makeRig({ ruleSet: SERVICE_CAP_1 });
    const items = Array.from({ length: 12 }, () => rawItem());
    await rig.handlers.CREATE_MULTI_SERVICE(rawRequest(items));
    expect(rig.countingGateway.calls).toBe(1);
  });

  it('distinct queries are each fetched exactly once per request', async () => {
    const rig = makeRig({ ruleSet: SERVICE_CAP_1 });
    const items = [
      rawItem({ serviceId: 'svc-1' }),
      rawItem({ serviceId: 'svc-2' }), // different query key
      rawItem({ serviceId: 'svc-1', locationId: 'loc-2' }), // DAY query identical to item 0's
    ];
    await rig.handlers.CREATE(rawRequest(items));
    // svc-1 DAY query deduped across items 0/2; svc-2 has no applicable limit.
    expect(rig.countingGateway.calls).toBe(1);
    expect(rig.countingGateway.queries[0]?.serviceId).toBe('svc-1');
  });
});

describe('short-TTL cache across validations (clock-driven, deterministic)', () => {
  it('serves identical queries from cache within the TTL and refetches after expiry', async () => {
    const rig = makeRig({ ruleSet: SERVICE_CAP_1, counterTtlMs: 1000 });

    await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(rig.countingGateway.calls).toBe(1);

    // Second validation inside the TTL window: served by the shared cache.
    rig.clock.advanceMs(500);
    await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(rig.countingGateway.calls).toBe(1);

    // After TTL expiry the counter is refreshed (authoritative reconciliation).
    rig.clock.advanceMs(501); // total 1001ms > ttl
    await rig.handlers.CREATE(rawRequest([rawItem()]));
    expect(rig.countingGateway.calls).toBe(2);
  });

  it('different queries never collide in the cache', async () => {
    const rig = makeRig({ ruleSet: SERVICE_CAP_1, counterTtlMs: 1000 });
    await rig.handlers.CREATE(rawRequest([rawItem({ serviceId: 'svc-1' })]));
    await rig.handlers.CREATE(rawRequest([rawItem({ serviceId: 'svc-2' })]));
    expect(rig.countingGateway.calls).toBe(1); // svc-2 has no applicable limit ⇒ still 1

    const twoCaps = openRuleSet({
      limits: [
        { limitId: 'cap-a', dimension: 'SERVICE', targetId: 'svc-1', maxCount: 5, includedStatuses: ['PENDING'] },
        { limitId: 'cap-b', dimension: 'DAY', maxCount: 9, includedStatuses: ['CONFIRMED'] },
      ],
    });
    const rig2 = makeRig({ ruleSet: twoCaps, counterTtlMs: 1000 });
    await rig2.handlers.CREATE(rawRequest([rawItem()]));
    expect(rig2.countingGateway.calls).toBe(2); // two distinct planned queries
  });
});
