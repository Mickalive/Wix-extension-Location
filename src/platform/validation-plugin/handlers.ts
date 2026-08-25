/**
 * Booking-time enforcement wiring — the handler factory consuming the pure
 * rules domain (INT-C3-1; Blueprint §4 flow 1; Technical Contract §5.3/§7/§11).
 *
 * LAYERING (binding): this module is PURE Wix-import-free wiring. It consumes
 * the canonical pure `evaluateRules` from `src/domain` with PRE-RESOLVED
 * `EvaluationDeps` built from injected ports, and maps outcomes to explicit
 * per-item results. ZERO rule semantics live here: windows, exceptions, caps
 * and duplicate matching are decided exclusively inside src/domain. The real
 * `bookingsValidation.provideHandlers()` SDK adapter is deferred to the
 * authenticated scaffold (gate T-VP0) and MUST follow ./README.md.
 *
 * TARGET SEMANTICS (Contract §5.3 — test-enforced):
 *   CREATE / CANCEL (+ *_MULTI_SERVICE): FAIL CLOSED. Any internal error or
 *   deadline expiry ⇒ EVERY item gets an explicit block-with-retry-hint.
 *   RESCHEDULE (+ *_MULTI_SERVICE): FAIL OPEN forever. Any internal error or
 *   deadline expiry ⇒ every item explicitly valid + ENFORCEMENT_FAIL_OPEN
 *   degradation logged/alerted/persisted; the result NEVER claims enforcement
 *   (`enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'`).
 *
 * ENTITLEMENT (ratified over-limit posture, Contract §7/§11 C5):
 *   - The gate resolves ONCE per request (fast response). Locations OUTSIDE
 *     `allowedLocationIds` are UNCOVERED: rule evaluation is SKIPPED for them
 *     (enforcement coverage restricted; native Wix behavior applies untouched)
 *     and an explicit valid result is still returned for the index.
 *   - A DEGRADED decision ⇒ fail-open coverage: uncovered locations are
 *     evaluated like covered ones and the warning is surfaced as a persisted
 *     ENTITLEMENT_DEGRADED degradation. A THROWING gate ⇒ synthetic degraded
 *     decision: a billing failure NEVER blocks a paying merchant's booking.
 *
 * COUNTERS (Blueprint flow 4): count queries are planned BY THE DOMAIN's own
 * exported helpers ({applicableLimits}/{countQueryForLimit}/{resolveSlot} —
 * mechanical planning, no decisions), prefetched in one cached pass per
 * request (short TTL), then served synchronously to the evaluator. Gateway
 * failures degrade caps per rule configuration with COUNT_GATEWAY_FAILURE
 * incidents — never silent, never thrown into the booking decision.
 *
 * IDENTITY (Invariant C1): duplicate inputs are identity-free-first. Only the
 * documented payload fields are mapped; metadata.identity is observed
 * structurally but CONSUMED only behind the explicit UNPROVEN-payload flag
 * (`identityPolicy.consumeMetadataIdentity`, default OFF) until gate T-VP3
 * proves which identity fields actually arrive.
 */

import {
  applicableLimits,
  countQueryForLimit,
  evaluateRules,
  resolveSlot,
} from '../../domain';
import type {
  BookingCountGateway,
  BookingFacts,
  Clock,
  CountQuery,
  EntitlementGate,
  EvaluationDeps,
  ExistingBookingFact,
  PolicyDecision,
  RuleOutcome,
  RuleSet,
  RulesConfigStore,
} from '../../domain';
import type { Instant } from '../../shared/types';
import { CachedBookingCountGateway, DEFAULT_COUNTER_TTL_MS, countQueryKey } from './counters';
import type { DegradationRecord, DegradationSink } from './incidents';
import { safeRecord } from './incidents';
import { ownerBusinessLocationId, parseValidationRequest } from './payload';
import type { ParsedSlotItem } from './payload';
import { semanticsOf } from './targets';
import type { ValidationTarget } from './targets';

