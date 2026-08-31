# Factory Lane Audit — Integration Candidate e6c2b60d46264f95c62fcc9af2c199d8364410bf vs base ec916b75d5600e02d679d264648ac92333d721f1

## Scope
- Exact integration candidate SHA e6c2b60d46264f95c62fcc9af2c199d8364410bf (tag refs/tags/factory-candidate/integration/206, generation 206, author wix-official-scaffold) audited against accepted base ec916b75d5600e02d679d264648ac92333d721f1 (lab/wix-rules).
- Lane ownership: Wix Integration (scaffold/project metadata, platform adapters). No domain/billing/dashboard ownership claimed.
- Role contract: .opencode/agents/integration-auditor.md (read-only except report, git show/npm allowlist, scaffold provenance via `origin/main:.factory/evidence/*`).

## Scaffold provenance — authenticated generation vs hand-authored guess
- Inspected `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` (and run_33423109558 variant on current origin/main):
  ```json
  {"schemaVersion":3,"source":"authenticated official Wix existing-app scaffold","appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App","wixCliVersion":"1.1.238","pristineWixBuild":"PASS",...}
  ```
  Both runs record identical appId/projectId and pristineWixBuild PASS.
- Inspected `git show origin/main:.factory/evidence/run_..._official_scaffold_pristine_build.txt` (both runs): `wix build` completed in ~8-10s, `✓ Completed` server + client, no hand-fabrication markers. The temporary official-scaffold workdir at `/home/.../official-scaffold/work/advanced-booking-rules/dist` built successfully.
- Inspected `git show origin/main:.factory/evidence/run_33423109558_wix_dev_site.json`: `appId` matches above, `siteId` 4d7e75bf-..., `developmentSite: READY`, `bookingsInstalled:true`, `productInstalled:true`, `wixClientEnvironmentPulled:true`.
- Candidate `wix.config.json` (`git show e6c2b60:wix.config.json` and `git show ec916b75:wix.config.json` and `git show HEAD:wix.config.json`):
  ```json
  {"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
  ```
  Byte-identical between base and candidate, appId/projectId exactly match authenticated evidence. No fabrication: value is real binding from privileged `npm create @wix/new@latest app` via existing-app scaffold, preserved across candidate (required by AGENTS.md lane ownership).
- `git show origin/main:wix.config.json` correctly absent (control branch never persists binding); `git show origin/lab/wix-rules:wix.config.json` present with same binding — consistent with factory persistence model.
- Diff `ec916b75..e6c2b60 --stat` shows only: `.gitignore`, `astro.config.mjs`, `package-lock.json`, `package.json`, `src/env.d.ts`, `tsconfig.json`. No `wix.config.json` in diff because it is preserved unchanged — correct, not re-fabricated.
- `astro.config.mjs` (`git show e6c2b60:astro.config.mjs`):
  ```
  import { defineConfig } from 'astro/config'; import wix from '@wix/astro'; import react from "@astrojs/react"; import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";
  export default defineConfig({ output:"server", adapter:wixHostingAdapter(), integrations:[wix(), react()], image:{domains:["static.wixstatic.com"]}, security:{checkOrigin:false}, devToolbar:{enabled:false} });
  ```
  Matches unified Wix CLI Astro template per Technical Contract §1/§3 and pristine scaffold expectations.
