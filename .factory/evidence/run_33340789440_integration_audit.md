# Factory Lane Audit — Integration Candidate 84e7907a2755a75ec2680f2beeaca9f0a6e1f402

**Candidate:** `84e7907a2755a75ec2680f2beeaca9f0a6e1f402` (commit message: candidate(integration): generation 74)
**Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Lane:** Wix Integration (src/platform/** ownership)
**Auditor role:** integration-auditor (read-only, independent; not builder)
**Date:** 2026-08-30

## Scope and method

- Audited exact diff `git diff ec916b75..84e7907` — 3 files, 80 insertions, 7 deletions. No other file changed.
- Reproduced all evidence independently via allowed `git show` and `npm` commands; did not trust builder claims.
- Verified scaffold authenticity via authenticated official-scaffold provenance on `origin/main` (`git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` and `run_33321707099_official_scaffold_pristine_build.txt`).
- Re-ran deterministic gates: `npm ci`, `npm run typecheck`, `npm run check:purity`, `npm run check` (vitest), `npm run build`.

## Diff summary

| File | Change |
|---|---|
| `src/platform/registration/scaffoldPrerequisites.ts` | `externalBlockerStatement()` now accepts optional `ProjectLinkage`; when `status === 'LINKED'` returns new 4-sentence statement acknowledging real binding and listing remaining empirical gates T-VP0, T-VP1–T-VP5, dev-site binding. Without linkage or non-LINKED, returns prior “No linked Wix CLI project exists…” wording. No identifier embedded. |
| `src/platform/registration/README.md` | Documents new `externalBlockerStatement(linkage?)` signature and LINKED vs not-LINKED dispatch. |
| `tests/platform/registration-surface.spec.ts` | Adds coverage for new LINKED path (checks contains LINKED/T-VP0/T-VP1/empirical gates, not-contains “No linked”, not-contains scaffold command as blocker, identifier-free) and end-to-end `classifyProjectBinding`→`externalBlockerStatement` flow. |

No change to `wix.config.json`, `wix.config.example.json`, `extensions.ts`, `src/platform/registration/projectConfig.ts`, or any domain/billing/dashboard lane.

## Wix-owned scaffold / binding authenticity (critical)

**Official provenance on `origin/main`:**

```
git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json
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

```
git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt
  → vite/astro build completed successfully in 10.70s, “Complete!”, 6864 modules, no errors beyond deprecation warnings.
```

- Source is explicitly `authenticated official Wix existing-app scaffold`; `pristineWixBuild: PASS` reproduced in build log.
- **Binding preservation:** `git show ec916b75:wix.config.json` and `git show 84e7907:wix.config.json` and `git show HEAD:wix.config.json` are identical:
  ```json
  { "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
  ```
  Matches official `appId` byte-for-byte. Candidate does not modify, regenerate, or hand-author `wix.config.json`.

- **No hand-authored guess:** `wix.config.example.json` remains placeholder template `{"projectType":"app","appId":"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"}`; `classifyProjectBinding` unchanged and still requires non-placeholder `appId` for LINKED. Anti-fabrication surface (`src/platform/registration/*.ts`, `extensions.ts`, `wix.config.example.json`) was verified to contain zero UUID-like strings via committed test, and candidate’s new code adds no identifier. `externalBlockerStatement` LINKED branch was inspected line-by-line: it mentions `wix.config.json classifies as LINKED` but never interpolates `linkage.appId` or any secret. Test explicitly asserts `UUID_LIKE.test(statement) === false`.

- **Gitignore protection:** `.gitignore` still contains `^wix\.config\.json$` and reference to `wix.config.example.json`, verified via `git show HEAD:.gitignore`.

- **Extensions anchor:** `extensions.ts` remains empty-by-design (`EXTENSIONS: []` frozen), not fabricated.

**Conclusion:** Scaffold/binding comes from authenticated official generation, not hand-authored values. Candidate preserves it and improves reporting honesty when LINKED.

## Lane ownership and contract compliance

- All edited production files under `src/platform/registration/` — within `integration-builder` allowlist (`src/platform/**`). No edits to `src/domain/**`, `src/billing/**`, `src/dashboard/**`, governance, or workflows.
- No `@wix/*` imports added; `src/platform/purity/check-purity.mjs` passed on HEAD and under `npm run check:purity`: “Purity gate passed: no '@wix/' imports under ... src/platform/registration.”
- No secrets, API keys, or account identifiers committed (`.factory/evidence` shows `secretsPersisted: false`; `wix.config.json` gitignored; no `~/.wix` access).
- No `PREVIEW_GATED` or `UNSUPPORTED` capability claimed; README and code explicitly state gates T-VP0–T-VP5 remain open and `reschedule` best-effort, consistent with `docs/WIX_TECHNICAL_CONTRACT.md` §10/§12.
- Diff-and-confirm, idempotency, revision, and §9 mutation safety not affected (orchestrator unchanged).
- Lane-boundary respected: billing/domain/dashboard semantics untouched.

## Deterministic verification — reproduced

- `npm ci` — succeeded (47 packages).
- `npm run typecheck` (`tsc --noEmit`) — PASS (zero errors).
- `npm run check:purity` — PASS.
- `npm run check` (typecheck + purity + vitest) — PASS: 49 test files, 550 tests passed. Includes the 3 new LINKED-path tests (2 in `registration-surface.spec.ts` plus existing 19). Purity-gate fixture failures inside `tests/domain/purity.spec.ts` and `tests/platform/purity-gate.spec.ts` are expected negative fixtures, logged as `Purity gate passed` then expected fixture violations — not real failures.
- `npm run build` (`npm run check`) — PASS with identical test results.
- `npm test -- --run` — PASS (same 550).

No flake, no silent destructive rewrite.

## Negative and edge-case checks

- Verified placeholder detection not bypassed: `looksLikeScaffoldPlaceholder` unchanged; `wix.config.example.json` still classifies as UNLINKED (pinned by existing test).
- Verified LINKED statement is identifier-free, does not leak `appId` even when caller passes LINKED object containing it.
- Verified UNLINKED path still contains `wix.config.json`, `npm create @wix/new@latest app`, `T-VP0`, `fabricat`, `wix.config.example.json`.
- Verified `classifyProjectBinding` with real JSON `{"projectType":"app","appId":"3e9ec3af-...-7844d"}` returns LINKED and feeding it to `externalBlockerStatement` yields LINKED wording, not “No linked”.

## Findings

No reproducible defect blocking integration found. Change is narrow, truthful, tested, and preserves official scaffold binding.

- Strength: When a real binding exists, live-QA now correctly reports empirical gates remaining instead of falsely claiming “No linked Wix CLI project exists.”
- No fabrication, no scope widening, no governance modification, no secret exposure.

## Verdict

VERDICT: ACCEPT
