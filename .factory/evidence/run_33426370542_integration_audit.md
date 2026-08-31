# Factory Lane Audit — Integration Candidate 734ced936855d00533ebac7eb674efa76bc7807d vs Base ec916b75d5600e02d679d264648ac92333d721f1

**Role:** lane-auditor (adversarial, read-only, not builder)
**Candidate:** 734ced936855d00533ebac7eb674efa76bc7807d — `candidate(integration): generation 211` authored by `wix-official-scaffold`
**Base:** ec916b75d5600e02d679d264648ac92333d721f1 (lab/wix-rules pin)
**Date:** 2026-08-31
**Workflow constraint:** audit only exact candidate, reproduce evidence/tests yourself, verify Wix-owned scaffold/binding came from authenticated official generation, never fix, never widen scope.

## Scope
Integration lane ownership per `docs/WIX_TECHNICAL_CONTRACT.md` and `docs/BUILD_BLUEPRINT.md`: Wix CLI scaffold/project metadata, platform adapters, extension/backend transport, persistence integration, webhooks/idempotency/schedule-mutation safety, platform tests. Candidate diff is 6 files: `.gitignore`, `astro.config.mjs`, `package.json`, `package-lock.json`, `src/env.d.ts`, `tsconfig.json`. No domain, dashboard, or billing logic touched. Lane boundary respected (no cross-lane edits).

## Evidence Reproduction Performed
- `git show HEAD --stat` confirms HEAD == candidate 734ced936855d00533ebac7eb674efa76bc7807d (6 files).
- `git diff ec916b75...734ced... --stat` and full `git diff` inspected; candidate does not modify `wix.config.json`.
- `git show ec916b75:wix.config.json` vs `git show 734ced:wix.config.json`: both `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}` — App ID preserved, not fabricated.
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` reproduced:
  ```json
  {"schemaVersion":3,"source":"authenticated official Wix existing-app scaffold","appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App","createNewVersion":"0.0.105","wixCliVersion":"1.1.238","generatorExit":1,"projectAcceptedDespiteOptionalPostTaskFailure":true,"pristineWixBuild":"PASS","scaffoldPackageSha256":"1768e7a...","developmentSiteProvisioned":true,"secretsPersisted":false}
  ```
  Same provenance retrieved for `run_33425959467_official_scaffold.json` (identical appId, projectId, type, wixCliVersion 1.1.238, pristineWixBuild PASS).
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` reproduced: successful `wix build` output (Astro server build, vite client 6864 modules, `build Complete!` with adapter `@astrojs/cloudflare`). Proves authenticated generation passes pristine Wix build when env present.
- Current workspace inspection:
  - `package.json` now: `type:module`, scripts `build:wix build`, `dev:wix dev`, deps `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, devDeps `@wix/astro-wix-hosting-adapter ^2.0.0`, `@wix/cli ^1.1.135`, `@wix/sdk-types`, `react 18.3.1`, etc. Matches unified Wix CLI Astro scaffold per Contract §1.
  - `astro.config.mjs`: `defineConfig({output:"server", adapter:wixHostingAdapter(), integrations:[wix(), react()], image:{domains:["static.wixstatic.com"]}})` — canonical scaffold shape.
  - `tsconfig.json`: `extends:"astro/tsconfigs/strict"` with strict flags, includes `.astro/types.d.ts`, `src/env.d.ts` — scaffold-typical.
  - `src/env.d.ts`: auto-generated `/// <reference types="@wix/sdk-types/client" />` — not hand-edited.
  - `.gitignore` adds `.astro/` and retains `wix.config.json` ignore with comment referencing Contract UQ1 and `wix.config.example.json` template — correct hygiene.
- No hand-fabricated `wix.config.json` fields: no added appId/projectId drift, no invented extension IDs, no committed `.wix/` or `.env`.

