# Factory Lane Audit — Integration Candidate 71e2bc6290731c3997e42c00c59381129b1b23ac vs base ec916b75d5600e02d679d264648ac92333d721f1

## Scope
- Audited exact candidate SHA 71e2bc6290731c3997e42c00c59381129b1b23ac against accepted base ec916b75d5600e02d679d264648ac92333d721f1 as detached candidate, not builder.
- Lane claimed: Wix Integration (registration surface). Verified file set via `git diff --stat` between the two SHAs: 4 files — `src/platform/registration/README.md`, `src/platform/registration/exampleProjectConfig.ts`, `tests/platform/registration-project-config.spec.ts`, `wix.config.example.json`. No other lane files touched. Ownership check PASS — all paths under `src/platform/registration/**` and `wix.config.example.json` template, owned by integration per BUILD_BLUEPRINT §2.

## Scaffold / Binding Authenticity (Wix-owned provenance)
- Inspected authenticated official-scaffold provenance on `origin/main` via `git show`:
  - `origin/main:.factory/evidence/run_33321707099_official_scaffold.json` — schemaVersion 3, source "authenticated official Wix existing-app scaffold", appId `3e9ec3af-001b-4684-a197-a5133677844d`, projectId `advanced-booking-rules`, projectType `App`, wixCliVersion `1.1.238`, pristineWixBuild `PASS`, scaffoldPackageSha256 `1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd`, developmentSiteProvisioned true, secretsPersisted false.
  - `origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — full `wix build` log, Astro/Cloudflare adapter, vite build 6864 modules, `✓ Completed`, `Server built in 10.70s` `Complete!` — no errors.
  - `reports/wix-live/BOOTSTRAP_BINDING.md` — confirms GitHub Actions authenticated with protected Wix API key, bound to existing app Advanced Booking Rules App ID 3e9ec3af-001b-4684-a197-a5133677844d, no app created, real `wix build` succeeded before binding persisted, persisted fields appId/projectId/projectType, no credential persisted.
- Reproduced real binding via `git show` for both SHAs:
  - `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` → `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`
  - `git show 71e2bc6290731c3997e42c00c59381129b1b23ac:wix.config.json` → identical, preserved. Candidate does NOT rewrite `wix.config.json` (diff shows zero changes to that file). No hand-authored guess, no App ID mutation, consistent with AGENTS.md prohibition on fabricating account-specific identifiers.
  - `git show` for `wix.config.example.json` at base: 2 fields (projectType app, appId placeholder). At candidate: 3 fields with added `projectId` placeholder `<PROJECT-SLUG>`. Placeholder shape correctly flagged as UNLINKED.
- Verdict on provenance: PASS — Wix-owned scaffold/binding derives from authenticated official generation, not hand-authored guesses. Evidence is concrete, persisted on origin/main, and matches live `wix.config.json`.

## Candidate Diff Analysis (reproduced)
- `git diff ec916b75d5600e02d679d264648ac92333d721f1 71e2bc6290731c3997e42c00c59381129b1b23ac` reproduced exactly:
  - README.md: removes UQ4 quarantined wording, replaces with observed scaffold truth: exactly three fields projectType/projectId/appId, values App/UUID/slug, loader tolerates unknown extra fields (C4 drift discipline). References BOOTSTRAP_BINDING.md and gate T-VP0. No claim of registration, no assertion of live behavior beyond observed fields.
  - `exampleProjectConfig.ts`: adds `SCAFFOLD_PLACEHOLDER_PROJECT_ID = '<PROJECT-SLUG>'`, extends `EXAMPLE_PROJECT_CONFIG` to include projectId, updates `exampleProjectConfigIsUnlinkedByConstruction` to require both placeholders, updates header comment to OBSERVED SCAFFOLD SHAPE. Serialization remains deterministic `JSON.stringify(..., null, 2) + "\n"`. Purity: no I/O, no @wix imports.
  - `tests/platform/registration-project-config.spec.ts`: imports new placeholder, adds test `classifies the real committed wix.config.json as LINKED with the scaffolded appId` that reads `wix.config.json` if present and asserts LINKED with appId `3e9ec3af-001b-4684-a197-a5133677844d` and presence of projectType/projectId; updates `carries only the documented fields` assertion to expect `['appId','projectId','projectType']`. Skips gracefully when file absent (fresh clone). No mock, no invented evidence.
  - `wix.config.example.json`: byte-identical to `serializeExampleProjectConfig()` after change, still UNLINKED.
- No governance violation: does not modify `MAIN_PROMPT.md`, workflows, agent fiches, or `opencode.json` beyond allowed lane files. No secret exposure. No external network dependency.
- Scope hygiene: No `SCOPE.*` changes, no permission escalation, no extension registration claim.

## Deterministic Checks Reproduced
- `npm ci` → PASS (47 packages, no fatal).
- `npm run check` → PASS:
  - `tsc --noEmit` PASS (after ci, previously missing @types/node resolved).
  - `node src/platform/purity/check-purity.mjs` → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.` PASS. Candidate adds no Wix imports.
  - `vitest run --config src/platform/vitest.config.ts` → 49 test files, 549 tests PASS (0 failed), including 14 tests in `registration-project-config.spec.ts` (the new LINKED real-config test passes against local wix.config.json). Duration 7.87s.
- `git status` shows detached HEAD with unrelated untracked agent files from runner, not part of candidate diff; candidate diff isolated via SHA range is clean.
- Purity gate negative test (fixture `violation-static.ts` etc.) correctly detected as expected within `purity-gate.spec.ts` — included test output `PURITY GATE FAILED: 4 forbidden...` is the intentional detection fixture, not a real violation; overall suite PASS confirms gate enforces invariants.

## Adversarial Findings Attempt
- Searched for fabricated IDs, invented scopes, bypass of validation, silent schedule rewrite, external DB, AI dependency — none present. Diff is documentation + placeholder alignment.
- Checked placeholder detection: `looksLikeScaffoldPlaceholder` covers `<...>`, `{{...}}`, `${...}`, tokens GENERATED-BY etc. Both placeholders `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` and `<PROJECT-SLUG>` correctly flagged (second via `<...>` shape). Candidate's `exampleProjectConfigIsUnlinkedByConstruction` correctly guards both.
- Checked drift tolerance: `classifyProjectBinding` still tolerates unknown fields (`linkableAppId` only checks appId), consistent with Contract §11 C4.
- Checked that example template remains UNLINKED: test `classifies as UNLINKED by the same loader` still PASS.
- No evidence of widened scope or fix without test: new test pins real config linkage, regression coverage added.

## Conclusion
Candidate is a minimal, accurate alignment of the committed shape template and documentation to the observed authenticated scaffold (3-field wix.config.json). It preserves the bound App ID verbatim, uses only placeholders for committable artifacts, adds regression tests, passes typecheck, purity, and all 549 unit tests. Provenance is authenticated official generation, not hand-authored.

VERDICT: ACCEPT
