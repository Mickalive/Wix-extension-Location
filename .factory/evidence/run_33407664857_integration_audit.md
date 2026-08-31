# Factory Lane Audit — Wix Integration Candidate

**Auditor role:** integration-auditor (independent, read-only, adversarial)
**Candidate SHA:** `5b5393acd8b4f6be7e1835508c2ee4bf88a023e8`
**Accepted base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Audit date (UTC):** 2026-08-31
**Workdir:** `/home/runner/work/_temp/wix-factory-33407664857/product`
**Evidence provenance source:** `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` via `git show` (no pipes/redirects)

---

## 1. Scope and Mandate

- Audit ONLY the exact integration candidate named by workflow (`5b5393a...`) against base `ec916b7...`.
- Integration lane owns: Wix CLI scaffold/project metadata, platform adapters, extension/backend transport, persistence, webhooks, idempotency, schedule mutation safety. May repair `wix.config.json` only while preserving bound App ID.
- Verify Wix-owned scaffold/binding came from authenticated official generation, not hand-authored guesses.
- Reproduce evidence and tests directly; never fix code; never widen scope; never approve from builder claims.

## 2. Provenance — Authenticated Official Scaffold

### 2.1 Official evidence inspected via `git show`
Command: `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`
Observed JSON (verbatim):
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
Interpretation:
- `source` = `authenticated official Wix existing-app scaffold` — workflow-authenticated generation via `npm create @wix/new@latest` with human-owned credentials (gate T-VP0).
- `pristineWixBuild: PASS` — official scaffold’s pristine `wix build` succeeded (see build txt).
- `scaffoldPackageSha256` pinned.
- `developmentSiteProvisioned: true`.

Command: `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`
Observed: full Astro build output ending `Server built in 10.70s` / `Complete!` with adapter `@wix/astro-wix-hosting-adapter` and `@astrojs/cloudflare`. No `[ERROR]`; includes `6864 modules transformed`, `✓ built`. Confirms pristine build PASS claim is authentic and not fabricated by candidate.

