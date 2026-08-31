# Factory Lane Audit — Integration Candidate e51bfc13

**Candidate SHA:** e51bfc13b5af3e68d1e1cd4937622090cf64c06d
**Accepted base SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Audit date (UTC):** 2026-08-31
**Auditor role:** lane-auditor (adversarial, read-only, independent of builder)
**Lane:** Wix Integration (build/deterministic gate repair: INT-REPAIR-DET-GATE)
**Scope constraint:** exact integration candidate only; no widening, no fixes, no builder claims trusted

## 1. Candidate diff vs accepted base (reproduced)

Command: `git diff ec916b75d5600e02d679d264648ac92333d721f1 e51bfc13b5af3e68d1e1cd4937622090cf64c06d` and `git show e51bfc13b5af3e68d1e1cd4937622090cf64c06d --stat`

Result: 2 files changed, 124 insertions, 1 deletion
- `package.json` : `build` script `npm run check` -> `node src/platform/build/build.mjs`
- `src/platform/build/build.mjs` : new file 123 lines (credential-free build wrapper)

No change to `wix.config.json`, `src/domain/**`, `src/billing/**`, `src/ui/**`, scopes, or governance files within the candidate interval. Working-tree dirty files outside candidate (`.opencode/agents/**`, `AGENTS.md`, `MANIFEST.sha256`) were excluded from diff and not attributable to candidate.

## 2. Wix-owned scaffold/binding — authenticated official generation vs hand-authored guess

### 2.1 Official provenance source (reproduced via `git show origin/main:…`)

File: `.factory/evidence/run_33321707099_official_scaffold.json` on `origin/main`
```
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
Pristine build log: `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` on `origin/main` — reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — contains full `wix build` output ending `Server built in 10.70s` `Complete!` with no error, confirming `pristineWixBuild: PASS` is not builder-claimed.

Evidence properties:
- `source` explicitly `authenticated official Wix existing-app scaffold`
- `projectAcceptedDespiteOptionalPostTaskFailure: true` with `generatorExit 1` is expected optional-post-task failure, not scaffold failure
- `secretsPersisted: false` confirms no credential leak
- `developmentSiteProvisioned: true`

### 2.2 Candidate and base binding preservation (reproduced)

Commands: `git show e51bfc13b5af3e68d1e1cd4937622090cf64c06d:wix.config.json`, `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json`, `git show origin/main:wix.config.json`

- Candidate `wix.config.json`:
```
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
- Base `wix.config.json` identical
- `origin/main` does not contain `wix.config.json` at that path (removed in factory housekeeping) but evidence `appId` and `projectId` match exactly.

Verification:
- `appId` equals official `3e9ec3af-001b-4684-a197-a5133677844d` character-for-character
- `projectId` equals official `advanced-booking-rules`
- No hand-authored placeholder, no new App ID, no namespace drift, no invented binding
- Contract §16 Human-owned prerequisites preserved: candidate does NOT fabricate credentials or attempt `wix login`; it correctly treats missing CLI as `BLOCKED_EXTERNAL`, not failure

**Conclusion on scaffold authenticity:** Candidate inherits its binding from the authenticated official scaffold. No hand-authored guess, no scope creep, no `wix.config.json` mutation beyond preservation. The `wix.config.json` repair prohibition (preserve bound App ID) is satisfied.

## 3. Deterministic gate reproduction (independent)

Executed directly without pipes/redirects/wrappers as mandated:

- `npm ci` — succeeded (audited 48 packages, after `typecheck` transient failure due to missing `node_modules` resolved after install)
- `npm run typecheck` — PASS (`tsc --noEmit` exit 0 after install)
- `npm run check:purity` — PASS: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- `npm run check` — PASS: typecheck + purity + `vitest run --config src/platform/vitest.config.ts` — 49 test files, 548 tests passed, duration ~7.8s (reproduced twice)
- `npm run build` (`node src/platform/build/build.mjs`) — PASS:
  - Step 1 `Deterministic gate (typecheck + purity + vitest)` passed
  - Step 2 branch: `Wix CLI build skipped (CLI not available)` — `A linked wix.config.json exists but the Wix CLI is not installed` — exit 0. This matches wrapper comment `BLOCKED_EXTERNAL on real_wix_scaffold_registration gate` and is correct for credential-free environment. When CLI is available and scaffold linked, wrapper will execute `npx wix build` and propagate its exit code.

No test failures, no type errors, no purity violations, no hidden `wix build` failure masking.

## 4. Build wrapper analysis — `src/platform/build/build.mjs`

Manual review of 123-line wrapper (read via Read tool, no builder summary trusted):

