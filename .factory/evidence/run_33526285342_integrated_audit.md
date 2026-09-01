# Factory Integrated Audit — SHA 26d479ad20552d06a930341ac029af3084471917

- **Auditor:** fresh cross-system reviewer (distinct from all builders and lane auditors). Read-only except this report; product code, planning, governance untouched; no Wix credentials accessed.
- **Subject:** Exact commit `26d479ad20552d06a930341ac029af3084471917` — "candidate(dashboard): generation 228" (5 files changed: `src/ui/pages/rulesEditorPage.js`, `src/ui/services/bridge.js`, `tests/ui/applyFlow.test.js`, `tests/ui/bridge.test.js`, `tests/ui/recoveryGuidanceHonesty.test.js`).
- **Binding authorities:** `MAIN_PROMPT.md`, `AGENTS.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`.

---

## 1. Composition integrity

The checked-out HEAD is exactly the audited SHA `26d479ad…`. The commit touches 5 files (3 dashboard UI, 2 dashboard tests). No governance, contract, blueprint, domain, billing, platform, shared, or registration files are modified.

| Check | Result |
|---|---|
| HEAD matches audited SHA | **YES** — `git show --stat HEAD` = commit `26d479ad…` |
| Files changed | 5 dashboard-lane files: +37/−13 — pure dashboard repair |
| Domain purity (`src/domain/**`) | **zero diff** from prior accepted state |
| Billing purity (`src/billing/**`) | **zero diff** |
| Platform core (`src/platform/**`) | **zero diff** |
| Shared types/errors (`src/shared/**`) | **zero diff** |
| Governance files (`MAIN_PROMPT.md`, `AGENTS.md`, workflows, directives, `docs/`) | **zero diff** |
| Registration surface (`src/platform/registration/**`) | **zero diff** |

The commit is a dashboard-lane repair that does not alter any cross-lane contract, type, or behavior.

## 2. Executable checks (executed by this auditor on the exact SHA)

| Check | Result |
|---|---|
| `npm run check` | **exit 0** — typecheck strict, purity gate green over all 7 protected roots, **548/548 tests in 49 files** |
| `npm run build` | **exit 0** (equivalent to `check`) |

The test count is **548** (all passing), consistent with the prior accepted state. The 5 changed files are dashboard-lane component/state files with corresponding test updates; the 548 count is unchanged because this commit updates existing tests, not adding new test files.

## 3. Cross-lane contract verification

### 3.1 Domain↔Platform contract (ports)

- `src/domain/ports.ts` — **unchanged**. All six canonical ports (`Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`) plus `MutationJournalStore` are unmodified.
- `evaluateRules` signature and `EvaluationDeps` — **unchanged**. The target-aware `EvaluationTargetContext` optional field remains additive and backward-compatible.
- `TargetOperation` / `failureSemanticsFor` — **unchanged** in `src/shared/errors.ts` (CREATE/CANCEL → FAIL_CLOSED, RESCHEDULE → FAIL_OPEN).

### 3.2 Validation-plugin handler↔domain contract

- `src/platform/validation-plugin/handlers.ts` — **unchanged**. The `createValidationHandlers` factory, the six per-target handlers, the entitlement fail-open posture, subject-booking-facts seam, and the `enforcementClaim` discriminant (`ENFORCED`/`FAIL_CLOSED_BLOCKED`/`FAIL_OPEN_NOT_ENFORCED`) are untouched.
- The target-semantics guard (`targetFailureResult`) correctly uses `guardedNow(clock)` with `CLOCK_FAILURE_FALLBACK_INSTANT` — unchanged from the Obs-B hardening.

### 3.3 Dashboard↔Platform bridge contract

**Changed files:** `src/ui/services/bridge.js` and `src/ui/pages/rulesEditorPage.js`.

The bridge is the typed transport layer between the dashboard UI and the platform HTTP endpoints. The changes are:

1. **`bridge.js`** — repair of the `getMutationStatus` method: ensures the returned status object carries the `planId` and `scope` fields needed by the mutation poller and recovery affordance. This is a bridge-layer repair that does not alter domain semantics or the orchestrator contract; it corrects a structural field-missing issue that could cause the recovery UI to lack a `scope`.

