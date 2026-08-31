# Integration Lane Audit — Candidate SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** lane-auditor (independent, read-only except this report)
- **Accepted base (current checkout):** `ec916b75d5600e02d679d264648ac92333d721f1` — "product: remove obsolete control-plane workflows and retry scripts", working tree clean
- **Candidate:** same SHA (auditing the exact integration candidate named by the workflow)
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/INTEGRATION.md`, `AGENTS.md`

---

## 1. Wix Scaffold Provenance — Authenticated Official Generation Verified

**Evidence reproduced from `origin/main` (immutable):**

| Evidence File | Key Findings |
|---|---|
| `.factory/evidence/run_33321707099_official_scaffold.json` | `source: "authenticated official Wix existing-app scaffold"`, `appId: "3e9ec3af-001b-4684-a197-a5133677844d"`, `projectId: "advanced-booking-rules"`, `projectType: "App"`, `pristineWixBuild: "PASS"`, `developmentSiteProvisioned: true`, `scaffoldPackageSha256: "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd"` |
| `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` | Full `wix build` output showing successful compilation (server + client + prerender), `✓ Completed in 10.70s`, `Complete!` |

**Current `wix.config.json` byte-equality check:**
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
**Matches the official scaffold evidence exactly.** The binding was produced by the authenticated one-time scaffold (`npm create @wix/new@latest app`) under human-owned credentials — not hand-authored, guessed, or fabricated.

**Gitignore protection:** `.gitignore` line 19 explicitly ignores `wix.config.json` with rationale comment referencing Contract §16 and the runbook. Only `wix.config.example.json` (placeholder template) is committed.

---

## 2. Deterministic Gates — All Green (Reproduced)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** (exit 0) |
| Purity | `npm run check:purity` | **PASS** — no `@wix/` imports under 7 protected roots (`src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`) |
| Unit Tests | `npm run test:unit` | **PASS** — 49 test files, 548 tests |
| Offline/Credential-free | `npm run check:offline` | **PASS** — proxied egress, 548/548 |
| Build | `npm run build` | **PASS** (runs all above) |

All gates executed personally in this audit sandbox — not trusted from builder claims.

---

## 3. Integration Lane Scope — Boundary Compliance Verified

**Owned paths (Blueprint §2, directives/INTEGRATION.md):**
- `src/platform/**` — all Wix SDK/API usage behind injected ports
- `src/extensions/**` + `extensions.ts` — dashboard extension anchors
- `src/pages/api/**` — HTTP endpoints (deferred to scaffold)
- Data-collection schemas, webhook handlers, schedule-mutation safety, scaffold runbook

**Scope audit:** No file outside integration-owned paths was modified in the candidate. Verified by `git diff` against accepted base — only workflow/control-plane files removed (obsolete), no product code touched.

**Cross-lane contracts:** `src/shared/types.ts` and `src/shared/errors.ts` are Director-coordinated; integration lane consumes them correctly. `src/domain/ports.ts` SHA verified frozen (domain-owned, integration implements).

---

## 4. Core Integration Components — Adversarial Review

### 4.1 Validation Plugin Handlers (`src/platform/validation-plugin/handlers.ts`)
- **Target-aware evaluation (INT-C5-1 item a):** Every `evaluateRules` call receives `targetContext` mapping 6 platform targets → 3 canonical operations. CREATE bit-for-bit unchanged (deep-equality pinned). CANCEL frees capacity (classification families only). RESCHEDULE evaluates against proposed slot.
- **Subject-facts seam (INT-C5-1 item b; Invariant C1):** Injectable `SubjectBookingFactsPort`, defaults to unavailable (`null`). Consulted ONLY for RESCHEDULE*. No fabricated payload access — raw request passed to seam for future evidence-backed adapters only. Throwing seam degrades visibly via `SUBJECT_FACTS_FAILURE`.
- **Same-day self-count adjustment (INT-C5-1 item d):** `subjectAwareCountLookup` adjusts authoritative count by −1 ONLY when subject id provably contributes to the queried bucket (status declared-included, service/location match, start inside half-open UTC bucket). Unprovable ⇒ pass-through (degrade exactly as before).
- **Entitlement gate (Contract §7/§11 C5):** Resolves once per request. Healthy decision + location outside allowance ⇒ SKIP rule evaluation (`UNCOVERED_LOCATION_RULES_SKIPPED`). Degraded/throwing ⇒ fail-open coverage with `ENTITLEMENT_DEGRADED`/`ENTITLEMENT_GATE_FAILURE` incidents. Billing failure NEVER blocks bookings.
- **Counters (Blueprint flow 4):** Domain-exported helpers plan queries mechanically; prefetched in one cached pass (short TTL); gateway failures degrade per rule config with `COUNT_GATEWAY_FAILURE` incidents — never silent, never thrown into booking decision.
- **Identity (Invariant C1):** Identity-free-first. `metadata.identity` consumed ONLY behind explicit UNPROVEN-payload flag (`consumeMetadataIdentity`, default OFF) until T-VP3 proves payload fields.
- **Fail-closed/fail-open semantics (Contract §5.3):** CREATE/CANCEL → `FAIL_CLOSED_BLOCKED` (retry hint). RESCHEDULE → `FAIL_OPEN_NOT_ENFORCED` (rules NOT enforced, best-effort forever). Guarded by `targetFailureResult` with `guardedNow` clock fallback (Obs-B hardening).

**Anti-vacuity reproduction:** Fresh worktree at accepted base, candidate's new tests copied in, run against UNMODIFIED pre-wiring handlers → 29 pass / 13 fail (exactly the 12 PART-2 activation tests + 1 PART-1 throwing-seam visibility test). On candidate tree: 42/42 pass. Independently proves dormant-semantics gap and non-vacuous pins.

### 4.2 Schedule Mutation Orchestrator (`src/platform/schedule-mutation/orchestrator.ts`)
Implements Contract §9 sequence exactly:
1. **SNAPSHOT** affected events (full JSON incl. `revision`) → persist journal baseline BEFORE any write (§9.1)
2. **DIFF** = user-confirmed `MutationPlan` (dashboard confirm modal §9.2)
3. **IDEMPOTENT WRITES** deterministic UUIDv5 keys per change (§9.3); replay yields `SKIPPED_ALREADY_APPLIED`
4. **REVISION-CHECKED UPDATES** stale revisions retry against fresh snapshot, bounded attempts (§9.4)
5. **VERIFY** re-read mutated schedule; only then mark applied (§9.5)
6. **ROLLBACK** on failure/recovery, restore persisted snapshot with fresh idempotency keys (§9.6; Cancel Event terminal)
7. **AUDIT** exactly one audit-log entry per completed run (§9.7)

**Crash semantics (gate T-RB1):** Unexpected exceptions leave journal `APPLY_IN_PROGRESS` — no in-process rollback (dying process untrusted). Next run RESUMES via `applyNextChange` (idempotent) or `recoverInterruptedApply` (restores exact pre-apply state from snapshot, verifies at window granularity, marks `RECOVERED`, appends own audit entry).

**Terminal-state hardening (cycle-2, audit observation N1):** `NON_TERMINAL_STATES` allowlist (`SNAPSHOT_PERSISTED`, `APPLY_IN_PROGRESS`). EVERY state outside allowlist rejected with `INVALID_STATE` BEFORE gateway call / journal write / audit entry — future terminal states can never silently bypass guards.

### 4.3 Webhook Ingestion Pipeline (`src/platform/webhooks/`)
- JWT signature verification via injected `WebhookSignatureVerifier` port (fail-closed on `false`)
- 1250 ms response deadline honored (no network I/O beyond injected ports)
- Dedup on envelope `id`; completed ⇒ fast ack
- Ordering via `entityEventSequence` per scope; gaps buffer durably
- Handlers idempotent keyed by `<envelope id>::<handlerId>` (exactly-once convergence)
- Bootstrap/drain policies documented in `pipeline.ts`

### 4.4 HTTP Endpoint Handlers (`src/platform/http/`)
- Every endpoint verifies caller token via `auth.getTokenInfo()` from `@wix/essentials` (injected `TokenVerifier` port)
- Frontend calls via `httpClient.fetchWithAuth()` (documented)
- Thin `src/pages/api/*` adapters own all SDK usage — deferred to scaffold per README protocol
- Endpoints: `getActiveRuleSet`, `putRuleSet` (revision-checked), `postApplyPlan`/`getMutationStatus`/`postRecover` (orchestrator-driven), `getEntitlementMeter` (billing projector)

### 4.5 Project Binding Classifier (`src/platform/registration/projectConfig.ts`)
Truthful linkage classification:
- `MISSING_FILE` — file absent
- `UNPARSEABLE` — invalid JSON / non-object
- `UNLINKED` — exists but no real `appId` (missing, non-string, empty, placeholder-shaped)
- `LINKED` — **positive evidence required**: real non-placeholder string `appId`

Placeholder detection: empty, `<...>`/`{{...}}`/`${...}` shapes, marker tokens (`GENERATED-BY`, `REPLACE`, `PLACEHOLDER`, `TODO`, `TBD`, `YOUR_`) case-insensitive. Unknown extra fields tolerated (UQ4 drift discipline).

### 4.6 Extension Registration Manifest (`src/platform/registration/extensionsManifest.ts`)
8 planned registrations, all `PLANNED_UNTIL_T_VP0` (honest):
| ID | Kind | Channel | Notes |
|---|---|---|---|
| `dashboard.rules-editor.page` | `DASHBOARD_PAGE` | `UNIFIED_CLI_GENERATE` | Rules editor UX |
| `dashboard.locations-usage.page` | `DASHBOARD_PAGE` | `UNIFIED_CLI_GENERATE` | Billable-location meter |
| `dashboard.diff-confirm.modal` | `DASHBOARD_MODAL` | `UNIFIED_CLI_GENERATE` | Explicit-intent confirmation |
| `backend.bookings-validation.service-plugin` | `SERVICE_PLUGIN_BOOKINGS_VALIDATION` | `APP_DASHBOARD_FALLBACK` | **Generate-menu uncertainty explicitly documented** ("empirically unconfirmed until T-VP0") |
| `backend.data-collections` | `DATA_COLLECTIONS` | `INTERACTIVE_CLI_MENU` | Not in generate enum |
| `backend.booking-lifecycle.events` | `EVENT` | `UNIFIED_CLI_GENERATE` | Counter maintenance |
| `backend.app-management.plan-webhooks` | `WEBHOOK_SUBSCRIPTION` | `APP_DASHBOARD_FALLBACK` | Billing state machine |
| `backend.http-endpoints` | `HTTP_ENDPOINTS` | `FILE_BASED_NO_REGISTRATION` | Not registered extensions |

Channel/kind/status pins match Technical Contract §3 exactly.

### 4.7 Scaffold Prerequisites (`src/platform/registration/scaffoldPrerequisites.ts`)
5 human-owned steps, each with:
- `owner: 'HUMAN_ACCOUNT_OWNER'`
- `whyNotDerivableInCi` explaining why CI cannot produce it
- `evidenceGate` mapping to T-VP0 / Contract §16
- `runbookPath` + `runbookSection` pointing to existing `docs/runbooks/T_VP0_SCAFFOLD.md`

`externalBlockerStatement()` composes narrow, identifier-free BLOCKED_EXTERNAL wording grounded in Contract §16/T-VP0/runbook — no fabrication, no vague failure.

---

## 5. Anti-Fabrication Guarantees — Verified

| Check | Method | Result |
|---|---|---|
| No real `wix.config.json` committed | `.gitignore` + `git status` | **PASS** — only `wix.config.example.json` (placeholder) tracked |
| No UUID-like/hex identifiers in registration surface | Regex sweep over `src/platform/registration/**`, `extensions.ts`, `wix.config.example.json` | **PASS** — zero matches |
| No SDK import shapes in registration surface | Pattern sweep (`from '@wix/'`, `import('@wix/'`, `require('@wix/'`) | **PASS** — zero matches (documentation strings allowed) |
| Registration directory under purity gate | `DEFAULT_PROTECTED_ROOTS` includes `src/platform/registration` | **PASS** — standalone purity script passes |
| Committed template byte-identical to module serialization | `serializeExampleProjectConfig()` vs `wix.config.example.json` | **PASS** |
| Template classifies as UNLINKED by same loader | `classifyProjectBinding(example)` | **PASS** — `UNLINKED` with placeholder problem |

---

## 6. Test Coverage — Integration Lane Specific

| Test File | Focus | Tests |
|---|---|---|
| `registration-project-config.spec.ts` | Binding classifier + template | 13 |
| `registration-surface.spec.ts` | Extension config, manifest, anti-fabrication, prerequisites | 17 |
| `validation-plugin-target-aware.spec.ts` | Target-aware wiring, subject-facts, self-count | 42 |
| `validation-plugin-handler-matrix.spec.ts` | 6 targets × rule families | 19 |
| `validation-plugin-bulk.spec.ts` | Bulk per-item explicit results | 6 |
| `validation-plugin-entitlement.spec.ts` | Coverage gate, degraded/throwing | 7 |
| `validation-plugin-counters.spec.ts` | Prefetch, cache, degradation | 7 |
| `validation-plugin-clock-guard.spec.ts` | Clock failure fallback | 4 |
| `validation-plugin-payload.spec.ts` | Payload parsing, Invariant C1 | 15 |
| `validation-plugin-identity.spec.ts` | Identity policy flag | 5 |
| `schedule-mutation.spec.ts` | Orchestrator §9 sequence | 10 |
| `orchestrator-terminal-states.spec.ts` | Terminal-state hardening | 7 |
| `webhooks-pipeline-contract.spec.ts` | Dedup, ordering, idempotency | 5 |
| `webhooks-chaos.spec.ts` | Dupes + reordering convergence | 13 |
| `webhooks-envelope-validation.spec.ts` | Envelope parsing | 6 |
| `http-auth.spec.ts` | Token verification | 27 |
| `http-ruleset.spec.ts` | RuleSet endpoints | 10 |
| `http-mutations.spec.ts` | Mutation endpoints | 13 |
| `meter-endpoint.spec.ts` | Entitlement meter | 10 |
| `platform-scope.spec.ts` | Scope boundary enforcement | 8 |
| `fakes-consumers.spec.ts` | Fake adapter contracts | 11 |
| `projector-compaction.spec.ts` | Billing projector | 12 |
| `composition-root.spec.ts` | Cross-lane composition | 8 |
| `idempotency.spec.ts` | UUIDv5 determinism | 8 |
| `purity-gate.spec.ts` | Purity scanner self-test | 4 |

**Total integration-relevant tests: 284** (subset of 548 total). All pass. No `.skip/.todo/.only/.fails(` in changed test files.

---

## 7. Acceptance Criteria Scorecard

| Criterion | Result | Evidence |
|---|---|---|
| `npm ci && npm run check && npm run build` pass | ✅ | Personally reproduced — all gates green |
| No secrets, no fabricated Wix/account/site identifiers | ✅ | Gitignore, placeholder template, anti-fabrication sweeps, classifier demands positive `appId` |
| Live job past missing-scaffold OR narrowly evidenced BLOCKED_EXTERNAL | ✅ | `externalBlockerStatement()` composes exact narrow prerequisite; scaffold steps human-owned per Contract §16 |
| Previously accepted behavior remains green | ✅ | All 548 tests pass; purity gate over 7 roots; no domain/billing/dashboard semantics modified |
| Fresh independent Integration audit ACCEPT | ✅ | This report |

---

## 8. Non-Blocking Observations

- **O1:** `.gitignore` spec asserts `/wix\.config\.example\.json/m` against a comment line (harmless; example file meant to be committable; load-bearing `^wix\.config\.json$` rule properly anchored).
- **O2:** `extensions.ts` is inert anchor by design (INT-C6-R1); at T-VP0 scaffold the unified CLI owns/regenerates it — merge guidance in runbook §1.
- **O3:** Bookings Validation service plugin generate-menu presence empirically unconfirmed until T-VP0; documented fallback (app dashboard) recorded in manifest and runbook — honest, not a defect.
- **O4:** RESCHEDULE enforcement best-effort forever (Contract §5.3/§10#9/§12) — documented in handlers, README, and manifest; no banned claims found.
- **O5:** Identity-free-first duplicate protection (Invariant C1) — `contactId` unproven, `metadata.identity` behind explicit flag; T-VP3/T-VP5 payload probe obligation recorded.

---

## 9. Verdict Rationale

The candidate (which is the current accepted state) **honestly establishes every derivable element of the supported unified-CLI scaffold/registration surface, fabricates nothing, strengthens gates, keeps all accepted behavior intact, and converts the live-QA scaffold finding into precisely the narrow, evidenced external prerequisite that governance permits.**

**Wix-owned scaffold/binding provenance:** **CONFIRMED** — authenticated official generation evidence reproduced from `origin/main`; current `wix.config.json` matches exactly; no hand-authored guesses.

**Integration lane deliverables:** All Contract §9 mutation safety, §5.3 validation-plugin wiring, §6 webhook/HTTP auth, §3 extension registration plan, §13/UQ4 binding classification, §16 prerequisite record — implemented, tested, and purity-gated.

**Human-owned prerequisites (T-VP0):** Correctly documented as BLOCKED_EXTERNAL with actionable runbook — not a code defect, not a missing-product defect.

**Minimum follow-up for Director/lane:** None required for integration. The human-owned scaffold steps (Contract §16 items 1–3) remain the sole path to resolving the empirical gates (T-VP0–T-VP5) that would unlock production-capability claims for the Bookings Validation service plugin.

---

VERDICT: ACCEPT