/**
 * Deterministic UUIDv5 idempotency-key tests (INT-C1-1 item d; Contract §9.3).
 */
import { describe, expect, it } from 'vitest';
import {
  deriveChangeIdempotencyKey,
  deriveRollbackIdempotencyKey,
  describeChangeForIdempotency,
  uuidV5,
} from '../../src/platform/schedule-mutation/idempotency';

const RFC4122_DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5 (RFC 4122 §4.3)', () => {
  it('reproduces the canonical python.org test vector', () => {
    expect(uuidV5('python.org', RFC4122_DNS_NAMESPACE)).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('emits version 5 and RFC 4122 variant bits', () => {
    const u = uuidV5('anything');
    expect(u[14]).toBe('5'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(u[19]); // variant nibble
  });

  it('is deterministic and collision-free across distinct inputs', () => {
    expect(uuidV5('same-input')).toBe(uuidV5('same-input'));
    expect(uuidV5('a')).not.toBe(uuidV5('b'));
  });
});

describe('deriveChangeIdempotencyKey (Contract §9.3: site, schedule, rule-version, weekday, window)', () => {
  const base = { siteId: 'site-abc', scopeScheduleId: 'sched-123', ruleVersion: 7 };

  it('is stable for identical inputs', () => {
    const change = {
      action: 'CREATE_MASTER' as const,
      weekday: 'MON' as const,
      startTime: '09:00',
      endTime: '12:00',
      anchorDate: '2026-08-31',
    };
    expect(deriveChangeIdempotencyKey(base, change)).toBe(deriveChangeIdempotencyKey(base, change));
  });

  it('changes when any binding dimension changes', () => {
    const change = {
      action: 'CREATE_MASTER' as const,
      weekday: 'MON' as const,
      startTime: '09:00',
      endTime: '12:00',
      anchorDate: '2026-08-31',
    };
    const reference = deriveChangeIdempotencyKey(base, change);
    expect(deriveChangeIdempotencyKey({ ...base, siteId: 'site-other' }, change)).not.toBe(reference);
    expect(deriveChangeIdempotencyKey({ ...base, scopeScheduleId: 'sched-other' }, change)).not.toBe(reference);
    expect(deriveChangeIdempotencyKey({ ...base, ruleVersion: 8 }, change)).not.toBe(reference);
    expect(
      deriveChangeIdempotencyKey(base, { ...change, weekday: 'TUE' as const }),
    ).not.toBe(reference);
    expect(
      deriveChangeIdempotencyKey(base, { ...change, endTime: '14:00' }),
    ).not.toBe(reference);
    // Split windows on the same weekday produce different keys.
    expect(
      deriveChangeIdempotencyKey(base, { ...change, startTime: '14:00', endTime: '18:00' }),
    ).not.toBe(reference);
  });

  it('distinguishes the three change actions even with overlapping fields', () => {
    const create = {
      action: 'CREATE_MASTER' as const,
      weekday: 'MON' as const,
      startTime: '09:00',
      endTime: '12:00',
      anchorDate: '2026-08-31',
    };
    const update = {
      action: 'UPDATE_MASTER' as const,
      eventId: 'evt-0001',
      expectedRevision: '3',
      startTime: '09:00',
      endTime: '12:00',
    };
    const cancel = { action: 'CANCEL_EVENT' as const, eventId: 'evt-0001', expectedRevision: '3' };
    const keys = [
      deriveChangeIdempotencyKey(base, create),
      deriveChangeIdempotencyKey(base, update),
      deriveChangeIdempotencyKey(base, cancel),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('derives fresh rollback keys distinct from apply keys per snapshot (Contract §9.6)', () => {
    const key = deriveChangeIdempotencyKey(base, {
      action: 'CREATE_MASTER',
      weekday: 'MON',
      startTime: '09:00',
      endTime: '12:00',
      anchorDate: '2026-08-31',
    });
    const rollback = deriveRollbackIdempotencyKey(base, 'snap-0001', 'evt-0002');
    expect(rollback).not.toBe(key);
    expect(deriveRollbackIdempotencyKey(base, 'snap-0001', 'evt-0002')).toBe(rollback); // stable per snapshot
    expect(deriveRollbackIdempotencyKey(base, 'snap-0002', 'evt-0002')).not.toBe(rollback); // fresh per attempt
  });
});

describe('describeChangeForIdempotency', () => {
  it('encodes weekday + window so split windows differ', () => {
    const morning = describeChangeForIdempotency({
      action: 'CREATE_MASTER',
      weekday: 'MON',
      startTime: '09:00',
      endTime: '12:00',
    });
    const afternoon = describeChangeForIdempotency({
      action: 'CREATE_MASTER',
      weekday: 'MON',
      startTime: '14:00',
      endTime: '18:00',
    });
    expect(morning).not.toBe(afternoon);
    expect(morning).toContain('09:00');
  });
});
