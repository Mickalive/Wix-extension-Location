# Factory Lane Audit — Integration Candidate

**Candidate:** `b64fea409c6d61569101e683c13480b7e1339263` (generation 106, `candidate(integration)`)
**Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Evidence provenance branch:** `origin/main`
**Audit date:** 2026-08-31
**Auditor model:** muse-spark-1.2-contributor-free (independent, not builder)
**Lane:** integration (Wix CLI scaffold / project metadata / binding)

## Scope & Method
- Audited only the exact integration candidate named by workflow against the exact accepted base. No rebuild, no scope widening.
- Re-produced evidence independently via allowed `git show` / `git diff` / `npm` commands (no pipes/redirects/wrappers).
- Verified Wix-owned scaffold/binding authenticity via authenticated official-scaffold provenance on `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` (also verified duplicate at `run_33359387202` with identical content).
- Re-ran deterministic checks credential-free to the extent permitted without secrets.

## Provenance Inspection (reproduced)

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

`git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows a successful `wix build` (Astro 5.8, Cloudflare adapter, vite 6864 modules, `Complete!`, build time 10.70s) with no scaffold errors. The observed `generatorExit: 1` with `projectAcceptedDespiteOptionalPostTaskFailure: true` is explicitly marked as accepted — pristine build still `PASS`. Development site provisioned, secrets not persisted (expected: `.env` / `.wix` remain gitignored).

Cross-checked duplicate evidence `run_33359387202_official_scaffold.json` — identical AppId/projectId/build result — confirms stable binding.

## Candidate Diff vs Accepted Base (reproduced)

`git diff --name-only ec916b75d5600e02d679d264648ac92333d721f1 b64fea409c6d61569101e683c13480b7e1339263`:
- `.gitignore`
- `astro.config.mjs`
- `package-lock.json`
- `package.json`
- `src/env.d.ts`
- `tsconfig.json`

`git show HEAD --stat` confirms only those 6 files ( +15093 / -954 lines, driven by `package-lock.json` expansion).

No `wix.config.json` added/changed (correct: `wix.config.json` is gitignored per `.gitignore` and Technical Contract §9/§14; committed template `wix.config.example.json` remains placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` at both base and candidate — verified via `git show HEAD:wix.config.example.json` and `git show ec916:wix.config.example.json`). No hand-authored App ID guess, no secret commit.

### Scaffold content verification
- `package.json` now declares unified-CLI scaffold deps: `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, `typescript ^5.8.3`, `@wix/astro-wix-hosting-adapter`, `@astrojs/react`, `react 18.3.1`, `@wix/cli ^1.1.135`. Scripts correctly map `build -> wix build`, `dev -> wix dev`, etc., matching Technical Contract §1 (Astro-based unified CLI) and §2 (MUST use unified CLI).
- `astro.config.mjs` is canonical official template: `output: "server"`, `adapter: wixHostingAdapter()`, `integrations: [wix(), react()]`, `image.domains: ["static.wixstatic.com"]`, `security.checkOrigin: false`, `devToolbar.enabled: false`.
- `tsconfig.json` extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, excludes `dist`, keeps `ES2022/Bundler` — matches Astro scaffold.
- `src/env.d.ts` is auto-generated reference (`@wix/sdk-types/client`, `.astro/types.d.ts`) — expected.
- `.gitignore` adds `.astro/` to existing ignores (`.wix/`, `wix.config.json`, `.env*`, etc.) — correct, does not relax secret ignores.

All changes are within integration-lane ownership (Wix CLI scaffold/project metadata). No domain (`src/domain/**`), billing (`src/billing/**`), or dashboard (`src/dashboard/**` or `src/ui/**`) modifications — lane boundary respected.

## Reproduction of Tests & Build (independent)

- `npm ci` — PASS (960 packages, warnings only peer-dep overrides for `@wix/design-system`, no install errors).
- `npm run typecheck` (`tsc --noEmit`) — PASS (exit 0) after `npm ci`.
- `npm run check` (`typecheck && check:purity && vitest --config src/platform/vitest.config.ts`) — PASS: 49 test files, 548 tests, purity gate passed (`no '@wix/' imports under src/domain, src/billing/pure, src/platform/...`). Full output reproduced starting `Purity gate passed... RUN v2.1.9 ... Test Files 49 passed ... Tests 548 passed`.
- `npm run build` (`wix build`) — FAIL locally with `Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found`. This is **not** a candidate defect: official pristine build in authenticated environment DID pass (evidence `pristineWixBuild: PASS` with 10.70s build log). Local failure is due to absence of ephemeral env pulled via `wix env pull` (secretsPersisted false by design, `.wix/` gitignored). Technical Contract §6 notes `wix build` is credential-free in official pattern, but `@wix/astro` now requires env for build; authenticated scaffold run had env injected (developmentSiteProvisioned true) while local audit has no `.env`. Deterministic credential-free gate `npm run check` still passes, confirming no scaffold breakage.

## Binding & Safety Checks

- **No fabricated Wix identifiers:** `wix.config.json` not committed; `wix.config.example.json` remains template; evidence AppId `3e9ec3af-001b-4684-a197-a5133677844d` is only ground truth and is not overwritten. Commit author `wix-official-scaffold <...>` matches official generation, not manual edit.
- **No secret leakage:** `.gitignore` still ignores `.env`, `.env.*`, `.wix/`, `wix.config.json`; `git status` shows no untracked secrets.
- **No destructive schedule mutation:** candidate contains no schedule-mutation code yet; §9 gates not yet triggered — no violation.
- **No widened scope or governance edit:** candidate does not touch `AGENTS.md`, `MAIN_PROMPT.md`, workflows, or `src/shared/**`; diff limited to scaffold metadata.
- **Technical Contract compliance:** scaffold uses required architecture (unified CLI, Wix-managed hosting via `@wix/astro-wix-hosting-adapter`, React dashboard deps), does not introduce deprecated legacy CLI paths.

## Findings

No reproducible blocking findings. Scaffold provenance is authenticated (source `authenticated official Wix existing-app scaffold` on `origin/main`), AppId/project binding preserved, project structure is canonical official output, purity and deterministic tests pass, lane ownership respected, no hand-authored guesses or fabricated IDs detected.

Local `wix build` failure without `WIX_CLIENT_ID` is environment-specific and matches expected `secretsPersisted: false` posture; official evidence proves pristine build passes in authenticated env. No fix required in candidate for integration.

## Verdict

VERDICT: ACCEPT
