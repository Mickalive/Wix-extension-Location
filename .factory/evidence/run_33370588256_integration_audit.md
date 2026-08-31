# Factory Lane Audit — Integration Candidate ec916b75d5600e02d679d264648ac92333d721f1

**Role:** lane-auditor (adversarial, read-only except this report) — auditing exact integration candidate as named by workflow, not builder claims.
**Candidate SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Accepted Base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Scope:** Wix Integration lane ownership (scaffold/project metadata, platform adapters, extension/backend transport, persistence, webhooks, idempotency, schedule mutation safety). Report writable path `reports/factory_lane_audit.md` only.
**Model:** opencode/muse-spark-1.2-contributor-free
**Date (UTC):** 2026-08-31

## 1. Candidate vs Base

- Reproduced via `git diff ec916b75d5600e02d679d264648ac92333d721f1 ec916b75d5600e02d679d264648ac92333d721f1` → no output (zero diff).
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` matches working-tree `wix.config.json`.
- Candidate is identical to accepted base; no new integration deltas to integrate. Audit therefore validates that the existing bound state remains authentic and integrable, and that no hand-authored scaffold drift was introduced.

## 2. Wix-Owned Scaffold/Binding Provenance (Authenticated Official Generation)

**Instruction:** For the current Wix app binding, authenticated official-scaffold provenance is available on `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`; inspect with `git show`.

Reproduced with allowed `git show` (no pipes/redirects):

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` returned:
```json
{
  "schemaVersion": 3,
  "source": "authenticated official Wix existing-app scaffold",
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App",
  "createNewVersion": "0.0.105",
  "wixCliVersion": "1.1.238",
  "generatorExit": 1,
  "projectAcceptedDespiteOptionalPostTaskFailure": true,
  "pristineWixBuild": "PASS",
  "scaffoldPackageSha256": "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd",
  "developmentSiteProvisioned": true,
  "secretsPersisted": false
}
```

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` returned a full Vite/Astro build log ending with `Server built in 10.70s / Complete!` and no build errors; pristine Wix build PASS is proven by log (Cloudflare adapter, 6864 modules transformed, client + server built).

- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` and working-tree `wix.config.json` both contain:
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

**Findings:**
- App ID, projectId, projectType exactly match authenticated official scaffold. No hand-authored guess, no fabricated ID, no secret material in `wix.config.json`.
- `generatorExit: 1` with `projectAcceptedDespiteOptionalPostTaskFailure: true` and `pristineWixBuild: PASS` is the documented acceptable case (optional post-task failure does not invalidate scaffold; build passed). No evidence of manual scaffold creation.
- No mutation of `wix.config.json` beyond preserving the bound existing App ID (lane ownership rule satisfied: integration lane may repair only while preserving bound App ID; here no repair needed).
- Working-tree check confirms no credential files, no `~/.wix/**` access, no raw WIX_API_KEY placement.

## 3. Evidence Reproduction — Deterministic Checks (Self-Run, Not Builder Claims)

Executed directly via allowed shell commands (no wrappers/pipes):

- `npm ci` → installed 47 packages, no script injection.
- `npm run check:purity` (direct `node src/platform/purity/check-purity.mjs`) → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- `npm run typecheck` (`tsc --noEmit`) → PASS after `npm ci` (initial run failed only due to missing `@types/node` before install; post-install clean).
- `npm test` (`npm run test:unit` → `check:purity && vitest run --config src/platform/vitest.config.ts`) → **49 test files, 548 tests passed**, 0 failed. Includes:
  - domain purity, billing purity, platform purity-gate specs
  - schedule-mutation, orchestrator-terminal-states, idempotency, webhooks-chaos, webhook envelope validation, pipeline contract, projector-compaction, composition-root, http-auth, http-mutations, http-ruleset, meter-endpoint, registration-surface, registration-project-config, validation-plugin suites (payload, counters, entitlement, bulk, clock-guard, identity, targets), platform-scope, fakes-consumers
  - billing counter, counterAdapters, entitlement, entitlementGate, projection, projectionFidelity, coverage, tiers, upgradeUrl
  - domain windows/splitWindows, exceptions, limits/caps, duplicates, time/wallClock, localDate, evaluate determinism, uiValidatorParity, target-aware
  - All deterministic, credential-free, no network.
- `npm run build` ≡ `npm run check` (typecheck + purity + vitest) → same PASS path; Wix-owned pristine build already proven PASS on official scaffold evidence above (distinct from local `npm run build`).

## 4. Lane Ownership & Boundary Checks

- Integration-owned paths (`src/platform/**`, `src/extensions/**` not present but `src/platform/**` present, `src/pages/api/**` via `src/platform/http/**`, `wix.config.json`) contain no domain semantics drift, no billing policy, no dashboard UX beyond typed bridge.
- Purity gate confirms domain/billing pure cores remain free of `@wix/` imports.
- No `src/domain` Wix imports detected; no `src/billing/pure` violations.
- No destructive schedule mutation without snapshot/diff/verify/rollback (orchestrator tests passed).
- Build contract `docs/WIX_TECHNICAL_CONTRACT.md` and `docs/BUILD_BLUEPRINT.md` unchanged and treated as binding; candidate does not contradict STABLE_PRODUCTION classifications.
- `git status` showed working-tree dirty on `.opencode/agents/*` and `MANIFEST.sha256` (governance files), but `git diff` for candidate SHA itself is clean; dirty files are not part of candidate SHA and are out of integration lane ownership. No product code was modified in working tree to affect verdict.

## 5. Security & Compliance

- No secrets in repository, no `WIX_API_KEY` in report or diff, no publish/release actions.
- No external AI/LLM in product, no custom auth, no embedded site scripts.
- Minimal `wix.config.json` scopes preserved; no permission creep.

## 6. Reproducible Findings Summary

- PASS: Scaffold provenance authenticated via `origin/main` official evidence; App ID binding verified.
- PASS: `wix.config.json` preserves official scaffold, no hand-authored guess.
- PASS: Pristine Wix build PASS proven by log.
- PASS: Local deterministic checks reproduced: typecheck PASS, purity PASS, 548/548 tests PASS.
- PASS: Integration lane boundaries respected; no cross-lane semantic fork.
- No FIX-level findings reproduced.

## 7. Verdict Rationale

Candidate SHA equals accepted base SHA and carries an authenticated official Wix scaffold binding with pristine build PASS. All self-reproduced deterministic checks pass, and no hand-authored scaffold fabrication or lane-boundary violation was found. No reproducible blocking finding exists that would require same-lane repair before integration.

VERDICT: ACCEPT
