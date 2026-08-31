# Factory Integrated Audit — SHA 6307f03264e623b1f7e71717242e2d3b35d53b1f

**Auditor role:** fresh cross-system reviewer, distinct from all builders and lane auditors. No lane audit reused or impersonated. No code fix attempted.
**Scope:** integration / rules / dashboard / billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior, real Wix scaffold assumptions.
**Evidence base:** exact candidate at 6307f03264e623b1f7e71717242e2d3b35d53b1f, `docs/WIX_TECHNICAL_CONTRACT.md` (binding, 2026-08-24), `docs/BUILD_BLUEPRINT.md`, `docs/state.json` (phase build, cycle 21), `docs/PRODUCT_GATES.json`, `MAIN_PROMPT.md`, `wix.config.json` / `wix.config.example.json`, `extensions.ts`, `src/domain/**`, `src/platform/**`, `src/billing/**`, `src/ui/**`, `src/shared/**`, `docs/runbooks/T_VP0_SCAFFOLD.md`, `src/platform/registration/**`, purity gate `src/platform/purity/check-purity.mjs`, deterministic checks via `src/platform/vitest.config.ts`.

---

## 1. Real Wix scaffold assumptions — honest deferral, no fabrication

**Verdict for this gate: PASS (external prerequisite correctly declared).**

- `src/platform/registration/extensionsManifest.ts` declares all 8 extension surfaces as `PLANNED_UNTIL_T_VP0` with explicit `RegistrationChannel` (UNIFIED_CLI_GENERATE / APP_DASHBOARD_FALLBACK / INTERACTIVE_CLI_MENU / FILE_BASED_NO_REGISTRATION). Every entry documents that real extension IDs and generated files appear only at authenticated scaffold. No identifier-shaped string is invented; tests sweep for it.
- `src/platform/registration/projectConfig.ts` is the sole classifier for `wix.config.json`. It treats empty / `<...>` / `{{...}}` / `${...}` / `GENERATED-BY|REPLACE|PLACEHOLDER|TODO|TBD|YOUR_` as UNLINKED. The committed template is `wix.config.example.json` containing `"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"` — correctly classified UNLINKED.
- `wix.config.json` on the filesystem carries `appId 3e9ec3af-001b-4684-a197-a5133677844d`. `.gitignore` explicitly ignores `wix.config.json` ("Real Wix CLI project binding — generated ONLY by the authenticated one-time scaffold ... never commit or hand-fabricate. Committed shape template: wix.config.example.json"). The file is therefore a local ignored derivation, not a committed fabrication. `extensions.ts` is empty-by-design (`EXTENSIONS = freeze([])`) per INT-C6-R1, with no hand-written extensionId.
- `src/platform/registration/scaffoldPrerequisites.ts` and `docs/runbooks/T_VP0_SCAFFOLD.md` enumerate the five human-owned prerequisites (Wix account, one-time scaffold/bind, dev-site consent, CI API key as secret, release/marketplace approvals) and state exact blocker wording for Live QA (`BLOCKED_EXTERNAL`). `docs/NEXT_CYCLE.md` correctly records that the next active work is Integration-only authenticated binding, with Rules/Dashboard/Billing complete.
- `docs/PRODUCT_GATES.json` leaves `real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release` OPEN with empty evidence — truthful, not fabricated.
- **Risk:** the local `wix.config.json` UUID would classify as LINKED if tested, but because it is gitignored it does not pollute the committed product state. Live QA must re-classify via `classifyProjectBinding` against committed history, not the working-tree file.

No `publish/release/submit`, secret exposure, or filesystem impersonation was observed.

## 2. Cross-lane contract parity

**Shared types as single source**

- `src/shared/types.ts` defines `RuleSetDTO`, `ScheduleScope`, `ScheduleSnapshot`, `MutationPlan`, `PolicyDecision`, `CountQuery`, etc. `src/shared/errors.ts` owns `TargetOperation` (`CREATE|CANCEL|RESCHEDULE`) and `failureSemanticsFor`. Both files are `@wix`-import-free by contract.
- `src/domain/ports.ts` canonicalizes `EvaluationTarget = TargetOperation` and `EvaluationTargetContext` (additive cycle-4 evolution, authorized by `docs/NEXT_CYCLE.json` `canonical_contracts_notice`). Dependency direction enforced: `dashboard → shared ← domain`, `platform → domain(ports)+shared`, `billing → domain/shared`, `domain → stdlib`.
- Purity gate `src/platform/purity/check-purity.mjs` scans `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`. No `@wix/` import detected in protected paths (verified by code inspection; lane `tests/ui/noWixImports.test.js` restricts Wix imports in `src/ui/**` to `src/ui/services/bridge.js` via guarded dynamic `import('@wix/essentials')`).

