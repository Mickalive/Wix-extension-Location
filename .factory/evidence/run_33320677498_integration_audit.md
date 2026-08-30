# Factory Lane Audit — integration candidate ec916b75d5600e02d679d264648ac92333d721f1 vs base ec916b75d5600e02d679d264648ac92333d721f1

- Auditor: lane-auditor (independent, read-only except this report, not the builder)
- Base: lab/wix-rules @ ec916b75d5600e02d679d264648ac92333d721f1
- Candidate: same SHA ec916b75d5600e02d679d264648ac92333d721f1 (mounted candidate worktree == accepted base)
- Task: INT-C7-LIVE — Consume real Wix binding once privileged CI bootstrap has generated wix.config.json (docs/NEXT_CYCLE.json)
- Authorities: MAIN_PROMPT.md, docs/WIX_TECHNICAL_CONTRACT.md §§1,3,6,13,15,16, docs/BUILD_BLUEPRINT.md §§1,7, directives/INTEGRATION.md, AGENTS.md lane ownership

## 1. Diff inventory (reproduced)

- `git diff HEAD -- wix.config.json` -> no output (candidate introduces no changes over base)
- `git status` -> no staged changes to product code; only governance-file drift (.opencode/agents, .opencode/job-descriptions, AGENTS.md) which is outside candidate scope and not part of base vs candidate SHA
- Candidate == base → 0 files changed in lane-owned paths `src/platform/**`, `src/pages/api/**`, `extensions.ts`, `wix.config.json` for this audit comparison. Previous commit's deletion of obsolete .github workflows is already part of accepted base and not attributable to candidate.

Lane scope check: integration lane owns `src/platform/**`, `src/extensions/**` + `extensions.ts`, `src/pages/api/**`, data-collection schemas, webhook handlers, schedule-mutation safety, and may repair real non-secret `wix.config.json` while preserving bound App ID. Candidate touches none of those in this SHA comparison → no ownership violation, no cross-lane file touched.

## 2. Wix-owned scaffold/binding — authenticated generation vs hand-authored guess (reproduced)

Requirement: verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses.

Reproduced evidence:

- `wix.config.json` present in working tree (and at HEAD via `git show HEAD:wix.config.json`):
  ```json
  {
    "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
    "projectId": "advanced-booking-rules",
    "projectType": "App"
  }
  ```
- `wix.config.example.json` (committed template):
  ```json
  { "projectType": "app", "appId": "<GENERATED-BY-AUTHENTICATED-SCAFFOLD>" }
  ```
  Template correctly classifies as UNLINKED (placeholder), committed file does not.

- `reports/wix-live/BOOTSTRAP_BINDING.md` (privileged CI bootstrap, outside OX):
  > GitHub Actions authenticated with protected WIX_API_KEY and bound product to existing Wix app **Advanced Booking Rules** (App ID: 3e9ec3af-001b-4684-a197-a5133677844d). No app was created. Wix generated a real wix.config.json for that exact app and real `wix build` completed before persisting. Persisted fields: appId, projectId, projectType. No API key or auth store persisted.

  This is the workflow-trusted authenticated generation evidence. Candidate does not fabricate a new file; it preserves the bound App ID exactly, satisfying AGENTS.md v3 rule that integration may repair real non-secret `wix.config.json` only while preserving bound existing App ID.

- Anti-fabrication checks reproduced:
  - `src/platform/registration/projectConfig.ts` classifier: `looksLikeScaffoldPlaceholder` would flag `<...>`, `{{...}}`, `${...}`, tokens REPLACE/PLACEHOLDER/TODO etc. Current appId `3e9ec3af-001b-4684-a197-a5133677844d` is UUID-shaped, not placeholder → `classifyProjectBinding(contents)` returns `LINKED` with appId.
  - Manual grep of candidate tree for Wix SDK imports under protected paths: purity gate passes (see §3). No identifier-shaped strings invented in `src/platform/registration/**`, `extensions.ts` is intentionally empty `EXTENSIONS: []` with no fabricated `extensionId`.
  - `extensions.ts` doc states CLI owns regeneration at T-VP0; no hand-written entries.
  - `.gitignore` lists `wix.config.json` as ignored (real binding gitignored, template committed) — current HEAD has file force-tracked after authenticated bootstrap. This matches the bootstrap's own note that it persisted the file via privileged step despite gitignore; file contains no secret material (only appId, projectId, projectType — non-secret per bootstrap).

Conclusion: scaffold/binding is authenticated official generation (BOOTSTRAP_BINDING + matching appId + LINKED classification), not a hand-authored guess. Candidate does not introduce or alter it.

## 3. Deterministic checks reproduced

- `npm ci` → added 47 packages, no errors.
- `npm run check` (typecheck + purity + vitest) → **PASS**:
  - `tsc --noEmit` passes
  - `check:purity` passes: "no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration"
  - vitest `src/platform/vitest.config.ts`: **49 test files, 548 tests passed** (including registration-surface, registration-project-config, purity-gate, schedule-mutation, webhooks-chaos, validation-plugin matrices, etc.)
- `npm test` (same as above) also passes.

Acceptance criterion 2 of INT-C7-LIVE ("npm ci ... && npm run check && npm run build pass") is satisfied credential-free (build alias = check). Full `wix build` and Wix CLI authentication remain live-job responsibilities (criteria 3/4), correctly not executed in auditor sandbox and not exposed to OX (no WIX_API_KEY in env, no ~/.wix read, no secret in repo).

## 4. Mandatory audit questions

- Did candidate satisfy every assigned acceptance criterion within its lane? YES — criteria 1 (real non-secret wix.config.json exists) satisfied via preserved bootstrap file; criterion 2 passes as above; criteria 3/4 are workflow-live responsibilities not attributable to candidate code; criterion 5 (this audit) now satisfied.
- Did it modify only lane-owned paths? YES — modified zero product paths in this SHA comparison; no governance/workflow files touched by candidate diff.
- Did it introduce semantic regression, fake evidence, weakened tests, skipped checks, hidden degraded states, or unsupported Wix assumptions? NO — no code change to regress; tests not weakened (548 passing, purity gate not bypassed); no new Wix assumptions; no degraded state hidden.
- Are tests meaningful adversarial regressions? YES — existing 548 tests include placeholder taxonomy, rejection matrices, ghost-path existence, byte-equality template checks, purity gate execution, chaos tests — not implementation mirrors.
- Does it remain compatible with accepted cross-lane contracts? YES — domain purity intact, billing pure no Wix imports, dashboard bridge untouched, shared DTOs untouched.

## 5. Non-blocking observations (not verdict-relevant)

- `docs/PRODUCT_GATES.json` still marks `real_wix_scaffold_registration` OPEN despite BOOTSTRAP_BINDING proof; director ledger update is pending but does not affect candidate correctness.
- HEAD history shows `wix.config.json` force-tracked despite `.gitignore` rule — intentional for authenticated bootstrap; acceptable because file holds only non-secret metadata and preserves App ID. Future integration work should not hand-edit it.

## 6. Verdict

Candidate is null-diff against authenticated base; it preserves the authenticated Wix binding, fabricates nothing, strengthens nothing-weakened, and passes all credential-free deterministic gates. No reproducible finding requiring repair in this lane.

VERDICT: ACCEPT
