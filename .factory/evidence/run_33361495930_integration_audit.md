# Factory Lane Audit — Integration Candidate be6c0fb267d4042d065bbde7472c60457ea28953 vs base ec916b75d5600e02d679d264648ac92333d721f1

## Role and Scope
- Auditor model: muse-spark-1.2-contributor-free (opencode/muse-spark-1.2-contributor-free) — not the builder.
- Candidate audited: `be6c0fb267d4042d065bbde7472c60457ea28953` ("candidate(integration): generation 110")
- Accepted base: `ec916b75d5600e02d679d264648ac92333d721f1`
- Lane: Wix Integration — owns `src/platform/**`, scaffold/project metadata, adapters, transport, persistence, webhooks, idempotency, schedule mutation safety (AGENTS.md).
- Audit authority: exact candidate SHA only, read-only, no fixes. Report writable only to `reports/factory_lane_audit.md`.

## Evidence Reproduction Performed
- `git show` for candidate and base diff, stat, and file contents (no pipes/wrappers).
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` and `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` inspected with `git show` per instruction.
- Read `wix.config.json`, `src/platform/registration/binding.ts`, `src/platform/registration/projectConfig.ts`, `src/platform/registration/index.ts`, `tests/platform/registration-binding.spec.ts`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`.
- Grep for `wix.config.json` and `@wix/` references across repo.
- Ran `npm ci`, `npm test -- tests/platform/registration-binding.spec.ts`, and `npm run build` (which runs `tsc --noEmit`, `check:purity`, and full Vitest suite).

## Scaffold Authenticity — Integration Binding Provenance (Critical Gate)
- **Official scaffold provenance exists on `origin/main`**: `.factory/evidence/run_33321707099_official_scaffold.json` returned (via `git show`):
  ```json
  {"schemaVersion":3,"source":"authenticated official Wix existing-app scaffold","appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App","createNewVersion":"0.0.105","wixCliVersion":"1.1.238","generatorExit":1,"projectAcceptedDespiteOptionalPostTaskFailure":true,"pristineWixBuild":"PASS","developmentSiteProvisioned":true,"secretsPersisted":false}
  ```
  Pristine build log (`run_33321707099_official_scaffold_pristine_build.txt`) shows successful Wix Astro build completing in ~10.7s, `✓ Completed`, with no scaffold failure masking project validity.

- **Working tree binding matches official provenance**: `wix.config.json` on disk contains exactly `appId 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId advanced-booking-rules`, `projectType App` — byte-identical to official evidence. No secret fields, no placeholder, no invented IDs.

- **Candidate does NOT hand-author or mutate `wix.config.json`**: `git diff ec916b..be6c0fb --stat` shows 3 files only: `src/platform/registration/binding.ts` (new), `src/platform/registration/index.ts` (re-export), `tests/platform/registration-binding.spec.ts` (new). Zero changes to `wix.config.json`, `package.json`, `extensions.ts`, `.gitignore`, or any scaffold-generated artifact. Candidate preserves the bound App ID per AGENTS.md lane rule ("may repair the real non-secret wix.config.json only while preserving the bound existing App ID" — candidate makes no repair, so preservation holds).

- **Loader is provenance-faithful, not fabricating**: `binding.ts` is documented as SINGLE RUNTIME ENTRY POINT, never fabricates/defaults/invents identifiers. It delegates all validation to `classifyProjectBinding` (pure classifier already tested, tolerates drift per UQ4/C4), returns discriminated `BindingResult` with explicit `MISSING_FILE`/`UNPARSEABLE`/`UNLINKED` states, and throws typed `BindingNotLinkedError` carrying full `ProjectLinkage` when required. Verified source contains no hardcoded UUIDs, no default appId strings, no `@wix/*` imports.

