# Factory Lane Audit — Integration Candidate cf7972ed8a244761f32728da61f90074c404e6fe vs base ec916b75d5600e02d679d264648ac92333d721f1

## Role
Independent lane-auditor. Read-only reproduction. Not the builder. Auditing exact candidate SHA against accepted base per factory workflow.

## Scope Verification
- `git diff --name-only ec916b75d5600e02d679d264648ac92333d721f1 cf7972ed8a244761f32728da61f90074c404e6fe` reports:
  `.gitignore, astro.config.mjs, package-lock.json, package.json, src/env.d.ts, tsconfig.json`
- No domain, dashboard, or billing logic touched. No webhooks, idempotency, schedule-mutation, or entitlement files changed.
- Diff is within **Wix Integration** lane ownership: scaffold/project metadata, platform build adapter, config.
- `wix.config.json` unchanged between base and candidate (verified via `git show` both SHAs):
  `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`

## Scaffold / Binding Authenticity (Wix-owned)
- Required provenance inspected via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
  ```json
  {"source":"authenticated official Wix existing-app scaffold","appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App","wixCliVersion":"1.1.238","pristineWixBuild":"PASS","scaffoldPackageSha256":"1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd","developmentSiteProvisioned":true}
  ```
- Companion pristine build log via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows successful Astro/Wix build (server + client, built in ~10.7s).
- Candidate preserves bound IDs exactly — no hand-fabricated `appId`/`projectId`. `wix.config.example.json` remains template `"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"`.
- Added scaffold artifacts are consistent with official generation for an `App` project:
  - `astro.config.mjs` defines `output:"server"`, `adapter: wixHostingAdapter()`, `integrations:[wix(),react()]` — expected for `@wix/astro` scaffold.
  - `src/env.d.ts` auto-generated `/// <reference types="@wix/sdk-types/client" />` and `.astro/types.d.ts`.
  - `tsconfig.json` extends `astro/tsconfigs/strict` (candidate) vs base strict TS only — matches Astro scaffold.
  - `package.json` migrates `build:"wix build"` and adds `@wix/astro`, `@wix/dashboard`, `@wix/essentials`, `astro`, `@wix/astro-wix-hosting-adapter`, `@wix/cli` etc. Versions are plausible scaffold defaults (candidate `@wix/cli ^1.1.135` vs generator `1.1.238` — older minor, not a binding forgery).
  - `.gitignore` adds `.astro/` — expected generated state ignore.
  - `package-lock.json` expansion is lockfile churn from adding those dependencies, not code.
- No evidence of hand-authored guesses for Wix binding. Scaffold/binding is authenticated official generation, preserved.

## Deterministic Reproduction
- `npm ci` — succeeded (audited 961 packages, warns only peer-dep resolutions for design-system, no install failure).
- `npm run typecheck` (`tsc --noEmit`) — PASS after install (previously failed without `astro/tsconfigs/strict` before `npm ci`; now clean).
- `npm run check` (`typecheck && check:purity && vitest run --config src/platform/vitest.config.ts`) — PASS:
  - Purity gate: `Purity gate passed: no '@wix/' imports under src/domain...`
  - Vitest: `49 test files, 548 tests passed, 0 failed, duration ~7.03s` (all platform/domain/billing suites).
- `npm run build` (`wix build`) — FAIL at `astro:config:setup` with `Missing environment variable WIX_CLIENT_ID`. This reproduces without credentials and is **not** a code defect:
  - Official scaffold pristine build on authenticated runner was `PASS` per evidence (env was provisioned via `wix env pull` on that runner).
  - Current audit environment has no `.wix` env/secrets (expected). Failure is `BLOCKED_EXTERNAL`, not a product regression. No destructive behavior executed.
  - Offline deterministic gate `npm run check` remains the integration acceptance gate for this lane; it passes.

## Negative / Edge Checks
- Purity: no Wix SDK imports in `src/domain`, `src/billing/pure`, or platform protected paths. Verified via both `check-purity.mjs` and `purity-gate.spec.ts` (intentional violation fixtures detected correctly).
- No secrets committed: `.env` still ignored, `wix.config.json` holds only non-secret binding (appId/projectId), no API keys in diff. `WIX_API_KEY` not present in candidate.
- No schedule mutation safety regression: no orchestrator/idempotency files changed.
- No permission/scope widening: no new Wix scopes added beyond scaffold defaults.
- No silent destructive rewrites: candidate only adds config, does not migrate or delete existing Wix schedule data.
- Least privilege: scaffold uses standard Wix-managed hosting/adapter.

## Findings
- No reproducible defect within lane scope that blocks integration.
- `wix build` credential requirement is external prerequisite (`BLOCKED_EXTERNAL`) already proven via authenticated pristine build evidence; should not block deterministic integration.
- Candidate does not fabricate Wix capabilities or IDs, does not cross lane boundaries, does not alter governance/orchestration files beyond allowed scaffold.

## Verdict
Candidate cf7972ed8a244761f32728da61f90074c404e6fe is a minimal, faithful application of the authenticated official Wix scaffold onto base ec916b75..., preserves the bound App ID, and passes all offline deterministic gates. No fixation required.

VERDICT: ACCEPT
