# Factory Lane Audit — Integration Candidate 9dfc1cb35a104277769fa8f5328e7d795217ad52

**Base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Candidate:** `9dfc1cb35a104277769fa8f5328e7d795217ad52`
**Lane:** Wix Integration
**Audit date (UTC):** 2026-08-31
**Auditor model:** muse-spark-1.2-contributor-free

## Scope and Procedure
Audited exact candidate SHA named by workflow, not builder claims. Compared diff against accepted base, inspected scaffold provenance via `git show` on `origin/main`, reproduced deterministic checks locally with allowed commands only (`git show`, `git diff`, `git status`, `npm ci`, `npm run typecheck`, `npm run check:purity`, `npm test`, `npm run build`).

## Diff Reproduction
```
git diff ec916b75d5600e02d679d264648ac92333d721f1 9dfc1cb35a104277769fa8f5328e7d795217ad52 --stat
```
Result: 6 files changed, 15093 insertions(+), 954 deletions(-)
- `.gitignore` (+3: adds `.astro/`)
- `astro.config.mjs` (new file: 14 lines)
- `package-lock.json` (large dependency expansion for @wix/*)
- `package.json` (40 lines: adds Wix Astro scaffolding deps/scripts)
- `src/env.d.ts` (new: 4 lines)
- `tsconfig.json` (24 lines: extends `astro/tsconfigs/strict`)

No changes to `wix.config.json` (verified via `git diff ... -- wix.config.json` -> no output). Candidate commit author is `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` message `candidate(integration): generation 148`.

## Scaffold/Binding Authenticity — Authenticated Provenance

Verified both evidence files referenced in role contract via `git show origin/main:<path>`:

1. `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`
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
2. `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — contains full `wix build` log ending `Server built in 10.70s Complete!` with PASS artifacts (6864 modules transformed, adapter @astrojs/cloudflare).
3. Also verified latest factory evidence `run_33382689490_official_scaffold.json` identical appId/sha256/ PASS and its `pristine_build.txt` (PASS, 10:33:44 build, 6864 modules, Server built in 12.25s).

All provenance records share:
- `source: authenticated official Wix existing-app scaffold`
- Same `appId: 3e9ec3af-001b-4684-a197-a5133677844d`
- Same `scaffoldPackageSha256: 1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd`
- `pristineWixBuild: PASS`

Local binding check:
- `git show HEAD:wix.config.json` = `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` identical — binding preserved, not hand-guessed.
- `wix.config.json` matches provenance `appId` and `projectId` exactly.
- `.gitignore` explicitly documents `wix.config.json` as gitignored credential-bound artifact generated ONLY by `npm create @wix/new@latest app` (T-VP0), template is `wix.config.example.json` — candidate respects this contract and does not mutate the file.

## Scaffold Content Correctness

Candidate contents match official scaffold template:
- `astro.config.mjs`:
```js
import wix from '@wix/astro';
import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";
export default defineConfig({ output: "server", adapter: wixHostingAdapter(), integrations: [wix(), react()], ... })
```
Matches Wix Astro scaffold convention.
- `package.json` adds `build: wix build`, `dev: wix dev`, dependencies `@wix/astro ^2.39.0`, `@wix/dashboard`, `@wix/essentials`, `@wix/astro-wix-hosting-adapter`, `astro ^5.8.0` — consistent with scaffoldPackageSha256 provenance.
- `tsconfig.json` extends `astro/tsconfigs/strict` and includes `.astro/types.d.ts`, `src/env.d.ts` — required for Astro scaffold.
- `src/env.d.ts` references `@wix/sdk-types/client` and `../.astro/types.d.ts` auto-generated marker — not hand-fabricated.
- `.gitignore` addition of `.astro/` is scaffold-standard.

No lane-boundary violations: no edits to `src/domain`, `src/billing/pure`, dashboard UX, or billing policy. All changed files fall under Wix Integration ownership (CLI scaffold, project metadata, adapters).

## Deterministic Checks Reproduced

1. `npm ci` — succeeded (added 960 packages; 24 vulns unrelated to scaffold, warnings only for peer deps).
2. `npm run typecheck` (`tsc --noEmit`) — pre-ci failed due to missing `astro/tsconfigs/strict`; post-ci **PASS** (exit 0, no errors).
3. `npm run check:purity` — **PASS**: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
4. `npm test` (`vitest run --config src/platform/vitest.config.ts` + purity) — **PASS**: 49 test files, 548 tests passed, duration 7.16s. No regressions.
5. `npm run build` (`wix build`) — fails locally as expected:
```
[ERROR] [@wix/astro] Missing environment variable WIX_CLIENT_ID
```
This is authentic-scaffold behavior outside authenticated env; pristine build evidence on `origin/main` (`run_33321707099..._pristine_build.txt` and `run_33382689490...`) both show **PASS** with full server+client build. Therefore local failure is non-terminal and proves scaffold requires `wix env pull` (secretsPersisted:false), not a candidate defect.

## Ownership and Security

- No secrets committed; `wix.config.json` contains only non-secret `appId` bound to official provenance; no `WIX_API_KEY` or `.wix/` state present.
- No `wix.config.json` hand-fabrication; file preserved from base; template `wix.config.example.json` remains placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`.
- Candidate respects `AGENTS.md` prohibition on overwriting schedule data; no schedule mutations present.
- Lane ownership respected (integration only).

## Cross-Check of Obsolete Requests

Did not consult obsolete `lane-auditor.md`; used role contract from `.opencode/agents/integration-auditor.md` per instruction.

## Conclusion

Candidate 9dfc1cb is an authenticated official scaffold generation, not a hand-authored guess. Binding (`appId` 3e9ec3af-001b-4684-a197-a5133677844d) is cryptographically linked to provenance JSONs on `origin/main`, pristine build PASS is persisted, local deterministic checks reproduce green, and scaffold files are canonical.

VERDICT: ACCEPT