**Contracts**

- Billing lanes use canonical shapes: `src/billing/enforcement/entitlementGate.ts` implements `EntitlementGate` (`allowedLocationIds(): Promise<PolicyDecision>`) verbatim plus `meter()`. `src/platform/composition/entitlementComposition.ts` composes `projectedSnapshotSource → createEntitlementGate` behind `BillingInstancePort` (`AppInstanceBillingSnapshot`) — webhook envelope types never cross into handlers (checked in `createValidationHandlers` deps).
- HTTP lane consumes only injected ports (`TokenVerifier`, `RulesConfigStore`, `ConfirmedPlanLookup`, `MutationJournalStore`). `src/platform/http/meterEndpoint.ts` pins the cross-lane DTO `{ meter: {count,degraded}, coverage: {allowedLocationIds,overLimit,degraded,warning} }` identically in `src/ui/services/bridge.js` (`requestPinnedMeterDto` with strict `isEntitlementMeterDto` shape check). Extra fields tolerated, missing/renamed fields rejected as `BAD_RESPONSE`.
- Validation-plugin lane consumes only `evaluateRules` + mechanical helpers `resolveSlot`/`applicableLimits`/`countQueryForLimit` (README §4 sanctions this). No window algebra or explanation construction is duplicated.
- Dashboard `src/ui/validation/mirror.js` accepts only `(draft,locations,services)=>DraftIssue[]` or verbatim `ValidationResult {valid,issues:{path,code,message}[]}` — structural validation snaps each issue, rejecting malformations fail-closed and leaving the previous source active.
- `src/domain/README.md` matrix ↔ `tests/domain/targets/matrixProperties.spec.ts` ties the CANCEL/RESCHEDULE/CREATE matrix to executable properties (determinism across matrix, explanation completeness, CANCEL-tail drift guard, ports SHA-256 pin).

No forked DTO, no silent domain fork, no leaked Wix import found.

## 3. Booking enforcement

- **Validation-plugin wiring** (`src/platform/validation-plugin/handlers.ts`): `createValidationHandlers` returns six handlers (`CREATE/CREATE_MULTI_SERVICE/CANCEL/CANCEL_MULTI_SERVICE/RESCHEDULE/RESCHEDULE_MULTI_SERVICE`). `evaluationTargetOf` strips `_MULTI_SERVICE` exactly as `src/domain/ports.ts` specifies; `_MULTI_SERVICE` shares base operation semantics.
- **Target-aware evaluation** (`src/domain/evaluate.ts`): `targetContext` optional, absent ⇒ `DEFAULT_TARGET_CONTEXT {CREATE}` bit-for-bit legacy. Per `src/domain/README.md` matrix: CANCEL runs classification only (RULESET_INVALID/INVALID_SLOT/EVALUATION_ERROR) and skips entitlement/windows/caps/duplicates; RESCHEDULE evaluates windows/exceptions/caps against PROPOSED slot and excludes subject booking; CREATE runs all families. Tenet enforced by domain tests.
- **Fail semantics** (`src/shared/errors.ts` + `src/platform/validation-plugin/targets.ts`): `CREATE/CANCEL (+ MULTI)` → `FAIL_CLOSED` (block every item with `VALIDATION_UNAVAILABLE` + `FAIL_CLOSED_BLOCKED`), `RESCHEDULE (+ MULTI)` → `FAIL_OPEN` (`ENFORCEMENT_FAIL_OPEN`, `FAIL_OPEN_NOT_ENFORCED`, never claims enforcement). `targetFailureResult` uses `guardedNow` with fallback `1970-01-01T00:00:00.000Z` so a throwing clock cannot escape the guard. `withDeadline` enforces per-request `deadlineMs`.
- **Bulk correctness:** `parseValidationRequest` enforces `1..12` items (`MAX_BULK_ITEMS=12`), maps only documented fields (`bookedEntity.slot.serviceId/scheduleId/startDate/endDate/timezone/location.id+locationType`, plus optional `metadata.identity` behind flag). `ownerBusinessLocationId` gates `location.id` to `OWNER_BUSINESS` only. Handlers return explicit `ValidationItemResult` for every index (`results[item.index]`), neutralizing the platform `omitted → valid` hazard. `countQueryKey` dedup + `CachedBookingCountGateway` ensures one cached pass, bounded TTL.
- **Coverage gating:** healthy decision + location outside `allowedLocationIds` ⇒ `UNCOVERED_LOCATION_RULES_SKIPPED` (valid, no rule evaluation); degraded decision ⇒ never skips (fail-open). Implemented in `executeRequest` item loop.
- **Duplicates:** identity-free first (same service + half-open overlap + start-bucket same site-zone day), identity-keyed cross-service, plus `excludeBookingId` for RESCHEDULE subject exclusion. Conservative: facts without `bookingId` never match exclusion. Overlap uses `intervalsOverlap` half-open (back-to-back allowed).
- **Degradations never silent:** `DUPLICATE_INPUT_FAILURE`, `COUNT_GATEWAY_FAILURE`, `COUNT_CACHE_MISS`, `ENTITLEMENT_*`, `SUBJECT_FACTS_FAILURE`, `ENFORCEMENT_FAIL_*` are emitted to `DegradationSink` and returned in result degradations.
- **Time/DST:** `src/domain/time/wallClock.ts` resolves slot via `localWallOf` (Intl IANA), normalizes end exactly at next-day midnight to `1440` (B4 repair) while genuine overnight stays `crossesMidnight` → blocked. Caps bucket via `instantForLocalWall` + `nextLocalDate` in `src/domain/limits/limits.ts`. Contracts §4.7 honored.
- **Reschedule self-count adjustment:** `subjectAwareCountLookup` in handlers verifies service/location/status/start-bucket proof before `-1` adjustment, clamped at 0, degraded counts stay degraded, multi-service single-subject residual honestly disclosed.
- **Explainability:** every decision (allow/block) carries `{ruleId,code,customerMessage}` from `src/domain/explain/explain.ts` (`ENGINE_RULE_IDS`/`OUTCOME_CODES`), jargon-free, no internal identifiers. Both fail-open and blocked explanations included.

