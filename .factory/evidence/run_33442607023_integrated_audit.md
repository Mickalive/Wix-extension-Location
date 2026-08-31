# Factory Integrated Audit — SHA bca1b73c2251811c47bc5493be55612be8dd68ff

**Auditor:** integrated-auditor (fresh cross-system, distinct from all builders and lane auditors)
**Scope:** exact candidate bca1b73c (candidate(integration): generation 219) + current checkout at that SHA; verifies contracts between integration / rules / dashboard / billing plus booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior and real Wix scaffold assumptions. Read-only, never fixes code.

---

## 1. Authority & scaffold assumptions

*Technical Contract* (BINDING 2026-08-24, §1-17) and *Build Blueprint* remain single source of truth. Candidate does not contradict them.

**Scaffold binding:**
- `package.json` now declares `build: wix build`, `dev: wix dev`, dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/essentials ^0.1.23`, `astro ^5.8`, `@wix/cli ^1.1.135` — conforms to Contract §2 MUST-use unified CLI.
- `astro.config.mjs` uses `output:server`, `wixHostingAdapter()`, `integrations: [wix(), react()]` — unified-CLI layout.
- `wix.config.json` committed with `appId: 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId: advanced-booking-rules`. `.gitignore` lists `wix.config.json` as ignored with comment "Real Wix CLI project binding - generated ONLY by authenticated scaffold (T-VP0)" and template `wix.config.example.json`. Committing a concrete `wix.config.json` at credential-free stage is a scaffold-prematurity, but the file is **honestly declared as placeholder**: `extensions.ts` is intentionally empty (`EXTENSIONS: []` frozen, docstring: "INTENTIONALLY EMPTY (INT-C6-R1): nothing to register yet, every extension generated at authenticated scaffold T-VP0") and `src/platform/registration/extensionsManifest.ts` marks every entry `PLANNED_UNTIL_T_VP0` with notes "nothing is registered anywhere yet; real IDs only at authenticated scaffold". `src/platform/registration/README.md` and `docs/runbooks/T_VP0_SCAFFOLD.md` define evidence checklist E1-E6 for future real scaffold. No fabricated extension IDs, no `projectId` reuse violation, no hidden claim of real Wix binding. Verdict impact: **observation, not blocking** — aligns with honest credential-free foundation (Contract §15/§16, blueprint §7).

- No secrets in repo; `WIX_API_KEY` handling deferred.

**Extension inventory honesty:** `extensionsManifest.ts` enumerates DASHBOARD_PAGE×2, DASHBOARD_MODAL, SERVICE_PLUGIN_BOOKINGS_VALIDATION, DATA_COLLECTIONS, EVENT, WEBHOOK_SUBSCRIPTION, HTTP_ENDPOINTS with correct `RegistrationChannel` per Contract §3. Source-path existence test-enforced. Channel for validation plugin correctly listed as `APP_DASHBOARD_FALLBACK` with fallback JSON `deploymentUri` + `validationTargets` and reference to `bookingsValidation.provideHandlers()` from `@wix/bookings/service-plugins` — matches Contract §3 note that unified `wix generate` menu presence is empirically unconfirmed until T-VP0.

---

## 2. Integration ↔ Rules contract

**Ports (`src/domain/ports.ts`)** canonical, domain-owned, zero `@wix/*` imports (purity gate scans `src/domain`, `src/billing/pure`, `src/platform/http|webhooks|validation-plugin|composition|registration` — all clean). Domain depends only on `shared/types` + `shared/errors`. Dependency direction `platform → domain(ports)+shared` enforced.

**Enforcement wiring (`src/platform/validation-plugin/handlers.ts`):**
- Consumes pure `evaluateRules` exclusively; zero rule semantics duplicated in platform — correct layering per Blueprint §4 flow 1.
- **Bulk handling:** `parseValidationRequest` caps `MAX_BULK_ITEMS=12`, throws typed `INVALID_QUERY` before dependency consultation; handler returns explicit `ValidationItemResult` for *every* index (prevents platform default-valid on omitted items, Contract §5.3).
- **Count planning** via domain exports `applicableLimits`/`countQueryForLimit`/`resolveSlot` (mechanical, no decisions) + single short-TTL `CachedBookingCountGateway` dedup across request — matches Blueprint fast-response.
- **Entitlement composition** via injected `EntitlementGate` (`resolveEntitlementDecision` fails open, records `ENTITLEMENT_DEGRADED`/`ENTITLEMENT_GATE_FAILURE`).
- **Duplicate seam** via `ExistingBookingsPort.loadExisting()` (throws → `DUPLICATE_INPUT_FAILURE` degradation, never blocks).
- **Identity** behind `IdentityPayloadPolicy.consumeMetadataIdentity=false` default (Invariant C1 honored); payload observes `metadata.identity` structurally but does not consume until T-VP3 proven.

**Target semantics (Contract §5.3) verified:**
- `src/platform/validation-plugin/targets.ts`: `evaluationTargetOf` maps `*_MULTI_SERVICE` to base, `semanticsOf` → `CREATE/CANCEL=FAIL_CLOSED`, `RESCHEDULE=FAIL_OPEN`.
- `handlers.ts` target-aware evaluation: `createValidationHandlers` injects `targetContext: {target: operation, subjectBookingId?}` for every `evaluateRules` call; absent context defaults to CREATE (bit-for-bit legacy). `failureSemanticsFor` in `shared/errors.ts` matches.
- `targetFailureResult` respects semantics: FAIL_OPEN → `allowedFailOpen` + `ENFORCEMENT_FAIL_OPEN` + `enforcementClaim: FAIL_OPEN_NOT_ENFORCED`; FAIL_CLOSED → `blockedWithRetryHint` (`VALIDATION_UNAVAILABLE`, retry message) + `FAIL_CLOSED_BLOCKED`. `withDeadline` honors optional `deadlineMs` per Contract "respond as fast as possible; timeout ⇒ blocked create".

**Domain evaluation (`src/domain/evaluate.ts`):**
- Stages correctly ordered, accumulates explanations: 0 fail-closed classification, 1 entitlement (skipped for CANCEL, degraded fails open), 0b slot shape (fail-closed for every target), 2 exceptions→windows (site-zone via `resolveSlot`, `weekdayOfDate`, `effectiveWeeklyWindows`), 3 caps (`applicableLimits` + `countQueryForLimit` per limit, `countForQuery` null → fail-open notice), 4 duplicates (`findDuplicateConflict`).
- **CANCEL narrowing** correct: only ruleset-valid + slot-shape run; caps/windows/duplicates/coverage skipped (rationale documented). Keeps §5.3 fail-closed for classification.
- **RESCHEDULE** evaluates proposed slot against windows/caps as CREATE, duplicate excludes `subjectBookingId` only when supplied, otherwise inert — matches README matrix.
- **Midnight fix** (B4 repair): `endMinute==1440` normalized, only genuine `crossesMidnight` blocked as `overnight_slot`.
- Never throws; catch → `EVALUATION_ERROR` block (fail-closed).

**Cross-lane shape stability:** `RuleSetDTO`, `BookingFacts`, `CountQuery`, `PolicyDecision` pinned in `shared/types.ts`; domain re-exports canonical `TargetOperation` alias preventing drift.

**Finding:** No contract break. Integration honors pure domain as authority; failure semantics per target are correctly isolated.

---

## 3. Booking enforcement ( §5.3, capabilities 1–8,10 )

- Payload parser (`payload.ts`) maps **only** documented fields (`serviceId, scheduleId, startDate, endDate, timezone, location.id/type`, plus observed `metadata.identity` behind flag). `ownerBusinessLocationId` gates on `OWNER_BUSINESS` only — CUSTOM/CUSTOMER yield null, matching domain "no locationId" path.
- Caps use UTC-bounded `CountQuery` per Technical Contract §4 §7; `BookingCountGateway.count` cached, failures degrade caps fail-open with `COUNT_GATEWAY_FAILURE` + per-limit `countUnavailableFailOpen` allow-notice — never silent.
- Windows/exceptions: split windows via multiple `WeeklyWindowDTO` per weekday; exceptions `CLOSED`/`OVERRIDE` with precedence; `effectiveWeeklyWindows` filters by location/service.
- Duplicate: identity-free-first, `IDENTITY_TIME_CONFLICT` vs `DUPLICATE_BOOKING` distinction, subject-exclusion via injected `SubjectBookingFactsPort` defaulting to nullptr (honest UNPROVEN handling).
- Explanations: every `block` carries verbatim `InvalidReason.message`/`code` per Contract §5.3; dashboard `explain/explainPanel` renders them.

No overclaim: T-VP3 payload probe still pending (contactId/metadata identity gated), reschedule fail-open labeled best-effort, hard-cap TOCTOU disclosed in UI caps disclosure — per Contract §12.

---

## 4. Billing ↔ Integration ↔ Dashboard contracts

**Billable location counting (`src/billing/counter/countBillableLocations.ts`):**
- Pure core takes fetched pages only (no I/O). Liveness `archived===true` excluded (never `status`), hidden services excluded, `type===BUSINESS` + `business.id` intersection, distinct-set dedup, pagination agnostic. Floor `computed 0 → count 1` with `billableLocationIds` staying true set — exactly Contract §7 ratified definition + Invitational C3/C5.

**Tiers (`src/billing/pure/tiers.ts`):** 4 paid tiers + FREE, labels ≤23 chars, `maxLocations` 1/3/10/∞ — matches constitution USD 9.99/19.99/34.99/49.99.

**Entitlement (`src/billing/pure/entitlement.ts`):**
- Null snapshot → FREE, `isFree:true` → FREE, empty `vendorProductId` → FREE. Known product → tier paid; unknown paid identifier → `TIER_1` fail-safe + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false`. Never reads `billingExpirationDate` (C2), never uses `originInstanceId` for resolution (clone honesty). Empty overrides default — no fabricated identifiers.

**Coverage (`src/billing/pure/coverage.ts`):** stable ordering default-first then byte-wise alphabetical, dedupe, archived re-filter, `unmanagedLocationIds` preserved never deleted — Contract §7 over-limit posture.

**Entitlement gate (`src/billing/enforcement/entitlementGate.ts`):**
- Fail-open posture per §7/C5: `BILLING_API_FAILURE` → sentinel `FAIL_OPEN_RESOLUTION` (`tier:null`, `maxLocations:∞`, explicit null tier — audit observation 2 correctly avoids claiming TIER_11_PLUS). `LOCATION_LISTING_FAILURE` → `allowedLocationIds:[]`, `degraded:true`. Transient warnings per-source clearing (`BILLING_API_FAILURE`, `LOCATION_LISTING_FAILURE`, `BILLABLE_COUNT_FAILURE`) — observation 1 repaired: clears `BILLING_API_FAILURE` whenever billing succeeded even if listing failed. Warnings persisted in injected `EntitlementWarningLedger`; `PolicyDecision.warning` carries current signal.
- `meter()` fail-open `count:null degraded:true`.

**HTTP meter endpoint (`src/platform/http/meterEndpoint.ts`):** pinned DTO `{meter:{count,degraded}, coverage:{allowedLocationIds,overLimit,degraded,warning}}` composed from `gate.meter()` + `gate.allowedLocationIds()` with per-half isolation; auth required via `requireVerifiedCaller` (Contract §6 token verification); never 5xx after verification — always 200 with degraded shape. Matches bridge's `requestPinnedMeterDto` strict shape validation.

**Dashboard consumption (`src/ui/pages/rulesEditorPage.js` + `bridge.js`):**
- Meter loaded via typed `bridge.getEntitlementMeter()` only — never direct SDK. 404/null → `status:na` with non-blocking notice; `degraded:true` → fail-open warning + `editor-degraded-banner` role=alert, editing stays unrestricted (never restricts off unreliable list) — matches enforcement fail-open.
- Over-limit: `coverage.overLimit` renders `editor-over-limit-section` with stable-ordering note and upgrade CTA via `buildUpgradeUrl(appId,instanceId)` opened `target=_blank` (Contract §7 upgrade URL). Missing/invalid identifiers → CTA omitted (never fabricated).
- **Management-side restriction (DASH-C5-1):** healthy coverage → locations outside `allowedLocationIds` are badge `Not covered by your plan`, inputs disabled, Add disabled, existing rows rendered read-only preserved (never deleted). Anti-trap: rows/limits contributing a validation issue (`issuePaths` has `locationWindows.<id>.<weekday>[i]` or bucket path) keep Remove/enable correctable. `meter.degraded` does not brick editing.
- Explain panel renders domain `RuleOutcome` explanations verbatim.

**Contract parity found:** Bridge ↔ endpoint DTO frozen under `docs/NEXT_CYCLE.json cross_lane_compatibility`; both sides share identical shape check (`isEntitlementMeterDto`).

---

## 5. Failure / rollback / recovery (Contract §9)

**Orchestrator (`src/platform/schedule-mutation/orchestrator.ts`):**
- Phase order enforced: `beginApply` snapshots before any write, persists journal baseline (`SNAPSHOT_PERSISTED`) before gateway writes; `applyNextChange` marks `APPLY_IN_PROGRESS` then single-change `applyWindowChanges` with bounded `maxRevisionRetries=3` (fresh `snapshotWorkingHours` revision refetch per §9.4); `completeApply` verifies (`verifyApplied`) then marks `APPLY_COMPLETED`; `failApply` rolls back via `rollbackTo(snapshot)` then marks `ROLLED_BACK`. One audit entry per run (`MUTATION_APPLIED`/`MUTATION_FAILED_ROLLED_BACK`/`RECOVERY_COMPLETED`) with `snapshotRef`/`rollbackRef`/`details` — §9.7.
- **Idempotency:** `withDerivedIdempotencyKeys` derives deterministic UUIDv5 per change from `(siteId, scopeScheduleId, ruleVersion, change)` — replay yields `SKIPPED_ALREADY_APPLIED`.
- **Crash semantics (T-RB1):** unexpected exception leaves `APPLY_IN_PROGRESS` durably (no in-process rollback); `recoverInterruptedApply` restores exact pre-apply snapshot from persisted journal, window-granularity `windowContentDiffs` (signature excludes eventId for terminal-cancel recreation), verifies, marks `RECOVERED`, appends audit. Serverless-friendly `begin/applyNextChange/complete` public steps.
- **Terminal hardening:** `NON_TERMINAL_STATES={SNAPSHOT_PERSISTED,APPLY_IN_PROGRESS}`; `assertNotTerminal` rejects every terminal state (including future) fail-fast before gateway/journal/audit — correct cycle-2 N1 fix.
- **Revision conflicts** only retry UPDATE/CANCEL (CREATE returns immediately — correctly no revision to refresh).

**Dashboard recovery UX (`rulesEditorPage.js`):**
- `recover` button appears only when `state.lastMutation.scope` known and not already `applied/rolled_back/recovered` nor `pending` (mid-poll hidden) — prevents concurrent disturbance (§9.2 explicit intent). Handler guarded `recoverInFlight` collapses same-tick double-click. Failure states offer recover guidance only when scope known (N-A fix). Polling via `pollMutationUntilTerminal` bounded (`maxAttempts`/`delayMs`), stops on first terminal or error. No auto-retry/auto-apply ever.

**Webhooks / idempotency:** `src/platform/webhooks/pipeline.ts` dedup on envelope `id`, ordering via `entityEventSequence`, requires `degradationSink`; platform build still scans under purity gate.

**Token verification:** `src/platform/http/tokenVerifier.ts` fail-closed (`null` on any untrusted token: missing/malformed/invalid/wrong audience/expired); handlers reject before store touch. Thin `src/pages/api/*` adapters own SDK usage pattern per README.

No silent destructive rewrites detected; diff-and-confirm is dashboard diffPreviewModal showing `computeScheduleDiff` ops, then apply only after hash-confirmed review.

---

## 6. Dashboard validation mirror & accessibility

**Validation mirror (`src/ui/validation/mirror.js`):**
- Single seam; `setValidationSource` accepts function OR server `ValidationResult {valid, issues:[path,code,message]}` verbatim — codes/messages/paths adapted snapshot-copied, never rewritten. Non-conforming source rejected (returns false) keeping previous source — fail-closed. `resetValidationSource` restores bundled fallback. Matches domain `src/domain/validate.ts` ValidationIssue shape — first half of F-N1 repoint per RULES-C3-1.

**Accessibility-sensitive behavior:**
- Per-lane checks: status region `role=status aria-live=polite`, degraded/issue banners `role=alert`/`role=status`, degraded meter warning `role=alert`; ordering note explicit; caps disclosure discloses TOCTOU; location disclosure discloses no-native-hours (§12). Inputs carry `aria-label` with weekday/window ordinal, remove buttons with `aria-label` including weekday+ordinal, limit inputs `aria-label` per dimension. Keyboard focus path: all interactive elements are native `<button>`/`<input>`/`<select>` — no custom trapping; disabled states communicated via `disabled` + `title` lock explanations. Validation issues linked via `aria-describedby` on review button. Modal focus management via `diffPreviewModal` (close on confirm/cancel, body-appended, returns focus).

**Dashboard purity enforcement:** only `src/ui/services/bridge.js` contains `@wix/` dynamic import (guarded lazy), proven by `tests/ui/noWixImports.test.js` with anti-vacuity assertion. No Wix SDK leaked into editor logic.

---

## 7. Purity & cross-lane discipline

- Domain and `billing/pure` remain `@wix/`-free (live grep outside `node_modules` hits only docs, `astro.config.mjs`, `package-lock`, bridge loader — protected roots clean; `npm run check:purity` gate definition covers `src/domain`, `src/billing/pure`, `src/platform/http|webhooks|validation-plugin|composition|registration`).
- Billing never calls Wix directly; all Wix I/O through injected ports (`BillingInstancePort`, `ManagedLocationListingPort`, `BillableCountPort`).
- No `SCOPE.DC-MULTILOCATION.MANAGE-LOCATIONS` requested; write scope limited to documented reads/writes (Contract §5).
- No schedule data deletion on downgrade/over-limit; UI preserves config, enforcement coverage restriction only.

---

## 8. Residual risks disclosed

- TOCTOU for count caps and concurrent-checkout risk disclosed verbatim in caps disclosure (Contract §11 C6).
- Reschedule enforcement best-effort forever (fail-open) disclosed; UI does not promise unconditional reschedule blocking (Contract §12).
- Identity via `contactDetails.contactId` declared UNPROVEN (C1) — handler defaults to identity-free-first.
- Availability-provider exclusivity (MULTIPLE_IMPLEMENTERS_FOUND) and validation invocation coverage remain empirical gates T-VP* pending real dev-site evidence — not claimed as proven.
- `billingExpirationDate` advisory-only (C2) correctly ignored.

---

## 9. Verdict rationale

All binding cross-system contracts are honored at the exact SHA: enforcement routing maps 6 platform targets → 3 operations → correct fail-closed/fail-open; billing fail-open with per-source clearing and explicit-null-tier sentinel; meter DTO is identically pinned across HTTP and bridge; rollback orchestrator implements §9 snapshot→verify→rollback→audit with crash-recoverable journal and explicit-intent UI gating; validation mirror repoints fail-closed; accessibility roles/labels and honest copy (§12) present. Scaffold `wix.config.json` prematurity and React deferral are documented, inventory-declared, and cause no functional contract drift — they do not block integration.

**No blocking cross-lane break found that requires same-lane repair before integration.**

VERDICT: ACCEPT
