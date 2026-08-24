/**
 * Fake-adapter consumer tests (INT-C1-1 item c; Blueprint §3, §6).
 *
 * Acceptance criterion: "every port has a fake implementation exercised by at
 * least one consumer test." Each block drives a fake THROUGH a realistic
 * consumer flow (the kind of flow the rules/dashboard/billing lanes and the
 * validation-plugin wiring will run in cycle 2). Consumer logic lives only in
 * this test file — no product rule logic is introduced anywhere.
 */
import { describe, expect, it } from 'vitest';
import {
  FakeAvailabilityGateway,
  FakeBookingCountGateway,
  FakeClock,
  FakeEntitlementGate,
  FakeMutationJournalStore,
  FakeRulesConfigStore,
  FakeScheduleGateway,
} from '../../src/platform/adapters/fakes/index';
import { PlatformError } from '../../src/platform/contracts';
import type {
  PolicyDecision,
  RuleSet,
  Slot,
} from '../../src/platform/contracts';

describe('FakeClock consumed as the injected Clock port', () => {
  it('supplies instants and zone to consumers (journal timestamps)', async () => {
    const clock = new FakeClock('2026-08-24T09:00:00.000Z', 'America/New_York').advanceMs(500);
    const journal = new FakeMutationJournalStore({ now: () => clock.now() });
    await journal.recordAudit({
      entryId: 'a1',
      at: clock.now(),
      actor: 'consumer',
      action: 'MUTATION_APPLIED',
      planId: 'p',
      scope: { scheduleId: 's', ownerType: 'BUSINESS', ownerId: 'o' },
      summary: 'stamp check',
      snapshotRef: 'snap-x',
    });
    expect(journal.auditEntries[0]?.at).toBe('2026-08-24T09:00:00.500Z');
    expect(clock.zone()).toBe('America/New_York');
  });
});

describe('FakeRulesConfigStore consumed by a load-modify-save flow', () => {
  const baseRuleSet: RuleSet = {
    ruleSetId: 'rs-1',
    revision: 'rev-1',
    version: 1,
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
  };

  it('round-trips a rule set and bumps revisions on save', async () => {
    const store = new FakeRulesConfigStore({ initialRuleSet: baseRuleSet });

    const loaded = await store.loadActiveRuleSet();
    expect(loaded?.revision).toBe('rev-1');

    const saved = await store.saveRuleSet(
      { ...loaded!, limits: [{ limitId: 'l1', dimension: 'DAY', maxCount: 10, includedStatuses: ['PENDING', 'CONFIRMED'] }] },
      loaded!.revision,
    );
    expect(saved.revision).toBe('rev-2');
    expect((await store.loadActiveRuleSet())?.limits).toHaveLength(1);
  });

  it('rejects a stale-revision save with REVISION_CONFLICT', async () => {
    const store = new FakeRulesConfigStore({ initialRuleSet: baseRuleSet });
    const loaded = await store.loadActiveRuleSet();
    await store.saveRuleSet(loaded!, loaded!.revision); // concurrent writer wins

    await expect(store.saveRuleSet(loaded!, loaded!.revision)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      retriable: true,
    });
  });

  it('returns null when no active rule set exists', async () => {
    const store = new FakeRulesConfigStore();
    expect(await store.loadActiveRuleSet()).toBeNull();
  });
});

