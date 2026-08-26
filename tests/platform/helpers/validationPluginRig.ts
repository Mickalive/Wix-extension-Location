/**
 * Test rig for the validation-plugin handler suites (INT-C3-1).
 *
 * Composes only accepted fakes + injected ports; every scenario is
 * deterministic (FakeClock, seeded counters, explicit errors). Fixture zone:
 * America/New_York (EDT, UTC−4 for all of August 2026), anchor Wednesday
 * 2026-08-12 — local 13:00 == 17:00Z (hand-checkable, mirrors the domain
 * fixture conventions).
 */
import { FakeClock } from '../../../src/platform/adapters/fakes/clock';
import { FakeBookingCountGateway } from '../../../src/platform/adapters/fakes/bookingCountGateway';
import type { SeededBooking } from '../../../src/platform/adapters/fakes/bookingCountGateway';
import { FakeEntitlementGate } from '../../../src/platform/adapters/fakes/entitlementGate';
import { FakeRulesConfigStore } from '../../../src/platform/adapters/fakes/rulesConfigStore';
import {
  createValidationHandlers,
  InMemoryDegradationSink,
} from '../../../src/platform/validation-plugin';
import type {
  IdentityPayloadPolicy,
  SubjectBookingFactsPort,
  ValidationHandlers,
} from '../../../src/platform/validation-plugin';
import type {
  BookingCountGateway,
  CountQuery,
  ExistingBookingFact,
  PolicyDecision,
  RulesConfigStore,
  RuleSet,
} from '../../../src/domain';

export const SITE_ZONE = 'America/New_York';
/** Wednesday 2026-08-12, EDT. Local 13:00–14:00 == 17:00–18:00Z. */
export const ANCHOR_START = '2026-08-12T17:00:00.000Z'; // 13:00 local
export const ANCHOR_END = '2026-08-12T18:00:00.000Z'; // 14:00 local
export const OUTSIDE_START = '2026-08-12T15:00:00.000Z'; // 11:00 local
export const OUTSIDE_END = '2026-08-12T16:00:00.000Z'; // 12:00 local

export function healthyEntitlement(allowed: string[] = ['loc-1']): PolicyDecision {
  return { allowedLocationIds: allowed, overLimit: false, degraded: false, warning: null };
}

export function degradedEntitlement(
  warning = 'billing API unavailable — fail-open coverage',
): PolicyDecision {
  return { allowedLocationIds: [], overLimit: false, degraded: true, warning };
}

/** Minimal valid RuleSet with nothing configured (default-open posture). */
export function openRuleSet(overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    ruleSetId: 'ruleset-vp',
    revision: 'rev-1',
    version: 1,
    locationWindows: {},
    serviceWindows: {},
    exceptions: [],
    limits: [],
    ...overrides,
  };
}

export interface RawItemOptions {
  serviceId?: string;
  start?: string;
  end?: string;
  timezone?: string;
  /** null ⇒ location key omitted entirely. */
  locationId?: string | null;
  locationType?: string;
  /** Omits the locationType field entirely (default is 'OWNER_BUSINESS'). */
  omitLocationType?: boolean;
  scheduleId?: string | null;
  identity?: Record<string, unknown> | null;
  /** Junk merged at the item root to prove undocumented fields are ignored. */
  extraItemFields?: Record<string, unknown>;
  /** Junk merged into slot to prove undocumented fields are ignored. */
  extraSlotFields?: Record<string, unknown>;
}

/** Builds one raw bulk item using ONLY documented payload paths (+ optional junk). */
export function rawItem(options: RawItemOptions = {}): Record<string, unknown> {
  const {
    serviceId = 'svc-1',
    start = ANCHOR_START,
    end = ANCHOR_END,
    timezone = SITE_ZONE,
    locationId = 'loc-1',
    locationType = 'OWNER_BUSINESS',
    omitLocationType = false,
    scheduleId = null,
    identity = null,
    extraItemFields = {},
    extraSlotFields = {},
  } = options;
  const slot: Record<string, unknown> = {
    serviceId,
    startDate: start,
    endDate: end,
    timezone,
    ...extraSlotFields,
  };
  if (scheduleId !== null) slot.scheduleId = scheduleId;
  if (locationId !== null) {
    slot.location = {
      id: locationId,
      ...(omitLocationType ? {} : { locationType }),
    };
  }
  const item: Record<string, unknown> = {
    bookedEntity: { slot },
    ...extraItemFields,
  };
  if (identity !== null) item.metadata = { identity };
  return item;
}

