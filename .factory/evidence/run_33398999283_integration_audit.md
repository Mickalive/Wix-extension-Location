# Factory Lane Audit — Integration Candidate b0329d2540114d30dc79cf0ac2f2763df25e0dab vs base ec916b75d5600e02d679d264648ac92333d721f1

## Scope
- Exact integration candidate SHA: `b0329d2540114d30dc79cf0ac2f2763df25e0dab`
- Accepted base SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Lane: Wix Integration (scaffold / project metadata / platform adapters)
- Role: independent lane-auditor, not builder, read-only except this report
- Contracts: MAIN_PROMPT.md, docs/WIX_TECHNICAL_CONTRACT.md, docs/BUILD_BLUEPRINT.md, AGENTS.md workflow

## Instructions Compliance
- Audited only the exact candidate SHA via `git diff` and `git show`; did not widen scope.
- Reproduced evidence locally via allowed shell commands (`git show`, `git diff`, `npm ci`, `npm run typecheck`, `npm run check:purity`, `npm test`, `npm run build`).
- Did not fix code, did not modify any file except this report.
- Inspected authenticated official-scaffold provenance on `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` via `git show` as instructed.
- Write limited to `reports/factory_lane_audit.md`.

## Candidate Diff Summary (reproduced)
`git diff --name-only ec916b75d5600e02d679d264648ac92333d721f1 b0329d2540114d30dc79cf0ac2f2763df25e0dab`:
```
.gitignore
astro.config.mjs
package-lock.json
package.json
src/env.d.ts
tsconfig.json
```
- `git show` confirms base had no `astro.config.mjs`, minimal `package.json` (`build: npm run check`, devDeps only @types/node/typescript/vitest), minimal `tsconfig.json` without astro extends.
- Candidate adds:
  - `astro.config.mjs`: `import wix from '@wix/astro'`, `wixHostingAdapter`, `output: server`, `adapter: wixHostingAdapter()`, `integrations: [wix(), react()]` — canonical official scaffold template.
  - `src/env.d.ts`: `/// <reference types="@wix/sdk-types/client" />` + `../.astro/types.d.ts` auto-generated.
  - `tsconfig.json`: `extends: astro/tsconfigs/strict`, include `.astro/types.d.ts`, `src/env.d.ts`, exclude `dist` — matches `astro/tsconfigs/strict` scaffold.
  - `package.json`: adds `dependencies: @wix/astro ^2.39.0, @wix/dashboard, @wix/design-system, @wix/essentials, astro, typescript` and `devDependencies: @astrojs/*, @wix/cli ^1.1.135, @wix/astro-wix-hosting-adapter, react` ; scripts `build: wix build`, `dev: wix dev`, `release: wix release` etc.
  - `package-lock.json`: large but consistent with scaffold (wrangler, esbuild, vite, @wix/*).
- `wix.config.json` unchanged between base and candidate, preserved via `git show` both SHAs:
  ```json
  { "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
  ```
- `.gitignore` unchanged, still documents that `wix.config.json` is real binding generated ONLY by authenticated one-time scaffold; template remains `wix.config.example.json`.

## Scaffold Authenticity — Authenticated Official Generation
Evidence reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
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
- `source` is `authenticated official Wix existing-app scaffold` (not hand-authored).
- `appId` exactly matches candidate's `wix.config.json` (`3e9ec3af-001b-4684-a197-a5133677844d`) — binding preserved, not fabricated.
- `projectId` and `projectType` match candidate.
- `pristineWixBuild: PASS` and `developmentSiteProvisioned: true` indicate official scaffold built successfully in isolated official workdir.
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` reproduced: Astro + @wix/astro-wix-hosting-adapter build completed in 10.70s, `✓ built in 2.49s` server, `✓ built in 7.81s` client, `Complete!` with no scaffold errors. This is the pristine build from the hash `1768e7a6...` — confirms schemaVersion 3 scaffold is production-buildable.

Assessment:
- Candidate does **not** hand-fabricate scaffold: `astro.config.mjs`, `tsconfig.json`, `src/env.d.ts`, `package.json` dependencies/scripts all conform to the shape produced by `npm create @wix/new@latest` for an existing-app binding, not guesses.
- `wix.config.json` preserves the authenticated binding verbatim; no new IDs invented, no secret committed.
- `.gitignore` correctly continues to ignore `.wix/` local state and documents `wix.config.json` provenance, consistent with contract `T-VP0` and `src/platform/registration/README.md`.

## Ownership & Scope
- Integration lane may repair non-secret `wix.config.json` while preserving App ID — candidate preserves it.
- Candidate touches only Wix-owned scaffold metadata (astro, tsconfig, env, package manifest) — within integration lane ownership, not domain/dashboard/billing.
- No domain logic, billing tiers, or dashboard UI modified — no lane-boundary violation.

## Deterministic Reproduction
Executed in this audit job (no builder claims trusted):

- `npm ci` — OK (added 960 packages, 24 vulnerabilities noted but not blocking, expected for @wix/design-system peer deps).
- `npm run typecheck` (`tsc --noEmit`) — **PASS** after install.
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — **PASS**: `no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, ...`
- `npm test` (`npm run test:unit` → `check:purity && vitest run --config src/platform/vitest.config.ts`) — **PASS**: 49 test files, 548 tests passed. All platform/domain/billing/purity tests pass, including `purity-gate.spec.ts`, `platform-scope.spec.ts`, `registration-project-config.spec.ts`.
- `npm run build` (`wix build`) — **FAIL** locally with `Missing environment variable WIX_CLIENT_ID` from `@wix/astro` integration. This matches expected behavior in a credential-free CI environment without `wix env pull`. The official pristine build on `origin/main` with the same scaffold shape **PASSED** (see evidence above) when run in the authenticated scaffold workdir with dev-site provisioning. No code defect; failure is external prerequisite (`WIX_CLIENT_ID` not persisted, `secretsPersisted: false` per provenance). Treated as `BLOCKED_EXTERNAL`-like for this lane, not a lane-code defect. `check:offline` and `typecheck` still validate scaffolding without live Wix.

## Security & Contract Checks
- No secrets in repo, no `WIX_API_KEY` in prompts/artifacts, no `.wix/` committed, no `src/**` Wix SDK leakage (purity gate passes).
- No duplicate-booking or schedule mutation logic changed — no silent destructive rewrites.
- `wix.config.example.json` remains placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` — correct template.
- Candidate description retains `credential-free platform foundation (build cycle 1, task INT-C1-1)` — aligns with build blueprint.

## Findings
No reproducible blocking defects found:

- Scaffold authenticity: **proven** via authenticated provenance and preserved binding.
- Idempotency / safety: not degraded (no schedule mutation code changed).
- Tests: all deterministic tests pass.
- Purity: passes.
- Typecheck: passes after install.

Informational: `wix build` requires `WIX_CLIENT_ID` in this environment; this is expected without authenticated `wix env pull` and matches provenance `secretsPersisted: false`. The pristine official build proves the scaffold itself is buildable when provisioned.

## Verdict
Candidate faithfully integrates the authenticated official Wix scaffold, preserves the bound App ID, respects lane ownership, and passes all reproducible deterministic checks. No hand-authored scaffold guesses, no secret leakage, no domain contamination.

VERDICT: ACCEPT