// ------------------------------------------------------------------ ports

/**
 * Existing-bookings snapshot port feeding identity-free duplicate protection.
 * MUST THROW on infrastructure failure (the handler degrades visibly — see
 * DUPLICATE_INPUT_FAILURE — instead of fabricating blocks or silence).
 */
export interface ExistingBookingsPort {
  loadExisting(): Promise<readonly ExistingBookingFact[]>;
}

/**
 * UNPROVEN-payload flag (Invariant C1 / gate T-VP3). Consumption of
 * `metadata.identity` as a duplicate identity key stays OFF until real
 * payload evidence proves which identity fields arrive.
 */
export interface IdentityPayloadPolicy {
  consumeMetadataIdentity: boolean;
}

export const DEFAULT_IDENTITY_PAYLOAD_POLICY: IdentityPayloadPolicy = {
  consumeMetadataIdentity: false,
};

// ----------------------------------------------------------- deps + result

export interface ValidationPluginDeps {
  configStore: RulesConfigStore;
  entitlementGate: EntitlementGate;
  counts: BookingCountGateway;
  existingBookings: ExistingBookingsPort;
  clock: Clock;
  /** Log + alert + persist seam for every degradation (never silent). */
  degradationSink: DegradationSink;
  /** Short TTL for cached counters (default {@link DEFAULT_COUNTER_TTL_MS}). */
  counterCacheTtlMs?: number;
  /**
   * Optional local deadline (ms) guarding the whole validation exchange.
   * Default: no local deadline (the platform timeout governs; Contract §5.3
   * "timeout ⇒ blocked create"). On expiry the target semantics apply.
   */
  deadlineMs?: number;
  /** Defaults to {@link DEFAULT_IDENTITY_PAYLOAD_POLICY} (flag OFF). */
  identityPolicy?: IdentityPayloadPolicy;
}

/** Why a verdict was reached when the pure evaluator did not decide it. */
export type ItemDisposition =
  | 'RULES_EVALUATED'
  | 'UNCOVERED_LOCATION_RULES_SKIPPED'
  | 'NO_ACTIVE_RULESET'
  | 'INTERNAL_FAILURE_FAIL_CLOSED'
  | 'INTERNAL_FAILURE_FAIL_OPEN';

export interface ValidationItemResult {
  /** Bulk position; results cover EVERY index explicitly (Contract §5.3). */
  index: number;
  valid: boolean;
  /**
   * The verbatim pure-domain outcome when rules were evaluated (deep-equal to
   * a direct `evaluateRules` call with identical inputs); null otherwise.
   */
  outcome: RuleOutcome | null;
  disposition: ItemDisposition;
  /** Present ONLY on invalid items: programmatic code + customer-safe message. */
  invalidReason: { code: string; message: string } | null;
}

/**
 * What this invocation actually claims:
 * - ENFORCED: the rules path executed (per-item dispositions carry nuance).
 * - FAIL_CLOSED_BLOCKED: internal failure on a fail-closed target; all items
 *   blocked with retry hint.
 * - FAIL_OPEN_NOT_ENFORCED: internal failure on RESCHEDULE*; rules were NOT
 *   enforced and this result must never be presented as enforcement.
 */
export type EnforcementClaim = 'ENFORCED' | 'FAIL_CLOSED_BLOCKED' | 'FAIL_OPEN_NOT_ENFORCED';

export interface ValidationHandlerResult {
  target: ValidationTarget;
  /** Explicit result for EVERY item index — omitted items default VALID on the platform side, so gaps would silently approve bookings. */
  results: ValidationItemResult[];
  enforcementClaim: EnforcementClaim;
  /** Degradations produced during THIS invocation (also pushed to the sink). */
  degradations: DegradationRecord[];
}

export type ValidationTargetHandler = (rawRequest: unknown) => Promise<ValidationHandlerResult>;

