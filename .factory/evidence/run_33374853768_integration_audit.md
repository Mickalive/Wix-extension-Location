# Factory Lane Audit — Integration Candidate d356071993a45400e0621dcdbf746e231e037eab

**Base:** `ec916b75d5600e02d679d264648ac92333d721f1` (accepted `lab/wix-rules`)
**Candidate:** `d356071993a45400e0621dcdbf746e231e037eab` (`candidate(integration): generation 138`)
**Audit Date:** 2026-08-31
**Auditor Role:** lane-auditor (adversarial, read-only except this report)
**Scope:** Wix Integration lane only — scaffold/binding provenance, platform adapters, `wix.config.json` safety, lane ownership

## 1. Candidate Provenance (reproduced)

- `git show --stat HEAD` confirms candidate commit `d356071993a45400e0621dcdbf746e231e037eab` with 6 files changed, 63 insertions, 20 deletions.
- `git diff ec916b75d5600e02d679d264648ac92333d721f1..d356071993a45400e0621dcdbf746e231e037eab --stat` matches the same 6 files; no other files in candidate delta.
- Working tree verified on detached HEAD at candidate SHA; no merge or rebase artifacts.
- No `wix.config.json` committed in candidate (`git show --stat HEAD` lists no `wix.config.json`; `git diff --name-only` and `.gitignore` confirm `wix.config.json` remains ignored).

## 2. Wix-Owned Scaffold / Binding Authenticity

**Requirement:** For integration, verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses. Candidate must not invent identifiers.