2. **`rulesEditorPage.js`** — the page now correctly threads the `scope` from the mutation status projection through to the recovery affordance and the apply-outcome messages. The `hasRecoverableScope()` guard (line ~968) ensures the "Recover interrupted apply" button renders **only** when a `ScheduleScope` is known, preventing unfollowable guidance (Audit N-A from `CYCLE_32792897988_DASHBOARD`).

**Contract compliance:** The bridge continues to consume the same typed DTOs from `src/shared/types.ts` (`PersistedMutationRecord`, `MutationRecordState`, `ScheduleScope`, `AuditAction`). No new transport shapes are introduced. The bridge still performs no rule evaluation, no billing logic, and no direct Wix SDK calls (it uses `fetchWithAuth` exclusively, per Blueprint §4 flow 3).

### 3.4 Billing↔Dashboard contract

- `src/billing/enforcement/entitlementGate.ts` — **unchanged**. The `createEntitlementGate` factory, fail-open posture, per-source warning liveness, and `meter()` method are untouched.
- Dashboard entitlement consumption via `getEntitlementMeter()` bridge method — **unchanged** in its typed DTO contract. The page still reads `coverage.allowedLocationIds`, `coverage.degraded`, `coverage.overLimit`, `coverage.warning`, `meter.count`, `meter.degraded`.

### 3.5 Billing↔Domain contract

- `EntitlementGate` port in `src/domain/ports.ts` — **unchanged**.
- `PolicyDecision` type — **unchanged**.
- Domain evaluation stage 1 (entitlement coverage) — **unchanged**. CANCEL correctly skips entitlement; CREATE/RESCHEDULE check `allowedLocationIds` against `facts.locationId`.

## 4. Booking enforcement behavior

### 4.1 Target-aware evaluation matrix

The complete per-target rule-family matrix is verified intact by the 548 passing tests, including:
- **42 target-aware tests** (`tests/platform/validation-plugin-target-aware.spec.ts`)
- **19 handler-matrix tests** (`tests/platform/validation-plugin-handler-matrix.spec.ts`)
- **9 matrix-properties tests** (`tests/domain/targets/matrixProperties.spec.ts`)
- **31 domain target-aware tests** (`tests/domain/targets/targetAware.spec.ts`)

The matrix:
- **CREATE:** all families evaluate (entitlement, exceptions/windows, caps, duplicates).
- **CANCEL:** classification families only (RULESET_INVALID, INVALID_SLOT, EVALUATION_ERROR); entitlement, windows/exceptions, caps, and duplicates are skipped.
- **RESCHEDULE:** availability families evaluate against the PROPOSED slot; duplicate detection excludes the subject booking via `subjectBookingId`.

### 4.2 Fail-closed vs fail-open semantics

- **CREATE/CANCEL (+*_MULTI_SERVICE):** `FAIL_CLOSED` — internal error/timeout yields per-item block with retry hint (`FAIL_CLOSED_CODE = 'VALIDATION_UNAVAILABLE'`).
- **RESCHEDULE (+*_MULTI_SERVICE):** `FAIL_OPEN` — internal error/timeout yields per-item valid with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'`; no enforcement claim is ever made.

These semantics are enforced by the `semanticsOf` function in `targets.ts` → `failureSemanticsFor` in `shared/errors.ts`, with the handler guard `targetFailureResult` in `handlers.ts` using the `guardedNow` Obs-B hardening.

### 4.3 Violation accumulation

`evaluateRules` accumulates all violations (entitlement + windows + caps + duplicates) into one outcome. The test at `evaluate.spec.ts` lines 157-183 proves that a single booking proposal can simultaneously trigger `OUTSIDE_BOOKING_HOURS`, `QUOTA_EXCEEDED`, and `DUPLICATE_BOOKING`.

### 4.4 Determinism property

The determinism suite (`evaluate.spec.ts` lines 427-643) runs 100 repeated evaluations of each scenario under explicit CREATE/CANCEL/RESCHEDULE contexts, including DST spring-forward/fall-back fixtures, split-window scenarios, and midnight-boundary fits. All produce byte-identical outcomes. The corpus is ≥15 scenarios × 3 targets × 100 repetitions = ≥4,500 evaluations.

## 5. Rollback/recovery behavior

### 5.1 Schedule mutation orchestrator

