# Factory Lane Audit — Integration Candidate e3be155e5a3887fbf72333029c430e4c788b5c20

Base: ec916b75d5600e02d679d264648ac92333d721f1
Candidate: e3be155e5a3887fbf72333029c430e4c788b5c20
Date: 2026-08-31
Auditor: lane-auditor (independent, not builder)

## Scope
Audited exact diff ec916b75..e3be155e (git diff):
- src/platform/registration/index.ts (+7 re-exports)
- src/platform/registration/registrationBinding.ts (new, 110 lines)
- tests/platform/registration-binding.spec.ts (new, 311 lines)

Integration lane ownership verified: Wix CLI scaffold/project binding metadata and platform registration surface. No domain, dashboard, or billing semantics altered. No governance/orchestration/workflow files modified.

## Scaffold Authenticity — Official Generation Provenance
Reproduced via git show origin/main:.factory/evidence/... (no pipes):
- git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json
  {
    "schemaVersion": 3,
    "source": "authenticated official Wix existing-app scaffold",
    "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
    "projectId": "advanced-booking-rules",
    "projectType": "App",
    "wixCliVersion": "1.1.238",
    "generatorExit": 1,
    "projectAcceptedDespiteOptionalPostTaskFailure": true,
    "pristineWixBuild": "PASS",
    "scaffoldPackageSha256": "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd",
    "developmentSiteProvisioned": true
  }
- git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt
  Contains verified Astro/Wix build PASS (vite built 6864 modules, server built 10.70s, no scaffold errors beyond deprecation warnings). Confirms authenticated scaffold was not a hand-authored guess.

Candidate handling:
- wix.config.json remains gitignored (.gitignore line `wix.config.json`), never committed. wix.config.example.json committed with placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` only.
- registrationBinding.ts contains zero UUID-like strings, zero `@wix/` imports (verified via grep of file and via purity gate). Anti-fabrication test in candidate explicitly asserts `expect(contents).not.toMatch(/3e9ec3af/i)` and scans src/platform/registration/*.ts for UUID/SDK shapes — prevents hardcoding the official appId 3e9ec3af-001b-4684-a197-a5133677844d.
- No hand-fabricated identifiers. classifyProjectBinding requires positive evidence for LINKED; placeholders classified as UNLINKED. loadRealBindingFromRepoRoot returns FILE_NOT_FOUND gracefully when file absent (expected credential-free state).
Conclusion: Wix-owned binding provenance is authentic and candidate preserves it without inventing identifiers.

## Reproduction of Evidence and Tests
Executed deterministic checks (allowed bash without pipes):

1. git status — detached HEAD, no staged changes (candidate isolated).
2. git diff ec916b75..e3be155e — reproduced exact 428 insertions.
3. Read src/platform/registration/projectConfig.ts, registrationBinding.ts, exampleProjectConfig.ts, wix.config.example.json, .gitignore, README.md — verified classifier logic, placeholder handling, gitignore rule, documentation.
4. npm ci — added 47 packages, no blocking errors.
5. npm run typecheck — PASS (tsc --noEmit).
6. npm run check:purity — PASS (no @wix/ imports under src/domain, src/billing/pure, src/platform/http, webhooks, validation-plugin, composition, registration).
7. npm run build (runs typecheck + purity + vitest run --config src/platform/vitest.config.ts) — PASS
   - Test Files 50 passed
   - Tests 568 passed (includes tests/platform/registration-binding.spec.ts 20 tests)
   - Detailed FINDING-1 tests: repoRootFromImportMeta resolves to repo root, contains package.json and src/, not src/ (traversal bug fixed).
   - FINDING-2 tests: FILE_NOT_FOUND for nonexistent config, temp-dir LOADED flow, MISSING_FILE for null, gitignore assertion.
   - FINDING-3 tests: isValidAppIdStructure accepts/rejects correctly, looksLikeScaffoldPlaceholder, EXAMPLE_PROJECT_CONFIG placeholder assertions, assertLinkedWithValidAppId throws/passes, real-file structural skip.
   - FINDING-4 tests: no UUID/SDK shapes in registration sources, byte-equality pin for wix.config.example.json vs serializeExampleProjectConfig(), wix.config.example.json classified not LINKED.

All reproduction confirms candidate's claims without reliance on WIX_API_KEY or live Wix site.

## Detailed Findings
- FINDING-1 (HIGH): repoRootFromImportMeta correctly uses `resolve(fileURLToPath(new URL('../../..', importMetaUrl)))` — three parent traversals from src/platform/registration/ to repo root. Comment documents bug (two levels landed on src/). Tests prove root equality and package.json/src presence, and that dir name != src. Fixed.
- FINDING-2 (HIGH): loadRealBindingFromRepoRoot handles absent file via existsSync check returning FILE_NOT_FOUND, handles READ_ERROR, otherwise LOADED with classifyProjectBinding. Tests verify graceful handling and confirm .gitignore contains `^wix.config.json$`. Fixed.
- FINDING-3 (MEDIUM): isValidAppIdStructure validates string non-empty and rejects <...>, {{...}}, ${...}, and tokens GENERATED-BY/REPLACE/PLACEHOLDER/TODO/TBD/YOUR_ case-insensitively. assertLinkedWithValidAppId asserts LINKED + structure, never a specific account value. Tests cover structural acceptance/rejection, EXAMPLE_PROJECT_CONFIG placeholder, and real-file structural assertion without hardcoding. Fixed.
- FINDING-4 (LOW): Anti-fabrication tests contain real expect() assertions (files.length >0, offenders == [], UUID false, SDK false, byte-equality). Verified in execution. Fixed.

No new defects observed:
- No @wix/ imports in protected paths, no UUID fabrication, no secrets, no destructive schedule rewrites, no lane boundary crossing.
- Exports re-added via index.ts are consistent with existing module surface.
- TypeScript types correct (BindingLoadResult discriminated union, ProjectLinkage assertion).

## Risk Assessment
- Pre-existing wix.config.json absent on fresh checkout is expected; candidate handles it correctly (FILE_NOT_FOUND).
- Scaffold authenticity external prerequisite remains narrow and correctly documented (T-VP0), not a product defect.

## Verdict
All four prior BLOCKING findings are remediated with passing deterministic tests, purity, typecheck, and build. Scaffold provenance is authenticated official generation, not hand-authored. No reproducible defects remain in candidate.

VERDICT: ACCEPT