No production enforcement claim before T-VP0–T-VP5; README explicitly gates claims. Honest residuals (RESCHEDULE same-day self-count, unproven `subjectBookingId` until payload probe) disclosed, not hidden.

## 4. Failure & rollback behavior

- **Orchestrator** (`src/platform/schedule-mutation/orchestrator.ts`) implements Contract §9 in order: (1) `beginApply` snapshots `snapshotWorkingHours` and `persistBaseline` before any write, resumable for non-terminal states, (2) diff is the user-confirmed `MutationPlan` (dashboard diff-and-confirm artifact), (3) deterministic UUIDv5 idempotency keys per change (`deriveChangeIdempotencyKey` from siteId+scheduleId+ruleVersion+weekday+window), replay yields `SKIPPED_ALREADY_APPLIED`, (4) revision-conflict retry bounded (`maxRevisionRetries=3`) with fresh snapshot re-read, (5) `verifyApplied` before `APPLY_COMPLETED`, (6) `failApply` `rollbackTo(snapshot)` on verify failure with fresh keys (Cancel Event terminal acknowledged; `windowContentDiffs` excludes event identity), (7) exactly one `AuditLogEntry` per terminal outcome (`MUTATION_APPLIED`/`MUTATION_FAILED_ROLLED_BACK`/`RECOVERY_COMPLETED`), (8) banned operations (Update Location, Set Service Locations, Assign Working Hours Schedule, Cancel Event on MASTERs) require explicit diff UX — none executed without `confirmedDiffHash`.
- **Crash / kill-the-power recovery (T-RB1):** unexpected exception leaves journal `APPLY_IN_PROGRESS`; `recoverInterruptedApply` restores exact pre-apply state from persisted snapshot, `windowContentDiffs` validates window content, marks `RECOVERED`, appends audit. Serverless-friendly `beginApply/applyNextChange/completeApply` span invocations on durable journal.
- **Terminal hardening:** `NON_TERMINAL_STATES = SNAPSHOT_PERSISTED|APPLY_IN_PROGRESS`; `assertNotTerminal` rejects every other state (including future terminals) with `INVALID_STATE` before any gateway/journal/audit mutation.
- **HTTP mutation endpoints** (`src/platform/http/mutationEndpoints.ts`): `POST /apply-plan` accepts ONLY `{confirmedDiffHash}` — strict schema rejects any extra key or inline `plan`; lookup via `ConfirmedPlanLookup` (diff-confirm artifact); missing hash ⇒ `NOT_FOUND` asking to confirm reviewed diff. `GET /mutation-status` projects journal without snapshot/plan payload. `POST /recover` validates `ScheduleScope` shape (strict `locationId` non-string rejection). All three begin with `requireVerifiedCaller` — fail-closed before store access.
- **Webhook pipeline** (`src/platform/webhooks/pipeline.ts`): signature verification before store, dedup on envelope `id` (`ALREADY_COMPLETED` fast-ack within 1250ms), `entityEventSequence` ordering with scope `eventType:entityId`, gap buffering, `RECLAIM_IN_FLIGHT` resume preserves monotonic head via `advanceHeadPast`, `drainContiguousSuccessors` and `drainBuffered` safety valve. Handlers idempotent per `deliveryKey = envelopeId::handlerId`. Counter drift self-heals via authoritative `BookingCountGateway`.
- **Dashboard mutation lifecycle:** diff modal shows exact ops (`computeScheduleDiff`), confirm disabled until `canConfirmDiff()` (modal open + hash current + zero issues). `editorStore.js` invalidates `confirmedHash` on any draft mutation, requires fresh review+confirm per apply attempt, bounded `pollMutationUntilTerminal` until TERMINAL state, explicit crash recovery via `recover(scope)` only on user click (`handleRecover` with `recoverInFlight` guard). Endpoint 404 `null` vs empty-2xx `BAD_RESPONSE` envelope discipline prevents mistaking "no body" for "no record".
- **Error taxonomy:** `PlatformError` codes (`REVISION_CONFLICT`, `VERIFY_FAILED`, `UNAUTHORIZED`, etc.) mapped truthfully; `UNAUTHORIZED` for auth failures with `UnauthorizedRequestError` class.