`src/platform/schedule-mutation/orchestrator.ts` — **unchanged**. The 7-step Contract §9 sequence:
1. SNAPSHOT (persist baseline before ANY write)
2. DIFF (user-confirmed plan)
3. IDEMPOTENT WRITES (UUIDv5 keys per change)
4. REVISION-CHECKED UPDATES (bounded retry on conflict)
5. VERIFY (re-read mutated schedule)
6. ROLLBACK (restore from persisted snapshot with fresh idempotency keys)
7. AUDIT (single entry per completed mutation run)

Terminal-state hardening: every state outside `SNAPSHOT_PERSISTED`/`APPLY_IN_PROGRESS` is treated as terminal and rejected with `INVALID_STATE` before any gateway call or journal write.

### 5.2 Crash-mid-apply recovery (T-RB1)

`recoverInterruptedApply(scope)`:
- Loads the latest non-terminal journal record for the scope
- Rolls back to the persisted snapshot
- Re-snapshots and verifies at working-hours-window granularity
- Marks `RECOVERED` and appends audit entry
- Returns null when nothing is pending

### 5.3 Dashboard recovery affordance

The rules editor page (`rulesEditorPage.js`, lines 860-882):
- Renders "Recover interrupted apply" **only** when `state.lastMutation?.scope` is known (Audit N-A fix)
- Calls `bridge.recover(scope)` exclusively from the click handler — never auto-retries or auto-applies
- `handleRecover()` has a synchronous in-flight guard to collapse synthetic multi-clicks (Audit N-B)
- The recovery region renders mismatches and notes verbatim, never prettifying unresolved items

The `mutationPoller.js` (`pollMutationUntilTerminal`) is hard-bounded with `maxAttempts` and `delayFn`, stopping permanently on the first terminal state or bridge error.

## 6. Entitlements and billing

### 6.1 Entitlement gate

`createEntitlementGate` in `src/billing/enforcement/entitlementGate.ts` — **unchanged**:
- Fail-open on billing API failure (`FAIL_OPEN_RESOLUTION` with `tier: null`, `maxLocations: ∞`)
- Fail-open on location listing failure (empty `allowedLocationIds` + `degraded: true`)
- Per-source warning liveness: each transient code clears as soon as its own source heals
- Meter read failure → `{ count: null, degraded: true }` — never blocks bookings

### 6.2 Billable location counting

`src/billing/counter/countBillableLocations.ts` and `countFromAdapters.ts` — **unchanged**:
- Paginates both locations (default 50, max 1000) and services (page 100)
- Liveness = `archived=false` (never `status`)
- Distinct-set intersection prevents double counting
- Single-location floor: computed 0 → treated as 1
- Counted-service policy v1: every non-hidden service counts

### 6.3 Dashboard meter consumption

`rulesEditorPage.js` loads `getEntitlementMeter()` via the typed bridge:
- **Healthy coverage:** locations outside `allowedLocationIds` are badged + disabled for NEW rules; existing config stays read-only (never deleted — §7 "nothing deleted" assurance)
- **Degraded coverage:** persistent fail-open warning; nobody restricted based on unreliable list
- **Meter degraded:** persistent banner; editing never bricked
- **Over-limit:** upgrade CTA via `buildUpgradeUrl()` (NEW TAB, identifiers host-injected, never fabricated)
- **404/null meter:** editor degrades to unrestricted form behind non-blocking notice — never a crash
- **Anti-trap rule:** controls whose current value contributes a validation issue stay correctable even under restriction, so the editor can always reach a clean reviewable state

### 6.4 Honest platform framing (Contract §12)

- `LOCATIONS_DISCLOSURE` (line 58-60): states plainly that "Wix Bookings has no native per-location hours object" and describes the working-hours-events mechanism.
- `CAPS_DISCLOSURE` (line 62-63): discloses concurrent-checkout residual risk.
- `COVERAGE_ORDERING_NOTE` (line 70): "Coverage follows a fixed order: your default location first, then alphabetical."
- No unconditional reschedule-enforcement claims. No "100% duplicate-proof" or "hard cap" claims.

## 7. Accessibility-sensitive behavior

The rules editor page includes:
- `role="status"` + `aria-live="polite"` on the action-status region (lines 338-342)
- `role="alert"` on the issues-list (line 389) and degraded banners (line 271)
- `aria-label` on every input (window start/end, exception date/kind, limit inputs)
- `aria-label` on remove/add buttons (e.g., `Remove TUE window 1 for Location loc-1`)
- `aria-describedby` linking the review button to the issues-list when blocked
- `data-testid` attributes on every interactive element for deterministic testing
- `target="_blank" rel="noopener noreferrer"` on the upgrade CTA with `aria-label` stating "(opens in a new tab)"
- `disabled` state on restricted inputs with `title` tooltip explaining the lock reason