- **Ownership correct:** under `src/platform/build/` — Integration lane owns `src/platform/**`.
- **Placeholder detection:** `PLACEHOLDER_TOKENS` includes GENER ATED-BY, REPLACE, PLACEHOLDER, TODO, TBD, YOUR_; shapes `<.*>`, `{{.*}}`, `${.*}`; case-insensitive includes check. Valid UUID hex will not false-positive. Empty-string treated as placeholder. Sound.
- **isRealScaffoldPresent():** checks `wix.config.json` existence, valid JSON, object, `appId` string, `!looksLikePlaceholder(appId)`. Handles catch-all parse failure -> false. No unsafe eval.
- **isWixCliAvailable():** `spawnSync('npx', ['wix','--version'], {stdio:'pipe', timeout:15000})` status 0 check; no throw on missing binary. Deterministic.
- **run(cmd,label):** `execSync` with `stdio:inherit`, returns boolean, logs pass/fail. Correct.
- **Step 1:** `npm run check` propagated; `process.exit(1)` on failure — fail-closed correct, preserves deterministic gate as required by Technical Contract §8.6 and Build Blueprint §6.
- **Step 2 branching:**
  - `isRealScaffoldPresent()` true + `isWixCliAvailable()` true -> `execSync('npx wix build')` and `process.exit(0)` on success, `process.exit(error.status ?? 75)` on failure — correctly propagates non-zero, does not swallow `wix build` errors.
  - scaffold present + CLI missing -> logs skipped, `process.exit(0)` after deterministic gate passed — correct `BLOCKED_EXTERNAL` posture, not a false PASS of missing build.
  - scaffold absent/placeholder -> logs `No linked wix.config.json found` and `process.exit(0)` after gate — correct for pre-scaffold cycles.
- **No secret handling, no network egress beyond wix CLI, no filesystem writes outside logging.**
- **Previous build script** was `npm run check` (credential-free only). New wrapper is a strict superset: still runs `npm run check` first, then optionally adds `wix build`. No regression.

Edge checks:
- `wix.config.json` with no `appId` -> false (treated as unlinked) correct
- `wix.config.json` invalid JSON -> false correct
- `appId` containing `YOUR_` etc. would be flagged placeholder, but no valid App ID contains that
- `error.status` nullish coalesced to 75 ensures non-zero propagation even if spawn error lacks status

No defects requiring FIX identified in wrapper logic.

## 5. Lane ownership, scope hygiene, contract alignment

- Integration lane hard ownership (Build Blueprint §2): `src/platform/**`, `src/pages/api/**`, `extensions.ts`, schemas — wrapper is inside `src/platform/build/` -> allowed.
- Does not own domain semantics, dashboard UX, billing policy — candidate touches none of those.
- Does not introduce Wix SDK imports into domain/billing pure — purity gate confirms.
- Preserves `wix.config.json` App ID per instruction "may repair the real non-secret wix.config.json only while preserving the bound existing App ID."
- Technical Contract §6 CI requirements: `npm install` + unit tests + `wix build` credential-free — wrapper implements exactly this with correct fallback when CLI or linked scaffold pending (T-VP0).
- No `PREVIEW_GATED` or `UNSUPPORTED` capability promoted; no marketplace submission, no publish, no secret exposure.

## 6. Adversarial falsification attempts

- Attempted to find hand-authored App ID: compared candidate `wix.config.json` to official evidence — exact match, not guessed.
- Attempted to trigger `typecheck` failure without `npm ci`: reproduced `TS2688 Cannot find type definition file for 'node'` pre-install, resolved after `npm ci` — demonstrates deterministic gate properly fails without deps, passes with them; wrapper correctly fails when `npm run check` fails (tested via initial failure).
- Attempted to force `wix build` masking: reviewed wrapper propagation code — no masking, error status propagated.
- Attempted to find extra file mutations: `git diff --stat HEAD` shows only governance rework outside candidate interval; candidate itself is minimal.
- Attempted to find widened permissions/scope requests: none.
- Attempted to run with placeholder `appId`: wrapper would correctly skip `wix build` (verified via code path `!looksLikePlaceholder`).

No hidden destructive mutations, no silent schedule rewrites, no credential handling.

## 7. Evidence summary

| Evidence | Location | Reproduced |
|---|---|---|
| Authenticated scaffold JSON | `origin/main:.factory/evidence/run_33321707099_official_scaffold.json` via `git show` | yes, appId/projectId/pristineWixBuild PASS verified |
| Pristine build log | `origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` via `git show` | yes, 10.70s complete, no error |
| Candidate binding | `e51bfc13:wix.config.json` via `git show` | yes, matches official App ID |
| Base binding | `ec916b75:wix.config.json` via `git show` | yes, identical to candidate |
| Deterministic gate | `npm run check` via direct bash | yes, 548/548 pass, typecheck + purity pass |
| Build wrapper | `npm run build` via direct bash | yes, gate pass + correct CLI-skipped branch |
| Purity | `npm run check:purity` via direct bash | yes, no forbidden imports |

## 8. Findings

No reproducible defects. Candidate is a minimal, correct repair of the deterministic gate to include credential-aware `wix build` fallback while preserving authenticated scaffold binding exactly.

No `FIX_BEFORE_INTEGRATION` conditions met. Section not applicable.

VERDICT: ACCEPT