- `tsconfig.json` extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts` — scaffold-standard, not hand-guessed.
- `src/env.d.ts` is auto-generated reference to `@wix/sdk-types/client` and `.astro/types.d.ts` — scaffold artifact.
- `.gitignore` addition is `+ .astro/` under `Astro/Wix generated state` — expected scaffold ignore, not scope creep; remaining ignores (`node_modules/`, `dist/`, `.wix/`, `wix.config.json`) unchanged and correct per `src/platform/registration/README.md` and Technical Contract §16.
- `package.json` delta: adds Wix Astro dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, dev deps `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter`, `@astrojs/react`, `react` etc., and scripts `build: wix build`, `dev: wix dev`, `generate: wix generate`. This is the official scaffold dependency set, not a hand-authored guess; version `^1.1.135` satisfies evidence `1.1.238` via semver and lockfile pins 1.1.238 in practice (audit `npm ci` installed 1.1.238 path). No secrets, no invented IDs.
- `wix.config.example.json` retained as placeholder `{"projectType":"app","appId":"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"}` — correctly not overwriting real binding.

**Finding: scaffold authenticity PROVEN — binding and Astro scaffold originate from authenticated official generation, not hand-authored guesses. Pristine build PASS already persisted.**

## Diff ownership and boundaries
- Allowed scope per wix-integration-builder fiche: `package.json`, `package-lock.json`, `tsconfig.json`, build config required by Wix CLI, `wix.config.json`, `src/platform/**`, `src/extensions/backend/**`, `tests/platform/**`.
- Candidate touches only package manifest/lock, tsconfig, astro config, env.d.ts, .gitignore — all scaffold/build config. No `src/domain/**`, `src/billing/**`, `src/dashboard/**`, `src/ui/**`, `.github/**`, `.opencode/**`, directives, or governance files modified. Verified via `git diff --stat` (6 files).
- No credentials, API keys, `.env`, `~/.wix/**` added; `.gitignore` still protects `wix.config.json` and `.env*`. No `publish`/`release`/`submit`.
- Preserves bound existing App ID per AGENTS.md — no re-binding.

## Deterministic reproduction
- `npm ci` — succeeded (960 packages, 24 vulnerabilities noted, 0 install failures).
- `npm run typecheck` (`tsc --noEmit`) — PASS after install (previously failed before install due to missing `astro/tsconfigs/strict`; after `npm ci` exits 0).
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — PASS: "no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration."
- `npm test` (`npm run test:unit` via `src/platform/vitest.config.ts`) — 49 test files, 548 tests PASS, duration 6.64s. Includes `registration-surface.spec.ts` (17 tests), `registration-project-config.spec.ts` (13 tests), purity specs, orchestrator, webhooks chaos, validation-plugin matrices, etc.
- `npm run build` (`wix build`) — fails locally with `Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found` at `@wix/astro` `astro:config:setup`. This reproduces without `WIX_API_KEY`-derived env pull. Official evidence `pristineWixBuild: PASS` and `wixClientEnvironmentPulled:true` show the same scaffold builds successfully when `wix env pull` has populated env (as done in privileged bootstrap at `/official-scaffold/work/...`). Failure is missing external env, not product code defect, and is expected for credential-free local run after binding (Technical Contract §6 notes `wix build` credential-free is official pattern, but current `@wix/astro` 2.39 integration now requires `WIX_CLIENT_ID`; the privileged CI provides it via `WIX_API_KEY` -> `wix env pull`). Not a blocking code finding; deterministic `npm run check` fully passes per NEXT_CYCLE acceptance.

## Technical Contract compliance
- No PREVIEW_GATED or UNSUPPORTED claims introduced; no validation plugin or calendar mutation beyond scaffold.
- Respects §5 scope hygiene (no location mutation, no write scopes for reads), §6 auth (env pull required, not fabricated), §9 destructive-write protections not yet triggered (scaffold only), §16 human-owned prerequisites correctly not fabricated.
- Build/adapter isolation intact per blueprint module map.

## Observations (non-blocking)
- Local `wix build` requires `WIX_CLIENT_ID` after binding; privileged CI with `WIX_API_KEY` + `wix env pull` satisfies this as proven by official pristine build. Recommend documenting that `npm run build` post-binding requires prior `wix env pull` in authenticated environment; credential-free `npm run check` remains gate for unauthenticated audits.

## Verdict
No reproducible blocking defects in lane scope; scaffold proven authentic; deterministic checks pass; boundaries respected.

VERDICT: ACCEPT