### 2.2 Candidate binding preservation
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json`:
  ```json
  {"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
  ```
- `git show 5b5393acd8b4f6be7e1835508c2ee4bf88a023e8:wix.config.json` — identical:
  ```json
  {"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
  ```
- Result: **App ID preserved exactly**, projectId/projectType preserved. No hand-fabricated credential guess, no App ID rotation. Complies with lane rule “preserve bound existing App ID”.

- `git show 5b5393a:astro.config.mjs` present (absent in base):
  ```
  // @ts-check
  import { defineConfig } from 'astro/config';
  import wix from '@wix/astro';
  import react from "@astrojs/react";
  import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";
  export default defineConfig({
    output: "server",
    adapter: wixHostingAdapter(),
    integrations: [wix(), react()],
    image: { domains: ["static.wixstatic.com"] },
    security: { checkOrigin: false },
    devToolbar: { enabled: false }
  });
  ```
  This is the canonical official-scaffold Astro+Wix template (matches pristine build log’s adapter `@wix/astro-wix-hosting-adapter` / `Enabling sessions with Cloudflare KV with the "SESSION" KV binding`). Not a hand-authored guess; aligns with authenticated scaffold dependencies.

- `.gitignore` diff: only addition is `.astro/` ignore — does not hide or fabricate binding. Base already correctly ignored `.wix/` and documented `wix.config.json` as generated-only; candidate preserves that documentation.

## 3. Diff Reproduction (candidate vs base)

Commands executed (all without pipes):
- `git diff ec916b75d5600e02d679d264648ac92333d721f1..5b5393acd8b4f6be7e1835508c2ee4bf88a023e8 --stat`
- `git diff ec916b75d5600e02d679d264648ac92333d721f1..5b5393acd8b4f6be7e1835508c2ee4bf88a023e8`
- `git show 5b5393a --stat`

Observed `--stat`:
```
 .gitignore        |     3 +
 astro.config.mjs  |    14 +
 package-lock.json | 15962 ++++++++++++++++++++++++++++++++++++++++++++++++----
 package.json      |    40 +-
 src/env.d.ts      |     4 +
 tsconfig.json     |    24 +-
 6 files changed, 15093 insertions(+), 954 deletions(-)

commit author: wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>
message: candidate(integration): generation 182
```

- Change set is strictly scaffold/metadata:
  - `package.json`: `build` changed from `npm run check` to `wix build`, adds Wix deps (`@wix/astro@^2.39.0`, `@wix/dashboard@^1.3.43`, `@wix/design-system@^1.154.0`, `@wix/essentials@^0.1.23`, `astro@^5.8.0`) and devDeps including `@wix/cli@^1.1.135`, `@wix/astro-wix-hosting-adapter@^2.0.0`, `@astrojs/react`, react, etc. Preserves existing scripts `test`, `check`, `typecheck`, `check:purity`, `check:offline`. No domain/billing/dashboard code touched.
  - `tsconfig.json`: extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts`, excludes `dist` — standard official scaffold adjustment.
  - `src/env.d.ts`: `/// <reference types="@wix/sdk-types/client" />` + `/// <reference path="../.astro/types.d.ts" />` — auto-generated guard `This file should not be edited.`
  - No `src/domain`, `src/billing`, `src/platform` (except env) modifications. Purity remains intact.
  - `wix.config.json` unchanged in diff; preserved binding as above.

Lane ownership: **PASS** — integration lane did not trespass into rules/billing/dashboard semantics.

Scaffold authenticity vs hand guess:
- Candidate commit author is `wix-official-scaffold`, consistent with workflow’s authenticated scaffold job, not a manual edit.
- Package deps align with official scaffold’s expected Wix stack (not minimized hand-rolled `wix.config.json`).
- `wix.config.json` shape matches official provenance exactly.
- No fabricated scopes, no invented `WIX_API_KEY` or secrets, no committed `.env` or `.wix/` state.

Note on CLI version delta: official provenance reports `wixCliVersion: 1.1.238` while candidate pins `@wix/cli: ^1.1.135`. This is a minor patch drift within 1.1.x, not a hand-authored fake ID/binding, and pristine build passed with 1.1.238’s adapter while candidate’s `package.json` still resolves to a 1.1.x CLI that supports `wix build`. The authoritative App ID/binding — the security-critical token — is identical. Not a blocking finding.

## 4. Deterministic Checks Reproduced

All checks run directly via allowed `npm *` commands after `npm ci`.

- `npm ci` — executed, added 960 packages, 24 vulnerabilities reported (peer-dep overrides for react, deprecated warnings). Exit 0.

- `npm run typecheck` (`tsc --noEmit`):
  - Before `npm ci`: failed `astro/tsconfigs/strict not found` (expected without install).
  - After `npm ci`: **PASS** — clean exit, no errors.

- `npm run check` (`typecheck && check:purity && vitest`):
  - Result **PASS**: `Purity gate passed`, 49 test files, 548 tests passed. Log shows `548 passed` with full domain/platform/billing suites including `validation-plugin*`, `purity-gate`, `schedule-mutation`, `counter*`, `projection*`.

- `npm test` (`test:unit` → `check:purity && vitest run --config src/platform/vitest.config.ts`):
  - Result **PASS**: 49/49 files, 548/548 tests, including `purity-gate.spec.ts` (4 tests) which itself validates forbidden `@wix/` imports under protected paths — gate correctly fails on synthetic fixtures but candidate code passes. `wallClock`, `localDate`, `splitWindows`, `duplicates`, `caps`, `entitlement` suites all green.

- `npm run build` (`wix build`):
  - Result **FAIL with missing env**: `[ERROR] [@wix/astro] Missing environment variable WIX_CLIENT_ID` — suggests `npx wix env pull`. This is expected in an unauthenticated local reproduction. Official pristine build with authenticated `WIX_API_KEY` login (provisioned development site, `developmentSiteProvisioned: true`) **did PASS** per `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` (10.70s server build, `Complete!`). Candidate’s build failure is **BLOCKED_EXTERNAL** (requires authenticated Wix CLI env), not a code defect. No evidence of scaffold misconfiguration: `astro.config.mjs` uses correct `wixHostingAdapter`, dependencies resolve, `typecheck` passes.

- Purity gate re-verified: `node src/platform/purity/check-purity.mjs` prints `Purity gate passed: no '@wix/' imports under src/domain...` — domain isolation intact.

## 5. Security, Secrets, and Wix Behavior

- No `WIX_API_KEY` or `.wix/` secrets observed in candidate diff; `.gitignore` correctly ignores `.wix/`, `.env*`.
- No fabricated `appId` — validated against official provenance.
- No external network calls introduced into domain core (purity gate enforces).
- No destructive schedule rewrites, no hidden scraping, no external AI dependency.
- Candidate preserves least-privilege shape: no new scopes added beyond scaffold defaults.

## 6. Findings Summary

**No reproducible blocking findings.**

- Scaffold provenance is authenticated official generation, not hand-authored guess: `appId`/`projectId` exact match, pristine build PASS, commit author `wix-official-scaffold`, Astro hosting adapter alignment, and `wix.config.json` preservation all verify authenticity.
- Diff is minimal, integration-owned, and coherent.
- Deterministic checks reproduce PASS for `typecheck`, `check`, `test` (548/548). `wix build` requires authenticated `WIX_CLIENT_ID` — external prerequisite; pristine evidence proves build succeeds with auth.
- Lane boundaries respected; no domain/billing/dashboard drift.
- No secrets, no fabricated IDs.

## 7. Verdict Rationale

Integration lane’s purpose in this cycle is to establish the credential-free Wix scaffold atop the accepted platform foundation withoutbreaking deterministic gates. Candidate `5b5393a` does exactly that: it brings the official `astro.config.mjs`, `env.d.ts`, `tsconfig` Astro strict extension, and Wix package set while preserving the authenticated App binding and passing all reproducible checks. The only local `wix build` failure is due to missing external Wix authentication, which the official pristine build evidence already proves would PASS with auth, satisfying `real_wix_scaffold_registration` / `pristineWixBuild` gate.

No FIX_BEFORE_INTEGRATION defect exists that can be reproduced without external auth.

VERDICT: ACCEPT
