# Booking-time enforcement wiring — pure modules + wiring protocol

> **STAGING NOTE (integration lane, INT-C3-1 — mirrors the cycle-2
> `src/platform/http/` staging pattern).** The unified-CLI project layout and
> the real `bookingsValidation.provideHandlers()` adapter from
> `@wix/bookings/service-plugins` do not exist yet: they are created at the
> authenticated scaffold (gate **T-VP0**, human-owned prerequisites per
> Technical Contract §16; service-plugin registration itself is empirically
> unconfirmed until then — Contract §3). This directory therefore contains the
> COMPLETE enforcement logic as pure, Wix-import-free modules plus this
> binding wiring protocol. Whoever writes the thin SDK adapter at scaffold
> time MUST follow it verbatim. **No production-capability claim is made or
> implied until gates T-VP0–T-VP5 pass on a real dev site.**

## 1. What this layer is

Blueprint §4 flow 1: Wix → validation-plugin handler → load active RuleSet →
evaluate PURE rules → explicit per-item results for EVERY bulk index → record
degradations → respond fast.

The factory `createValidationHandlers(deps)` returns six per-target handlers
(`CREATE`, `CREATE_MULTI_SERVICE`, `CANCEL`, `CANCEL_MULTI_SERVICE`,
`RESCHEDULE`, `RESCHEDULE_MULTI_SERVICE`). Each takes the raw request object,
structurally parses it, pre-resolves evaluation dependencies from injected
ports, calls the canonical pure `evaluateRules` from `src/domain` ONCE PER
ITEM, and maps outcomes to explicit results. Zero rule semantics live here —
the handler matrix tests prove outcomes are the domain's verbatim.

## 2. Binding target semantics (Contract §5.3 — test-enforced)

| Target(s) | Internal error / deadline expiry | Claim in result |
|---|---|---|
| CREATE, CREATE_MULTI_SERVICE | FAIL CLOSED — every item blocked with retry hint (`VALIDATION_UNAVAILABLE`) | `FAIL_CLOSED_BLOCKED` |
| CANCEL, CANCEL_MULTI_SERVICE | FAIL CLOSED — same as CREATE | `FAIL_CLOSED_BLOCKED` |
| RESCHEDULE, RESCHEDULE_MULTI_SERVICE | FAIL OPEN forever — every item explicitly valid + `ENFORCEMENT_FAIL_OPEN` degradation logged/alerted/persisted | `FAIL_OPEN_NOT_ENFORCED` (never claims enforcement) |

Structurally unparseable requests (no item indices to answer for) reject with
typed `INVALID_QUERY` to the thin adapter BEFORE any dependency runs; the
platform-level error surface already implements the binding semantics for such
calls (blocked create, fail-open reschedule).

## 3. Payload mapping — documented fields ONLY (Invariant C1)

Per item, exactly these fields are mapped (Contract §5.3 verbatim paths):

| Parsed field | Payload path | Notes |
|---|---|---|
| `serviceId` | `bookedEntity.slot.serviceId` | required non-empty string |
| `scheduleId` | `bookedEntity.slot.scheduleId` | optional string |
| `startDate`/`endDate` | `bookedEntity.slot.startDate` / `.endDate` | UTC instants; format problems classify as fail-closed `INVALID_SLOT` in the domain |
| `timezone` | `bookedEntity.slot.timezone` | booking timezone (§4.7) |
| `locationId` | `bookedEntity.slot.location.id` | extracted ONLY when `location.locationType === 'OWNER_BUSINESS'`; otherwise null |
| identity (gated) | `metadata.identity.{memberId\|wixUserId\|anonymousVisitorId\|appId}` | observed structurally; CONSUMED only when `identityPolicy.consumeMetadataIdentity === true` (default OFF) until payload-probe gate T-VP3 proves what actually arrives |

Everything else — including all redacted `contactDetails` content and any
UNPROVEN survivor such as `contactDetails.contactId` — is dropped at this
boundary and can never reach a fact, count query or duplicate key.

Bulk cap: `MAX_BULK_ITEMS = 12` (Contract §5.3 maxItems). The platform's
omitted-items-default-valid hazard is neutralized by construction: handlers
return an explicit result for EVERY index (proven by the bulk suite, including
a mixed skip/block/allow repro at the 12-item boundary).

## 4. Sanctioned domain consumption seam

