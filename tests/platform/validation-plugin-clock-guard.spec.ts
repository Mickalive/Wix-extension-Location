/**
 * INT-C4-1(d) — obs-B regression (audit CYCLE_32792897988_INTEGRATION §5
 * observation B): a THROWING injected clock used to escape the
 * target-semantics guard because `targetFailureResult` called `clock.now()`
 * unguarded, propagating out of the handler instead of producing guarded
 * per-item results.
 *
 * Proves: with a throwing clock AND an internal failure, EVERY target still
 * returns complete guarded results honoring Contract §5.3 semantics
 * (fail-closed blocks on CREATE/CANCEL*, fail-open valids on RESCHEDULE*),
 * degradation records carry the documented fallback instant, and nothing
 * throws past the handler boundary. A healthy-clock control pins that the
 * fallback is used ONLY on clock failure.
 */
import { describe, expect, it } from 'vitest';
import { createValidationHandlers, InMemoryDegradationSink } from '../../src/platform/validation-plugin';
import type {
  ValidationHandlerResult,
  ValidationHandlers,
  ValidationTarget,
} from '../../src/platform/validation-plugin';
import { CLOCK_FAILURE_FALLBACK_INSTANT } from '../../src/platform/validation-plugin/handlers';
import { FakeClock } from '../../src/platform/adapters/fakes/clock';
import { FakeBookingCountGateway } from '../../src/platform/adapters/fakes/bookingCountGateway';
import { FakeRulesConfigStore } from '../../src/platform/adapters/fakes/rulesConfigStore';
import { openRuleSet, rawItem, rawRequest, SITE_ZONE } from './helpers/validationPluginRig';
import type { Clock, ExistingBookingFact, RuleSet } from '../../src/domain';

class ThrowingClock implements Clock {
  now(): string {
    throw new Error('injected clock misconfigured — now() exploded');
  }
  zone(): string {
    return SITE_ZONE;
  }
}

/**
 * Works exactly once (executeRequest's opening `at` attribution), then
 * explodes — so the FAILURE path itself (`targetFailureResult`) hits a
 * throwing clock while the deadline-expiry route is genuinely taken.
 */
class ClockThatThrowsAfterFirstCall implements Clock {
  private calls = 0;
  now(): string {
    this.calls += 1;
    if (this.calls > 1) throw new Error('clock died after first read');
    return '2026-08-12T12:00:00.000Z';
  }
  zone(): string {
    return SITE_ZONE;
  }
}

const ALL_TARGETS: ValidationTarget[] = [
  'CREATE',
  'CREATE_MULTI_SERVICE',
  'CANCEL',
  'CANCEL_MULTI_SERVICE',
  'RESCHEDULE',
  'RESCHEDULE_MULTI_SERVICE',
];

function failClosedTargets(): ValidationTarget[] {
  return ALL_TARGETS.filter((t) => !t.startsWith('RESCHEDULE'));
}

function makeRigWith(
  clock: Clock,
  options?: { hangingConfigStore?: boolean; configStoreError?: Error },
): {
  handlers: ValidationHandlers;
  sink: InMemoryDegradationSink;
} {
  const store = new FakeRulesConfigStore();
  store.setActive(openRuleSet());
  let configStore: {
    loadActiveRuleSet: () => Promise<RuleSet | null>;
    saveRuleSet: (next: RuleSet, expectedRevision: string) => Promise<RuleSet>;
  } = store;
  if (options?.configStoreError) {
    const error = options.configStoreError;
    configStore = {
      loadActiveRuleSet: async (): Promise<RuleSet | null> => {
        throw error;
      },
      saveRuleSet: store.saveRuleSet.bind(store),
    };
  } else if (options?.hangingConfigStore) {
    configStore = {
      loadActiveRuleSet: (): Promise<RuleSet | null> => new Promise<RuleSet | null>(() => undefined),
      saveRuleSet: store.saveRuleSet.bind(store),
    };
  }
  const sink = new InMemoryDegradationSink();
  const handlers = createValidationHandlers({
    configStore,
    entitlementGate: { allowedLocationIds: async () => ({
      allowedLocationIds: ['loc-1'],
      overLimit: false,
      degraded: false,
      warning: null,
    }) },
    counts: new FakeBookingCountGateway(),
    existingBookings: {
      loadExisting: async (): Promise<readonly ExistingBookingFact[]> => [],
    },
    clock,
    degradationSink: sink,
    ...(options?.hangingConfigStore ? { deadlineMs: 15 } : {}),
  });
  return { handlers, sink };
}

