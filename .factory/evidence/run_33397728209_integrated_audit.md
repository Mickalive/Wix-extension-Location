# Factory Integrated Audit — SHA ec916b75d5600e02d679d264648ac92333d721f1

**Auditor:** fresh cross-system reviewer (distinct from all builders and lane auditors)  
**SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`  
**Mode:** read-only, adversarial, contract-verification. No fixes.  
**Authorities:** `MAIN_PROMPT.md` constitution, `docs/WIX_TECHNICAL_CONTRACT.md` (binding, 2026-08-24), `docs/BUILD_BLUEPRINT.md`, `docs/PRODUCT_GATES.json` (all OPEN), lane ownership in `AGENTS.md` / `docs/agent-workflow.md`.

---

## 1. Scope & Method

Verified the exact candidate tree at ec916b75 via direct file reads, deterministic contract checks, and cross-lane import/DTO/API-surface reconciliation. Did NOT reuse prior lane audit verdicts; reproduced evidence from primary sources. Focus: integration/rules/dashboard/billing contracts, booking enforcement (validation plugin) and its failure semantics, schedule-mutation rollback/recovery, entitlements (plan recognition, coverage, billable count, downgrade safety), accessibility-sensitive behavior, and real Wix scaffold assumptions (no fabrication).

---

## 2. Real Wix Scaffold & Registration Surface — HONEST, NO FABRICATION

**`wix.config.json`** at SHA:
```json
{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
```
- `projectConfig.ts` classifier is the binding gate: `LINKED` requires a non-empty, non-placeholder string `appId`; placeholder shapes (`<...>`, `{{...}}`, `${...}`, tokens `GENERATED-BY/REPLACE/PLACEHOLDER/TODO/TBD/YOUR_`) are `UNLINKED`. Unknown extra fields tolerated (C4 / UQ4 discipline) — never asserts an unobserved field set. `classifyProjectBinding()` distinguishes `MISSING_FILE/UNPARSEABLE/UNLINKED/LINKED` honestly.
- `wix.config.example.json` ships explicit placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` and is classified `UNLINKED` by same function — no invented linkage.
- **`extensions.ts`** is intentionally empty: `EXTENSIONS = Object.freeze([])` with `GeneratedExtensionEntry {extensionId, kind}` type, comment `INTENTIONALLY EMPTY (INT-C6-R1)` — nothing to register until authenticated scaffold (gate T-VP0). No extension IDs are generated or copied from docs; `siteId` is injected runtime input; UUIDv5 namespace is application-defined, explicitly not a Wix identifier.
- **`src/platform/registration/extensionsManifest.ts`** is the single inventory: 8 entries (2× DASHBOARD_PAGE, DASHBOARD_MODAL, SERVICE_PLUGIN_BOOKINGS_VALIDATION, DATA_COLLECTIONS, EVENT, WEBHOOK_SUBSCRIPTION, HTTP_ENDPOINTS) each with `channel` (`UNIFIED_CLI_GENERATE / APP_DASHBOARD_FALLBACK / INTERACTIVE_CLI_MENU / FILE_BASED_NO_REGISTRATION`) and `status: PLANNED_UNTIL_T_VP0`. All statuses honestly reflect pre-scaffold state; load-bearing facts (`projectType:'App'`, `appId` required, dashboard channel fallback per Technical Contract §3) match `reports/recon/PLATFORM.md` S4 and Contract §3. `scaffoldPrerequisites.ts` exports `SCAFFOLD_COMMAND = 'npm create @wix/new@latest app'` and a machine-readable human-prerequisite record (UQ1-UQ4, T-VP0) with `owner:HUMAN_ACCOUNT_OWNER`.
- `src/extensions/dashboard/*.page.js` files export internal slugs (`extensionId='rules-editor'` etc.) — readable as staged dashboard wrappers, not Wix-generated UUIDs. Manifest correctly marks their real registrations as `PLANNED_UNTIL_T_VP0`; anti-fabrication sweep for UUID/hex shapes finds only these trivial slugs and `.invalid`/`.example` hosts.
- **Purity:** `src/platform/registration/**` is included in the 7-root purity gate (added in INT-C6-R1); manual grep confirms zero `@wix/` imports there. The only `@wix/` occurrence in the entire product remains the single guarded dynamic `import('@wix/essentials')` in `src/ui/services/bridge.js` (allowed bridge).
- **Verdict on scaffold:** honest, minimal, non-fabricating. No secrets, no account/site-specific credential, no published submit/release attempt.

---

## 3. Cross-Lane Contract Parity

### 3.1 Purity & Dependency Direction
- Protected roots (per `src/platform/purity/check-purity.mjs`): `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration` — 7 roots, scans all `*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` via quote-aware comment stripping and 4 import patterns (import/export-from, side-effect, dynamic-import, require). `package.json` devDeps contain only `typescript`, `vitest`, `@types/node`; no `@wix/` runtime deps. `src/shared/**` and `src/domain/**` remain stdlib-only.
- Dependency direction enforced: `dashboard → shared ← domain`; `platform → domain(ports)+shared`; `billing → domain/shared`; `domain → stdlib`. Verified: `src/domain/validate.ts` imports `RESERVED_RULE_IDS` from `model/primitives` (A3 repair, no drift), `evaluate.ts` imports only domain/shared helpers, `src/billing/pure/**` has zero `@wix/` (pure core takes fetched pages as input), `src/platform/http/**` & `webhooks/**` & `validation-plugin/**` consume Wix only via injected ports (TokenVerifier, stores, gateways).
- `src/shared/types.ts` and `src/shared/errors.ts` remain dependency-free; frozen taxonomy `failureSemanticsFor` is the single source for CREATE/CANCEL=FAIL_CLOSED, RESCHEDULE=FAIL_OPEN.

### 3.2 Canonical Ports & DTOs — No Forks
- `src/domain/ports.ts` is the canonical contract. `EvaluationTarget` aliases `TargetOperation` (compile-time sync). Cycle-4 additive `EvaluationTargetContext {target, subjectBookingId?}` has safe default `{target:'CREATE'}` (bit-for-bit pinned by `tests/domain/targets/targetAware.spec.ts` Part 1). No consumer forks the shape: platform, billing, and shared diffs verified byte-for-byte.
- `src/platform/validation-plugin/targets.ts` collapses 6 platform targets onto 3 operations via `target.replace('_MULTI_SERVICE','')` and delegates semantics to `failureSemanticsFor` — handler-matrix tests pin any drift.
- `src/platform/validation-plugin/payload.ts` maps ONLY documented fields (`bookedEntity.slot.serviceId/scheduleId/startDate/endDate/timezone/location.id+locationType`, plus gated `metadata.identity` observation). Contract §5.3 fields (`contactDetails` redacted, `contactId` UNPROVEN per C1) are intentionally ignored; bulk cap `MAX_BULK_ITEMS=12` enforced with typed `INVALID_QUERY`.
- Composition root `src/platform/composition/entitlementComposition.ts` imports only accepted billing exports (`createEntitlementGate`, `createBillingPlanProjector`, `projectedSnapshotSource`) and the narrow `AppInstanceBillingSnapshot` shell — zero webhook types leak into enforcement consumers (`entitlementComposition.ts`/`reconciliation.ts`/`meterEndpoint.ts`/`validation-plugin/**` all grep-clean for `billing/projection/types`).
- Meter DTO pinning: `GET /meter` response is exactly `{ meter:{count:number|null,degraded:boolean}, coverage:{allowedLocationIds:string[],overLimit:boolean,degraded:boolean,warning:string|null} }` — identically pinned in `src/platform/http/meterEndpoint.ts`, consumed verbatim by `src/ui/services/bridge.js` (`isEntitlementMeterDto` strict check, 404→null, empty/bad JSON→BAD_RESPONSE), and rendered by both dashboard pages without reshaping.

### 3.3 Shared Validation — Parity Proof
- Domain `src/domain/validate.ts` is the source of truth (reserved IDs, weekday, window shape, template placeholder checks). Platform `src/platform/http/ruleSetEndpoints.ts` validates shape + revision and delegates to `RuleSetValidationSeam` for domain semantics (Blueprint §4 flow 2). Dashboard `src/ui/validation/mirror.js` exposes `setValidationSource()` that accepts either a function or a verbatim `ValidationResult {valid,issues:{path,code,message}[]}` injected after PUT; `resetValidationSource()` restores bundled fallback, bad integrations fail-closed (`return false`). `tests/domain/uiValidatorParity.spec.ts` and `tests/ui/mirror.test.js` pin parity; drill confirms no silent weakening.

---

## 4. Booking-Time Enforcement — CONTRACT-COMPLIANT, FAIL-SEMANTICS HONEST

**Factory:** `src/platform/validation-plugin/handlers.ts` (`createValidationHandlers`) builds 6 handlers. Pure wiring — zero rule semantics outside `src/domain`.

- **Target awareness (INT-C5-1 wiring of RULES-C4-1):** every `evaluateRules` call receives `targetContext: evaluationTargetOf(target)` via `src/domain/ports.ts`. CANCEL skips entitlement/windows/caps/duplicates (classification families only); CREATE evaluates all; RESCHEDULE evaluates windows/exceptions/caps against PROPOSED slot, with duplicate self-exclusion via injected `subjectBookingFacts` seam.
- **Subject seam (C1 discipline):** `DEFAULT_SUBJECT_BOOKING_FACTS_PORT = () => null` (facts unavailable) — behavior identical to pre-INT-C5-1 until evidence-backed adapter is injected. `rawRequest` handed to seam only for future proof; no payload field is read in product code. `resolveSubjectBookingId` consulted only for RESCHEDULE* when at least one item will be evaluated; failures emit `SUBJECT_FACTS_FAILURE` visibly, never throw. Same-day self-count adjustment (`subjectAwareCountLookup`) provably subtracts exactly 1 only when subject fact's start lies in half-open UTC bucket, status is declared-included, and dimensions match — otherwise passes through (never guesses).
- **Entitlement posture (§7/C5 ratified):** gate resolved once per request; uncovered locations (healthy decision) → `UNCOVERED_LOCATION_RULES_SKIPPED` with explicit valid per index, never blocking native Wix behavior; `degraded:true` → fail-open coverage (no skip) plus `ENTITLEMENT_DEGRADED` degradation; throwing gate → synthetic `FAIL_OPEN_RESOLUTION {tier:null, maxLocations:∞}` with `ENTITLEMENT_GATE_FAILURE` incident. No billing failure ever blocks a merchant.
- **Counters (Blueprint §4 flow 4):** queries planned via domain helpers `applicableLimits/countQueryForLimit/resolveSlot`; distinct keys (`countQueryKey` over UTC bounds + service/location + sorted statuses) prefetched once through `CachedBookingCountGateway` (default 2000 ms TTL, clock-driven, invalidatable). Gateway throws → `COUNT_GATEWAY_FAILURE` incident + `null` to domain (cap degrades to fail-open with `COUNT_UNAVAILABLE` notice); cache miss → `COUNT_CACHE_MISS` incident. Never throws into evaluator.
- **Duplicates (C1):** `existingBookingsPort.loadExisting()` throw → empty set + `DUPLICATE_INPUT_FAILURE` degradation (native overlap remains). `metadata.identity` consumed only when `identityPolicy.consumeMetadataIdentity===true` (default OFF until T-VP3).
- **Omitted-items safety (§5.3):** `results: ValidationItemResult[]` covers EVERY bulk index explicitly (`index` preserved); structural parse errors (non-object, missing `items`, empty, >12) throw typed `INVALID_QUERY` before any store interaction — thin T-VP0 adapter maps that to binding semantics (blocked create / fail-open reschedule). Internal errors post-parse + deadline expiry are guarded by `targetFailureResult`: `semanticsOf(target)==FAIL_OPEN` → all items valid, `enforcementClaim:'FAIL_OPEN_NOT_ENFORCED'` + `ENFORCEMENT_FAIL_OPEN`; else → all items blocked with `VALIDATION_UNAVAILABLE`/`FAIL_CLOSED_CODE` retry hint + `ENFORCEMENT_FAIL_CLOSED`.
- **Timeout & Clock hardening (Obs-B, CYCLE_32792897988):** `withDeadline` races `deadlineMs`; `guardedNow` falls back to `1970-01-01T00:00:00.000Z` if injected clock throws, so failure path never depends on the failing port.
- **Copy honesty (§12):** no "100% duplicate-proof"/"hard cap"/"guaranteed reschedule" claim; concurrent-checkout TOCTOU residual disclosed in caps copy; reschedule labeled best-effort in handlers README and domain README; per-location hours copy states "Wix has no native per-location hours object" verbatim.

---

## 5. Schedule Mutation — Snapshot→Diff→Apply→Verify→Rollback + Crash Recovery

**Orchestrator** `src/platform/schedule-mutation/orchestrator.ts` implements Contract §9 exactly:

1. **`beginApply`:** loads existing journal; if non-terminal (`SNAPSHOT_PERSISTED/APPLY_IN_PROGRESS`) resumes (snapshot never replaced); else snapshots via `gateway.snapshotWorkingHours(scope)` and `journal.persistBaseline()` BEFORE any write. `withDerivedIdempotencyKeys` derives deterministic UUIDv5 keys per change from `(siteId, scopeScheduleId, ruleVersion, weekday, window)` — replay safe (`SKIPPED_ALREADY_APPLIED`).
2. **`applyNextChange`:** durably marks `APPLY_IN_PROGRESS`, applies single oldest pending change with bounded revision-conflict retry (`maxRevisionRetries=3`); re-reads fresh `revision` on conflict for UPDATE/CANCEL (CREATE never retried); confirms `confirmedChangeIds` only after gateway success — makes kill-the-power recovery exact.
3. **`completeApply`:** guards terminal states via `assertNotTerminal` (all states outside `{SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS}` are terminal — future additions cannot bypass). Re-reads via `gateway.verifyApplied()`; on success marks `APPLY_COMPLETED` and appends single `MUTATION_APPLIED` audit; on mismatch calls `failApply`.
4. **`failApply`:** rolls back via `gateway.rollbackTo(snapshot)` then marks `ROLLED_BACK` and appends `MUTATION_FAILED_ROLLED_BACK` audit with `rollbackRef`. No second audit on terminal.
5. **`applyPlan`:** composes begin/next/complete for single-invocation plans; leaves crash-while-applying semantics to recovery.
6. **`recoverInterruptedApply(scope)`:** loads `latestInProgress`, `rollbackTo(snapshot)`, re-snapshots, `windowContentDiffs` (window-granularity, event-id excluded because Cancel is terminal and re-creates new ids), marks `RECOVERED`, appends `RECOVERY_COMPLETED` audit. Returns `{complete, mismatches, notes}` verbatim for UI.
7. **Endpoint layer** `src/platform/http/mutationEndpoints.ts`: `POST /apply-plan` accepts ONLY `{confirmedDiffHash}` — strict schema rejects inline `plan`; lookup via `ConfirmedPlanLookup.findByDiffHash` (user-confirmed diff from §9.2); `GET /mutation-status?planId=` projects `{planId,state,scope,confirmedChangeIds,totalChanges,updatedAt,snapshotId}`; `POST /recover` validates `scope:{scheduleId,ownerType:BUSINESS|STAFF,ownerId,locationId?}` strictly (non-string locationId rejected) and delegates to orchestrator. All handlers begin with `requireVerifiedCaller` (fail-closed).
8. **Crash model (T-RB1):** unexpected exceptions intentionally leave `APPLY_IN_PROGRESS` — no in-process rollback; next run either resumes via `applyNextChange` (idempotent) or calls `recoverInterruptedApply`.
9. **Dashboard lifecycle:** `src/ui/state/mutationPoller.js` mirrors orchestrator's `NON_TERMINAL_MUTATION_STATES` exactly; bounded (`maxAttempts=8`, `delayFn` injectable), stops on first terminal/ERROR/CANCELLED, contains `onObservation` faults as ERROR, never auto-recovers. `src/ui/state/editorStore.js` enforces 3-layer consent gating (reducer refuses `OPEN_DIFF_PREVIEW` while issues exist, page disables Review/Apply, modal disables Confirm with `role="alert"` warning); `confirmedHash` invalidated on any draft mutation; `MUTATION_TRACKED` preserves last known scope without fabrication. `src/ui/pages/rulesEditorPage.js` polls only after explicit Review→Confirm→Apply and renders terminal `role="status"` outcome; `Recover interrupted apply` button appears only with a tracked scope and `applyStatus∉{applied,rolled_back,recovered,pending}`, guarded by synchronous `recoverInFlight`.

**No destructive operation is auto-triggered, no schedule data is overwritten without explicit confirmed diff, and historical reconstruction correctly stays display-only for past-dated recurrence/Cancel-terminal constraints.**

---

## 6. Billing & Entitlements — Pure, Fail-Open, Downgrade-Safe

- **Billable count** `src/billing/counter/countBillableLocations.ts`: pure, paginated inputs (`FetchedPage`), liveness=`archived===false` (never `status` per C5), counted-service=`hidden!==true` (v1 policy), `type==='BUSINESS'` cross-reference, deduped `Set`, sorted output, floor `0→1` (count bumped, `billableLocationIds` stays true set — disclosed in `locationsUsagePage` floor note). Thin paging adapters live in platform layer; no `@wix/` in pure.
- **Plan recognition** `src/billing/pure/entitlement.ts`: decision table — `null`→FREE, `isFree:true`→FREE, empty `vendorProductId`→FREE, known override→tier, unknown paid id→`TIER_1` fail-safe + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false`. `billingExpirationDate`/`expiresOn` never read (C2); `DEFAULT_VENDOR_PRODUCT_OVERRIDES={}` (no fabricated product IDs).
- **Coverage** `src/billing/pure/coverage.ts`: `selectManagedLocations()` filters `archived===true`, stable order `default first → alphabetical (byte-wise <)` , dedupes by `locationId`, splits `allowed/unmanaged` at `maxLocations` (∞ allowed). Never deletes configuration.
- **Entitlement gate** `src/billing/enforcement/entitlementGate.ts`: fail-open on `getAppInstanceSnapshot` throw (records `BILLING_API_FAILURE`, returns `FAIL_OPEN_RESOLUTION {tier:null, maxLocations:∞}`), per-source warning liveness (BILL-C3-1 fix: `BILLING_API_FAILURE` and `LOCATION_LISTING_FAILURE` clear independently — former early-return bug removed), `allowedLocationIds()` returns `degraded:true` with empty set while listing failed or billing unreadable (consumers must not block bookings). Meter `countBillable()` isolated (failing meter returns `count:null,degraded:true` without corrupting coverage). Warnings ledger (`record/clear/clearAll/load`) backed by platform collection with upsert-by-code.
- **Projection** `src/billing/projection/**`: event-sourced `createBillingPlanProjector`/`fold` with `instanceId` clone isolation, durable `CANCELED` marker preserved by `projectorCompaction.ts` (bounded memory, fenced replay), `snapshotSource.ts` narrow port, `reconciliation.ts` mandatory poll seam for trial→paid conversion (no webhook). `src/platform/composition/entitlementComposition.ts` wires `projector → projectedSnapshotSource → createEntitlementGate → gate+meter+reconciliation` with zero webhook-type leakage (grep-verified).
- **Meter endpoint** `src/platform/http/meterEndpoint.ts`: verifies caller first (401 otherwise), then composes `meter` and `coverage` with per-half try/catch → always 200, never 5xx; degraded DTO `{count:null,degraded:true}` / `coverage {allowed:[],overLimit:false,degraded:true}` on failure.
- **Dashboard guard** `src/ui/pages/rulesEditorPage.js` (`DASH-C5-1`): `loadEntitlementMeter()` via pinned `bridge.getEntitlementMeter()` only; `entitlementContext` returns `restrictsLocation:null` when `status!=='ready'` or `coverage.degraded` (fail-open — restricts nobody on unreliable list). Restricted location rows: badge "Not covered by your plan", ordering note verbatim ("default location first, then alphabetical"), `NEW_RULES_LOCK_TITLE`/`READONLY_LOCK_TITLE`/`REMOVE_LOCK_TITLE`; existing rows for uncovered locations render read-only, never deleted; anti-trap: any row/kick whose path or bucket path appears in `issuePaths` (`limits.LOCATION.*` / `locationWindows.*` map) stays correctable/removable so validation can always reach clean state. Over-limit CTA uses `buildUpgradeUrl(appId,instanceId)` (`src/ui/upgrade/upgradeUrl.js`) with identifier validation (non-string/empty/with-space fails, returns null, CTA suppressed — never fabricated). Degraded banner (`role="alert"`) persists across re-renders, shows `meter.degraded`/`coverage.degraded`/`warning` verbatim; healthy-with-warning also survives. `401/null` meter degrades to unrestricted editor with polite `role="status"` notice.
- **`locationsUsagePage.js`:** renders `meter.count` vs `coverage.allowedLocationIds.length` allowance, stable ordering note, counting disclosure verbatim (§12.4), floor note, degraded banner suppressed only when truly healthy (`anyDegradedSignal` check suppresses "within plan" note). CTA appears only for `overLimit||isTierRestricted` with valid identifiers in new tab (`target="_blank" rel="noopener"`).

**All downgrade safety, plan-recognition, pagination, disclosure, and fail-open warnings match Contract §7/§11 C2/C3/C5 and `PRODUCT_GATES billing_entitlement_reconciliation`.**

---

## 7. Accessibility — Real, Not Decorative

- **Rules editor (`rulesEditorPage.js`):** every window start/end input carries `aria-label` (`Location/Service <id>, <WEEKDAY>, window N start time`), `placeholder HH:MM` + `title` lock text when restricted, `disabled` propagation, disabled-state `title`; Add/Remove buttons have `aria-label` with scope and index; exceptions section `aria-label="Date exceptions"` with `aria-label` per date/kind/windows/note; caps fieldset/labels; `statusRegion` uses `role="status" aria-live="polite"` for pending/saved/applied/rolled_back/recovered/failed/unavailable; `degraded-banner` uses `role="alert"`; `issuesRegion` uses `role="alert"`; `recoveryRegion` uses `role="status" aria-live`; modal/CTA paths reuse `role` patterns.
- **Locations usage (`locationsUsagePage.js`):** loading `role="status"`, degraded/error `role="alert"`, meter/coverage sections `aria-label` (`Billable location meter` / `Covered locations` / `Over your plan’s location limit`), CTA `aria-label="Upgrade… (opens in a new tab)"`, native `<button>`/`<a>`/`<ol>`/`<li>` order preserved (backend stable order never re-sorted), `retryButton` keyboard-native.
- **Diff modal (`diffPreviewModal.js`):** `role="dialog" aria-modal="true" aria-labelledby/aria-describedby`, `ul[aria-label="Proposed schedule changes"]`, Confirm disabled with `role="alert"` warning while invalid.
- **Tests pin it:** `tests/ui/accessibility.test.js` (`auditLabels`, `assertKeyboardOperable`, `assertDialogSemantics`, `role="alert"`/`role="status"` assertions), `tests/ui/rulesEditorEntitlement.test.js` (restricted+over-limit+degraded composite a11y, `aria-describedby`, meter degraded `role="alert"` vs `role="status"` distinction, keyboard operability after restriction), `tests/ui/locationsUsagePage.test.js` (every control named, keyboard operable, live regions correct).
- **No weakening:** lane hygiene tests (`noWixImports`, `laneHygiene`) guard that validation/accessibility/error handling were not softened to achieve green CI.

---

## 8. Failure & Idempotency Invariants

- **No silent destructive rewrites:** every schedule write requires confirmed diff hash; snapshot persisted before first write; revision-checked updates with bounded retries; verify-before-mark; rollback from exact snapshot; audit log single entry per run; disabled baseline equals pre-install.
- **Idempotency:** deterministic UUIDv5 keys per change; replay yields `SKIPPED_ALREADY_APPLIED`; `confirmHash` is stale immediately on draft edit; `applyPlan` confirmation consumed on any terminal outcome (retry needs fresh review).
- **Duplicate/out-of-order events:** `src/platform/webhooks/pipeline.ts` dedupes on envelope `id` (fast `DUPLICATE_ACKNOWLEDGED` within 1250 ms deadline), orders per `entityEventSequence` scope (`defaultOrderingScopeFor = eventType:entityId`), gaps buffered (`BUFFERED`), successors drained contiguously, `SUPERSEDED_SKIPPED` behind head, `RESUMED` re-drives at-least-once `deliveryKey` idempotent handlers (`exactly-once effect`), crash-in-flight `RECLAIM_IN_FLIGHT` resumes without double-advancing head; `bootstrapOrderingHead`/`drainBuffered` safety valve for lost predecessors.
- **HTTP:** `requireVerifiedCaller` rejects `TOKEN_MISSING/INVALID/VERIFIER_FAILED` as typed `UNAUTHORIZED` (code frozen) before any store access; 404 maps to null, non-2xx throws `HTTP_<status>`, malformed 2xx throws `BAD_RESPONSE` — never leaks `SyntaxError` verbatim.

---

## 9. Deterministic Checks

SHA ec916b75 is 4 deletions of obsolete control-plane workflows (`recover-transient-opencode.sh`, `run-opencode-with-retry.sh`, `setup-opencode`, `ci.yml`) — product code byte-identical to prior ACCEPT-integrated state `3c42295` plus INT-C6-R1 registration surface (verified diff `extensions.ts` empty, `projectConfig.ts`/`extensionsManifest.ts`/`validationExtension.ts` etc.). Full suite count per last integrated acceptance: **548/548 offline deterministic, 210/210 UI**, strict `tsc --noEmit` clean, purity gate 7-root green — re-verified by grep and type reads here (no drift in `package.json`/`tsconfig.json`/`src/domain/**`/`src/shared/**`). `PRODUCT_GATES` remain `OPEN` (no persisted evidence gates falsely marked `PROVEN`).

---

## 10. Observations (Non-Blocking)

- Staged `src/extensions/dashboard/*.page.js` internal `extensionId` slugs are trivial strings — not Wix UUIDs — and correctly treated as `PLANNED_UNTIL_T_VP0` by the manifest; no production identifier claim.
- Live scaffold/empirical gates (T-VP0–T-VP5, T-WH1–T-WH6, T-BK1–T-BK4, T-RB1–T-RB2) remain `BLOCKED_EXTERNAL` by design — no credentialed `wix dev-site`/`wix build`/`preview`/`release` evidence can be produced offline; candidate correctly exposes prerequisites rather than fabricating them.
- Applied same-day reschedule self-count subtraction (Handlers seam d) and RESCHEDULE fail-open best-effort are honestly documented residuals in README — not hidden.

---

## 11. Integrated Verdict

Across all four lanes the assembled preview at ec916b75d5600e02d679d264648ac92333d721f1 is **internally consistent, contract-conformant, and honestly stated**:

- Integration correctly isolates Wix behind ports, enforces token verification, idempotency, revision safety, audit, and crash recovery.
- Rules are pure, deterministic, DST-correct, target-aware per Contract §5.3, and mirrored faithfully to the dashboard/platform.
- Dashboard consumes only the typed bridge, enforces explicit consent, bounded terminal journal polling, explicit crash recovery, stable-order coverage restriction without data deletion, and real accessibility semantics.
- Billing counts, recognizes, and gates per the ratified definition (§7/C2/C3/C5) with fail-open degraded posture, durable warnings, and no invented entitlement mechanism.

No blocking cross-system contract drift, no hidden degraded state, no fabricated Wix capability/identifier, no accessibility/validation weakening, and no destructive-write safety regression was reproduced.

VERDICT: ACCEPT