export interface ValidationHandlers {
  CREATE: ValidationTargetHandler;
  CREATE_MULTI_SERVICE: ValidationTargetHandler;
  CANCEL: ValidationTargetHandler;
  CANCEL_MULTI_SERVICE: ValidationTargetHandler;
  RESCHEDULE: ValidationTargetHandler;
  RESCHEDULE_MULTI_SERVICE: ValidationTargetHandler;
}

/** Block-with-retry-hint constants for fail-closed internal failures. */
export const FAIL_CLOSED_CODE = 'VALIDATION_UNAVAILABLE';
export const FAIL_CLOSED_MESSAGE =
  'We could not validate this booking right now. Please try again in a moment.';

const SYNTHETIC_DEGRADED_WARNING =
  'Entitlement coverage could not be verified — failing open; bookings are never blocked on billing errors.';

interface ResolvedDeps extends ValidationPluginDeps {
  identityPolicyResolved: IdentityPayloadPolicy;
  /**
   * Shared short-TTL counter cache owned by the factory closure: identical
   * queries are fetched once across the TTL — within a bulk exchange AND
   * across consecutive validations (fast-response design, Blueprint flow 4).
   */
  countCache: CachedBookingCountGateway;
}

// ------------------------------------------------------------- internals

class DeadlineExceeded extends Error {
  constructor() {
    super('validation deadline exceeded');
    this.name = 'DeadlineExceeded';
  }
}

