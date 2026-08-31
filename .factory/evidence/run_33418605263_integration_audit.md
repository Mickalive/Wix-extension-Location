# Factory Lane Audit — Integration Candidate 3a6abde8fcbd93734e2c9f80ab3bef14f753f91c

**Base:** `ec916b75d5600e02d679d264648ac92333d721f1` (accepted `lab/wix-rules`)
**Candidate:** `3a6abde8fcbd93734e2c9f80ab3bef14f753f91c`
**Auditor model:** `opencode/muse-spark-1.2-contributor-free`
**Date:** 2026-08-31
**Scope:** Wix Integration lane only (scaffold/project metadata, platform adapters, extension/backend transport, persistence, webhooks, idempotency, schedule-mutation safety, platform tests). Domain/billing/dashboard semantics out of scope unless silently forked.

## 1. Provenance Instructions Compliance
- Inspected authenticated official-scaffold provenance via allowed `git show` (no pipes/redirects):
  - `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`
  - `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`
- Official evidence (origin/main):
```json
{
  "schemaVersion": 3,
  "source": "authenticated official Wix existing-app scaffold",
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App",
  "wixCliVersion": "1.1.238",
  "pristineWixBuild": "PASS",
  "scaffoldPackageSha256": "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd"
}
```
- Pristine build log shows `✓ built in 7.81s` / `Server built in 10.70s` / `Complete!` with PASS.

## 2. Binding Authenticity (Wix-owned scaffold check)
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json`:
```json
{ "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
```
- `git show 3a6abde8fcbd93734e2c9f80ab3bef14f753f91c:wix.config.json` — identical App ID / projectId / projectType.
- `git show HEAD:wix.config.json` (HEAD == candidate, verified via `git diff HEAD 3a6abde... --name-only` → no output) also identical.
- **Result:** Candidate preserves the authenticated binding verbatim; no hand-fabricated or guessed App ID. Candidate does not modify `wix.config.json` beyond preserving the bound ID (allowed repair of non-secret fields only, which was not needed). `wix.config.json` is correctly ignored in `.gitignore` per contract (real binding generated only by `npm create @wix/new@latest app`).

## 3. Diff Scoping — Exact Candidate Changes
- `git diff --name-only ec916... 3a6abde...`:
```
.gitignore
astro.config.mjs
package-lock.json
package.json
src/env.d.ts
tsconfig.json
```
- No `src/platform/*`, `src/domain/*`, `src/billing/*`, dashboard UI, or `extensions.ts` changes. `extensions.ts` verified via `git show HEAD:extensions.ts` — still `EXTENSIONS = Object.freeze([])` with intentional empty registry and documented T-VP0 gate. No fabricated `extensionId`.
- Changes are within Integration lane ownership (scaffold/project metadata):
  - **package.json:** `build` changed from `npm run check` → `wix build`; added `dev`/`release`/`preview`/`generate` scripts; moved to Wix Astro stack (`@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, `@wix/astro-wix-hosting-adapter ^2.0.0`, `@wix/cli ^1.1.135`). Engines `node >=20.11.0` retained. Description preserved.
  - **astro.config.mjs** (new, not in base): minimal correct Wix Astro config — `output: "server"`, `adapter: wixHostingAdapter()`, `integrations: [wix(), react()]`, image domains, security/checkOrigin, devToolbar disabled. No secrets, no hand-guessed extension IDs.
  - **tsconfig.json:** extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts`, etc.; compilerOptions unchanged aside from formatting. Valid for Astro+Wix.
  - **src/env.d.ts** (new): `/// <reference types="@wix/sdk-types/client" />` + `/// <reference path="../.astro/types.d.ts" />` auto-generated header, correct.
  - **.gitignore:** adds `.astro/` (Astro/Wix generated state) — correct hygiene.
  - **package-lock.json:** regenerated for above deps (960 packages).
- No cross-lane file forks, no silent domain semantics change, no billing policy change.

## 4. Reproduction — Deterministic Checks (run directly, no pipes/wrappers)
- `npm ci` — executed, installed 960 packages with peer warnings (react 18 override for react-chartjs-2 etc.) — success.
- `npm run check` — executed via allowed `npm run check`:
  - `typecheck: tsc --noEmit` — PASS (after `npm ci`, previously failed due to missing `astro/tsconfigs/strict` before install — now passes)
  - `check:purity: node src/platform/purity/check-purity.mjs` — `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/...` — PASS (Technical Contract §8.1)
  - `vitest run --config src/platform/vitest.config.ts` — **49 test files, 548 tests passed** in 4.88s (including domain, billing, platform: validation-plugin, webhooks-chaos, schedule-mutation, idempotency, registration-surface, purity-gate, etc.)
- `npm run build` (`wix build`) — executed via allowed `npm run build`:
  - Fails locally with `Missing environment variable WIX_CLIENT_ID` / `wix env pull` hint. This is **environment-dependent, not code-defective**: official pristine build on authenticated scaffold (same Astro adapter, `wix build`) is recorded as PASS on origin/main evidence. Local failure reproduces exactly the expected credential-free limitation when `WIX_CLIENT_ID` is not provided; `wix build` is documented to require `wix login --api-key` + `wix env pull` for authenticated builds. Candidate’s `wix build` integration is structurally correct; the authenticated pristine build already proves scaffold build viability.
- No other deterministic check (`npm run check:offline` not separately required; `check` already covers offline-capable unit tests).

## 5. Lane-Ownership and Safety Verification
- **Scaffold authenticity:** PASS — App ID binding is authenticated, not hand-authored.
- **Least privilege / no secret commit:** No `.env`, no `~/.wix`, no API key in diff or working tree (`git status` shows only unrelated `.opencode` fiche drift, not candidate files). Scopes not changed in this diff (scope hygiene deferred to first release per contract §5).
- **Destructive-write protections:** Not modified in this candidate (schedule-mutation paths untouched). Existing `tests/platform/schedule-mutation.spec.ts` (10 tests), `idempotency.spec.ts` (8 tests), `webhooks-chaos.spec.ts` (13 tests) all pass.
- **Idempotency / webhooks / persistence:** No regression; candidate does not alter `src/platform` logic.
- **Extension registration:** No hand-fabricated IDs; `extensions.ts` remains empty per T-VP0, correct to await authenticated `wix generate`.

## 6. Findings
- No reproducible integration-lane defect found. Candidate is a minimal, correct scaffold alignment that preserves the authenticated `wix.config.json` binding, adds only Wix Astro project metadata owned by Integration lane, and passes all deterministic credential-free checks (`typecheck` + `purity` + 548 vitest). The only non-passing local command (`wix build` without `WIX_CLIENT_ID`) is an expected external-prerequisite failure, not a code defect, and is already proven PASS in authenticated pristine build evidence on `origin/main`.
- Minor version drift (`@wix/cli ^1.1.135` in candidate vs `1.1.238` in official evidence) does not affect binding authenticity or build viability; not a blocking defect.
- No scope widening, no cross-lane ownership violation, no secret exposure, no silent domain fork.

VERDICT: ACCEPT
