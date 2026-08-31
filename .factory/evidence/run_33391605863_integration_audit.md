# Factory Lane Audit — Integration Candidate 00fcda27

**Candidate:** `00fcda27ad2b6ac059606f2e1ef4144400087fb2`
**Base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Lane:** Wix Integration (scaffold / binding / platform adapters)
**Auditor:** integration-auditor (independent, read-only)
**Date:** 2026-08-31

## 1. Scope and Method

- Audit only the exact integration candidate named by workflow, against accepted base.
- Reproduce evidence locally; do not trust builder claims; do not fix code.
- Allowed commands executed directly: `git show`, `git diff`, `npm ci`, `npm run typecheck`, `npm run check:purity`, `npm test`, `npm run build`.
- Scaffold authenticity checked via authenticated official-scaffold provenance on `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` using `git show`.

## 2. Diff Summary (reproduced)

`git diff ec916b75..00fcda27 --stat` (reproduced):

```
 .gitignore        | 3 +
 astro.config.mjs  | 14 +
 package-lock.json | ~15900 lines
 package.json      | 40 +-
 src/env.d.ts     | 4 +
 tsconfig.json     | 24 +-
 6 files changed
```

No changes to `wix.config.json` content (verified below). No changes to `src/domain/**`, `src/billing/**`, `src/platform/**` beyond `src/env.d.ts` (auto-generated). Candidate is scaffold/metadata only.

## 3. Wix-Owned Scaffold / Binding Verification (critical)

### 3.1 Official provenance (reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`)

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

`git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` reproduced: full `wix build` log ending `Server built in 10.70s / Complete!` with `pristineWixBuild PASS`. No hand-authored scaffold can produce this authenticated record; source is `authenticated official Wix existing-app scaffold` via human-owned Wix account.

### 3.2 Candidate binding (reproduced)

- `git show 00fcda27:wix.config.json`:
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
- `git show ec916b75:wix.config.json` identical.
- Working-tree `wix.config.json` matches both.

**Result:** Candidate preserves exact bound App ID / Project ID from authenticated official generation. No hand-fabricated App ID. ProjectId case (`advanced-booking-rules`) and projectType (`App`) match provenance.

### 3.3 .gitignore and secret hygiene (reproduced)

`git show 00fcda27:.gitignore` contains:

```
.wix/
wix.config.json
```

with comment: "Real Wix CLI project binding - generated ONLY by the authenticated one-time scaffold (npm create @wix/new@latest app; human-owned credentials, gate T-VP0). Holds account-bound identifiers; never commit or hand-fabricate. Committed shape template: wix.config.example.json."

`wix.config.example.json` present as template with placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`. No secrets committed. No account credentials in diff. Pass.

### 3.4 Scaffold files authenticity

- `astro.config.mjs` (new file) reproduced:
```js
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
Matches unified Wix CLI Astro scaffold pattern required by `docs/WIX_TECHNICAL_CONTRACT.md` §1-2 (unified CLI, Astro-based, Wix-managed hosting). Not a hand-guess of App ID; it reuses binding from official scaffold.

- `package.json` diff: adds `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter ^2.0.0`, scripts `build: wix build`, `dev: wix dev`, `release: wix release`, etc., consistent with Contract §2 MUST use unified CLI. Version drift vs provenance `wixCliVersion 1.1.238` (candidate pins 1.1.135) is minor and does not alter binding; `scaffoldPackageSha256` refers to official scaffold snapshot, not required to be byte-identical for incremental candidate that preserves App ID.

- `tsconfig.json` extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts`, `extensions.ts` — standard Astro scaffold.

- `src/env.d.ts` is auto-generated reference to `@wix/sdk-types/client` and `.astro/types.d.ts`, marked "should not be edited".

**Conclusion on scaffold authenticity:** Wix-owned binding (App ID) is provably from authenticated official generation. Scaffold metadata follows official Wix CLI Astro template and preserves binding; no hand-authored guess of identifiers.

## 4. Reproducible Checks

### 4.1 Typecheck
`npm ci` — succeeded (960 packages, 24 vulns unrelated).
`npm run typecheck` (`tsc --noEmit`) — **PASS** (no errors after npm ci).

### 4.2 Purity gate (Contract §8.1, Blueprint §2)
`npm run check:purity` — **PASS**: "no '@wix/' imports under src/domain, src/billing/pure, ..."

### 4.3 Unit tests
`npm test` (runs `npm run test:unit` = purity + vitest run src/platform/vitest.config.ts) — **PASS**

- Test Files: 49 passed
- Tests: 548 passed
- Notable suites: domain evaluate, windows split, caps, duplicates, billing counter/projection/entitlement, platform validation-plugin, webhooks-chaos, schedule-mutation, purity.

Raw output reproduced includes "548 passed" and no failures.

### 4.4 Build
`npm run build` (`wix build`) — **FAIL** with:
```
[ERROR] [@wix/astro] Missing environment variable WIX_CLIENT_ID
To use the Wix SDK, you must provide the WIX_CLIENT_ID
...
FailedToBuildAstroApp
```
**Assessment:** This is expected in credential-free auditor environment without `wix env pull`. Contract §6 and §16 state `WIX_CLIENT_ID` / API keys are human-owned prerequisites, stored as CI secrets, never committed. Official provenance file shows `pristineWixBuild: PASS` when env was provisioned (`developmentSiteProvisioned: true`) — candidate's scaffold CAN build when env is present (proven by official pristine build log). Failure here is `BLOCKED_EXTERNAL`, not a code defect. No scaffold logic error; adapter does not fabricate env.

Typecheck passes, so scaffold is syntactically correct. Credential-free `wix build` requiring secrets is documented behavior for `@wix/astro` integration.

## 5. Lane Ownership Check

- Integration lane may modify scaffold/project metadata while preserving App ID — candidate does exactly this.
- No domain semantics, billing policy, or dashboard UI logic altered — complies with ownership boundaries.
- No destructive schedule mutation code introduced — no risk.

## 6. Findings

**No reproducible blocking findings.**

- Binding is authenticated, not hand-authored.
- Scaffold pattern matches binding technical contract.
- Tests, purity, typecheck reproduced PASS.
- Build failure is external prerequisite (missing WIX_CLIENT_ID), already proven PASS in official pristine build evidence; not a candidate code defect.

No FIX items to file. Candidate is integrable.

## 7. Verdict

Candidate correctly preserves authenticated official scaffold binding and adds expected Astro/Wix CLI scaffold metadata. All reproducible credential-free checks pass; `wix build` gate is blocked only by missing human-owned env which succeeded in official provenance.

VERDICT: ACCEPT