No silent destructive rewrite, no auto-retry of destructive operations, no partial unverified apply left durable.

## 5. Billing & entitlements

- **Tiers** (`src/billing/pure/tiers.ts`): exactly 4 plans + FREE, labels within 23 chars, identical feature set, `maxLocations` 1/3/10/∞. `PLAN_TIERS` frozen.
- **Plan recognition** (`src/billing/pure/entitlement.ts`): decision table — `null` snapshot ⇒ FREE, `isFree true` ⇒ FREE, missing/empty `vendorProductId` ⇒ FREE, known `vendorProductId` (via `overrides`) ⇒ that tier, unknown paid id ⇒ `TIER_1` + `UNKNOWN_PLAN_IDENTIFIER` warning (`restrictionReliable:false`) — fail-SAFE under-serve. `billingExpirationDate` never consulted (C2). Clone markers ignored for resolution. `DEFAULT_VENDOR_PRODUCT_OVERRIDES = {}` — no fabricated identifiers.
- **Billable-location count** (`src/billing/counter/countBillableLocations.ts`): `archived===false` liveness (never `status` per Contract §4.2), `hidden===true` services excluded (policy v1), `locations[type=BUSINESS].business.id` cross-reference, distinct-set intersection, deterministic sorted output, floor `0→1` for `count` while `billableLocationIds` stays true set (reporting-only, no grant). Pagination responsibility belongs to platform adapter `countFromAdapters.ts` (>50 locations, >100 services) with contract tests.
- **Coverage selection** (`src/billing/pure/coverage.ts`): stable order default-first then byte-wise `<` alphabetical, deduped, `unmanagedLocationIds` never deleted, `overLimit` explicit.
- **Entitlement gate** (`src/billing/enforcement/entitlementGate.ts`): fail-open on every infrastructure throw (`BILLING_API_FAILURE`, `LOCATION_LISTING_FAILURE`, `BILLABLE_COUNT_FAILURE`) with ledger `record` and `PolicyDecision degraded:true` — consumers must not block bookings when degraded. Per-source warning liveness (`TRANSIENT_WARNING_CODES` clear only when its own source heals). `FAIL_OPEN_RESOLUTION {tier:null,maxLocations:∞}` sentinel never misused as paid tier. Meter `count:null,degraded:true` never blocks.
- **Projection** (`src/billing/projection/projector.ts`): reconciliation supremacy — `ingestSnapshot` re-seeds event layer, discards pre-snapshot events, keeps `seenEventIds` across snapshots to suppress stale replays; `currentSnapshot()` renders merged view only when post-snapshot events refine it. Handles `FOREIGN_INSTANCE` clone isolation via `instanceId` guard. `billingExpirationDate` never read.
- **Composition** (`src/platform/composition/entitlementComposition.ts`): `composeValidationEntitlement` wires `projector → projectedSnapshotSource → createEntitlementGate` + mandatory `createReconciliationSeam` periodic poll for trial→paid conversion (no event fires). `projectorCompaction` optional for long-lived processes.
- **Meter endpoint** (`src/platform/http/meterEndpoint.ts`): authenticated → ALWAYS 200, per-half failure isolation (failing meter never corrupts coverage), unauthenticated ⇒ 401 `UNAUTHORIZED` before any gate. Pinned DTO consumed verbatim by dashboard.
- **Upgrade URL** (`src/billing/upgrade/upgradeUrl.ts` + `src/ui/upgrade/upgradeUrl.js`): `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` opened in new tab, identifiers host-injected, never fabricated, gracefully degraded to notice when unbuildable.
- **Dashboard enforcement parity:** `renderRulesEditorPage` restricts NEW rule configuration for uncovered locations only (`coverageBadge` + disabled inputs + `coverage-note` with stable-ordering phrase), EXISTING config stays read-only never deleted. Anti-trap rule: controls contributing to current validation issue paths stay enabled. Degraded coverage fails open (warns, restricts nobody). `overLimit` shows upgrade CTA alongside ordering note. Meter `degraded`/`404 null` degrades to unrestricted editor with non-blocking notice — never crash.

