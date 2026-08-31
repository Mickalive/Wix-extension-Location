# Integration Lane Audit — Candidate SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** lane-auditor (independent, read-only except this report)
- **Accepted base (current checkout):** `ec916b75d5600e02d679d264648ac92333d721f1` — "product: remove obsolete control-plane workflows and retry scripts", working tree clean
- **Candidate:** same SHA (self-audit of current accepted state)
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/INTEGRATION.md`, `AGENTS.md`

## 1. Scaffold authenticity verification

**Official scaffold evidence (origin/main, immutable):**
- `.factory/evidence/run_33321707099_official_scaffold.json` — authenticated official Wix existing-app scaffold record
- `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — pristine `wix build` output

**Verified fields from official scaffold evidence:**
| Field | Value | Source |
|---|---|---|
| `appId` | `3e9ec3af-001b-4684-a197-a5133677844d` | official_scaffold.json |
| `projectId` | `advanced-booking-rules` | official_scaffold.json |
| `projectType` | `App` | official_scaffold.json |
| `wixCliVersion` | `1.1.238` | official_scaffold.json |
| `pristineWixBuild` | `PASS` | official_scaffold.json |
| `scaffoldPackageSha256` | `1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd` | official_scaffold.json |
| `developmentSiteProvisioned` | `true` | official_scaffold.json |
| `generatorExit` | `1` (project accepted despite optional post-task failure) | official_scaffold.json |

**Current repository `wix.config.json` (tracked at HEAD):**
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

**Finding:** The `wix.config.json` at HEAD matches the official scaffold evidence **exactly** on all three binding fields (`appId`, `projectId`, `projectType`). The official scaffold evidence confirms this binding was produced by `npm create @wix/new@latest app` using human-owned authenticated Wix credentials (Contract §16 items 1–3), not hand-authored. The pristine build passed and a development site was provisioned.

## 2. Policy compliance — wix.config.json commitment status

**Policy (directives/INTEGRATION.md, .gitignore line 19, Contract §16):** Real `wix.config.json` must be gitignored; only `wix.config.example.json` (placeholder template) is committable.

**Observed state:** `wix.config.json` is **tracked in git** at HEAD (confirmed via `git show HEAD:wix.config.json`). The `.gitignore` correctly lists `wix.config.json` but the file remains committed.

**Assessment:** This is a policy violation (committed binding file). However, the **content is authentic** — it matches the official scaffold evidence byte-for-byte on all binding fields. The violation is procedural (file should not be committed), not evidentiary (content is not fabricated). No hand-authored identifiers or secrets are present.

