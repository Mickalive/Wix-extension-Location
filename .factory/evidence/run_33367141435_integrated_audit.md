# Integrated Audit — SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** independent integrated auditor (fresh cross-system review, distinct from all builders and lane auditors)
- **Subject:** exact commit `ec916b75d5600e02d679d264648ac92333d721f1` ("product: remove obsolete control-plane workflows and retry scripts") — working tree clean, no local modifications to product code
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `AGENTS.md`, `docs/agent-workflow.md`
- **Inputs read:** all four lane audits from cycle 32920420147 (INTEGRATION, RULES, DASHBOARD, BILLING), the integrated audit from that cycle, Wix Live finding, runbook T-VP0, Director state/gates, and the complete source tree under `src/`
- **Execution note:** deterministic checks executed directly on the subject tree (`npm run check`, `npm run build`, `npm test`); all 548 unit tests + 210 UI tests pass; purity gate passes over seven protected roots

---

## 1. Cross-lane contract integrity (mechanical + semantic)

| Contract surface | Status | Evidence |
|---|---|---|
| `src/shared/types.ts` (DTOs) | **FROZEN** — zero diff since cycle 6 accepted base | `git diff aec73b0..HEAD -- src/shared/types.ts` = empty |
| `src/domain/ports.ts` (canonical ports) | **FROZEN** — cycle-4 additive `EvaluationTargetContext` only; no breaking change | `canonical_contracts_notice` in `NEXT_CYCLE.json`; 31 target-aware tests + 9 matrix-properties tests pin the contract SHA-256 |
| `src/billing/**` pure core | **FROZEN** — no diff | billing lane no-op audit ACCEPT |
| `src/ui/**` dashboard components | **FROZEN** — no diff | dashboard lane no-op audit ACCEPT |
| `src/platform/validation-plugin/**` enforcement wiring | **FROZEN** — no diff | integration lane no-op audit ACCEPT |
| `src/platform/schedule-mutation/**` orchestrator | **FROZEN** — no diff | integration lane no-op audit ACCEPT |
| `src/platform/webhooks/**` pipeline | **FROZEN** — no diff | integration lane no-op audit ACCEPT |
| `src/platform/http/**` endpoints | **FROZEN** — no diff | integration lane no-op audit ACCEPT |
| `src/platform/composition/**` entitlement wiring | **FROZEN** — no diff | integration lane no-op audit ACCEPT |

**Single-source-of-truth welding verified:**
- `VALIDATION_TARGETS` (6 targets) → `evaluationTargetOf`/`semanticsOf` → `failureSemanticsFor` → handler matrix (42 tests) → `buildBookingsValidationExtensionConfig()` derives `validationTargets` from the implemented handler matrix — registration follows enforcement, never the reverse
- `EntitlementGate` port implemented once in `billing/enforcement/entitlementGate.ts`, consumed verbatim by validation-plugin handlers (`ValidationPluginDeps.entitlementGate`) and meter endpoint (`MeterSourceGate`) — no forked semantics
- `PolicyDecision` shape flows from billing → validation-plugin → dashboard bridge → editor restriction — identical DTO at every hop (pinned by `isEntitlementMeterDto` strict shape check)
- `MutationPlan`/`MutationSummary`/`RecoverySummary` shared types compose orchestrator → HTTP endpoints → dashboard bridge → editor polling — no reshaping

**No new coupling:** grep confirms nothing outside `src/platform/registration/**` imports the new registration surface; the module set is purely additive.

---

## 2. Booking-time enforcement — target-aware CREATE/CANCEL/RESCHEDULE

**Binding matrix (Technical Contract §5.3, domain README, 31 target-aware tests + 42 handler-matrix tests):**

| Rule family | CREATE | CANCEL | RESCHEDULE |
|---|---|---|---|
| Fail-closed classification (`RULESET_INVALID`, `INVALID_SLOT`, `EVALUATION_ERROR`) | ✅ block | ✅ block | ✅ block |
| Entitlement coverage | ✅ proposed slot | ❌ skipped | ✅ proposed slot |
| Exceptions + weekly windows | ✅ proposed slot | ❌ skipped | ✅ proposed slot |
| Caps (day/service/location) | ✅ proposed slot | ❌ skipped | ✅ **proposed slot** |
| Duplicate protection | ✅ all bookings | ❌ skipped | ✅ **excludes subject booking** |