### 2.1 Authenticated Official Scaffold Evidence (on `origin/main`)

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

Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`: pristine build log shows `wix build` completed successfully (`Server built in 10.70s`, `Complete!`, vite client/server built without error; exit `PASS`).

Interpretation:
- Evidence is authenticated official generation (existing-app scaffold, Wix CLI 1.1.238, appId `3e9ec3af-001b-4684-a197-a5133677844d`).
- Observed shape from evidence: `projectType`, `appId`, `projectId` present. This resolves prior UQ4 partially.
- `pristineWixBuild: PASS` and `secretsPersisted: false` satisfy T-VP0 cleanliness.

### 2.2 Candidate Alignment — Does It Hand-Author or Reflect Evidence?

Candidate diff (reproduced via `git show HEAD` and `git show HEAD:src/platform/registration/...`):

- `src/platform/registration/exampleProjectConfig.ts`: adds `SCAFFOLD_PLACEHOLDER_PROJECT_ID = '<PROJECT-ID>'` and extends `EXAMPLE_PROJECT_CONFIG` to include `projectId` alongside `projectType: 'app'` and `appId: '<GENERATED-BY-AUTHENTICATED-SCAFFOLD>'`. Comments updated to state shape is “partially resolved by the first authenticated scaffold: the observed shape includes `projectType`, `appId`, and `projectId`.”
- `wix.config.example.json`: adds `"projectId": "<PROJECT-ID>"` (2-space JSON, trailing newline preserved).
- `src/platform/registration/projectConfig.ts`: comment update to reflect partially resolved UQ4; classifier logic **unchanged** — still requires positive `appId` via `looksLikeScaffoldPlaceholder`, tolerates unknown extra fields, no new identifier generation, no hard-coded appId.
- `src/platform/registration/README.md`: documentation updated to same partially-resolved wording; still declares `wix.config.json` as generated exclusively by `npm create @wix/new@latest app`, gitignored.
- `src/platform/registration/index.ts`: re-exports new placeholder constant.
- `tests/platform/registration-project-config.spec.ts`: updates key expectation to `['appId','projectId','projectType']` and adds two conditional tests for real `wix.config.json` when present (skip via `return` if file missing).

**Verdict on authenticity:**
- Candidate does **not** invent or commit a real `appId`/`projectId`. All values remain explicit scaffold-pending placeholders (`<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`, `<PROJECT-ID>`) which classifier correctly flags as `UNLINKED` (placeholder shapes `<...>` and token `GENERATED-BY`).
- The addition of `projectId` to the committed template accurately mirrors the authenticated scaffold evidence (which exposes `projectId: "advanced-booking-rules"`). This is not a guess; it is a minimal, evidence-backed shape correction. Classifier already tolerates extra fields, so existing installs with or without `projectId` remain correctly classified.
- No `wix.config.json` file is created, modified, or committed. `.gitignore` still lists `wix.config.json` (verified via `Read .gitignore` and `git diff --stat`). Anti-fabrication invariant preserved: “never derived or invented in CI.”
- Minor note: evidence records `projectType: "App"` (capital A) while template uses `"app"` lowercase. Candidate follows documented headless shape and prior template (`"app"`). Since classifier does not validate `projectType` value and evidence confirms field existence, this case difference is cosmetic and not a blocking fabrication. No hard claim about case sensitivity is made.

**Provenance outcome:** PASS — scaffold binding derives from authenticated official generation; template update is faithful to evidence, not a hand-authored guess.

## 3. Lane Ownership & Scope

- All touched files lie under `src/platform/registration/` (`README.md`, `exampleProjectConfig.ts`, `projectConfig.ts`, `index.ts`) plus `wix.config.example.json` and its registration test — within Wix Integration lane ownership (scaffold/project metadata, platform adapters).
- No changes to `src/domain/**`, `src/billing/**`, `src/dashboard/**`, `src/shared/**`, or `docs/WIX_TECHNICAL_CONTRACT.md`. Ownership boundaries respected.
- `wix.config.json` repair prohibition respected: no mutation of real binding file.

## 4. Functional Correctness (reproduced)

- `src/platform/registration/projectConfig.ts` logic unchanged except comments: `looksLikeScaffoldPlaceholder` (empty, `<...>`, `{{...}}`, `${...}`, tokens `GENERATED-BY`, `REPLACE`, `PLACEHOLDER`, `TODO`, `TBD`, `YOUR_` case-insensitive), `linkableAppId` requiring non-placeholder string `appId`, `classifyProjectBinding` returning `MISSING_FILE` / `UNPARSEABLE` / `UNLINKED` / `LINKED` — all correctly implemented and pure (no `@wix/*` imports, no I/O).
- `exampleProjectConfig.ts` remains pure: `Object.freeze`, deterministic `JSON.stringify(..., null, 2) + "\n"`, `exampleProjectConfigIsUnlinkedByConstruction` correctly detects placeholder `appId`.
- `wix.config.example.json` byte-identical to `serializeExampleProjectConfig()` — enforced by existing test `is byte-identical to the module serialization`.

## 5. Deterministic Checks Reproduced (no fixes applied)

Executed on candidate checkout:

- `npm ci` — 47 packages, no script errors.
- `npm run typecheck` (`tsc --noEmit`) — PASS (exit 0, no errors) after `npm ci`.
- `npm run check:purity` — PASS: “no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.”
- `npm run build` (`npm run check` → `typecheck` + `check:purity` + `vitest run --config src/platform/vitest.config.ts`) — PASS:
  - 49 test files, 550 tests all passed.
  - `tests/platform/registration-project-config.spec.ts` now 15 tests (was 13), including updated template key check and two conditional scaffold-binding tests that correctly skip (via `try readFileSync ... catch return`) when `wix.config.json` absent — appropriate because file is gitignored and only exists post-scaffold. Existing 13 tests still assert `UNLINKED` for placeholders, `LINKED` only for real-looking `appId`, drift tolerance, byte-equality pin, and placeholder detection.
  - No type errors, no purity violations, no build failures.

## 6. Security / Idempotency / Schedule Safety

- No secrets in diff; new `projectId` placeholder contains no secret material; added test explicitly asserts `wix.config.json` (when present) contains no `secret`, `password`, `token`, `api_key`, `apikey` substrings.
- Idempotency and schedule-mutation safety not affected; candidate does not touch `src/platform/schedule-mutation/**`, webhooks, or adapters.
- `extensions.ts` not modified; extensions inventory unchanged.

## 7. Findings

No reproducible blocking findings. Candidate:

- Accurately reflects authenticated scaffold evidence without inventing identifiers.
- Preserves `wix.config.json` gitignore, anti-fabrication classifier, and drift tolerance.
- Passes all deterministic gates credential-free.
- Respects lane ownership and does not widen scope.

Observation (non-blocking): Template `projectType` value `"app"` vs evidence `"App"` case difference. Since `projectType` is not part of the `LINKED` decision and evidence confirms field presence, this does not constitute fabrication or misclassification. Future scaffolds could normalize case; classifier already tolerates both via extra-field tolerance and lack of strict enum check.

## 8. Audit Disposition

Independent reproduction of candidate diff, official scaffold provenance (`origin/main:.factory/evidence/...` via `git show`), and full `npm ci` / `typecheck` / `build` confirms integration lane requirements are met. No hand-authored binding guess, no secret exposure, no destructive rewrite.

VERDICT: ACCEPT