async function runTarget(
  handlers: ValidationHandlers,
  target: ValidationTarget,
): Promise<ValidationHandlerResult> {
  const request = rawRequest([rawItem(), rawItem({ serviceId: 'svc-2', locationId: 'loc-1' })]);
  const handler = handlers[target];
  return (await handler(request)) as ValidationHandlerResult;
}

describe('obs-B regression: throwing injected clock still yields guarded per-item results', () => {
  it('every fail-closed target (CREATE/CANCEL + multi) blocks every item with the retry hint', async () => {
    for (const target of failClosedTargets()) {
      const { handlers, sink } = makeRigWith(new ThrowingClock());
      const result = await runTarget(handlers, target);

      expect(result.target).toBe(target);
      expect(result.enforcementClaim).toBe('FAIL_CLOSED_BLOCKED');
      expect(result.results.map((r) => r.index)).toEqual([0, 1]);
      for (const item of result.results) {
        expect(item.valid).toBe(false);
        expect(item.disposition).toBe('INTERNAL_FAILURE_FAIL_CLOSED');
        expect(item.invalidReason?.code).toBe('VALIDATION_UNAVAILABLE');
        expect(item.outcome).toBeNull();
      }
      // Degradation record exists, was persisted to the sink, and carries the
      // documented fallback instant (the real clock threw).
      expect(result.degradations).toHaveLength(1);
      expect(result.degradations[0]?.kind).toBe('ENFORCEMENT_FAIL_CLOSED');
      expect(result.degradations[0]?.at).toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
      expect(sink.records).toHaveLength(1);
      expect(sink.records[0]?.at).toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
    }
  });

  it('every fail-open target (RESCHEDULE + multi) explicitly validates every item and never claims enforcement', async () => {
    for (const target of ['RESCHEDULE', 'RESCHEDULE_MULTI_SERVICE'] as ValidationTarget[]) {
      const { handlers, sink } = makeRigWith(new ThrowingClock());
      const result = await runTarget(handlers, target);

      expect(result.target).toBe(target);
      expect(result.enforcementClaim).toBe('FAIL_OPEN_NOT_ENFORCED');
      expect(result.results.map((r) => r.index)).toEqual([0, 1]);
      for (const item of result.results) {
        expect(item.valid).toBe(true);
        expect(item.disposition).toBe('INTERNAL_FAILURE_FAIL_OPEN');
        expect(item.invalidReason).toBeNull();
      }
      expect(result.degradations).toHaveLength(1);
      expect(result.degradations[0]?.kind).toBe('ENFORCEMENT_FAIL_OPEN');
      expect(result.degradations[0]?.at).toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
      expect(sink.records[0]?.at).toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
    }
  });

  it('deadline expiry with a clock that dies AFTER its first read still yields guarded results', async () => {
    // The opening `at` attribution succeeds; the store hangs; the deadline
    // fires; `targetFailureResult` then meets a THROWING clock — the guard
    // must hold on exactly that route (obs-B's original escape path).
    const { handlers } = makeRigWith(new ClockThatThrowsAfterFirstCall(), {
      hangingConfigStore: true,
    });
    for (const target of ALL_TARGETS) {
      const result = await runTarget(handlers, target);
      const failOpen = target.startsWith('RESCHEDULE');
      expect(result.enforcementClaim).toBe(failOpen ? 'FAIL_OPEN_NOT_ENFORCED' : 'FAIL_CLOSED_BLOCKED');
      expect(result.results.map((r) => r.index)).toEqual([0, 1]);
      for (const item of result.results) {
        expect(item.disposition).toBe(
          failOpen ? 'INTERNAL_FAILURE_FAIL_OPEN' : 'INTERNAL_FAILURE_FAIL_CLOSED',
        );
      }
      expect(result.degradations[0]?.at).toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
    }
  });

  it('control: a healthy clock keeps attributing REAL instants (fallback only on clock failure)', async () => {
    const healthy = new FakeClock('2026-08-12T12:00:00.000Z', SITE_ZONE);
    const { handlers, sink } = makeRigWith(healthy, {
      configStoreError: new Error('ruleset store outage'),
    });
    const result = await runTarget(handlers, 'CREATE');

    expect(result.enforcementClaim).toBe('FAIL_CLOSED_BLOCKED'); // store failure path
    expect(result.degradations[0]?.at).toBe('2026-08-12T12:00:00.000Z');
    expect(sink.records[0]?.at).toBe('2026-08-12T12:00:00.000Z');
    expect(sink.records[0]?.at).not.toBe(CLOCK_FAILURE_FALLBACK_INSTANT);
  });
});