**Verified behaviors:**
- **CREATE:** all families evaluate; fail-closed on internal error/deadline → explicit per-item block with retry hint (`VALIDATION_UNAVAILABLE`)
- **CANCEL:** classification families only; caps/windows/exceptions/duplicates/entitlement **skipped entirely** (not merely satisfied) — cancel-frees-capacity, holiday closure must not strand existing reservation, duplicate protection stops double-holding not double-releasing, entitlement is plan posture not a booking rule; fail-closed on internal error
- **RESCHEDULE:** availability families evaluate against **proposed slot**; duplicate detection excludes `subjectBookingId` (injected via evidence-gated seam, default unavailable → legacy behavior); fail-open forever on internal error/deadline → explicit per-item valid + `FAIL_OPEN_NOT_ENFORCED` claim (never claims enforcement)
- **Bulk per-item explicitness:** every index receives an explicit result; omitted items would default valid on platform side — handlers return results for all indices (tested in `validation-plugin-bulk.spec.ts` 6 tests)
- **Identity discipline (Invariant C1):** `metadata.identity` consumed only behind explicit `consumeMetadataIdentity` flag (default OFF); `contactDetails.contactId` availability UNPROVEN — duplicate protection is identity-free-first (slot/service/location/day counting)

**Honest residuals disclosed (never hidden):**
1. RESCHEDULE same-day self-count in caps: if subject's OLD slot falls in PROPOSED day bucket, authoritative counter can block same-day reschedule on at-capacity day even though total occupancy unchanged — requires platform-side count adjustment, not domain guess
2. `subjectBookingId` depends on unproven payload shape (gates T-VP3/T-VP5) — without it, self-exclusion inert, RESCHEDULE duplicate detection degrades to pre-cycle-4 behavior
3. RESCHEDULE enforcement is best-effort forever (Contract §5.3, §10#9, §12 banned claim 2) — no enforcement claim made or permitted

---

## 3. Schedule mutation — snapshot→diff→apply→verify→rollback (Contract §9)

**Orchestrator (`src/platform/schedule-mutation/orchestrator.ts`) implements the full §9 sequence:**

1. **SNAPSHOT** (`beginApply`): full JSON incl. `revision` persisted to journal **before any write** (Contract §9.1); idempotent for retries — existing non-terminal baseline resumed untouched; terminal plans rejected
2. **DIFF**: `MutationPlan` IS the user-confirmed diff (dashboard confirm modal produced it); orchestrator adds zero rule logic
3. **IDEMPOTENT WRITES** (`applyNextChange`): deterministic UUIDv5 keys per change derived from `(siteId, scopeScheduleId, ruleVersion, change)`; replay-safe (`SKIPPED_ALREADY_APPLIED`)
4. **REVISION-CHECKED UPDATES**: stale revisions retry against fresh snapshot with bounded attempts (default 3, configurable)
5. **VERIFY** (`completeApply`): re-read mutated schedule via `gateway.verifyApplied`; only then mark `APPLY_COMPLETED` and append single audit entry
6. **ROLLBACK** (`failApply`): on verification failure or explicit failure, `gateway.rollbackTo(snapshot)` with fresh idempotency keys; mark `ROLLED_BACK`; append failure audit entry; Cancel Event is terminal (documented)
7. **AUDIT**: exactly one audit-log entry per completed mutation run (`MUTATION_APPLIED` / `MUTATION_FAILED_ROLLED_BACK` / `RECOVERY_COMPLETED`)

**Crash semantics (gate T-RB1):**
- Unexpected exceptions (including process death) intentionally leave journal `APPLY_IN_PROGRESS` — no in-process rollback because dying process cannot be trusted
- Next run either **RESUMES** via `applyNextChange` (safe: writes idempotent) or calls `recoverInterruptedApply` which restores exact pre-apply state from persisted snapshot
- Serverless-friendly: `beginApply`/`applyNextChange`/`completeApply` public so long apply can span multiple invocations

**Terminal-state hardening (cycle-2, audit observation N1):**
- `NON_TERMINAL_STATES = { SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS }` — **every state outside this allowlist is treated as terminal**
- `completeApply` and `failApply` reject **every** terminal state with `INVALID_STATE` **before** touching gateway or appending audit entry
- Future state additions can never silently bypass guards

**Recovery (`recoverInterruptedApply`):**
- Loads latest interrupted plan for scope, rolls back to its snapshot, verifies restoration at working-hours-window granularity (event identity excluded — terminal-cancelled MASTERs re-create under new IDs per Contract §9.6)
- Marks record `RECOVERED`, appends own audit entry
- Returns `RecoverySummary` with `complete` boolean, `mismatches[]`, `notes[]` — never prettified into false "all good"

**Dashboard integration (DASH-C3-1):**
- Confirmed apply polls `bridge.getMutationStatus(planId)` via bounded controller (`pollMutationUntilTerminal`) until terminal state
- Polling stops permanently on first terminal state or bridge error; hard-bounded (no infinite loop)
- Crash-mid-apply recovery offered **only** as explicit button ("Recover interrupted apply") calling `bridge.recover(scope)` on click — nothing auto-retries or auto-applies destructive operation (Contract §9.2)

---

## 4. Entitlements & billing — fail-open posture, stable ordering, no data deletion

**Plan recognition (`billing/pure/entitlement.ts`):**
- Decision table fully tested (11 tests): `null` snapshot → FREE; `isFree:true` → FREE; missing/empty `vendorProductId` → FREE; known identifier → that tier; **unknown PAID identifier → TIER_1 (smallest paid allowance) + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false`** — fail-safe: under-serve rather than over-serve
- Invariant C2: `billingExpirationDate` advisory-only, never read; `isFree:false` stays paid through dunning; `isFree:true` stays free regardless of date; clone markers never change this instance's resolution

**Coverage selection (`billing/pure/coverage.ts`):**
- Stable ordering: default location first, then alphabetical by location ID (byte-wise `<` — locale-independent, deterministic)
- Locations beyond allowance returned as `unmanagedLocationIds`: management **disabled, never deleted**; customer configuration preserved so upgrade restores coverage without data loss (Contract §7, Blueprint downgrade safety)
- `overLimit: true` when at least one managed location falls outside allowance (upgrade CTA state)

**Billable location counting (`billing/counter/countBillableLocations.ts`):**
- Ratified definition (Contract §7, §11 C3/C5): business location with `archived:false` AND at least one **non-hidden** service referencing it via `locations[type=BUSINESS].business.id`
- Distinct-set intersection prevents double counting regardless of how many services reference the same location
- **Floor semantics:** computed 0 → treated as 1 for billing; floor bumps only `count`, `billableLocationIds` stays true computed set (reporting set, not entitlement grant)

**Enforcement gate (`billing/enforcement/entitlementGate.ts`):**
- **FAIL-OPEN on billing/counting/listing infrastructure errors** (Contract §7, §11 C5): transient API failure must never block paying merchant's bookings
- Degraded decisions carry `degraded:true` + persisted warning; consumers **MUST** treat `degraded:true` as "entitlement coverage unknown — do not block bookings because of entitlement"
- Warnings persist in injected ledger (Integration lane backs with data collection); transient codes clear automatically on next healthy call; `UNKNOWN_PLAN_IDENTIFIER` persists until operator maps identifier
- Over-limit is NOT an error: normal decision with `overLimit:true`, stable coverage ordering, no deletion of customer configuration
- `meter()` reading: count unreadable → `{ count: null, degraded: true }` — fail-open, never blocks bookings

**Dashboard consumption (DASH-C5-1):**
- Loads meter via typed bridge `getEntitlementMeter()` (pinned v1 DTO, consumed verbatim)
- **Healthy coverage:** locations OUTSIDE `coverage.allowedLocationIds` visibly restricted for NEW rule configuration (badged + disabled); EXISTING configuration for those locations stays rendered **read-only, never deleted or silently dropped** (§7)
- **Anti-trap rule:** any control whose current value contributes a validation issue stays correctable, so restriction can never trap editor in permanently invalid draft
- **Degraded coverage fails OPEN exactly like enforcement:** persistent warning banner, nobody restricted based on unreliable list
- `meter.degraded` shows persistent fail-open warning banner without bricking editing
- `overLimit` surfaces Contract §7 upgrade CTA (`buildUpgradeUrl` contract, opened in NEW TAB); identifiers host-injected, never fabricated
- 404/null meter or typed bridge failure degrades to unrestricted editor behind non-blocking notice — never a crash

---

## 5. Accessibility-sensitive behavior

**Rules editor page (`src/ui/pages/rulesEditorPage.js`):**
- All interactive controls have explicit `aria-label` attributes describing scope, weekday, window index, and field purpose
- Status region uses `role="status"` with `aria-live="polite"` for save/apply/recover feedback
- Degraded/over-limit banners use `role="alert"` for immediate announcement
- Validation issues region uses `role="alert"` with `aria-describedby` linking to issues list
- Disabled controls under entitlement restriction carry descriptive `title` attributes explaining the restriction
- Keyboard-friendly native inputs (`type="text"`, `inputmode="numeric"`, `select` elements)
- Diff preview modal (`diffPreviewModal.js`) — confirm/cancel actions accessible, focus management on open/close
- Color not sole conveyor of information (badges + text labels)

**No accessibility regressions:** 210/210 UI tests pass including accessibility assertions; no `.skip/.only/.todo` in test suite.

---

## 6. Real Wix scaffold assumptions — honest external prerequisite

**Current state (Wix Live finding `reports/wix-live/CYCLE_32920420147.md`):**
- **No real `wix.config.json` exists** — the integrated product is not yet registered as a testable Wix CLI app
- Empirical Wix/dev-site claims **cannot** be made
- Required repair: establish supported non-secret Wix CLI app scaffold/registration and prove it with live job
- **VERDICT: FIX_BEFORE_INTEGRATION** (live job disposition)

**Registration surface delivered (cycle 7 integration candidate, independently ACCEPTed):**
- Truthful linkage classifier (`MISSING_FILE`/`UNPARSEABLE`/`UNLINKED`/`LINKED` demanding positive `appId` evidence) — cannot over-report linkage (safe direction: only under-reports)
- Machine-readable prerequisites record (5 entries, each with `owner=HUMAN_ACCOUNT_OWNER`, `why-not-derivable-in-CI`, gate, existing-runbook anchor)
- `externalBlockoutStatement()` composes narrow, identifier-free `BLOCKED_EXTERNAL` wording grounded in Contract §16/T-VP0/runbook
- Extension inventory with contract-exact channels (8 rows): DASHBOARD_PAGE/MODAL + EVENT → `UNIFIED_CLI_GENERATE`; SERVICE_PLUGIN → `APP_DASHBOARD_FALLBACK` (generate-menu uncertainty explicitly recorded pending T-VP0); DATA_COLLECTIONS → `INTERACTIVE_CLI_MENU`; plan webhooks → `APP_DASHBOARD_FALLBACK`; HTTP endpoints → `FILE_BASED_NO_REGISTRATION`
- Validation-plugin config welded to implemented target matrix (single source of truth)
- No `wix.config.json` committed — gitignored with rationale; committed `wix.config.example.json` carries only explicit placeholders, pinned UNLINKED by same classifier
- No identifiers/secrets fabricated — anti-fabrication specs sweep whole surface for UUID-like/hex shapes and SDK-import strings (passing)

**Human-owned prerequisites (Contract §16, never automatable):**
1. Wix account authorizing the CLI; owner/co-owner for API Keys Manager
2. One-time scaffold/bind (`npm create @wix/new@latest app`) choosing immutable namespace + code identifier → real appId
3. One interactive dev-site install consent; dev-site pinning for automation
4. API key created in API Keys Manager, stored as CI secret (never committed)
5. Payout account setup before publishing a paid app; Partner Program membership
6. `wix release` approvals, pricing/listing content entry, App Market Submit & Publish, demo-account maintenance, privacy policy + ToU URLs, support email

**Until (1)–(3) occur:** builders produce credential-free value (pure domain core, adapter interfaces + fakes, orchestrators, dashboard components, billing engines, all tests). Real extension IDs, `wix dev`, releases, and empirical gates wait for credentials.

---

## 7. Deterministic gates — all green on subject tree

| Gate | Command | Result |
|---|---|---|
| TypeScript strict | `npm run check` (tsc --noEmit) | ✅ exit 0 |
| Purity gate (7 roots) | `npm run check:purity` | ✅ pass (domain, billing/pure, platform/http, webhooks, validation-plugin, composition, registration) |
| Unit tests | `npm run test:unit` (vitest) | ✅ 548/548 passed, 49 files |
| UI tests | `npm test` in `tests/ui` | ✅ 210/210 passed |
| Offline build | `npm run check:offline` (proxies pinned to dead port) | ✅ exit 0, 548/548 — zero network egress |
| Production build | `npm run build` | ✅ exit 0 (equals `check`) |
| Hygiene | no `.skip/.only/.todo/.fails(` under `tests/` | ✅ clean |
| Banned claims scan | §12 vocabulary over all added files | ✅ clean |

---

## 8. Non-blocking observations (record; no repair required)

1. **O1 (inherited):** `registration-surface.spec.ts` matches `/wix\.config\.example\.json/m` against `.gitignore`, hitting a comment line rather than active rule. Harmless (example file meant committable; load-bearing `^wix\.config\.json$` anchor correct).
2. **O2:** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal (e.g. `/api/%2e%2e/x`). Value is self-authored at scaffold time, not attacker input; consider decoding before traversal check when next touched.
3. **O3:** Two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect; unify when surface next touched.
4. **O4 (standing, cross-cycle):** Simulated-Wix QA has never completed; all dev-site gates await human-owned credentials; TOCTOU and best-effort-reschedule disclosures remain mandatory.
5. **O5:** Placeholder token matching can flag exotic real appId containing e.g. `TODO` as UNLINKED — false positive in safe direction; acceptable.

---

## 9. Verdict rationale

The subject commit `ec916b75d5600e02d679d264648ac92333d721f1` is a **governance hygiene commit** that removes obsolete control-plane workflows and retry scripts (`.github/actions/setup-opencode`, `.github/scripts/recover-transient-opencode.sh`, `.github/scripts/run-opencode-with-retry.sh`, `.github/workflows/ci.yml`). It introduces **zero product code changes** — all product behavior (domain, platform, dashboard, billing) remains byte-identical to the cycle-7 integrated preview that was independently ACCEPTed by the integrated auditor (`CYCLE_32920420147_INTEGRATED.md`).

The cross-lane contracts are frozen and mechanically verified. The target-aware CREATE/CANCEL/RESCHEDULE enforcement matrix is implemented, tested, and documented with honest residuals. The schedule-mutation orchestrator implements the full Contract §9 sequence with crash-safe recovery, terminal-state hardening, and explicit user intent for every destructive operation. The entitlement system implements the ratified fail-open posture, stable coverage ordering, and no-data-deletion downgrade safety. The dashboard consumes typed contracts exclusively through the bridge, enforces entitlement restriction with anti-trap rules, and meets accessibility requirements. The real Wix scaffold prerequisite is honestly documented as `BLOCKED_EXTERNAL` with a narrow, evidenced external blocker statement — no fabrication, no pre-emption of the live job's disposition.

All deterministic gates pass. No semantic regression, no weakened test, no hidden degraded state, no unsupported Wix assumption, no scope violation.

**The integrated product at this SHA is mechanically sound and contractually coherent. The sole blocker to production claims is the human-owned Wix scaffold prerequisite (Contract §16), which is correctly evidenced as `BLOCKED_EXTERNAL` and does not invalidate the accepted product state.**

VERDICT: ACCEPT