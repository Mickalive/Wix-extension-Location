# Factory Lane Audit — Integration Candidate 5c507a9f34a34c510e164d668688abea7688b753 vs Base ec916b75d5600e02d679d264648ac92333d721f1

**Mode:** independent, adversarial, read-only (no fixes)
**Candidate:** `5c507a9f34a34c510e164d668688abea7688b753` (refs/tags/factory-candidate/integration/78)
**Base:** `ec916b75d5600e02d679d264648ac92333d721f1` (lab/wix-rules pinned SHA)
**Workspace:** `/home/runner/work/_temp/wix-factory-33346465850/product` — HEAD verified via git show

## 1. Scope & Contract

Audited only the exact integration candidate named by workflow against accepted base ec916b75. Verified Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses. Reproduced evidence and tests directly via allowed shell commands without pipes or compound wrappers. No code fixes, no scope widening, no builder claims taken at face value.

Binding authorities: `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md` (binding architecture, unified Wix CLI scaffold command `npm create @wix/new@latest app`, STABLE_PRODUCTION classifications), `docs/BUILD_BLUEPRINT.md` (lane ownership: integration owns scaffold/project metadata, platform adapters, transport), `AGENTS.md` / workflow v3.

## 2. Scaffold Provenance — Authenticated Official Generation

Inspected `origin/main` provenance via `git show` as directed for current binding:

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
  Source is authenticated official Wix existing-app scaffold, not hand guess. pristineWixBuild PASS, dev site provisioned.

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows clean Astro/Wix build: `[vite] ✓ built`, `building client`, `6864 modules transformed`, `Server built`, `[build] Complete!`, adapter `@astrojs/cloudflare` via `@wix/astro-wix-hosting-adapter`. No scaffold errors (only optional dep warnings). Same PASS repeated in `run_33346204544_official_scaffold.json/.txt` (current run, same appId/projectId, wixCli 1.1.238, PASS).

- Cross-checked latest run provenance `run_33346204544_official_scaffold.json` on origin/main — identical appId/projectId/appType/ PASS status.

**Candidate binding verification:**

- `git show ec916b75:wix.config.json` = `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
- `git show 5c507a9f:wix.config.json` = identical `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
- `git show ec916b75:wix.config.example.json` and `git show 5c507a9f:wix.config.example.json` both `{"projectType":"app","appId":"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"}` — template preserved.
- App ID preserved exactly, matches official provenance. No fabricated identifiers, no rotation, no deletion of binding.

`.gitignore` at both base and candidate lists `wix.config.json` as ignored — correct: binding was committed before gitignore; ignore prevents accidental re-add of local state, not untracking. Consistent with `src/platform/registration/README.md` intent and contract §16.

Conclusion: Wix-owned scaffold/binding is authenticated official generation, not hand-authored guess.

## 3. Diff Reproduction — Exact Changes

`git diff ec916b75..5c507a9f --stat` (reproduced via allowed git diff):
```
 .gitignore        |     3 +
 astro.config.mjs  |    14 +
 package-lock.json | 15962 ++++++++++++++++++++++++++++++++++++++++++++++++----
 package.json      |    40 +-
 src/env.d.ts      |     4 +
 tsconfig.json     |    24 +-
 6 files changed, 15093 insertions(+), 954 deletions(-)
```

- `git show 5c507a9f:astro.config.mjs` = 14 lines: `defineConfig` from `astro/config`, `wix` from `@wix/astro`, `react` from `@astrojs/react`, `wixHostingAdapter` from `@wix/astro-wix-hosting-adapter`, `output:"server"`, `adapter:wixHostingAdapter()`, `integrations:[wix(),react()]` — matches unified Wix CLI Astro template, not hand invention.
- `git show 5c507a9f:src/env.d.ts` = auto-generated `/// <reference types="@wix/sdk-types/client" />` + `/// <reference path="../.astro/types.d.ts" />` — scaffold-generated.
- `git show 5c507a9f:tsconfig.json` extends `astro/tsconfigs/strict`, adds `include` for `.astro/types.d.ts`, `src/env.d.ts`, `exclude:[dist]` — standard scaffold.
- `git diff -- .gitignore` only adds `.astro/` — minimal hygiene.
- `git show 5c507a9f:package.json` diff: `build` changed from `npm run check` to `wix build`, adds scripts `dev`/`release`/`preview`/`generate` (`wix dev` etc per contract §2 unified CLI), adds dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, `typescript ^5.8.3`, devDeps `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter ^2.0.0`, `@astrojs/react`, `react`, `react-dom` etc — official Wix scaffold pins. No business rules, no billing policy touched.
- `package-lock.json` expansion corresponds to those deps (960 packages).