## Candidate Change Analysis
- **In-scope for integration lane**: `src/platform/registration/binding.ts` provides `loadProjectBinding`, `loadProjectBindingFromPath`, `loadProjectBindingFromContents`, `requireLinkedBinding`, `BindingNotLinkedError`, `BINDING_FILENAME`. This is platform adapter code (filesystem I/O on `wix.config.json`) — explicitly allowed per Blueprint §1 (`src/platform/registration`) and AGENTS.md. No domain semantics (`src/domain/**`), billing policy, or dashboard UX touched.
- **No cross-lane widening**: `src/platform/registration/index.ts` only adds re-exports and comment noting binding module as sole reader. No `@wix/` import introduced, no domain/billing import.
- **Anti-fabrication discipline upheld**: File header explicitly cites BOOTSTRAP_BINDING.md, Technical Contract §16, gate T-VP0. Implementation:
  - `loadProjectBindingFromPath` catches `readFileSync` errors and classifies as `MISSING_FILE` via `classifyProjectBinding(null)`.
  - `loadProjectBindingFromContents` handles `null` and delegates to classifier.
  - `LINKED` requires `classifyProjectBinding` to return `LINKED` with real `appId` (placeholder detection via `looksLikeScaffoldPlaceholder` in `projectConfig.ts`).
  - No fallback UUID, no TODO/PLACEHOLDER acceptance.

## Purity and Build Verification
- **Purity gate**: `npm run check:purity` passes. Binding module imports `node:fs`, `node:path`, `node:url` only. Comment correctly notes it lives under `src/platform/registration/` which is under the `@wix/` import gate, but only `@wix/*` specifiers are forbidden — filesystem I/O is allowed for platform adapters. Manual grep for `@wix/` in `src/platform/registration/binding.ts` found zero live imports (only JSDoc prose).
- **Typecheck**: `tsc --noEmit` passes (via `npm run build`).
- **Full test suite**: `npm run build` runs `vitest run` over 50 test files, 570 tests — all passed (including 22 new binding tests). Output reproduced above.
- **Binding-specific tests**: `npm test -- tests/platform/registration-binding.spec.ts` passed 22/22:
  - Real `wix.config.json` exists, contains valid JSON, appId not placeholder, classifies LINKED via `loadProjectBinding` and `requireLinkedBinding` with expected appId `3e9ec3af-001b-4684-a197-a5133677844d` and `projectId`/`projectType`.
  - Missing file → `MISSING_FILE`, invalid JSON → `UNPARSEABLE`, placeholder appId → `UNLINKED`, missing appId → `UNLINKED`.
  - Drift tolerance: extra field tolerated, source discrimination `disk` vs `provided`.
  - `requireLinkedBinding` throws `BindingNotLinkedError` with linkage detail containing `wix.config.json not found`.
  - Anti-fabrication: missing file does not embed UUID, idempotency on repeated calls, empty/array/null JSON → `UNPARSEABLE`.

## Lane Ownership and Contract Compliance
- Integration lane ownership satisfied: candidate touches only `src/platform/registration/**` and corresponding `tests/platform/registration-binding.spec.ts`. No violation of Rules (`src/domain` untouched), Dashboard (`src/dashboard` untouched), Billing (`src/billing` untouched).
- Technical Contract §16 (Human-owned prerequisites) and §15 (T-VP0) honored: candidate does not invent scaffold, does not bypass authenticated generation, exposes diagnostic `source` field for callers (platform adapters) to branch correctly.
- Blueprint §4 binding data flows preserved: binding result is typed discriminated union consumable by validation plugin / HTTP endpoints / schedule mutation orchestrator without duplicating file reads elsewhere.
- No secrets committed: `wix.config.json` remains gitignored, evidence files contain non-secret metadata only, `secretsPersisted: false` in official evidence.

## Negative Checks (Attempted Falsification)
- Searched for hand-authored `wix.config.json` creation in candidate diff — none.
- Searched for `@wix/` imports in new code — none.
- Verified `BINDING_FILENAME` equals `PROJECT_CONFIG_FILENAME` (`wix.config.json`) — consistent.
- Verified candidate does not weaken validation, bypass platform bridge, or alter billing tiers — no such code.
- Verified `extensions.ts` not hand-edited with guessed IDs — untouched in candidate.

## Findings
No blocking defects found. The candidate correctly consumes the authenticated official scaffold artifact, preserves the bound App ID, enforces anti-fabrication classification, passes typecheck/purity/build, and adds comprehensive deterministic tests without crossing lane boundaries. Scaffold provenance is independently reproducible via `git show origin/main:.factory/evidence/*`.

VERDICT: ACCEPT