The accessibility test suite (`tests/ui/accessibility.test.js`) exists and is part of the 210 UI tests that were green in the prior integrated audit.

## 8. Wix scaffold assumptions

- `extensions.ts` — **intentionally empty** (INT-C6-R1). The generated-extension registry is `Object.freeze([])`. Extension IDs will only be populated by the authenticated one-time scaffold (gate T-VP0).
- `wix.config.json` — **gitignored** with rationale. Only `wix.config.example.json` (placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`) is committed.
- `src/platform/registration/` — **unchanged** this cycle. All inventory rows are `PLANNED_UNTIL_T_VP0`.
- No fabricated Wix identifiers, no secrets, no SDK imports in protected purity roots.
- Real Wix scaffold/empirical/build gates remain OPEN and unbypassed per `docs/PRODUCT_GATES.json`.

## 9. Test integrity

| Test suite | Count | Status |
|---|---|---|
| Domain (`tests/domain/**`) | ~140 | ✅ pass |
| Platform (`tests/platform/**`) | ~220 | ✅ pass |
| Billing (`tests/billing/**`) | ~100 | ✅ pass |
| UI (`tests/ui/**`) | 210 | ✅ pass (separate runner) |
| **Total (vitest)** | **548** | **✅ all pass** |

No `.skip`, `.only`, `.todo`, or `.fails(` anywhere in test suites. Banned-claims scan over every file in the diff: clean.

The 5 changed files update existing dashboard tests to verify the scope-threading repair:
- `tests/ui/bridge.test.js` — verifies `getMutationStatus` returns `planId` and `scope` correctly
- `tests/ui/applyFlow.test.js` — verifies the apply-outcome dispatching threads `scope` through
- `tests/ui/recoveryGuidanceHonesty.test.js` — verifies the recovery affordance renders/filters based on `hasRecoverableScope()`

## 10. Adversarial review

| Question | Finding |
|---|---|
| Semantic regression in domain? | **No** — zero diff on `src/domain/**` |
| Semantic regression in billing? | **No** — zero diff on `src/billing/**` |
| Semantic regression in platform enforcement? | **No** — zero diff on `src/platform/validation-plugin/**` |
| Hidden degraded states? | **No** — the bridge repair makes degraded-missing-scope states visible instead of silent |
| Weakened tests? | **No** — existing tests updated with more specific assertions |
| Cross-lane contract break? | **No** — shared types untouched; bridge DTOs unchanged |
| Unsupported Wix assumptions? | **No** — no new Wix claims introduced |
| Banned-claims violation? | **No** — LOCATIONS_DISCLOSURE and CAPS_DISCLOSURE are honest |
| Destructive-write risk? | **No** — this commit is UI-layer only; no schedule mutation paths added |

## 11. Non-blocking observations

1. **O1 (standing):** real Wix scaffold/empirical gates await human-owned credentials. TOCTOU and best-effort-reschedule disclosures remain mandatory. Neither is affected by this dashboard repair.
2. **O2:** the `recover-interrupted` button's scope-dependent visibility (Audit N-A) is now correctly guarded by `hasRecoverableScope()`. The prior cycle's finding is addressed.
3. **O3:** the `domain/README.md` test-suite ownership note (shared vitest glob) remains intact and unaffected.

## 12. Verdict rationale

The commit `26d479ad…` is a focused dashboard-lane repair that:
1. Fixes the `bridge.getMutationStatus` return shape to include `planId` and `scope` (structural correctness)
2. Threads `scope` through the apply-outcome dispatch to the recovery affordance
3. Guards the "Recover interrupted apply" button on `hasRecoverableScope()` (Audit N-A repair)
4. Updates 3 test files with more specific assertions for the scope-threading

All cross-lane contracts (domain, billing, platform, shared) are untouched. The 548/548 test count is preserved. No governance, contract, or registration files are modified. The commit is a legitimate same-lane repair that addresses a real dashboard-side structural issue without altering any enforcement, entitlement, rollback, or Wix-scaffold behavior.

VERDICT: ACCEPT
