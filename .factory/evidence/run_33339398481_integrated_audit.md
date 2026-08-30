# Factory Integrated Audit — SHA ca6b15ec263d2b76caee416e4adcd1e17b24f954

- **Auditor:** fresh independent cross-system reviewer (distinct from all builders and lane auditors). Read-only except this report. No code fix, no Wix credentials accessed, no governance edits.
- **Subject:** exact candidate SHA `ca6b15ec263d2b76caee416e4adcd1e17b24f954` — `candidate(integration): generation 66` — diff against its parent: 5 files `+200/-9` in `src/platform/registration/**` and `tests/platform/**`.
- **Accepted base context:** `lab/wix-rules` at `aec73b05eefb17a3643043f3d4f7a6bcba92fc0b`-lineage (cycle 7 integrated preview baseline). Task `INT-C7-LIVE` (evolution of `INT-C6-R1` scaffold/registration surface).
- **Authorities:** `MAIN_PROMPT.md`, `AGENTS.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `docs/state.json` (phase `build`, cycle 21), `src/shared/**` canonical DTOs, `src/domain/**` pure core, `src/billing/**` pure+enforcement, `src/platform/**` adapters/orchestrator/validation-plugin.
- **Execution:** `npm run typecheck`, `npm run check:purity`, `vitest run --config src/platform/vitest.config.ts` (557/557), manual read of every changed file plus full cross-lane module graph (`domain/evaluate.ts`, `platform/validation-plugin/handlers.ts|payload.ts|targets.ts`, `platform/schedule-mutation/orchestrator.ts`, `billing/pure/*`, `billing/enforcement/entitlementGate.ts`, `shared/types.ts|errors.ts`, `platform/registration/*`, `extensions.ts`, `.gitignore`, `wix.config.json|example`).

---

## 1. Composition & lane-scope integrity

| Check | Result |
|---|---|
| Diff inventory | `src/platform/registration/projectConfig.ts`, `src/platform/registration/scaffoldPrerequisites.ts`, `src/platform/registration/index.ts`, `tests/platform/registration-project-config.spec.ts`, `tests/platform/registration-surface.spec.ts` — all inside integration lane allowlist (`src/platform/**`, `tests/platform/**`). No governance, workflow, directive, contract, domain, billing, or shared file touched. |
| Governance untouched | `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `docs/state.json`, `docs/PRODUCT_GATES.json`, `AGENTS.md`, `.opencode/**` — zero diff. |
| Additive only | No deletions of accepted behavior; `ProjectLinkage` LINKED gains optional `warnings?` (safe additive), `externalBlockerStatement` retained as deprecated alias, new export `scaffoldStatusStatement` added. |
| Deterministic gates | `npm run check` → `typecheck: pass`, `purity: pass` on 7 roots (`src/domain`, `src/billing/pure`, `src/platform/http`, `webhooks`, `validation-plugin`, `composition`, `registration`), `vitest: 557 passed / 49 files` — arithmetic: prior integrated 548 + 7 new (5 projectConfig `projectType` cases + 2 scaffoldStatus cases) + 2 real-binding cases = 557. No `.skip/.only` in tests. |

**Verdict on scope:** clean integration-lane repair, no cross-lane file boundary violation.

## 2. Executable & static verification (re-run on integrated tree)

- `npm run typecheck` — **pass** (`extensions.ts` covered).
- `npm run check:purity` — **pass**; new `src/platform/registration` remains `@wix/`-free (documentation strings only, no import shapes). Purity negative-controls in `purity-gate.spec.ts` still assert as expected.
- `vitest` — **557/557** green (domain 30+18+9+31+ deterministic corpus, platform schedule-mutation 10, orchestrator-terminal 7, validation matrices 42+19+ bulk/payload/entitlement/counters/identity/clock-guard, billing entitlement/coverage/tiers/counter, registration 20+19). Offline proxy check inherited from prior integrated audit remains valid; no new network code added.
- Type compatibility — `tsc --noEmit` proves new `ProjectLinkage` optional `warnings` does not break any consumer (no consumer destructures it exhaustively).

## 3. Cross-lane contracts (integration ↔ rules ↔ billing ↔ dashboard)

**Frozen contracts intact.** Zero diff on `src/shared/types.ts` (RuleSetDTO, MutationPlan, PolicyDecision, etc.), `src/domain/**`, `src/billing/**`, `src/platform/schedule-mutation/**`, `src/platform/validation-plugin/**`, `src/platform/composition/**`. Therefore:

- **Domain purity** preserved — no `@wix/` import introduced; `evaluateRules` remains sole decision function, synchronous deterministic, target-aware per CREATE/CANCEL/RESCHEDULE matrix pinned by `tests/domain/targets/*` + `evaluate.spec.ts`.
- **Sanctioned consumption seam** `platform/validation-plugin → domain` still limited to `evaluateRules`, `resolveSlot`, `applicableLimits`, `countQueryForLimit` (mechanical planning, no duplicated window/exception/duplicate logic). Marker scan `platform-scope.spec.ts` green.
- **Single source of truth** `VALIDATION_TARGETS` → `buildBookingsValidationExtensionConfig()` (frozen 6-target derivation, canonical order pin) unchanged — registration cannot drift from implemented handler matrix.
- **Billing → enforcement port** `EntitlementGate` (`allowedLocationIds(): PolicyDecision`) unchanged. `billing/enforcement/entitlementGate.ts` still consumes canonical `PolicyDecision` shape from `src/domain/ports.ts` verbatim (no forked DTO). Verification: `createEntitlementGate` + `resolveEntitlement` + `selectManagedLocations` signatures unchanged; `FAIL_OPEN_RESOLUTION` sentinel with explicit `tier:null` still prevents tier-shaped misuse.
- **Dashboard bridge** — no `src/dashboard` directory (dashboard pages staged as `src/extensions/dashboard/*.page.js` per manifest). `src/shared/types.ts` DTOs remain dependency-free and import-free; dashboard lane not touched this cycle, so no new bridge bypass introduced. Prior UI validator parity (`uiValidatorParity 30`) remains green and assertion-identical.
- **No new coupling** — grep: nothing outside `src/platform/registration/**` imports the new `scaffoldStatusStatement`/`validateProjectType`/`KNOWN_PROJECT_TYPES`. The surface is purely declarative/classifier.

**Result:** DTO/type parity holds; no silent fork, no bypass.

## 4. Booking-time enforcement (validation plugin)

Unchanged files, re-verified by execution:

- **Six targets** `CREATE|CREATE_MULTI_SERVICE|CANCEL|CANCEL_MULTI_SERVICE|RESCHEDULE|RESCHEDULE_MULTI_SERVICE` → `evaluationTargetOf` → three operations, bulk per-item explicit results (omitted-items-default-valid hazard neutralized), `MAX_BULK_ITEMS=12` cap still enforced in `payload.ts`.
- **Fail-closed vs fail-open** (Contract §5.3) intact: `CREATE/CANCEL*` → `FAIL_CLOSED_BLOCKED` (`VALIDATION_UNAVAILABLE` retry hint), `RESCHEDULE*` → `FAIL_OPEN_NOT_ENFORCED` with `ENFORCEMENT_FAIL_OPEN` degradation, never claims enforcement. `subjectBookingFacts` seam still defaults to unavailable (`() => null`), identity flag `consumeMetadataIdentity` defaults OFF (Invariant C1), `targets.ts`/`handlers.ts` suites green (42 target-aware + 19 handler-matrix + payload 15).
- **Entitlement coverage** (over-limit) — SKIPs evaluation for uncovered `OWNER_BUSINESS` locations when healthy, fail-open when `degraded:true` (billing failure never blocks). Degradations `ENTITLEMENT_GATE_FAILURE|DEGRADED`, `COUNT_GATEWAY_FAILURE|CACHE_MISS`, `DUPLICATE_INPUT_FAILURE`, `SUBJECT_FACTS_FAILURE` all still emitted via `DegradationSink` locally before persistence.
- **Counting** — `planCountQueries` uses domain helpers only; TTL cache `CachedBookingCountGateway` unchanged; same-day self-count adjustment for RESCHEDULE subject remains gated and conservative (half-open bucket, status/service/location provability, clamp at 0).

No enforcement semantics forked by this candidate (registration-only diff).

## 5. Schedule mutation, rollback & recovery (Contract §9)

Unchanged `src/platform/schedule-mutation/orchestrator.ts|idempotency.ts` — re-proven by 10+7+8 tests:

- **Sequence** `snapshotWorkingHours` → persist `SNAPSHOT_PERSISTED` journal baseline before any write → `APPLY_IN_PROGRESS` → idempotent writes with deterministic UUIDv5 keys (`siteId|scopeScheduleId|ruleVersion`) → revision-checked updates with bounded `maxRevisionRetries=3` → `verifyApplied` → terminal `APPLY_COMPLETED`, else `rollbackTo` → `ROLLED_BACK` → single audit entry (`MUTATION_APPLIED` vs `MUTATION_FAILED_ROLLED_BACK`). Terminal-state hardening (`NON_TERMINAL_STATES` = `SNAPSHOT_PERSISTED|APPLY_IN_PROGRESS`; all other states `INVALID_STATE` fail-fast) intact.
- **Crash recovery** `recoverInterruptedApply` restores exact pre-apply snapshot, window-granularity `windowContentDiffs` (event ids excluded, working-hours windows compared), marks `RECOVERED`, appends `RECOVERY_COMPLETED` audit — green.
- **Safety gates** — `extensions.ts` remains empty by design; no service `Set Service Locations` or `Update Location` or `Assign Working Hours` mutation path introduced here. Destructive-write risk from this diff is nil by construction (classifier + statement builders only).

## 6. Billing, entitlement & downgrade safety (Contract §7, §11 C2/C3/C5)

Unchanged `src/billing/**` — re-proven by entitlement 11, gate 11, coverage 5, counter 13, etc.:

- **Plan recognition** `resolveEntitlement(snapshot)` — null→FREE, `isFree:true`→FREE, missing/empty `vendorProductId`→FREE, known override→paid tier, unknown paid id→`TIER_1` fail-safe + `UNKNOWN_PLAN_IDENTIFIER` warning with `restrictionReliable:false`. `billingExpirationDate`/`expiresOn` never consulted (C2).
- **Billable-location count** `countBillableLocations` — paginated `archived===true` exclusion (liveness ≠ `status`), non-hidden services only, `BUSINESS` refs intersect live ids, distinct-set dedup, deterministic sort, floor `0→1` on `count` only (reporting set may be empty). Thin paging adapters live in platform (not pure).
- **Coverage ordering** `selectManagedLocations` — default-location first then alphabetical `locationId`, archived filtered defensively, deduped, `maxLocations=∞` for `TIER_11_PLUS`, `unmanagedLocationIds` disabled never deleted (downgrade-through-gate regression green).
- **Gate posture** `createEntitlementGate` — `BillingInstancePort` throwing → `BILLING_API_FAILURE` + `FAIL_OPEN_RESOLUTION` (`tier:null`, `∞` coverage); `ManagedLocationListingPort` throwing → `LOCATION_LISTING_FAILURE` + `degraded:true` empty ids; per-source `TRANSIENT_WARNING_CODES` clear on healthy call (CYCLE_32787032785 Obs 1 fixed); `meter()` fail-open on `BILLABLE_COUNT_FAILURE`. `PolicyDecision.warning` carries current signal; durable ledger via `EntitlementWarningLedger` (upsert by code).
- **Pricing** tiers exactly 4 (+ FREE) at 9.99/19.99/34.99/49.99 matching constitution; feature parity identical across tiers (only `maxLocations` differs).

This candidate does not alter billing; no entitlement bypass introduced.

## 7. Accessibility & explanation-sensitive behavior

No dashboard UI diff this cycle, but domain explainability (customer-facing) re-verified:

- Every `evaluateRules` outcome carries `{ruleId,code,customerMessage}` from closed vocabulary (`ENGINE_RULE_IDS`/`OUTCOME_CODES`); jargon-free messages (e.g., `outsideBookingHours`, `dateClosed`, `quotaExceeded`) displayed verbatim by Wix (`InvalidReason.message`/`FieldViolation.description`). Fail-closed classification messages are customer-safe, not machine codes.
- Explanation completeness & matrix properties suites green: determinism sweep across CREATE/CANCEL/RESCHEDULE, `allowExplanation` validity, `CANCEL` tail-drift guard (only classification explanations).

Accessibility regression risk: none (no UI change); prior dashboard runner 210/210 + new purity roots do not weaken ARIA/label/keyboard contracts.

## 8. Real Wix scaffold assumptions (Contract §1/§3/§6/§13/§16, gates T-VP0…)

**Binding classifier `projectConfig.ts` (INT-C7-LIVE evolution):**

- Requires positive evidence: non-empty, non-placeholder string `appId` → `LINKED`; placeholder taxonomy (`GENERATED-BY|REPLACE|PLACEHOLDER|TODO|TBD|YOUR_` + `<…>`/`{{…}}`/`${…}` shapes) → `UNLINKED`; empty/non-string/non-object → `UNLINKED`/`UNPARSEABLE`; `MISSING_FILE` when null. Unknown extra fields tolerated (UQ4/C4 discipline) — correct, does not assert unobserved field set.
- New: `projectType` validation against `['app','App']` (documented lowercase + Wix-generated uppercase) — known values without warning, unknown values → still `LINKED` with `warnings:['projectType … tolerating per drift discipline']` (fail-open in safe direction: never blocks linkage on doc lag). Optional `validProjectTypes` override allows strict mode without breaking default.
- Anti-fabrication preserved: classifier never generates/defaults/invents identifiers; `LINKED` path is only via `linkableAppId` success. New `warnings` is additive optional; not a hard binding requirement — only `appId` is load-bearing (documented in file header).
- `extensions.ts` remains intentionally empty (`EXTENSIONS: []` frozen) until CLI generates entries — correct per recon PLATFORM.md §3 S4 "Don't edit this file".
- `.gitignore` correctly anchors `^wix.config.json$` (real binding ignored) while leaving `wix.config.example.json` committable — verified.
- Present on-disk `wix.config.json` `{appId:3e9ec3af…, projectId:advanced-booking-rules, projectType:App}` now classifies as `LINKED` without warnings (covers bootstrap evidence). Committed `wix.config.example.json` `{projectType:app, appId:<GENERATED-BY…>}` still classifies `UNLINKED` (no regression, byte-identical to serializer).

**Prerequisites & live-QA disposition `scaffoldPrerequisites.ts`:**

- Five prerequisites (`WIX_ACCOUNT_CLI_AUTHORIZATION`, `ONE_TIME_SCAFFOLD_BIND`, `DEV_SITE_BINDING_AND_CONSENT`, `CI_API_KEY_AS_SECRET`, `RELEASE_AND_MARKETPLACE_APPROVALS`) each with `owner=HUMAN_ACCOUNT_OWNER`, `whyNotDerivableInCi`, `evidenceGate` (`T-VP0`/Contract §16), `runbookPath` (`docs/runbooks/T_VP0_SCAFFOLD.md`) — existence test-enforced.
- `SCAFFOLD_COMMAND='npm create @wix/new@latest app'` documented and runbook-consistent.
- **Fix for live-QA truthfulness (INT-C7-LIVE):** new `scaffoldStatusStatement(linked:boolean)` produces state-aware wording: `linked=true` → confirms real binding + remaining prerequisites (dev-site consent, extension registration via dashboard/generate, `wix release`) without identifiers; `linked=false` → narrow external prerequisite (Contract §16/T-VP0/runbook + `wix.config.example.json`/registration modules/gitignore inventory). `externalBlockerStatement()` retained as deprecated alias returning `scaffoldStatusStatement(false)` — backwards compatible, no consumer break. Both branches sweep clean for `UUID_LIKE` and identifiers.

**Platform extension surface `extensionsManifest.ts|validationExtension.ts`:**

- Eight inventory rows, each `PLANNED_UNTIL_T_VP0`, channel mapping per Contract §3 verified: DASHBOARD_PAGE/MODAL+EVENT → `UNIFIED_CLI_GENERATE`; SERVICE_PLUGIN → `APP_DASHBOARD_FALLBACK` with generate-menu uncertainty honestly recorded; DATA_COLLECTIONS → `INTERACTIVE_CLI_MENU`; plan webhooks → `APP_DASHBOARD_FALLBACK`; HTTP → `FILE_BASED_NO_REGISTRATION`. All `productSourcePath` anchors exist.
- `buildBookingsValidationExtensionConfig` validates `deploymentUri` (`/api/`-rooted or `https://` with host, no traversal/query/fragment) else throws `INVALID_STATE` — no coercion. Default `/api/bookings-validation` derived from documented `pages/api` mapping (not an identifier).

**Scaffold assumption verdict:** no fabricated `wix.config.json`, no invented appId/extensionId/siteId, no secret committed, no preview-gated dependency introduced, no production claim made; `real_wix_scaffold_registration` honestly remains `OPEN` in `PRODUCT_GATES.json` pending human-owned steps (T-VP0 E1–E6).

## 9. Anti-fabrication, honesty & scope

- Registration source surface (`src/platform/registration/*.ts` + `wix.config.example.json` + `extensions.ts`) still contains **zero** UUID-like/hex shapes and **zero** SDK import shapes (swept by `registration-surface.spec.ts`; re-confirmed by reading every new file). `DEFAULT_VALIDATION_DEPLOYMENT_URI` is a project-internal route.
- Statements `scaffoldStatusStatement` (both branches) are identifier-free (`UUID_LIKE` false) and grounded in committed facts + contract citations only.
- No banned product-copy claims (§12) — no native per-location hours object claim, no unconditional reschedule promise, no hard TOCTOU cap claim; disclosures remain intact.
- Scope: every changed path belongs to integration lane fiche (owns `wix.config.json` non-secret metadata, `wix.config.example.json`, `extensions.ts`, `src/platform/registration/**`); no billing/domain/dashboard policy touched.

## 10. Non-blocking observations (no repair required)

1. **O1 — Hardcoded bootstrap appId in test.** `tests/platform/registration-project-config.spec.ts` (`real wix.config.json binding` suite) hardcodes the bootstrap-generated appId `3e9ec3af-001b-4684-a197-a5133677844d` to prove `LINKED`. The value is a real account-bound identifier already present on disk in the ignored `wix.config.json`; duplicating it in a committed test is not fabrication but is an unnecessary committed copy of a real identifier. The anti-fabrication sweep excludes `tests/**` by design, so it passes, but future edits should prefer synthetic fixture ids (`fixture-app-id`) or a dynamic read of the ignored file (gated) rather than pinning the real bootstrap id.
2. **O2 — Percent-encoded traversal.** `validateDeploymentUri` rejects literal `..` but not `%2e%2e`-encoded traversal. The value is self-authored at scaffold time, not attacker input; exposure minimal. Consider decoding before the check when next touched (inherited from prior integrated audit O2).
3. **O3 — Kind vocabularies.** Manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'` coexist — zero behavioral effect (inherited O3).
4. **O4 — Standing external gates.** Simulated-Wix and dev-site empirical gates `T-VP*/T-WH*/T-BK*/T-RB*` remain open awaiting human-owned credentials; TOCTOU/best-effort-reschedule disclosures mandatory — unaffected by this cycle.

## 11. Verdict rationale

The candidate is a narrow, evidence-backed repair of the prior live finding: it makes the unified-CLI binding classifier tolerant of the documented `projectType` variance (`app` vs `App`) without weakening the hard `appId` binding requirement, and it makes the live-QA disposition truthful in both linked and unlinked directions via `scaffoldStatusStatement`. Diff is additive, type-safe, `@wix/`-pure, and leaves every accepted domain/platform/billing behavior byte-intact (557/557, typecheck and seven-root purity green). Cross-lane DTOs, failure semantics (fail-closed CREATE/CANCEL, fail-open RESCHEDULE), rollback/recovery (§9 journal + idempotency + revision retry + verification + audit), and entitlement fail-open downgrade safety all re-prove green. No fabricated identifiers, no secrets, no scope violation, no production claim; the four observations are cosmetic/standing and do not block integration.

VERDICT: ACCEPT