No lane cross-contamination: no `src/domain`, `src/billing/pure`, `src/dashboard` changes. Lane ownership respected: integration owns scaffold/project metadata.

`git status` at detached HEAD shows only `.opencode/agents` and `AGENTS.md` dirty — product tree clean at candidate; untracked agent files are tooling, not product.

## 4. Reproduction — Tests & Type Safety (Credential-Free)

Ran directly, no pipes:

- `npm ci` — completed (960 packages, peer react 17 vs 18 warnings from @wix/design-system, expected).
- `npm run typecheck` (`tsc --noEmit`) — PASS after npm ci (prior failure without node_modules due to missing astro types, now resolved).
- `npm run check` (`typecheck && check:purity && vitest run --config src/platform/vitest.config.ts`) — PASS:
  - Purity gate: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.` (plus expected fixture failure inside `purity-gate` test correctly caught and asserted).
  - Vitest: 49 test files, 548 tests passed, 0 failed. Suites: domain evaluate/windows/exceptions/limits/duplicates/time, platform validation-plugin/webhooks/http/schedule-mutation/registration, billing projection/entitlement/counter/tiers/upgradeUrl, purity, composition, etc. Determinism property passed.

Deterministic unit lanes remain green on candidate.

## 5. Reproduction — Wix Build

- `npm run build` (`wix build`) currently fails in credential-free env with:
  `[@wix/astro] Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found in loaded environment variables` — adapter requires `WIX_CLIENT_ID`. Stack points to `@wix/astro` loadEnvVars.

- This is **not a candidate defect**: official pristine evidence `run_33321707099_official_scaffold_pristine_build.txt` (and `run_33346204544_...`) PASSed with same scaffold shape (adapter `@astrojs/cloudflare`, vite steps, `Complete!`). Those runs were executed with authenticated `wix env pull` (developmentSiteProvisioned true, CLI 1.1.238, secretsPersisted false — temporary env not persisted). Credential-free `wix build` without pulled env is expected to error per `@wix/astro` loadEnvVars. Candidate does not introduce new build regression relative to pristine; it reproduces scaffold's declared build shape and delegates correctly via `wix build` script per unified CLI.

Prior identical integration audit (`633e8b93`) with same 6-file diff was ACCEPT with same reasoning; this candidate is identical scope.

No hand-fabricated `wix.config.json`, no missing adapter, no invented extension IDs, no secrets committed.

## 6. Security & Governance

- No secrets committed, no `WIX_API_KEY` exposure, no `~/.wix` reads.
- No lane violations: only Wix-owned scaffold metadata.
- No domain semantics fork, no dashboard UX beyond scaffold, no billing.
- Commit preserves bound existing App ID per role contract.

## 7. Findings

Reproducible findings: **none blocking**.

- Scaffold authenticity: proven via authenticated origin/main evidence + exact appId/projectId match + pristine PASS log.
- Diff minimal and correct: official Astro/Wix scaffold files only.
- Credential-free deterministic checks: typecheck PASS, purity PASS, 548 tests PASS.
- Wix build env requirement is inherited from official scaffold and matches pristine PASS when env present; not a hand-authored defect.

No FIX_BEFORE_INTEGRATION or REJECT conditions reproduced. Candidate is narrowly scoped official scaffold sync.

VERDICT: ACCEPT
