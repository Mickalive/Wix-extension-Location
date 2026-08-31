# Factory Lane Audit — Integration Candidate 5b2ce982c5e5cd12c5a779cacea71e823236f341 vs Base ec916b75d5600e02d679d264648ac92333d721f1

## Candidate & Base
- Candidate SHA: `5b2ce982c5e5cd12c5a779cacea71e823236f341`
- Accepted Base SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Audit scope: Wix-owned scaffold / project binding authenticity only (integration lane). No cross-lane repair attempted.

## Reproduction Method (independent)
- Used `git show` on both SHAs and on `origin/main:.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` (per developer contract).
- Compared `wix.config.json`, `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `src/env.d.ts` via `git show` and `git diff --stat`.
- Ran deterministic checks independently after `npm ci`:
  - `npm run typecheck` → PASS (tsc no emit)
  - `npm test` (`npm run check:purity && vitest run --config src/platform/vitest.config.ts`) → 49 files, 548 tests PASSED
  - `npm run build` (`wix build`) → fails locally with `Missing environment variable WIX_CLIENT_ID` — expected offline without `wix env pull`; pristine build evidence shows PASS with provisioned dev site (see below). Not a candidate defect.

## Scaffold Provenance & Binding Authenticity (primary criterion)

### Authenticated official scaffold evidence (origin/main)
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
- Pristine build log (`run_33321707099_official_scaffold_pristine_build.txt`) shows complete Astro + `@wix/astro-wix-hosting-adapter` Vite build in ~10.7s, PASS, corroborating that authenticated scaffold is viable.

### Candidate binding
- `git show ec916b75: wix.config.json` → `{ "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }`
- `git show 5b2ce982: wix.config.json` → identical, preserves bound App ID (required by integration lane ownership). No new ID fabricated.
- Disk `wix.config.json` matches. `wix.config.example.json` remains template `"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"` — no secret committed.
- `.gitignore` correctly retains:
  ```
  .wix/
  wix.config.json
  ```
  and candidate adds only `.astro/` (standard Astro/Wix generated state) — matches official scaffold expectations.

### Scaffold files
- `git diff --stat` between base and candidate: 6 files only:
  `.gitignore (+3, adds .astro/), astro.config.mjs (+14 new), package-lock.json (+15962/-954), package.json (scaffold deps), src/env.d.ts (+4), tsconfig.json (extends astro/tsconfigs/strict)`
- `astro.config.mjs` at candidate:
  ```js
  import { defineConfig } from 'astro/config';
  import wix from '@wix/astro';
  import react from "@astrojs/react";
  import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";
  export default defineConfig({ output: "server", adapter: wixHostingAdapter(), integrations: [wix(), react()], image: { domains: ["static.wixstatic.com"] }, security: { checkOrigin: false }, devToolbar: { enabled: false } });
  ```
  Matches official Wix Astro App template used in pristine build (adapter, integrations, image domains). Not a hand-guessed minimal config.
- `tsconfig.json` extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts` — standard scaffold.
- `src/env.d.ts` auto-generated, references `@wix/sdk-types/client` — scaffold artifact.
- `package.json` adds dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0` and dev deps `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter ^2.0.0`, etc., and changes `build` to `wix build`, `dev` to `wix dev` etc. This is the expected Wix-owned scaffold surface; no domain/billing/dashboard ownership violated.
- Package-lock delta is dependency-tree expansion consistent with those additions; no evidence of manual ID fabrication.
- Wix CLI version in evidence (`1.1.238`) vs dependency `^1.1.135` is not a mismatch: generator version vs pinned dep range can differ; scaffold still builds (pristine PASS). No hand-authored ID or endpoint invented.

**Conclusion on authenticity:** Candidate preserves authenticated binding (App ID / Project ID) and introduces only standard Wix scaffold artifacts that align with the authenticated pristine build. No hand-authored `wix.config.json` guesses, no secret persistence, no binding mutation.

## Lane Ownership & Isolation
- Integration lane is permitted to repair `wix.config.json` non-secret shape while preserving App ID — candidate preserves App ID exactly.
- No modifications to `src/domain`, `src/billing/pure`, or dashboard UI logic; purity gate passes (`Purity gate passed: no '@wix/' imports under protected paths`). Domain remains deterministic and Wix-free.
- Dashboard/billing ownership untouched.

## Deterministic Checks Reproduced
- `npm ci` → 960 packages installed (peer warnings only, expected for `@wix/design-system` transitive `react` peers).
- `npm run typecheck` → PASS after install.
- `npm test` → 548 tests across 49 files PASSED; purity-gate fixture failures isolated to test fixtures, real gate PASSED.
- Schedule mutation, webhook, idempotency, validation-plugin tests present and passing (covers platform integration contracts).
- No silent destructive schedule rewrites detected in diff; candidate does not touch persistence logic.

## Security / Secrets / Wix Binding Hygiene
- No `.env`, `.wix/` or credentials committed; `secretsPersisted: false` in official evidence corroborates.
- `WIX_API_KEY` never observed in candidate diff or report; Wix MCP `--wixCliAuth` path not abused.
- No `wix.config.json` hand-fabrication; binding not widened.

## Findings
- No reproducible blocking finding. Scaffold provenance is authenticated, binding preserved, deterministic checks pass, lane boundaries respected.

## Verdict Rationale
All integration-lane acceptance criteria satisfied: authenticated scaffold provenance (`origin/main:.factory/evidence/...`), binding intact, scaffold files plausible and consistent with pristine PASS, no secret exposure, no ownership violation, reproduced tests passing.

VERDICT: ACCEPT