function withDeadline<T>(promise: Promise<T>, deadlineMs: number | undefined): Promise<T> {
  if (deadlineMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gate = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), deadlineMs);
  });
  return Promise.race([promise, gate]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function messageOf(error: unknown): string {
  if (error instanceof DeadlineExceeded) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'unknown error';
}

/**
 * Deterministic attribution instant used ONLY when the injected clock itself
 * throws inside the failure guard. Incident timestamps are observability
 * metadata — never rule inputs — so a fixed epoch instant is safe here.
 */
export const CLOCK_FAILURE_FALLBACK_INSTANT: Instant = '1970-01-01T00:00:00.000Z';

/**
 * Obs-B hardening (audit CYCLE_32792897988_INTEGRATION §5 observation B):
 * {@link targetFailureResult} used to call `clock.now()` unguarded, so a
 * THROWING injected clock escaped the target-semantics guard and propagated
 * out of the handler instead of producing guarded per-item results. The
 * failure path must never depend on the very port that may have misbehaved:
 * a clock failure degrades to the fixed fallback instant above.
 */
function guardedNow(clock: Clock): Instant {
  try {
    return clock.now();
  } catch {
    return CLOCK_FAILURE_FALLBACK_INSTANT;
  }
}

/**
 * Maps ONLY documented payload fields into canonical BookingFacts
 * (Invariant C1). location.id becomes a locationId exclusively for
 * OWNER_BUSINESS locations; metadata.identity becomes an identityKey only
 * when the UNPROVEN-payload flag is explicitly enabled.
 */
function bookingFactsFor(item: ParsedSlotItem, policy: IdentityPayloadPolicy): BookingFacts {
  const identity =
    policy.consumeMetadataIdentity && item.metadataIdentity !== null
      ? `${item.metadataIdentity.kind}:${item.metadataIdentity.value}`
      : null;
  return {
    at: item.startDate,
    serviceId: item.serviceId,
    locationId: ownerBusinessLocationId(item),
    slotStart: item.startDate,
    slotEnd: item.endDate,
    timezone: item.timezone,
    identityKey: identity,
  };
}

/**
 * SANCTIONED DOMAIN CONSUMPTION SEAM (see README §4): plans the exact count
 * queries the evaluator will need using the domain's own exported helpers.
 * Purely mechanical — every semantic decision stays inside src/domain. A slot
 * the domain cannot resolve yields zero queries; evaluation will classify it
 * (INVALID_SLOT) without counting anything.
 */
function planCountQueries(rules: RuleSet, facts: BookingFacts): CountQuery[] {
  try {
    if (facts.slotStart === undefined || facts.slotEnd === undefined) return [];
    const resolved = resolveSlot(facts.slotStart, facts.slotEnd, facts.timezone);
    return applicableLimits(rules, facts).map((limit) =>
      countQueryForLimit(limit, facts, resolved.targetDate, facts.timezone),
    );
  } catch {
    return [];
  }
}

interface Emission {
  records: DegradationRecord[];
  emit(record: DegradationRecord): void;
  flush(): Promise<void>;
}

function createEmission(sink: DegradationSink): Emission {
  const records: DegradationRecord[] = [];
  const pending: Promise<void>[] = [];
  return {
    records,
    emit(record: DegradationRecord): void {
      records.push(record);
      pending.push(safeRecord(sink, record));
    },
    async flush(): Promise<void> {
      await Promise.all(pending);
    },
  };
}

async function resolveEntitlementDecision(
  deps: ResolvedDeps,
  target: ValidationTarget,
  at: Instant,
  emission: Emission,
): Promise<PolicyDecision> {
  try {
    const decision = await deps.entitlementGate.allowedLocationIds();
    if (decision.degraded) {
      emission.emit({
        kind: 'ENTITLEMENT_DEGRADED',
        at,
        target,
        detail: decision.warning ?? 'entitlement gate reported degraded coverage — failing open',
      });
    }
    return decision;
  } catch (error) {
    // Ratified posture (§7/C5): a billing API failure NEVER blocks bookings.
    emission.emit({
      kind: 'ENTITLEMENT_GATE_FAILURE',
      at,
      target,
      detail: `entitlement gate failed — failing open: ${messageOf(error)}`,
    });
    return {
      allowedLocationIds: [],
      overLimit: false,
      degraded: true,
      warning: SYNTHETIC_DEGRADED_WARNING,
    };
  }
}

async function resolveExistingBookings(
  deps: ResolvedDeps,
  target: ValidationTarget,
  at: Instant,
  emission: Emission,
): Promise<readonly ExistingBookingFact[]> {
  try {
    return await deps.existingBookings.loadExisting();
  } catch (error) {
    // Duplicate protection is additive to native Wix overlap prevention: a
    // failed read degrades OUR layer visibly instead of blocking customers.
    emission.emit({
      kind: 'DUPLICATE_INPUT_FAILURE',
      at,
      target,
      detail: `existing-booking read failed — duplicate layer degrades to native Wix protection: ${messageOf(error)}`,
    });
    return [];
  }
}

async function preresolveCounts(
  deps: ResolvedDeps,
  rules: RuleSet,
  factsList: readonly BookingFacts[],
  target: ValidationTarget,
  at: Instant,
  emission: Emission,
): Promise<(query: CountQuery) => number | null> {
  const cache = deps.countCache;

  const distinct = new Map<string, CountQuery>();
  for (const facts of factsList) {
    for (const query of planCountQueries(rules, facts)) {
      const key = countQueryKey(query);
      if (!distinct.has(key)) distinct.set(key, query);
    }
  }

  const values = new Map<string, number>();
  const failedKeys = new Set<string>();
  for (const [key, query] of distinct) {
    try {
      values.set(key, await cache.count(query));
    } catch (error) {
      failedKeys.add(key);
      emission.emit({
        kind: 'COUNT_GATEWAY_FAILURE',
        at,
        target,
        detail: `count gateway failed — caps degrade per rule configuration for this query: ${messageOf(error)}`,
        countQueryKey: key,
      });
    }
  }

  return (query: CountQuery): number | null => {
    const key = countQueryKey(query);
    const value = values.get(key);
    if (value !== undefined) return value;
    if (failedKeys.has(key)) {
      // The gateway failure above already covers this query: degrade silently
      // HERE (the domain still emits its per-limit fail-open notice) without
      // double-counting the incident.
      return null;
    }
    // Every derivable query was prefetched above; a miss is an internal
    // invariant break. Degrade that cap check fail-open WITH an incident —
    // never throw into the pure evaluator, never degrade silently.
    emission.emit({
      kind: 'COUNT_CACHE_MISS',
      at,
      target,
      detail: 'count query missed the pre-resolved cache — cap check degrades fail-open',
      countQueryKey: key,
    });
    return null;
  };
}

function itemResultFromOutcome(index: number, outcome: RuleOutcome): ValidationItemResult {
  if (outcome.decision === 'allow') {
    return { index, valid: true, outcome, disposition: 'RULES_EVALUATED', invalidReason: null };
  }
  const firstBlock = outcome.explanations.find((e) => e.decision === 'block');
  return {
    index,
    valid: false,
    outcome,
    disposition: 'RULES_EVALUATED',
    invalidReason: firstBlock
      ? { code: firstBlock.code, message: firstBlock.customerMessage }
      : { code: 'EVALUATION_ERROR', message: 'Booking could not be validated. Please try again shortly.' },
  };
}

/**
 * Executes one structurally valid request. Every dependency failure is
 * converted INSIDE this function into either visible degradation (entitlement,
 * counters, duplicates) or the outer target-semantics guard (unexpected
 * errors/deadline) — it never throws past {@link handleTarget}'s guard except
 * by truly exceptional programming errors, which the guard also catches.
 */
async function executeRequest(
  target: ValidationTarget,
  items: readonly ParsedSlotItem[],
  deps: ResolvedDeps,
  emission: Emission,
): Promise<ValidationHandlerResult> {
  const at = deps.clock.now();
  const rules = await deps.configStore.loadActiveRuleSet();

  if (rules === null) {
    // No active RuleSet ⇒ nothing to enforce; explicit valid for every index.
    await emission.flush();
    return {
      target,
      enforcementClaim: 'ENFORCED',
      results: items.map((item): ValidationItemResult => ({
        index: item.index,
        valid: true,
        outcome: null,
        disposition: 'NO_ACTIVE_RULESET',
        invalidReason: null,
      })),
      degradations: emission.records,
    };
  }

  const entitlement = await resolveEntitlementDecision(deps, target, at, emission);

  // Coverage gate (ratified over-limit posture): healthy decision + location
  // outside allowedLocationIds ⇒ SKIP rule evaluation for that item entirely.
  // Degraded decisions never skip (fail-open coverage).
  const results: ValidationItemResult[] = new Array(items.length);
  const evaluated: { item: ParsedSlotItem; facts: BookingFacts }[] = [];
  for (const item of items) {
    const locationId = ownerBusinessLocationId(item);
    if (
      !entitlement.degraded &&
      locationId !== null &&
      !entitlement.allowedLocationIds.includes(locationId)
    ) {
      results[item.index] = {
        index: item.index,
        valid: true,
        outcome: null,
        disposition: 'UNCOVERED_LOCATION_RULES_SKIPPED',
        invalidReason: null,
      };
      continue;
    }
    evaluated.push({ item, facts: bookingFactsFor(item, deps.identityPolicyResolved) });
  }

  const existing = await resolveExistingBookings(deps, target, at, emission);
  const countLookup = await preresolveCounts(
    deps,
    rules,
    evaluated.map((e) => e.facts),
    target,
    at,
    emission,
  );

  const evalDeps: EvaluationDeps = {
    entitlement,
    countForQuery: countLookup,
    existingBookings: () => existing,
  };

  for (const { item, facts } of evaluated) {
    results[item.index] = itemResultFromOutcome(item.index, evaluateRules(facts, rules, evalDeps));
  }

  await emission.flush();
  return { target, results, enforcementClaim: 'ENFORCED', degradations: emission.records };
}

function blockedWithRetryHint(index: number): ValidationItemResult {
  return {
    index,
    valid: false,
    outcome: null,
    disposition: 'INTERNAL_FAILURE_FAIL_CLOSED',
    invalidReason: { code: FAIL_CLOSED_CODE, message: FAIL_CLOSED_MESSAGE },
  };
}

function allowedFailOpen(index: number): ValidationItemResult {
  return {
    index,
    valid: true,
    outcome: null,
    disposition: 'INTERNAL_FAILURE_FAIL_OPEN',
    invalidReason: null,
  };
}

/**
 * Target-semantics guard: converts ANY internal error/timeout after a
 * successful structural parse into explicit per-item results honoring the
 * binding failure semantics (Contract §5.3), with a logged+surfaced incident.
 */
async function targetFailureResult(
  target: ValidationTarget,
  itemCount: number,
  error: unknown,
  deps: ResolvedDeps,
  emission: Emission,
): Promise<ValidationHandlerResult> {
  const detail = messageOf(error);
  const indices = Array.from({ length: itemCount }, (_, i) => i);

  if (semanticsOf(target) === 'FAIL_OPEN') {
    emission.emit({
      kind: 'ENFORCEMENT_FAIL_OPEN',
      at: guardedNow(deps.clock),
      target,
      detail: `${target} validation failed internally — failing OPEN, rules NOT enforced (best-effort forever): ${detail}`,
    });
    await emission.flush();
    return {
      target,
      enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED',
      results: indices.map(allowedFailOpen),
      degradations: emission.records,
    };
  }

  emission.emit({
    kind: 'ENFORCEMENT_FAIL_CLOSED',
    at: guardedNow(deps.clock),
    target,
    detail: `${target} validation failed internally — failing CLOSED with retry hint: ${detail}`,
  });
  await emission.flush();
  return {
    target,
    enforcementClaim: 'FAIL_CLOSED_BLOCKED',
    results: indices.map(blockedWithRetryHint),
    degradations: emission.records,
  };
}

async function handleTarget(
  target: ValidationTarget,
  rawRequest: unknown,
  deps: ResolvedDeps,
): Promise<ValidationHandlerResult> {
  const emission = createEmission(deps.degradationSink);

  // Structural parse happens BEFORE the target-semantics guard: an unparseable
  // call has no item indices to answer for. It rejects typed INVALID_QUERY to
  // the thin adapter, whose platform-level error surface already implements
  // the binding semantics for such calls (blocked create; fail-open
  // reschedule). Everything AFTER a successful parse never throws past the
  // guard below.
  const parsed = parseValidationRequest(rawRequest);

  try {
    return await withDeadline(executeRequest(target, parsed.items, deps, emission), deps.deadlineMs);
  } catch (error) {
    return targetFailureResult(target, parsed.items.length, error, deps, emission);
  }
}

// ------------------------------------------------------------ factory

/**
 * Builds the six per-target handlers. The T-VP0 thin adapter registers these
 * with `bookingsValidation.provideHandlers(...)` exactly as documented in
 * ./README.md — until that scaffold exists, tests exercise them directly.
 */
export function createValidationHandlers(deps: ValidationPluginDeps): ValidationHandlers {
  const resolved: ResolvedDeps = {
    ...deps,
    identityPolicyResolved: deps.identityPolicy ?? DEFAULT_IDENTITY_PAYLOAD_POLICY,
    countCache: new CachedBookingCountGateway({
      gateway: deps.counts,
      clock: deps.clock,
      ttlMs: deps.counterCacheTtlMs ?? DEFAULT_COUNTER_TTL_MS,
    }),
  };
  return {
    CREATE: (raw) => handleTarget('CREATE', raw, resolved),
    CREATE_MULTI_SERVICE: (raw) => handleTarget('CREATE_MULTI_SERVICE', raw, resolved),
    CANCEL: (raw) => handleTarget('CANCEL', raw, resolved),
    CANCEL_MULTI_SERVICE: (raw) => handleTarget('CANCEL_MULTI_SERVICE', raw, resolved),
    RESCHEDULE: (raw) => handleTarget('RESCHEDULE', raw, resolved),
    RESCHEDULE_MULTI_SERVICE: (raw) => handleTarget('RESCHEDULE_MULTI_SERVICE', raw, resolved),
  };
}