This lane may call ONLY these pure-domain exports, and only mechanically:

- `evaluateRules(facts, rules, deps)` — the single decision function;
- `resolveSlot` + `applicableLimits` + `countQueryForLimit` — used solely to
  PLAN which `CountQuery`s to prefetch so `EvaluationDeps.countForQuery` can be
  synchronous and fully served from one cached pass (fast-response design);
- types (`BookingFacts`, `EvaluationDeps`, `RuleOutcome`, ...).

Any other domain internal (window algebra, exception precedence, duplicate
matching, explanation construction) is forbidden here and guarded by the
refined marker scan in `tests/platform/platform-scope.spec.ts`.

## 5. Degradation posture (never silent)

Every degradation produces a typed `DegradationRecord` that is BOTH returned
in the result (`degradations[]`) AND pushed to the injected `DegradationSink`
(production adapter: log + alert + persist to a data collection; keep it
local-first so persistence outages cannot swallow incidents; sink failures
never alter booking outcomes):

| Kind | Trigger | Effect on bookings |
|---|---|---|
| `ENTITLEMENT_GATE_FAILURE` | gate port threw | synthetic degraded decision — fail-open coverage; NEVER blocks (§7/C5) |
| `ENTITLEMENT_DEGRADED` | gate returned `degraded: true` | coverage treated as fail-open; warning surfaced verbatim |
| `COUNT_GATEWAY_FAILURE` | count gateway threw for a query | caps degrade per rule configuration (domain emits per-limit fail-open notices) |
| `COUNT_CACHE_MISS` | prefetched query missed (invariant break) | that cap check degrades fail-open |
| `DUPLICATE_INPUT_FAILURE` | existing-bookings read failed | plugin duplicate layer degrades to native Wix overlap protection |
| `ENFORCEMENT_FAIL_OPEN` | RESCHEDULE* internal failure/deadline | rules NOT enforced for this call |
| `ENFORCEMENT_FAIL_CLOSED` | CREATE/CANCEL* internal failure/deadline | all items blocked with retry hint |

Entitlement coverage semantics (ratified over-limit posture): locations
outside `allowedLocationIds` are UNCOVERED — rule evaluation is SKIPPED for
them (explicit valid result, disposition `UNCOVERED_LOCATION_RULES_SKIPPED`);
degraded decisions never skip (fail-open coverage).

## 6. Thin adapter protocol (execute at scaffold time, T-VP0)

1. Capture the REAL `bookingsValidation.provideHandlers()` import path, config
   shape (`deploymentUri`, `validationTargets`) and handler signatures from the
   current official docs and generated scaffold — do NOT guess API shapes
   before T-VP0 evidence exists.
2. Register one thin handler per target, delegating immediately to the matching
   handler from this barrel.
3. Map the real wire envelope onto `{ items: [...] }` (§3 table) and pass it as
   the raw request object.
4. Map `ValidationHandlerResult` onto the SDK response DTO:
   - `result.valid` → per-item `valid`;
   - `invalidReason.message` → customer-displayed rejection text
     (`InvalidReason.message` / `FieldViolation.description`);
   - `invalidReason.code` → programmatic code (`FieldViolation.code`);
   - forward `degradations[]` + `enforcementClaim` to the audit/explain sink.
5. Wire `ValidationPluginDeps`: `RulesConfigStore`, `EntitlementGate` (built
   ONCE by the composition root `../composition/entitlementComposition.ts` —
   `composeValidationEntitlement` wires the billing projector via
   `projectedSnapshotSource` + `createEntitlementGate` and owns the mandatory
   §7 reconciliation poll; INT-C4-1a), `BookingCountGateway` (Count
   Extended Bookings adapter + TTL cache), `ExistingBookingsPort`, real clock,
   degradation sink. All scopes per Contract §5; no new permissions.
6. Record T-VP0/T-VP3 probe evidence (payload fields incl. identity variants)
   before enabling `identityPolicy.consumeMetadataIdentity`. It stays OFF by
   default.

## 7. Scope discipline (audit-facing)

- No business-rule logic: every verdict originates from `src/domain`.
- No pricing/billing policy: entitlement arrives as an accepted billing-lane
  `PolicyDecision` via the canonical port.
- No live Wix calls, no fabricated identifiers, no secrets.
- Purity gate covers this directory since cycle 3
  (`npm run check:purity`).
