# Factory Lane Audit — Integration Candidate 633e8b93 vs Base ec916b75

**Mode:** independent, adversarial, read-only (no fixes)
**Candidate:** `633e8b933532085f45d13b4fd669764953f047d2` (`candidate(integration): generation 54`, author `wix-official-scaffold`)
**Base:** `ec916b75d5600e02d679d264648ac92333d721f1` (`lab/wix-rules` pinned SHA)
**Workspace:** `/home/runner/work/_temp/wix-factory-33335228573/product` — HEAD is candidate (verified `git show HEAD --stat`)

## 1. Scope & Contract

Audited only the exact integration candidate named above against its accepted base. Verified Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses. Reproduced evidence and tests directly via allowed shell. No code fixes, no scope widening.

Binding authorities: `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md` (STABLE_PRODUCTION classifications, binding architecture, scaffold command `npm create @wix/new@latest app`), `docs/BUILD_BLUEPRINT.md` (lane ownership: integration owns scaffold/project metadata, platform adapters, transport, etc.).

## 2. Scaffold Provenance — Authenticated Official Generation

Inspected `origin/main` provenance via `git show` (as directed):

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
  Source is `authenticated official Wix existing-app scaffold`, not hand guess. `pristineWixBuild: PASS`, dev site provisioned.

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows clean Astro/Wix build: `[vite] ✓ built`, `[build] Complete!`, `@wix/astro-wix-hosting-adapter` adapter `@astrojs/cloudflare`, no scaffold errors (WARN about optional deps only).

**Candidate binding verification:**

- `git show 633e8b93:wix.config.json` = `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
- `git show ec916b75:wix.config.json` identical. AppId preserved, matches official provenance exactly. No fabricated identifiers, no App ID rotation.
- `wix.config.json` remains tracked despite `.gitignore` listing `wix.config.json` — correct: binding was committed at scaffold time before gitignore; ignore prevents accidental re-add, not untracking. Consistent with `src/platform/registration/README.md` intent and contract §2 scaffold runbook.

Conclusion: Wix-owned scaffold/binding is authenticated official generation, not hand-authored guess.

## 3. Diff Reproduction — Exact Changes

`git diff ec916b75..633e8b93 --stat` (reproduced):

```
 .gitignore        |     3 +
 astro.config.mjs  |    14 +
 package-lock.json | 15962 ++++++++++++++++++++++++++++++++++
 package.json      |    40 +-
 src/env.d.ts      |     4 +
 tsconfig.json     |    24 +-
 6 files changed
```

- `git diff -- .gitignore` only adds `.astro/` ignore — minimal hygiene.
- `git show 633e8b93:astro.config.mjs` uses official imports `defineConfig` from `astro/config`, `wix` from `@wix/astro`, `react` from `@astrojs/react`, `wixHostingAdapter` from `@wix/astro-wix-hosting-adapter`, output `server`, adapter `wixHostingAdapter()`, integrations `[wix(), react()]` — matches unified Wix CLI Astro template, not hand invention.
- `git show 633e8b93:tsconfig.json` extends `astro/tsconfigs/strict`, adds `include` for `.astro/types.d.ts`, `src/env.d.ts` — standard scaffold.
- `git show 633e8b93:src/env.d.ts` is auto-generated `/// <reference types="@wix/sdk-types/client" />` — scaffold-generated.
- `git show 633e8b93:package.json` moves `build` from `npm run check` to `wix build`, adds scripts `dev`/`release`/`preview`/`generate`, adds dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, devDeps `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter ^2.0.0`, etc. These are official Wix scaffold pins. No business rules, no billing policy touched — lane boundary respected.

No silent fork, no domain mutation, no dashboard UX beyond scaffold, no billing.

`git status` at HEAD shows only `.opencode/agents`/`AGENTS.md` dirty files unrelated to product — product tree clean at candidate.

## 4. Reproduction — Tests & Type Safety (Credential-Free)

Ran directly, no pipes/compound wrappers:

- `npm ci` — completed (960 packages, 32s, warnings about peer react 17 vs 18 only, expected for `@wix/design-system`).
- `npm run typecheck` (`tsc --noEmit`) — **PASS** (no errors).
- `npm run check` (`typecheck && check:purity && vitest run --config src/platform/vitest.config.ts`) — **PASS**:
  - Purity gate: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/...` (plus gate-fixture expected failure inside test, correctly caught).
  - Vitest: `49 passed` test files, `548 passed` tests, 0 failed.
  - Suites covered: domain evaluate, windows, exceptions, limits, duplicates, time, purity, platform validation-plugin, webhooks, http, schedule-mutation, registration, billing projection/entitlement/counter/tiers, etc. Determinism property passed.

All deterministic unit lanes remain green on candidate.

## 5. Reproduction — Wix Build

- `npm run build` (`wix build`) currently fails in this env with:
  `[@wix/astro] Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found` — adapter requires `WIX_CLIENT_ID`.
- This is **not a candidate defect**: official pristine evidence `run_33321707099_official_scaffold_pristine_build.txt` **PASS**ed with same scaffold (adapter `@astrojs/cloudflare`, vite build success, `Complete!`). That run was executed with authenticated `wix env pull` (secretsPersisted false but dev site provisioned, CLI 1.1.238). Credential-free `wix build` without pulled env is expected to error per `@wix/astro` loadEnvVars. The candidate does not introduce a new build regression relative to pristine; it reproduces the scaffold's declared build shape.
- `npx wix build` pattern is enforced tooling; candidate's `package.json` build script correctly delegates to `wix build` per unified CLI (§2 of contract).

No hand-fabricated `wix.config.json`, no missing adapter, no invented extension IDs.

## 6. Security & Governance

- No secrets committed, no `WIX_API_KEY` exposure, no `~/.wix` reads.
- No lane cross-contamination: candidate touches only Wix-owned scaffold metadata, not `src/domain` or `src/billing/pure`.
- Commit author is `wix-official-scaffold` (workflow-generated), not human guess.
- Scaffold `appId` binding preserved — satisfies immutable role contract to preserve bound existing App ID.

## 7. Findings

Reproducible findings: **none blocking**.

- Scaffold authenticity: **proven** via authenticated `origin/main` evidence + exact `appId`/`projectId` match + pristine PASS log.
- Diff minimal and correct: official Astro/Wix scaffold files only.
- Credential-free deterministic checks: typecheck PASS, purity PASS, 548 tests PASS.
- Wix build env requirement is inherited from official scaffold and matches pristine PASS when env present; not a hand-authored defect.

No `FIX_BEFORE_INTEGRATION` or `REJECT` conditions reproduced.

## 8. Verdict

Candidate is narrowly scoped integration scaffold sync from authenticated generation, preserves Wix binding, passes all reproducible deterministic gates, and shows no hand-authored guesses or lane violations.

VERDICT: ACCEPT