describe('FakeAvailabilityGateway consumed by a slot-preview flow', () => {
  const slots: Slot[] = [
    { startDate: '2026-08-24T13:00:00.000Z', endDate: '2026-08-24T14:00:00.000Z', serviceId: 'svc-1', localDate: '2026-08-24', locationId: 'loc-a' },
    { startDate: '2026-08-24T15:00:00.000Z', endDate: '2026-08-24T16:00:00.000Z', serviceId: 'svc-1', localDate: '2026-08-24', locationId: 'loc-b' },
    { startDate: '2026-08-25T13:00:00.000Z', endDate: '2026-08-25T14:00:00.000Z', serviceId: 'svc-1', localDate: '2026-08-25', locationId: 'loc-a' },
    { startDate: '2026-08-24T13:00:00.000Z', endDate: '2026-08-24T14:00:00.000Z', serviceId: 'svc-2', localDate: '2026-08-24', locationId: 'loc-a' },
  ];

  it('filters by service, location and local-date window', async () => {
    const gateway = new FakeAvailabilityGateway();
    gateway.seed(slots);

    const mondayLocA = await gateway.slots({
      serviceId: 'svc-1', locationId: 'loc-a', fromDate: '2026-08-24', toDate: '2026-08-24', timeZone: 'UTC',
    });
    expect(mondayLocA).toHaveLength(1);
    expect(mondayLocA[0]?.startDate).toBe('2026-08-24T13:00:00.000Z');

    const mondayAll = await gateway.slots({
      serviceId: 'svc-1', fromDate: '2026-08-24', toDate: '2026-08-24', timeZone: 'UTC',
    });
    expect(mondayAll).toHaveLength(2);

    const range = await gateway.slots({
      serviceId: 'svc-1', fromDate: '2026-08-24', toDate: '2026-08-25', timeZone: 'UTC',
    });
    expect(range).toHaveLength(3);
  });

  it('validates queries defensively', async () => {
    const gateway = new FakeAvailabilityGateway();
    gateway.seed(slots);
    await expect(gateway.slots({
      serviceId: 'svc-1', fromDate: '2026-08-25', toDate: '2026-08-24', timeZone: 'UTC',
    })).rejects.toBeInstanceOf(PlatformError);
  });
});

