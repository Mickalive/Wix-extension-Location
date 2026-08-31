# Integrated Audit — SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** independent integrated auditor (fresh cross-system review, distinct from all builders and lane auditors)
- **Subject:** exact commit `ec916b75d5600e02d679d264648ac92333d721f1` ("product: remove obsolete control-plane workflows and retry scripts") on branch `lab/wix-rules`
- **Accepted base:** same commit (this is the current accepted state)
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `AGENTS.md`, lane fiches
- **Scope:** verify contracts between integration, rules, dashboard, billing; booking enforcement; rollback/recovery; entitlements; accessibility-sensitive behavior; real Wix scaffold assumptions. No fixes; verdict only.

---

## 1. Composition Integrity (mechanical)

| Check | Result |
|---|---|
| `git status` | clean working tree (only agent fiche churn, no product drift) |
| `git diff HEAD~1..HEAD` | 4 deleted workflow/action files (control-plane removal); **zero product code changes** |
| `src/domain/**`, `src/billing/**`, `src/platform/**`, `src/ui/**`, `src/shared/**`, `src/extensions/**` | byte-identical to prior accepted cycle (32920420147) |
| `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `docs/state.json`, `docs/PRODUCT_GATES.json` | unchanged |
| Lane scopes | disjoint; no merge conflicts possible |

The commit under audit is a **governance-only cleanup** (removing deprecated CI workflows and retry scripts). All product code, tests, contracts, and evidence remain exactly as they were in the last integrated cycle (run 32920420147), which received `VERDICT: ACCEPT` from the prior integrated auditor.

---

## 2. Executable Checks (reproduced on the exact SHA)

| Gate | Result | Notes |
|---|---|---|
| `npm run check:purity` | **PASS** | 7 protected roots (domain, billing/pure, platform/http, platform/webhooks, platform/validation-plugin, platform/composition, platform/registration) — no `@wix/` imports |
| `npm run check` (tsc strict + vitest) | **PASS** | 548/548 tests in 49 files; `PURITY GATE FAILED` stdout is the expected negative-control fixture |
| `npm run check:offline` (proxies → dead port) | **PASS** | 548/548 — zero network egress |
| `npm run build` | **PASS** | equals `check` |
| Dashboard lane (`npm test` in `tests/ui`) | **PASS** | 210/210 tests |
| Hygiene | **CLEAN** | no `.skip/.only/.todo/.fails(`; banned-claims scan (§12 vocabulary) clean |

Arithmetic verified: cycle-6 accepted 518 + 30 new (registration-surface + registration-project-config) = 548 exact. No test lost or duplicated.

---

## 3. Cross-Lane Contract Parity (frozen, verified)

### 3.1 Canonical DTOs (`src/shared/types.ts`) — **byte-identical** to cycle-6 pins
- `RuleSetDTO`, `BookingFacts`, `CountQuery`, `PolicyDecision`, `ScheduleScope`, `MutationPlan`, `ScheduleSnapshot`, `Explanation`, `RuleOutcome`, `Slot`, `SlotQuery`, `AuditLogEntry`, `VerifyResult`, `RollbackResult`, `AppliedChangeRecord`, `PersistedMutationRecord`, `JournalProgressPatch`, `Weekday`, `BookingStatus`, `Instant`, `IanaZone`, `LocalDate`, `LocalTime` — all frozen.

### 3.2 Domain Ports (`src/domain/ports.ts`) — **byte-identical** to cycle-6 pins
- `Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`, `MutationJournalStore` — all frozen.
- Additive `EvaluationTargetContext` (cycle-4 RULES-C4-1) present with safe `DEFAULT_TARGET_CONTEXT = { target: 'CREATE' }` — **bit-for-bit backward compatible**.

### 3.3 Target Mapping (six → three) — **compile-time pinned**
- `evaluationTargetOf()` strips `_MULTI_SERVICE`; `semanticsOf()` routes through `failureSemanticsFor`.
- `EvaluationTarget` aliases shared `TargetOperation` (compile-time sync).
- 42 target-aware + 19 handler-matrix + 9 matrix-properties + 31 domain target-aware tests all green inside 548.

### 3.4 Validation-Plugin Wiring (`src/platform/validation-plugin/handlers.ts`) — **unchanged**
- `createValidationHandlers()` factory consumes pure `evaluateRules` with pre-resolved `EvaluationDeps`.
- **CREATE/CANCEL** → fail-closed (block-with-retry-hint on any internal error/timeout).
- **RESCHEDULE** → fail-open forever (`FAIL_OPEN_NOT_ENFORCED`, never claims enforcement).
- Subject-booking-facts seam (`subjectBookingFacts` port) **injected, default-inert** — activation only via evidence-backed adapter (gates T-VP3/T-VP5).
- Same-day self-count adjustment (`subjectAwareCountLookup`) applies **only when subject fact provably contributes** to the queried bucket — degrades exactly as before when unprovable.
- Entitlement coverage gate: healthy decision + location outside `allowedLocationIds` ⇒ `UNCOVERED_LOCATION_RULES_SKIPPED` (valid, rules skipped); degraded ⇒ fail-open coverage (no skip, warning persisted).
- Counters: domain plans queries via `applicableLimits`/`countQueryForLimit`/`resolveSlot`; prefetched once per request via `CachedBookingCountGateway` (short TTL); gateway failures → `COUNT_GATEWAY_FAILURE` incident + per-limit fail-open notice (never silent, never thrown).

### 3.5 Dashboard ↔ Platform Contract — **pinned v1 DTO, verbatim consumption**
- `meterEndpoint.ts` projects `entitlementGate.allowedLocationIds()` → `{ meter: { count, degraded }, coverage: { allowedLocationIds, overLimit, degraded, warning } }`.
- `bridge.getEntitlementMeter()` is the **single** transport touch; no direct SDK/REST calls in UI.
- Editor restricts **NEW** rule configuration for uncovered locations (badged + disabled); existing config stays rendered read-only, never deleted (Contract §7).
- Anti-trap: controls whose current value contributes a validation issue stay correctable (issue-path unlock).
- Degraded coverage fails OPEN exactly like enforcement (persistent warning banner, no restriction on unreliable list).
- `meter.degraded` → fail-open warning banner without bricking editing.
- `overLimit` → Contract §7 upgrade CTA (`buildUpgradeUrl`, NEW TAB, host-injected identifiers only).
- 404/null/transport failure → unrestricted editor behind non-blocking notice (never crash).
- `ruleDraftValidators.js` byte-frozen; parity ledger (`uiValidatorParity.spec.ts` 30 tests) green.

### 3.6 Billing/Enforcement Composition — **unforked**
- `createEntitlementGate()` resolves once per request; throwing gate ⇒ synthetic degraded fail-open decision (billing failures never block bookings, §7/C5).
- Degraded ⇒ no coverage skip + persisted `ENTITLEMENT_DEGRADED` warning.
- `selectManagedLocations()` stable ordering: default location first, then alphabetical by location id; over-limit locations → `unmanagedLocationIds` (management disabled, configuration preserved).
- `countBillableLocations()` ratified definition: live (`archived=false`) business locations referenced by at least one non-hidden service; distinct-set intersection; computed 0 ⇒ floor 1 (billing only, reporting set stays true computed set).
- `resolveEntitlement()` decision table: null snapshot → FREE; `isFree:true` → FREE; empty `vendorProductId` → FREE; known id → that tier; unknown paid id → TIER_1 + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false` (fail-safe: under-serve).
- All billing tests (entitlement, coverage, counter, projection, tiers, downgradeThroughGate, purity) green.

---

## 4. Booking Enforcement Behavior (adversarially verified)

### 4.1 Evaluation Stages (pure `evaluateRules`, deterministic, synchronous)
1. **Fail-closed classification** (`RULESET_INVALID` / `INVALID_SLOT` / `EVALUATION_ERROR`) — never throws.
2. **Entitlement coverage** (skipped for CANCEL; fail-open on degraded).
3. **Exceptions + Weekly Windows** (site-zone wall clock, Contract §4.7 DST semantics).
4. **Caps** per day/service/location with declared `includedStatuses` (UTC-bounded queries via `Count Extended Bookings` semantics).
5. **Duplicate protection** (identity-free first, Contract §11 C1).

### 4.2 Target-Aware Semantics (cycle-4 RULES-C4-1, wired in INT-C5-1)
| Target | Families Evaluated | Notes |
|---|---|---|
| `CREATE` / `CREATE_MULTI_SERVICE` | All (legacy behavior verbatim) | |
| `CANCEL` / `CANCEL_MULTI_SERVICE` | Classification only (ruleset validity + slot shape) | Cancellation frees capacity; windows/exceptions/caps/duplicates/entitlement cannot meaningfully constrain removal. Explicit allow when no classification block. |
| `RESCHEDULE` / `RESCHEDULE_MULTI_SERVICE` | Availability families against **proposed** slot (windows/exceptions/caps as CREATE); duplicate detection excludes `subjectBookingId` (mover's own still-existing booking) | Without subject id, exclusion inert (documented residual). |

**Verified by independent runtime probes (7) against integrated tree** — all passing:
- RESCHEDULE_MULTI_SERVICE strips to RESCHEDULE; self-overlap passes, genuine third-party overlap blocks.
- Seam never consulted for CANCEL/CREATE.
- CANCEL_MULTI_SERVICE frees capacity on at-capacity day while CREATE blocks.
- Degraded entitlement × self-count compose correctly.
- Mixed-coverage bulk RESCHEDULE: uncovered skipped, covered evaluated, one seam consult.
- All-uncovered request ⇒ zero seam consultations.

### 4.3 Duplicate Protection (identity-free first, Contract §11 C1)
- **Identity-free**: existing ACTIVE booking for SAME SERVICE, start on proposal's site-zone day, half-open interval overlap → `DUPLICATE_BOOKING` (strongest signal).
- **Identity-keyed** (only when `identityKey` supplied via UNPROVEN-payload flag): overlapping existing booking with SAME key, DIFFERENT service → `IDENTITY_TIME_CONFLICT`.
- Known v1 limitation (audit A2): bucketing uses existing booking's START in site zone → native overnight booking starting previous day but overlapping proposal not caught. Documented, not hidden.
- `contactDetails.contactId` availability in payload **UNPROVEN** — parser ignores it; identity keying stays behind explicit flag until T-VP3/T-VP5 evidence.

### 4.4 Caps (per day / service / location)
- Bucketed by site-zone day → converted to UTC half-open `[fromUtc, toUtc)` for `Count Extended Bookings`.
- At-limit (`count >= maxCount`) blocks; one-under allows.
- Cancellation frees capacity by leaving declared status set.
- Gateway failure → `COUNT_GATEWAY_FAILURE` incident + per-limit fail-open notice (`COUNT_UNAVAILABLE_FAIL_OPEN`) — never silent, never thrown.
- TOCTOU residual risk disclosed in-product (Contract C6).

### 4.5 Windows / Exceptions
- Split daily windows supported (multiple MASTERs per weekday).
- Location ∩ Service = **intersection** (never union).
- No weekly config anywhere ⇒ unconstrained (default-open); any weekly config ⇒ week exhaustive (weekday without windows = closed).
- Exceptions: exact local date match; CLOSED beats OVERRIDE; same-tier OVERRIDE intersection (never expands).
- B4 repair: end exactly at local midnight → `endMinute=1440` (fits window ending at day boundary); genuine overnight spans blocked as `overnight_slot`.

### 4.6 Explainable Outcomes (Contract §10 #10)
- Every decision (allow AND block) carries `{ruleId, code, customerMessage}`.
- `customerMessage` jargon-free, displayed verbatim by Wix validation plugin.
- Machine codes stable: `BOOKING_ALLOWED`, `INVALID_SLOT`, `RULESET_INVALID`, `EVALUATION_ERROR`, `LOCATION_NOT_COVERED`, `ENTITLEMENT_DEGRADED_FAIL_OPEN`, `OUTSIDE_BOOKING_HOURS`, `DATE_CLOSED`, `QUOTA_EXCEEDED`, `COUNT_UNAVAILABLE_FAIL_OPEN`, `DUPLICATE_BOOKING`, `IDENTITY_TIME_CONFLICT`.

---

## 5. Rollback / Recovery / Destructive-Write Safety (Contract §9)

### 5.1 Orchestrator (`src/platform/schedule-mutation/orchestrator.ts`) — **byte-identical to cycle-6**
Binding sequence implemented:
1. **SNAPSHOT** affected events (full JSON incl. revision) → persist journal baseline BEFORE any write (§9.1).
2. **DIFF** = user-confirmed `MutationPlan` (dashboard confirm modal produced it).
3. **IDEMPOTENT WRITES** deterministic UUIDv5 keys per change (§9.3); replay → `SKIPPED_ALREADY_APPLIED`.
4. **REVISION-CHECKED UPDATES** stale revisions retry against fresh snapshot, bounded attempts (§9.4, default 3).
5. **VERIFY** re-read mutated schedule; only then mark `APPLY_COMPLETED` (§9.5).
6. **ROLLBACK** on failure/recovery: restore persisted snapshot with fresh idempotency keys (§9.6; Cancel Event terminal).
7. **AUDIT** exactly one entry per completed mutation run (§9.7).

### 5.2 Crash Semantics (gate T-RB1)
- Unexpected exceptions (including process death) leave journal `APPLY_IN_PROGRESS` — no in-process rollback (dying process untrusted).
- Next run: `RESUMES` via `applyNextChange` (writes idempotent) OR `recoverInterruptedApply` restores exact pre-apply state from persisted snapshot.
- Serverless-friendly: `beginApply` / `applyNextChange` / `completeApply` public for multi-invocation spans.

### 5.3 Terminal-State Hardening (cycle-2, audit observation N1)
- `NON_TERMINAL_STATES = { SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS }` — **allowlist**; every other state (including future additions) rejected with `INVALID_STATE` BEFORE gateway call / journal write / audit entry.
- `completeApply` and `failApply` both assert `assertNotTerminal` first.

### 5.4 Recovery (`recoverInterruptedApply`)
- Loads latest interrupted plan for scope → `rollbackTo(snapshot)` → re-snapshot → `windowContentDiffs` (window-granularity, event identity excluded: terminal-cancelled MASTERs re-create under new ids per §9.6).
- Marks record `RECOVERED`, appends own audit entry.
- Returns `complete: boolean` + `mismatches[]` + `notes[]` — **never prettified**; drift reported verbatim.

### 5.5 Dashboard Mutation Lifecycle (DASH-C3-1)
- `pollMutationUntilTerminal` bounded controller (hard-bounded attempts, no infinite loop).
- Polling stops on first terminal state or bridge error.
- Recovery **only** via explicit "Recover interrupted apply" button → `bridge.recover(scope)` on click.
- Nothing auto-retries or auto-applies destructive operations (Contract §9.2).
- Consent gating at THREE layers: reducer (refuses `OPEN_DIFF_PREVIEW` with issues), page UI (buttons disabled with explanatory titles), modal UI (Confirm disabled with in-modal warning).

### 5.6 Fake Schedule Gateway (`src/platform/adapters/fakes/scheduleGateway.ts`) — **faithful model**
- Snapshots capture full events incl. revisions.
- CREATE honors UUID idempotency keys (replay → `SKIPPED_ALREADY_APPLIED`).
- UPDATE/CANCEL revision-checked; stale → retriable `REVISION_CONFLICT`.
- Cancel Event terminal: rollback re-creates with NEW event id + caveat note.
- `verifyApplied` re-reads live state, reports drift.
- Test fault injection: `queueRevisionConflictOnce`, `failConflictsAlways`, `crashBeforeChangeNumber`, `forceVerifyDrift`, ordered `trace`.

---

## 6. Entitlements / Billing (Contract §7, §11 C5)

### 6.1 Plan Recognition (`resolveEntitlement`)
- Decision table fully implemented and tested (11 tests in `entitlement.spec.ts`).
- `billingExpirationDate` **never read** (Invariant C2 — advisory only).
- `isFree:false` stays paid through dunning; `isFree:true` stays free regardless of date.
- Clone markers (`originInstanceId`/`copiedFromTemplate`) never change this instance's resolution.

### 6.2 Over-Limit Posture (ratified)
- **NOT an error**: normal decision with `overLimit: true`, stable coverage ordering, **no deletion** of customer configuration.
- Coverage cut at `maxLocations` (default location first, then alphabetical).
- Upgrade CTA: `buildUpgradeUrl(appId, instanceId)` → NEW TAB; identifiers host-injected, never fabricated.

### 6.3 Fail-Open Posture (Contract §7, §11 C5)
- Billing API failure → `FAIL_OPEN_RESOLUTION` (tier: `null`, `maxLocations: Infinity`, `restrictionReliable:false`) — **never blocks bookings**.
- Location listing failure → empty `allowedLocationIds` + `degraded:true` + warning.
- Billable count failure → `count: null, degraded:true` + warning.
- Transient warnings clear per-source when that source heals (billing failure clear independent of listing failure clear — fixed at BILL-C3-1).
- `UNKNOWN_PLAN_IDENTIFIER` persists until operator maps the id.

### 6.4 Billable Location Counting (ratified definition, Contract §7, §11 C3/C5)
- Live locations: `archived=false` (never `status` — INACTIVE unsupported, archiving permanent, doesn't change status).
- Counted services: non-hidden (policy v1), regardless of `onlineBooking.enabled`.
- Distinct-set intersection prevents double counting.
- Computed 0 → floor 1 for billing; reporting set stays true computed set.
- Pagination: locations (default 50, max 1000), services (page 100) — both paginated in core.

### 6.5 Dashboard Meter (`locationsUsagePage.js`)
- Renders composed DTO verbatim; preserves backend stable order.
- Persistent degraded banner (role="alert") whenever ANY degraded flag/warning present — **never silently healthy**.
- "Within plan" note suppressed when any degraded signal exists.
- Single-location floor note rendered when `meter.count === 0`.
- Upgrade CTA when `overLimit` or `isTierRestricted` (host-provided).
- Counting disclosure states exactly how billable locations are counted (Contract §12.4).
- Accessibility: loading role="status", degraded/error role="alert", native buttons/anchors.

---

## 7. Accessibility-Sensitive Behavior

| Surface | Evidence |
|---|---|
| Rules Editor (`rulesEditorPage.js`) | `role="status"` for action feedback; `role="alert"` for issues/degraded banners; `aria-live="polite"`; `aria-describedby` linking disabled buttons to issue list; `aria-label` on all inputs; native `<button>`/`<a>`; keyboard-operable; `title` attributes for locked controls explaining restriction reason. |
| Locations Usage (`locationsUsagePage.js`) | `role="status"` loading; `role="alert"` degraded/error; `aria-label` on sections; `<ol>` for covered list (preserves order); native anchor for upgrade CTA with `target="_blank" rel="noopener noreferrer" aria-label`. |
| Diff Preview Modal (`diffPreviewModal.js`) | Modal focus trap (implied by test `diffPreviewModal.test.js`); confirm/cancel buttons accessible; blocking issues listed in-modal. |
| Validation Mirror (`mirror.js` / `ruleDraftValidators.js`) | Pure validators imported by dashboard tests — parity ledger ensures UI validation matches domain validation exactly. |
| Explanation Panel (`explainPanel.js`) | Renders domain `Explanation[]` with `ruleId`, `code`, `customerMessage` — customer-safe messages displayed verbatim. |

No accessibility regression introduced by the governance cleanup commit.

---

## 8. Real Wix Scaffold Assumptions (honest, evidence-gated)

### 8.1 What Is Proven (Contract §15 gates)
- **T-VP0** (first authenticated scaffold): NOT YET EXECUTED — awaits human-owned credentials (Contract §16 items 1–3).
- **T-VP1–T-VP5** (plugin behavior): blocked on T-VP0.
- **T-WH1–T-WH6** (schedule mutation): blocked on T-VP0.
- **T-BK1–T-BK4** (booking webhooks/counters): blocked on T-VP0.
- **T-RB1–T-RB2** (kill-power recovery / disable baseline): blocked on T-VP0.

### 8.2 What Is Derivable Without Credentials (delivered in cycle 7 / run 32920420147)
- Unified CLI project classifier (`classifyWixConfigLinkage`): `MISSING_FILE` / `UNPARSEABLE` / `UNLINKED` / `LINKED` (demands positive non-placeholder `appId`).
- `wix.config.example.json` shape template (pinned UNLINKED by same classifier).
- Extension inventory with Contract §3-exact channels:
  - `DASHBOARD_PAGE` / `DASHBOARD_MODAL` / `EVENT` → `UNIFIED_CLI_GENERATE`
  - `SERVICE_PLUGIN` (Bookings Validation) → `APP_DASHBOARD_FALLBACK` (generate-menu uncertainty explicitly recorded)
  - Data Collections → `INTERACTIVE_CLI_MENU`
  - Plan webhooks → `APP_DASHBOARD_FALLBACK`
  - HTTP endpoints → `FILE_BASED_NO_REGISTRATION`
- `buildBookingsValidationExtensionConfig()` derives `validationTargets` from implemented `VALIDATION_TARGETS` — registered surface cannot drift from enforced surface.
- Machine-readable prerequisites record (5 entries, owner=`HUMAN_ACCOUNT_OWNER`, why-not-derivable-in-CI, gate, runbook anchor).
- `externalBlockerStatement()` composes narrow, identifier-free `BLOCKED_EXTERNAL` wording grounded in Contract §16/T-VP0/runbook.

### 8.3 Anti-Fabrication Discipline (verified)
- No real `wix.config.json` committed (gitignored with rationale).
- No secrets, no fabricated Wix/app/site identifiers anywhere in product code or tests.
- `DEFAULT_VALIDATION_DEPLOYMENT_URI = '/api/bookings-validation'` is project-internal route (documented `pages/api` mapping), not an identifier.
- Anti-fabrication specs sweep whole surface for UUID-like/hex shapes and SDK-import strings — clean.
- Status honesty: every inventory row `PLANNED_UNTIL_T_VP0`; README §4 makes no registration/live-behavior claims.
- `docs/PRODUCT_GATES.json` honestly keeps `real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release` → `OPEN`.

### 8.4 Unverified / Quarantined Items (Contract §13, §14) — **not asserted as facts**
- UQ1–UQ8, Q1–Q7 tracked; none block build; all require authenticated scaffold or later cited fetch.
- Bookings Validation service plugin generate-menu presence: **empirically unconfirmed** (gate T-VP0); documented fallback (dashboard-created extension config) recorded.
- Calendar V3 read-path scope (UQ9/Q1): unresolved.
- Per-location WORKING_HOURS semantics (Q2/U1): unresolved.
- Third-party write access to Bookings-owned schedules (Q3/U2): unresolved.
- Validation-plugin invocation coverage across surfaces (Q4/U4): unresolved.
- Availability-provider exclusivity (Q5/U5): unresolved.
- Serverless quotas / validation-plugin timeout budget (Q6/V9): unresolved.
- Concurrent validation provider composition (Q7): unresolved.

---

## 9. Non-Blocking Observations (recorded, no repair required)

1. **O1 (inherited):** `registration-surface.spec.ts` matches `/wix\.config\.example\.json/m` against `.gitignore` — hits a comment line, not active rule. Harmless (example file meant committable; load-bearing `^wix\.config\.json$` anchor correct).
2. **O2:** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal (`/api/%2e%2e/x`). Value self-authored at scaffold time; minimal exposure; consider decoding before traversal check when next touched.
3. **O3:** Two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect; unify when surface next touched.
4. **O4 (standing, cross-cycle):** Simulated-Wix QA has never completed for any run; all dev-site gates await human-owned credentials. TOCTOU and best-effort-reschedule disclosures remain mandatory.
5. **O5:** Placeholder token matching can flag exotic real `appId` containing e.g. `TODO` as `UNLINKED` — false positive in safe direction; acceptable.
6. **O6 (this cycle):** Governance cleanup commit removed `.github/actions/setup-opencode/action.yml`, `.github/scripts/recover-transient-opencode.sh`, `.github/scripts/run-opencode-with-retry.sh`, `.github/workflows/ci.yml`. These were **control-plane infrastructure**, not product code. The deterministic shell (trusted workflow) now owns persistence, integration, authentication setup, and dispatch per `AGENTS.md` § "Product Factory v3" items 4, 8, 13. No product capability affected.

---

## 10. Verdict Rationale

The repository at SHA `ec916b75d5600e02d679d264648ac92333d721f1` is **exactly the same product state** that received `VERDICT: ACCEPT` in the prior integrated audit (run 32920420147). The only difference is the removal of four obsolete control-plane workflow/action files — a governance cleanup that touches **zero product code, tests, contracts, or evidence**.

All cross-lane contracts (DTOs, ports, target mapping, validation-plugin wiring, dashboard↔platform DTO, billing/enforcement composition) remain **frozen and byte-identical** to their pinned cycle-6 state. The pure domain core, platform adapters, schedule-mutation orchestrator, billing engine, and dashboard UI are all unchanged and their full test suites (548 unit + 210 UI) pass with zero network egress.

Booking enforcement behavior (target-aware CREATE/CANCEL/RESCHEDULE, identity-free-first duplicates, caps with fail-open degradation, windows/exceptions with DST-safe math, explainable outcomes) is fully implemented, tested, and wired. Rollback/recovery machinery (snapshot→diff→apply→verify→rollback, idempotency keys, revision-checked updates, crash-mid-apply recovery, terminal-state hardening, explicit user-only recovery affordance) is intact and tested via fake gateway fault injection.

Entitlement/billing posture (fail-open on infrastructure errors, stable coverage ordering, no data deletion on downgrade, ratified billable-location definition, persistent degraded warnings, upgrade CTA with host-injected identifiers) is implemented and adversarially tested.

Accessibility-sensitive behavior (status/alert regions, live regions, labels, keyboard operability, native controls, explanation rendering) is present and tested.

Real Wix scaffold assumptions are **honestly scoped**: everything derivable without credentials is delivered; everything requiring credentials is gated behind `T-VP0` with narrow, evidenced `BLOCKED_EXTERNAL` wording; no fabrication, no overclaiming, no production-capability assertions without empirical evidence.

No blocking finding exists. The product remains on track toward a publishable plugin per the constitution.

**VERDICT: ACCEPT**