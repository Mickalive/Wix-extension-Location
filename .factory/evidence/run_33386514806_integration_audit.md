# Factory Lane Audit — Integration Candidate 8316316

**Candidate SHA:** `8316316ff93ccab46c9516c0e6226a3fbf6f2c27`
**Accepted Base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Audit Scope:** Exact integration candidate vs accepted base. Reproduce evidence. Verify Wix-owned scaffold/binding came from authenticated official generation.

## 1. Scaffold/Binding Provenance (Authenticated Official Generation)

Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
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
Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`:
- Pristine build output shows `✓ Completed in 320ms`, `✓ built in 2.49s`, `✓ built in 7.81s`, `Server built in 10.70s`, `Complete!` with adapter `@astrojs/cloudflare` and hosting adapter enabling Cloudflare KV. `pristineWixBuild: PASS` confirmed empirically in authenticated workflow. Generator exit 1 is marked accepted due to optional post-task failure (`projectAcceptedDespiteOptionalPostTaskFailure: true`), not scaffold invalidity.

Verification against candidate:
- `git show HEAD:wix.config.json` → `appId 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId advanced-booking-rules`, `projectType App`
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` → identical `appId`/`projectId`/`projectType`
- **Binding preserved:** candidate preserves bound existing App ID exactly, no hand-fabricated or rotated ID.
- `git show HEAD:astro.config.mjs` → official pattern: `output: "server"`, `adapter: wixHostingAdapter()`, `integrations: [wix(), react()]`, `security: { checkOrigin: false }`. Matches authenticated Wix Astro scaffold.
- `git show HEAD:tsconfig.json` → `extends: astro/tsconfigs/strict`, `include` with `.astro/types.d.ts`, `src/env.d.ts`, `exclude: dist` — official Astro scaffold shape.
- `git show HEAD:src/env.d.ts` → auto-generated `/// <reference types="@wix/sdk-types/client" />` and `/// <reference path="../.astro/types.d.ts" />`.
- Candidate commit metadata: `Author: wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` `candidate(integration): generation 156` — consistent with automated official generation, not hand-authored guess.

Conclusion: Wix-owned scaffold/binding provenance is authenticated, not hand-authored.

## 2. Diff Scope vs Lane Ownership

`git diff ec916b75d5600e02d679d264648ac92333d721f1 8316316ff93ccab46c9516c0e6226a3fbf6f2c27 --stat`:
```
 .gitignore        | 3 +
 astro.config.mjs  | 14 +
 package-lock.json | 15962 ++++++++++++
 package.json      | 40 +-
 src/env.d.ts      | 4 +
 tsconfig.json     | 24 +-
 6 files changed
```
- No domain (`src/domain`), billing (`src/billing/pure`), dashboard UI changes — lane boundary respected. Integration lane correctly owns scaffold/project metadata, platform adapters, `wix.config.json` repair while preserving App ID.
- `package.json` change: adds `dependencies: @wix/astro, @wix/dashboard, @wix/design-system, @wix/essentials, astro, typescript` and `devDependencies: @wix/cli, @wix/astro-wix-hosting-adapter, @astrojs/react/check` etc. Scripts `build` changed from `npm run check` to `wix build` with `dev/release/preview/generate: wix ...` — correct for Wix CLI scaffold. `engines node >=20.11.0` preserved.
- `.gitignore` addition: `.astro/` — correct Astro generated state exclusion.
- `wix.config.json` unchanged — no secret added, no ID fabrication.
- No Wix SDK imports introduced into protected pure paths (verified by purity gate).

## 3. Deterministic Checks — Reproduced

- `npm ci` → PASS (960 packages, warnings only peer dependency overrides expected for react 18 vs design-system, no audit block).
- `npm run typecheck` (`tsc --noEmit`) → PASS (no errors).
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.` The subsequent test log `PURITY GATE FAILED: 4 forbidden ... /tmp/purity-gate-fixture-...` is expected fixture negative test inside `purity-gate.spec.ts` (proves gate detects violations).
- `vitest run --config src/platform/vitest.config.ts` → `49 passed (49)`, `548 passed (548)` covering domain, billing, platform, webhooks, idempotency, registration, validation plugins.
- Full `npm run check` (typecheck + purity + vitest) → PASS in 6.50s.

## 4. Wix Build Validation

- Local `npm run build` (`wix build`) → `Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found` at `@wix/astro/build/integration`. This is expected without authenticated `wix env pull`. Not a candidate code defect; pristine build in authenticated environment already passed (`pristineWixBuild: PASS` with 10.70s server build, Cloudflare adapter). Candidate scaffold is buildable when env is provisioned — confirmed by official pristine evidence. No silent `wix.config.json` rewrite, no destructive schedule mutation.

## 5. Security / Global Prohibitions

- No secrets committed (`secretsPersisted: false`, `.env` ignored, `.wix/` ignored).
- No fabricated account identifiers; `appId` matches official evidence.
- No marketplace publish/release; no manual `wix release`.
- No governance/orchestration file edits in candidate (candidate SHA touches only 6 scaffold files).
- No silent destructive schedule rewrites in candidate diff.

## 6. Adversarial Findings

Attempted to falsify: hand-authored scaffold, ID rotation, purity violation, test failure, build failure due to code. None reproduced. The only build failure is missing `WIX_CLIENT_ID` which is external credential prerequisite, correctly marked `projectAcceptedDespiteOptionalPostTaskFailure` and `developmentSiteProvisioned: true` in official evidence. Candidate does not hide this.

## Verdict

Candidate is narrowly scoped integration scaffold generation from authenticated official Wix CLI, preserves binding, adds correct Astro/Wix hosting dependencies, passes deterministic typecheck/purity/unit checks, and has proven pristine build via authenticated evidence. No lane boundary violation, no fabrication.

VERDICT: ACCEPT