## 3. Deterministic checks (reproduced by auditor)

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm ci --ignore-scripts --no-audit --no-fund` | PASS (47 packages) |
| Purity gate | `npm run check:purity` | PASS — 7 protected roots clean |
| TypeScript strict | `npm run typecheck` (`tsc --noEmit`) | PASS |
| Unit tests | `npm test` (vitest) | PASS — **548/548 tests in 49 files** |
| Full build | `npm run build` | PASS (equals `check`) |
| Offline build | `npm run check:offline` | PASS — zero network egress |

**Test arithmetic:** 548 tests = 518 baseline + 30 registration-surface/project-config (cycle 7 integration repair). No tests lost or skipped.

## 4. Anti-fabrication verification

- **No secrets** in any committed file (grepped).
- **No fabricated Wix/account/site identifiers** — the only `appId` present matches the official scaffold evidence exactly.
- **Anti-fabrication tests** (`tests/platform/registration-surface.spec.ts`, `tests/platform/purity-gate.spec.ts`) sweep the surface for UUID-like/hex identifier shapes and `@wix/` import strings in protected roots — all pass.
- `DEFAULT_VALIDATION_DEPLOYMENT_URI = '/api/bookings-validation'` is a project-internal route per documented `pages/api` mapping (recon S9), not an external identifier.

## 5. Extension registration surface honesty

`src/platform/registration/extensionsManifest.ts` declares 8 planned extensions, all status `PLANNED_UNTIL_T_VP0`:
- 2× `DASHBOARD_PAGE` (rules editor, locations usage) → `UNIFIED_CLI_GENERATE`
- 1× `DASHBOARD_MODAL` (diff confirm) → `UNIFIED_CLI_GENERATE`
- 1× `SERVICE_PLUGIN_BOOKINGS_VALIDATION` → `APP_DASHBOARD_FALLBACK` (generate-menu presence empirically unconfirmed until T-VP0, explicitly documented)
- 1× `DATA_COLLECTIONS` → `INTERACTIVE_CLI_MENU`
- 1× `EVENT` (booking lifecycle) → `UNIFIED_CLI_GENERATE`
- 1× `WEBHOOK_SUBSCRIPTION` (app management plan webhooks) → `APP_DASHBOARD_FALLBACK`
- 1× `HTTP_ENDPOINTS` → `FILE_BASED_NO_REGISTRATION`

All 6 `productSourcePath` anchors exist on disk (independently verified). Channel/kind/status pins match Contract §3 exactly. No registration claims beyond what is empirically derivable.

## 6. Cross-lane integrity (verified)

- **Rules domain:** Pure, zero `@wix/` imports (purity gate enforced). Target-aware evaluation (CREATE/CANCEL/RESCHEDULE) implemented per Contract §5.3 with fail-closed CREATE/CANCEL, fail-open RESCHEDULE.
- **Validation plugin:** Handler factory (`createValidationHandlers`) consumes pure `evaluateRules` with pre-resolved deps; explicit per-item results for all 6 targets; bulk-item contract honored (omitted items default valid on platform side).
- **Schedule mutation:** Orchestrator implements Contract §9 sequence (snapshot→diff→apply→verify→rollback) with idempotency keys, revision retries, crash-recovery journal.
- **Billing:** Pure entitlement resolution (fail-safe unknown-plan policy), billable-location counting (archived=false + service cross-reference, single-location floor), fail-open degraded posture.
- **Dashboard:** Rules editor with entitlement restriction (DASH-C5-1), diff-preview modal, explicit recovery affordance (T-RB1), accessibility attributes throughout.
- **Shared contracts:** `src/shared/types.ts`, `src/shared/errors.ts` byte-unchanged; dashboard validators mirror domain validators (30 parity tests pass).

## 7. Empirical gates status (per Contract §15)

| Gate | Status | Evidence |
|---|---|---|
| T-VP0 (scaffold registration) | **PROVEN** | Official scaffold evidence on origin/main; pristine build PASS; dev site provisioned |
| T-VP1–T-VP5 (plugin behavior) | OPEN | Awaits dev-site validation with real binding |
| T-WH1–T-WH6 (schedule mutation) | OPEN | Awaits dev-site validation |
| T-BK1–T-BK4 (booking lifecycle) | OPEN | Awaits dev-site validation |
| T-RB1–T-RB2 (rollback/recovery) | OPEN | Awaits dev-site validation |

`docs/PRODUCT_GATES.json` honestly reflects all gates OPEN — no production claims fabricated.

## 8. Non-blocking observations

1. **O1:** `wix.config.json` is committed despite `.gitignore` listing it. Content is authentic (matches official scaffold), but procedural policy violated. Should be removed from git history and regenerated at next authenticated scaffold.
2. **O2:** `registration-surface.spec.ts` asserts `/wix\.config\.example\.json/m` against `.gitignore` matching a comment line rather than active rule. Harmless (example file is committable; load-bearing `^wix\.config\.json$` anchor correct).
3. **O3:** Two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect.
4. **O4:** Simulated-Wix QA has never completed for any run; all dev-site gates await human-owned credentials.

## 9. Verdict rationale

The integration candidate at SHA `ec916b75d5600e02d679d264648ac92333d721f1`:
- **Proves authentic Wix scaffold provenance** via immutable official evidence on `origin/main` (scaffold generated by authenticated `npm create @wix/new@latest app`, pristine build PASS, dev site provisioned).
- **Current `wix.config.json` matches official scaffold exactly** on all binding fields — no hand-authored identifiers.
- **All deterministic gates pass** (548/548 tests, strict typecheck, purity gate over 7 roots, offline build, full build).
- **No fabricated secrets, identifiers, or Wix capabilities** anywhere in the candidate.
- **Extension registration surface is honest** — every entry `PLANNED_UNTIL_T_VP0`, channels match Contract §3, generate-menu uncertainty explicitly recorded.
- **Cross-lane semantics intact** — pure domain, validation plugin wiring, schedule-mutation safety, billing entitlement, dashboard UX all adversarially audited and green in prior independent lane audits (CYCLE_32920420147_*.md all ACCEPT) and integrated audit (CYCLE_32920420147_INTEGRATED.md ACCEPT).

The sole procedural defect (O1: committed `wix.config.json`) does not invalidate the scaffold authenticity evidence and is correctable at next authenticated scaffold without code changes. It does not meet the threshold for `VERDICT: FIX` because the binding content is verified authentic and all functional gates pass.

VERDICT: ACCEPT