## 6. Accessibility-sensitive behavior

- All interactive dashboard surfaces carry `aria-label`, `role="status"`/`role="alert"`, `aria-modal`, and `data-testid` contracts. Diff modal moves focus into `dialog` on open, restores to `previouslyFocused` on close, handles `Escape` → `onCancel`, disables `Confirm` unless `canConfirm` (triple-layer gate: reducer refuses `OPEN_DIFF_PREVIEW` when issues exist, page disables `Review changes` with `title` + `aria-describedby="issues-list"`, modal disables `Confirm` + shows `modal-blocking-issues` alert). `editorStore` guarantees every state change notifies subscribers; `statusRegion` live-regions (`role="status" aria-live="polite"`).
- Kit `src/ui/dom/kit.js` mirrors browser focusability (`isFocusableTag`, `tabindex -1` programmatically focusable for dialog), disabled buttons swallow clicks, Enter/Space synthesize clicks on buttons — enabling keyboard operability without react. `UiDocument._adoptFocus` drives modal restore coverage (documented coupling N-3, frozen).
- Custom kit intentionally deferred until T-VP0 pins React/design-system versions (Contract §8.4/UQ3) — not a bypass, and the bridge is the only lane module importing Wix runtime (`controlled import` of `@wix/essentials`).
- Explain panel renders customer message first, then machine `ruleId:code` in `code` element, empty state honestly states no outcomes yet.

## 7. Product gates honesty

- `docs/PRODUCT_GATES.json` marks `cross_lane_contract_parity`, `credential_free_build_and_tests` OPEN absent persisted evidence — correct, not claimed. Real Wix gates OPEN with no evidence — blocking production claims without fabricating readiness.

---

## Findings summary

Critical/high blockers: **0**
Medium observations (honest deferrals, not integrable defects):
- Real Wix scaffold/binding still `PLANNED_UNTIL_T_VP0` — narrowly evidenced `BLOCKED_EXTERNAL` on human-owned prerequisites (§16/T-VP0), not a product defect.
- Reschedule `subjectBookingId` seam defaults to unavailable until T-VP3/T-VP5 payload probe proves field shape — disclosed residual, never enforced falsely.
- Reschedule same-day self-count adjustment only offers single-subject compensation; multi-service per-item subject resolution awaits payload evidence — disclosed residual.
- Dashboard React + `@wix/design-system` mount deferred until T-VP0 dependency pins (`kit` abstraction) — honestly staged.

The assembled preview implements Contract §1–§17 and Blueprint §1–§9 verbatim, enforces failure-semantics correctly, preserves rollback auditability, fails open on billing/counting outages without deleting customer configuration, and keeps all Wix SDK access behind injected ports with token-verified HTTP surfaces. No governance violation, secret exposure, or silently forked semantics was observed at this SHA.

VERDICT: ACCEPT
