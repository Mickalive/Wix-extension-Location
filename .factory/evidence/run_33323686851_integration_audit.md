# Factory Lane Audit — Integration Candidate 6f9aa898

**Candidate:** `6f9aa898e93e3c4d2914cc162449e86d78a85949` — `candidate(integration): generation 31`  
**Base:** `ec916b75d5600e02d679d264648ac92333d721f1` (`lab/wix-rules` pinned SHA)  
**Auditor model:** muse-spark-1.2-contributor-free (opencode/muse-spark-1.2-contributor-free)  
**Date:** 2026-08-30  
**Scope:** Exact integration candidate diff only; reproducible evidence; scaffold provenance via authenticated official generation.

---

## 1. Diff reproduction (candidate vs base)

```
git diff ec916b75d5600e02d679d264648ac92333d721f1..6f9aa898e93e3c4d2914cc162449e86d78a85949 --stat
 .gitignore | 1 +
 1 file changed, 1 insertion(+)

git diff ec916b75d5600e02d679d264648ac92333d721f1..6f9aa898e93e3c4d2914cc162449e86d78a85949
 + .astro/
```

Reproduced via `git show` for both SHAs and `git diff --stat HEAD`. No other tracked changes. Candidate touches only `.gitignore` (addition of `.astro/`). No changes to `src/domain/**`, `src/billing/**`, `src/dashboard/**`, `src/platform/**` (except leave-unchanged), `extensions.ts`, or `wix.config.*`.

## 2. Wix-owned scaffold / binding authenticity

Requirement: integration lane must preserve Wix-owned scaffold/binding from authenticated official generation, never hand-authored guesses. Reproduce provenance from `origin/main`.

Executed:
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` → fatal (deleted at `origin/main` tip `1fdf4c98`)
- `git show origin/main --stat` revealed tip deleted evidence (`AUDIT generation 32 run 33323279810` removed the three `run_33321707099_*` files)
- `git show origin/main~1:.factory/evidence/run_33321707099_official_scaffold.json` → recovered:
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
- `git show origin/main~1:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` → recovered Astro build log ending `Server built in 10.70s / Complete!` with PASS, confirming `pristineWixBuild: PASS`.

Verification against candidate binding:
- `git show HEAD:wix.config.json` and `git show ec916b75:wix.config.json` both:
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
Matches official scaffold `appId`/`projectId` exactly. No hand-fabricated or guessed identifier. Preservation rule satisfied.

Additional binding checks:
- `wix.config.example.json` remains unlinked placeholder (`<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`), correctly classified as `UNLINKED` by `src/platform/registration/projectConfig.ts` (tests pin this).
- `.gitignore` correctly lists `wix.config.json` as gitignored (real binding generated only by authenticated one-time scaffold `npm create @wix/new@latest app`, gate T-VP0). The file is tracked historically from base (pre-existing), candidate does not introduce or mutate it. Candidate preserves the bound App ID.
- `extensions.ts` remains intentionally empty `EXTENSIONS: readonly GeneratedExtensionEntry[] = Object.freeze([])` with documentation that entries originate only from authenticated scaffold (T-VP0). No fabricated `extensionId`.
- `src/platform/registration/README.md` and `validationExtension.ts` correctly derive deploymentUri/targets from single source of truth, document fallback channel, and avoid claiming registration.

Scaffold provenance: **AUTHENTICATED** — official existing-app scaffold via `origin/main~1` evidence, not hand-authored.

## 3. Lane ownership

Integration lane owns scaffold/project metadata, platform adapters, extension/backend transport, persistence integration, webhooks, idempotency, schedule-mutation safety.

Candidate change (`+ .astro/` in `.gitignore`) is project metadata (Astro build output directory per Wix Astro adapter). It does not modify:
- domain semantics (`src/domain/**`)
- dashboard UX (`src/dashboard/**`)
- billing policy (`src/billing/**`)
- It also does not claim to register extensions or mutate schedules.

No cross-lane boundary violation.

## 4. Deterministic checks reproduced

Executed independently (no reliance on builder claims):

- `npm ci` → `added 47 packages` — success.
- `npm run check` → `typecheck` PASS, `check:purity` PASS (`Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration`), `vitest run --config src/platform/vitest.config.ts` → **49 test files, 548 tests PASS** (6.0s). Full log captured above, including generated purity positive-control failures as expected within `purity-gate.spec.ts`.
- No `wix build` required per `package.json: build = npm run check`; scaffold pristine Wix build already proven PASS in official evidence.

## 5. Security / destructive-write / scope hygiene

- No secrets committed (`.env*`, `.wix/` remain gitignored).
- No `WIX_API_KEY` exposure.
- No deletion of customer configuration.
- No schedule mutation code changed; Contract §9 gates unaffected.
- Addition of `.astro/` to `.gitignore` is additive, reversible, and prevents committing generated Astro output. Low risk, consistent with scaffold's Astro adapter.

## 6. Observations (non-blocking)

- `wix.config.json` is tracked in git despite `.gitignore` entry (inherited from base). This is pre-existing accepted state, not introduced by candidate. Candidate preserves correct authenticated `appId`. Future Director hygiene may consider `git rm --cached` if policy requires fully untracked, but not a candidate-introduced defect.
- Official-scaffold evidence files were deleted at `origin/main` tip `1fdf4c98`; provenance still recoverable via `origin/main~1`. Auditor retrieved authenticated source for this report.
- Candidate diff is minimal (single `.gitignore` line). No new product capability, but also no regression; integration lane safety and determinism preserved.

## 7. Verdict rationale

Candidate satisfies integration lane ownership, preserves authenticated official scaffold binding verbatim, introduces no hand-fabricated Wix identifiers, makes no out-of-scope semantic changes, and passes all reproduced deterministic checks. No reproducible finding warrants FIX.

VERDICT: ACCEPT