export function rawRequest(items: unknown[]): { items: unknown[] } {
  return { items };
}

/** Counting wrapper proving exactly how many gateway reads occur. */
export class CountingCountGateway implements BookingCountGateway {
  calls = 0;
  readonly queries: CountQuery[] = [];

  constructor(private readonly inner: BookingCountGateway) {}

  async count(query: CountQuery): Promise<number> {
    this.calls += 1;
    this.queries.push(structuredClone(query));
    return this.inner.count(query);
  }
}

export interface RigOptions {
  ruleSet?: RuleSet | null;
  entitlement?: PolicyDecision;
  seededBookings?: SeededBooking[];
  existingBookings?: ExistingBookingFact[];
  configStoreError?: Error;
  /** Never-resolving RuleSet load — deterministic deadline-expiry proof. */
  hangingConfigStore?: boolean;
  /**
   * Replaces the fake store entirely (INT-C5-1): fixtures that need the REAL
   * loaded object identity preserved (e.g. getter-poisoned RuleSets probing
   * the evaluator's internal failure classification).
   */
  configStoreOverride?: RulesConfigStore;
  /**
   * Injectable subject-booking-facts seam (INT-C5-1). Absent ⇒ the factory
   * default applies (facts unavailable ⇒ subjectBookingId undefined ⇒
   * behavior identical to the pre-INT-C5-1 handlers).
   */
  subjectBookingFacts?: SubjectBookingFactsPort;
  existingError?: Error;
  counterError?: Error;
  counterTtlMs?: number;
  deadlineMs?: number;
  identityPolicy?: IdentityPayloadPolicy;
  clockStart?: string;
}

export interface Rig {
  handlers: ValidationHandlers;
  /** The exact InMemoryDegradationSink handed to the factory. */
  sink: InMemoryDegradationSink;
  gate: FakeEntitlementGate;
  countingGateway: CountingCountGateway;
  innerCounts: FakeBookingCountGateway;
  clock: FakeClock;
  existingCalls: () => number;
}

export function makeRig(options: RigOptions = {}): Rig {
  const clock = new FakeClock(options.clockStart ?? '2026-08-12T12:00:00.000Z', SITE_ZONE);

  const store = new FakeRulesConfigStore();
  store.setActive(options.ruleSet !== undefined ? options.ruleSet : openRuleSet());
  let configStore: Pick<RulesConfigStore, 'loadActiveRuleSet' | 'saveRuleSet'> = options.configStoreOverride ?? store;
  if (!options.configStoreOverride && options.configStoreError) {
    configStore = {
      loadActiveRuleSet: async (): Promise<RuleSet | null> => {
        throw options.configStoreError as Error;
      },
      saveRuleSet: store.saveRuleSet.bind(store),
    };
  } else if (!options.configStoreOverride && options.hangingConfigStore) {
    configStore = {
      loadActiveRuleSet: (): Promise<RuleSet | null> => new Promise<RuleSet | null>(() => undefined),
      saveRuleSet: store.saveRuleSet.bind(store),
    };
  }

  const gate = new FakeEntitlementGate(options.entitlement ?? healthyEntitlement());

  const innerCounts = new FakeBookingCountGateway();
  if (options.seededBookings) innerCounts.seed(options.seededBookings);
  const countingGateway = new CountingCountGateway(
    options.counterError
      ? {
          count: async (): Promise<number> => {
            throw options.counterError as Error;
          },
        }
      : innerCounts,
  );

  let existingLoadCount = 0;
  const existingBookings = {
    loadExisting: async (): Promise<readonly ExistingBookingFact[]> => {
      existingLoadCount += 1;
      if (options.existingError) throw options.existingError;
      return options.existingBookings ?? [];
    },
  };

  const sink = new InMemoryDegradationSink();
  const handlers = createValidationHandlers({
    configStore,
    entitlementGate: gate,
    counts: countingGateway,
    existingBookings,
    clock,
    degradationSink: sink,
    ...(options.counterTtlMs !== undefined ? { counterCacheTtlMs: options.counterTtlMs } : {}),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.identityPolicy !== undefined ? { identityPolicy: options.identityPolicy } : {}),
    ...(options.subjectBookingFacts !== undefined
      ? { subjectBookingFacts: options.subjectBookingFacts }
      : {}),
  });

  return {
    handlers,
    sink,
    gate,
    countingGateway,
    innerCounts,
    clock,
    existingCalls: () => existingLoadCount,
  };
}