describe('FakeBookingCountGateway consumed by a cap-headroom flow', () => {
  function seedBookings(gateway: FakeBookingCountGateway): void {
    gateway.seed([
      { bookingId: 'b1', serviceId: 'svc-1', locationId: 'loc-a', startUtc: '2026-08-24T10:00:00.000Z', status: 'CONFIRMED' },
      { bookingId: 'b2', serviceId: 'svc-1', locationId: 'loc-a', startUtc: '2026-08-24T11:00:00.000Z', status: 'PENDING' },
      { bookingId: 'b3', serviceId: 'svc-1', locationId: 'loc-b', startUtc: '2026-08-24T12:00:00.000Z', status: 'CONFIRMED' },
      { bookingId: 'b4', serviceId: 'svc-1', locationId: 'loc-a', startUtc: '2026-08-24T13:00:00.000Z', status: 'CANCELED' }, // excluded by status policy
      { bookingId: 'b5', serviceId: 'svc-1', locationId: 'loc-a', startUtc: '2026-08-25T10:00:00.000Z', status: 'CONFIRMED' }, // outside UTC window
      { bookingId: 'b6', serviceId: 'svc-2', locationId: 'loc-a', startUtc: '2026-08-24T14:00:00.000Z', status: 'CONFIRMED' }, // other service
    ]);
  }

  it('counts with declared statuses over UTC bounds (cap headroom consumer)', async () => {
    const gateway = new FakeBookingCountGateway();
    seedBookings(gateway);

    // Consumer flow: remaining headroom under a per-location day cap.
    const countFor = (locationId: string): Promise<number> =>
      gateway.count({
        fromUtc: '2026-08-24T00:00:00.000Z',
        toUtc: '2026-08-24T23:59:59.999Z',
        serviceId: 'svc-1',
        locationId,
        includedStatuses: ['PENDING', 'CONFIRMED'],
      });

    const cap = 5;
    const locACount = await countFor('loc-a');
    expect(locACount).toBe(2); // CANCELED excluded, next-day excluded
    expect(cap - locACount).toBe(3);

    expect(await countFor('loc-b')).toBe(1);
  });

  it('surfaces failures so consumers can apply their configured posture', async () => {
    const gateway = new FakeBookingCountGateway();
    seedBookings(gateway);
    gateway.failNextWith(new PlatformError('GATEWAY_UNAVAILABLE', 'count API down', { retriable: true }));

    await expect(
      gateway.count({
        fromUtc: '2026-08-24T00:00:00.000Z',
        toUtc: '2026-08-24T23:59:59.999Z',
        includedStatuses: ['PENDING', 'CONFIRMED'],
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_UNAVAILABLE' });
    // Failure was one-shot; the next call succeeds again.
    expect(await gateway.count({
      fromUtc: '2026-08-24T00:00:00.000Z',
      toUtc: '2026-08-24T23:59:59.999Z',
      includedStatuses: ['PENDING', 'CONFIRMED'],
    })).toBe(4);
  });
});

describe('FakeEntitlementGate consumed by an enforcement-coverage flow', () => {
  it('propagates allowed locations, over-limit and degraded warning signals', async () => {
    const decision: PolicyDecision = {
      allowedLocationIds: ['loc-default', 'loc-a', 'loc-b'],
      overLimit: false,
      degraded: false,
      warning: null,
    };
    const gate = new FakeEntitlementGate(decision);

    // Consumer flow: coverage = requested locations ∩ allowed.
    const coverageFor = async (requested: string[]): Promise<string[]> =>
      (await gate.allowedLocationIds()).allowedLocationIds.filter((id) => requested.includes(id));

    expect(await coverageFor(['loc-b', 'loc-z'])).toEqual(['loc-b']);

    gate.setDecision({
      allowedLocationIds: ['loc-default', 'loc-a'],
      overLimit: true,
      degraded: false,
      warning: 'plan covers 2 of 3 active locations',
    });
    const limited = await gate.allowedLocationIds();
    expect(limited.overLimit).toBe(true);
    expect(limited.allowedLocationIds).not.toContain('loc-b');

    gate.setDecision({
      allowedLocationIds: ['loc-default', 'loc-a', 'loc-b'], // fail-open keeps full coverage
      overLimit: false,
      degraded: true,
      warning: 'billing API unreachable; enforcement continuing fail-open',
    });
    const degraded = await gate.allowedLocationIds();
    expect(degraded.degraded).toBe(true);
    expect(degraded.warning).toContain('fail-open');
  });

  it('raises failures to the consumer instead of inventing decisions', async () => {
    const gate = new FakeEntitlementGate({
      allowedLocationIds: [], overLimit: false, degraded: false, warning: null,
    });
    gate.failNextWith(new Error('instance API down'));
    await expect(gate.allowedLocationIds()).rejects.toThrow('instance API down');
  });
});

describe('FakeScheduleGateway + FakeMutationJournalStore consumed directly', () => {
  it('supports snapshot -> journal -> audit flows for non-mutation consumers', async () => {
    const clock = new FakeClock();
    const trace: string[] = [];
    const gateway = new FakeScheduleGateway({ now: () => clock.now(), trace });
    const journal = new FakeMutationJournalStore({ now: () => clock.now(), trace });
    gateway.seed('sched-x', [{
      eventId: 'e1', type: 'WORKING_HOURS', recurrence: 'MASTER', scheduleId: 'sched-x',
      startLocalDate: '2026-08-24', startLocalTime: '10:00', endLocalTime: '18:00',
      weekday: 'MON', locationId: null, revision: '2', raw: {},
    }]);

    const snapshot = await gateway.snapshotWorkingHours({
      scheduleId: 'sched-x', ownerType: 'BUSINESS', ownerId: 'owner-x',
    });
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.revision).toBe('2'); // full JSON incl. revision

    await journal.recordAudit({
      entryId: 'audit-1', at: clock.now(), actor: 'direct-consumer', action: 'MUTATION_APPLIED',
      planId: 'p-direct', scope: snapshot.scope, summary: 'direct flow', snapshotRef: snapshot.snapshotId,
    });
    const audit = await journal.listAudit({ scheduleId: 'sched-x', ownerType: 'BUSINESS', ownerId: 'owner-x' });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.snapshotRef).toBe(snapshot.snapshotId);

    // Scope filtering excludes other scopes.
    expect(await journal.listAudit({ scheduleId: 'other', ownerType: 'STAFF', ownerId: 'x' })).toEqual([]);
  });
});