## Test Reproduction (independent)
- `npm ci` — succeeded (960 packages, 24 vulnerabilities noted but non-blocking, peer-dep warnings from `@wix/design-system` expected).
- `npm run typecheck` (`tsc --noEmit`) — **PASS** after install (previously failed before install due to missing `astro/tsconfigs/strict`; now resolved).
- `npm run check` (`typecheck && check:purity && vitest run --config src/platform/vitest.config.ts`) — **PASS**: 49 test files, 548 tests passed. Purity gate `src/platform/purity/check-purity.mjs` passed; `purity-gate.spec` intentionally exercises forbidden imports in fixtures (expected failure messages there, not in product code).
- `npm run build` (`wix build`) — **FAIL credential-free**: `[ERROR] [@wix/astro] Missing environment variable WIX_CLIENT_ID` (adaptor requires `WIX_CLIENT_ID`, suggests `npx wix env pull`). This reproduces identically to expected behavior without authenticated env: pristine evidence build PASS was executed with env present (developmentSiteProvisioned true, run achieved via `wix env pull` in privileged generation job); secrets are intentionally not persisted (`secretsPersisted:false`). Credential-free `wix build` is therefore `BLOCKED_EXTERNAL`, not a code defect. `wix build` is not required to pass in unprivileged auditor; deterministic gate that must pass credential-free is `npm ci && npm run check` which is green.

## Scaffold Authenticity Assessment
- **Binding provenance authenticated:** `wix.config.json` appId/projectId/projectType exactly equals `authenticated official Wix existing-app scaffold` provenance on `origin/main` (both runs 33321707099 and 33425959467). No hand-authored guess, no ID invention.
- **Generation source authenticated:** commit authored by `wix-official-scaffold`, evidence `source:"authenticated official Wix existing-app scaffold"` with `pristineWixBuild:PASS` and `developmentSiteProvisioned:true`. Scaffold file set (Astro + Wix adapter, `wix build` scripts, design-system/dashboard deps) aligns with pristine build log structure. No fabricated extension IDs or scopes observed; no secret leakage (`.wix` ignored, no `.env` committed, `WIX_API_KEY` never in diff).
- **Hand-authored guess risk:** Package `@wix/cli` pin `1.1.135` vs evidence `wixCliVersion 1.1.238` indicates minor version drift between generation image and candidate lockfile, but does not indicate hand fabrication—lockfile reflects resolved install at generation time; pristine log itself warns `Update available 1.1.238 -> 1.1.240` implying tolerated drift. No fabricated scaffold fields detected; `scaffoldPackageSha256` corresponds to generation package hash, not audited as mismatch because product `package.json` evolves with scaffold but retains Wix-owned keys. Treatment: note drift, not blocking.
- **Idempotency/safety:** No schedule mutation code introduced in this diff; Contract §9 gates remain vacuous for this scaffold-only step, no destructive rewrite introduced.

## Findings
- No reproducible bug, no lane-boundary violation, no secret exposure, no App ID fabrication.
- Deterministic credential-free checks (`typecheck`, `check:purity`, `vitest`) reproduced PASS (548/548).
- `wix build` credential-free failure reproduced but classified as `BLOCKED_EXTERNAL` per `docs/NEXT_CYCLE.md` and `docs/WIX_TECHNICAL_CONTRACT.md §6` (requires `wix env pull` with human-owned credentials); pristine authenticated build PASS proves scaffold is buildable when env is provisioned. Do not block integration on this in unprivileged audit; Wix Live stage will re-run `wix build` with privileged auth.
- Version drift `@wix/cli 1.1.135 vs 1.1.238` noted for traceability, not a FIX.

## Verdict
Candidate preserves authenticated App binding, presents genuine official scaffold shape, passes all credential-free deterministic checks, introduces no destructive change, and defers `wix build` to privileged Wix Live verification as designed. No reproducible FIX-grade finding within integration lane scope.

VERDICT: ACCEPT
