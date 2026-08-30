# Factory Lane Audit — Integration

**Candidate SHA:** `3e53f9d5a13acf335aa53a932c64605a059ea163`
**Accepted base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Lane:** integration
**Audit mode:** independent, adversarial, read-only (no fixes)
**Date (UTC):** 2026-08-30

## Scope and authority
Audit the exact integration candidate named by the workflow against the accepted base. Verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses. Reproduce evidence and tests directly. No widening, no builder claims taken at face value. This file is the only permitted write.

## Method — reproduced locally
- `git show --stat HEAD` confirms candidate is `3e53f9d... candidate(integration): generation 62` touching 2 files.
- `git show 3e53f9d...` inspected full diff (see below).
- `git diff ec916b75... 3e53f9d... --stat` → `src/platform/registration/README.md` + `src/platform/registration/scaffoldPrerequisites.ts` only.
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` and `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` inspected with `git show` per instruction.
- `git show 3e53f9d:wix.config.json` and `git show ec916b75:wix.config.json` and `git show origin/main:wix.config.json` compared.
- Current working-tree files read: `wix.config.json`, `wix.config.example.json`, `.gitignore`, `src/platform/registration/*`, `extensions.ts`.
- Deterministic checks reproduced: `npm ci`, `npm test` (548 tests), `npm run build` (`tsc --noEmit` + `check:purity` + vitest), `git status`, `git diff`.

## What the candidate changes
Diff vs base (`ec916b75` → `3e53f9d`):

- `src/platform/registration/README.md` — title amended to `(INT-C6-R1, INT-C7-REPAIR)`, section 1 rewritten to document actual tree state: `.gitignore` contains `wix.config.json` but a non-placeholder `wix.config.json` IS present in committed tree, provenance unverified, anomaly documented, repair status described as `git rm --cached` workflow persistence action, classifier note (`LINKED` vs real), and added Known anomaly paragraph keeping gates `OPEN`.
- `src/platform/registration/scaffoldPrerequisites.ts` — `externalBlockerStatement()` wording revised from `No linked Wix CLI project exists: ...` to `The scaffold state requires independent verification: ...`, adds note that `wix.config.json` with non-placeholder identifiers may exist but provenance is unverified, and that truthful live-QA disposition remains external prerequisite subject to authenticated Live QA.

No other files changed. No `wix.config.json` mutation. No new dependencies, no dashboard/billing/domain logic.

## Scaffold / binding authenticity — provenance verification

### Official scaffold evidence on `origin/main`
`git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
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
`git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` was inspected; it contains a full `wix build` log ending `Complete!` with vite build, adapter `@astrojs/cloudflare`, no publish/release, consistent with `pristineWixBuild: PASS` and `generatorExit 1` accepted despite optional post-task failure. `secretsPersisted: false` confirms no secret material leaked into evidence.

This is the binding authority for the current Wix app.

### Candidate and base binding files
- `git show ec916b75:wix.config.json` → `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
- `git show 3e53f9d:wix.config.json` → identical to base (same three fields, same values).
- `git show origin/main:wix.config.json` → `fatal: path exists on disk but not in origin/main` — not tracked on `origin/main`, which is expected for the gitignored file; presence in `lab/wix-rules` history is a tracked anomaly, not a fresh hand-authored guess.

**Identity match:** candidate `appId`, `projectId`, `projectType` are byte-identical to the authenticated official scaffold evidence above. Not a placeholder (`<GENERATED-BY...>`, `REPLACE`, etc.), not a random UUID, not drifted. Candidate preserves the bound existing App ID exactly, satisfying lane ownership rule: may repair real non-secret `wix.config.json` only while preserving App ID. Candidate does not mutate the file at all, so preservation holds.

**Hand-authored guess check:** No fabricated `appId`/namespace/code-identifier, no invented extension IDs in `extensions.ts` (still `EXTENSIONS: []` frozen, documented empty by design), no hallucinated `.wix/` site binding, no API key in repo (`git diff` shows none, `.gitignore` protects `.wix/` and `wix.config.json`). The only Wix-adjacent values in candidate are the already-proven `appId`/`projectId` that match official provenance. Rejected hypothesis of hand fabrication.

**Gitignore anomaly handling:** `.gitignore` correctly lists `wix.config.json`. Candidate does not hide the anomaly — README explicitly states the file is present but SHOULD BE gitignored, was added before the ignore rule, provenance unverified, and must be removed via `git rm --cached` as workflow-shell persistence. This is truthful and governance-compliant: builders must not claim gates are PROVEN, must not fabricate, and `git rm --cached` is not a builder edit but a control-plane persistence action. Candidate does not attempt to commit a fake removal or to bypass the rule.

### No production capability claims
- README and `scaffoldPrerequisites.ts` keep T-VP0–T-VP5 open, note that `LINKED` classification via `projectConfig.ts` says nothing about real-world validity, and require authenticated Wix Live QA + `wix build` before gates advance. No `STABLE_PRODUCTION` claim inflated, no `PREVIEW_GATED` bypass.
- `extensions.ts` remains empty; `extensionsManifest.ts` entries remain `PLANNED_UNTIL_T_VP0` with documentation-only channels; no extension ID invented. Verified by reading both files and by passing `registration-surface` tests.

## Lane ownership and scope check
- Integration lane owns scaffold/project metadata, adapters, transport, webhooks, idempotency, schedule-mutation safety, platform tests. Candidate touches only `platform/registration/README.md` and `scaffoldPrerequisites.ts` — both owned registration surface. No domain semantics, dashboard UX, or billing policy touched. Not a silent lane cross.
- No governance files altered beyond allowed lane surface (`diff --stat` shows no `AGENTS.md`, `MAIN_PROMPT.md`, workflows, fiches, `MANIFEST.sha256`).
- No secret exposure: `wix.config.json` holds non-secret identifiers only; `secretsPersisted:false` in official evidence; no `.wix/` or API key in diff or working tree.

## Deterministic checks — reproduced
- `npm ci` — succeeded (47 packages).
- `npm test` (`npm run check:purity && vitest run --config src/platform/vitest.config.ts`) — **548 passed, 49 test files, 0 failed**. Purity gate: `Purity gate passed: no '@wix/' imports under src/domain, ... src/platform/registration`. Key suites: `registration-surface.spec.ts` (17), `registration-project-config.spec.ts` (13), `purity-gate.spec.ts` (4), `validation-plugin*`, `schedule-mutation`, `http-*`, `webhooks-*`, etc.
- `npm run build` (`tsc --noEmit` + `check:purity` + vitest) — **passed** (typecheck clean, purity passed, 548 tests again).
- `git status` and `git diff` confirm only expected 2-file candidate diff vs base; no untracked product code left behind.
- No `wix build` executed here (requires authenticated Wix CLI/dev-site/MCP, forbidden to fabricate). Official scaffold's pristine build evidence already inspected above as authenticated build proof for the scaffold package itself.

## Governance and anti-fabrication
- No fabrication of capabilities, IDs, credentials, tests, or readiness in candidate. README and `scaffoldPrerequisites.ts` explicitly deny that classification equals reality and demand Live QA.
- No publication/release, no deletion of site/app, no Premium/billing/domain/team actions.
- Candidate does not expose `WIX_API_KEY`, does not read `~/.wix/**`, does not embed identifiers in blocker statement.
- Preservation of App ID verified; no destructive schedule rewrite; no hidden external DB/infrastructure.

## Residual risks and next steps (not blocking integration)
The tracked `wix.config.json` remains an anomaly despite passing `.gitignore`. The candidate correctly documents that removal from tracking (`git rm --cached`) must be performed by the trusted workflow shell, not the builder. Until Live QA authenticates and `wix build` succeeds on the current tree, gates `real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release` properly remain `OPEN`. This is expected and not a candidate defect.

## Conclusion
Candidate `3e53f9d` is a documentation-only repair within the integration lane that truthfully describes the existing Wix binding anomaly, preserves the authenticated App ID proven via `origin/main` official scaffold evidence (`run_33321707099`), makes no hand-authored guesses, widens no scope, and passes all deterministic checks.

VERDICT: ACCEPT
