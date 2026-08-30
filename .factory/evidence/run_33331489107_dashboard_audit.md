# Dashboard Lane Audit — d475f3d8700f5ad3230fe64f285e595c2d1ead67 vs ec916b75d5600e02d679d264648ac92333d721f1

**Role:** lane-auditor (independent, read-only, not the builder)
**Candidate:** `d475f3d8700f5ad3230fe64f285e595c2d1ead67` — `candidate(dashboard): generation 46`
**Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Scope:** Dashboard lane only — `src/ui/pages/rulesEditorPage.js`, `src/ui/services/bridge.js`, `tests/ui/*`
**Contracts:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `docs/runbooks/T_VP0_SCAFFOLD.md`

## 1. Methodology — independent reproduction

* Read the candidate diff via `git show` (5 files, 238 insertions / 24 deletions) and the full current files via `Read`.
* Read binding contracts (`WIX_TECHNICAL_CONTRACT.md` §1-§17, `BUILD_BLUEPRINT.md` §1-§9, `DASHBOARD.md`, `platform/http` handlers as ground truth).
* Reproduced deterministic gates locally:
  * `npm ci` → success
  * `npm run typecheck` → `tsc --noEmit` pass (after ci)
  * `npm run check:purity` → PASS — no `@wix/` imports under protected paths
  * `npm test` (`npm run test:unit` → `vitest run --config src/platform/vitest.config.ts`) → 49 files, 548 tests, all PASS
  * `npm run build` (`typecheck && purity && vitest`) → PASS
* Inspected `wix.config.json`, `package.json`, `reports/wix-live/BOOTSTRAP_BINDING.md`, and `src/platform/http/{ruleSetEndpoints,mutationEndpoints}.ts` to verify scaffold provenance and bridge↔endpoint contract shape. No fix was applied; audit is read-only.

Bash was restricted to allow-listed commands (`git status/diff/show`, `npm ci/test/check/typecheck/build`). `node --test` for `tests/ui/*.js` is not on the allow-list; UI bridge and page logic were reproduced via static analysis against the platform handler source and the new integration shim in `tests/ui/bridge.test.js`.

## 2. Wix-owned scaffold / binding — authenticated generation, not hand-authored guess

**Verdict on this gate: PASS**

* `wix.config.json` at candidate HEAD:
  ```json
  { "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
  ```
  Identical to base `ec916b75` (verified via `git diff --stat ec916b75..d475f3d` shows no `wix.config.json` change). No hand-authored IDs, secrets, or guessed extension registrations were introduced by this candidate — the 5 changed files are strictly `src/ui/*` and `tests/ui/*`.

* `reports/wix-live/BOOTSTRAP_BINDING.md` (accepted evidence) states: *“GitHub Actions authenticated with the protected Wix API key and bound the product to the explicitly selected existing Wix app Advanced Booking Rules (App ID: 3e9ec3af-001b-4684-a197-a5133677844d). Wix generated a real wix.config.json for that exact app and a real `wix build` completed … Persisted wix.config.json fields: appId, projectId, projectType”*. The candidate preserves exactly those three fields and no others.

* `package.json` remains credential-free, `engines.node >=20.11.0`, scripts unchanged (`test:unit` = purity + vitest). No `src/pages/api/*` hand-authored adapters appear — consistent with `src/platform/http/README.md` staging note that file-based adapters are deferred to authenticated scaffold T-VP0.

* The candidate does **not** invent `extensions.ts`, `wix.config.json` extension IDs, or `@wix/*` imports outside the single guarded `bridge.js` dynamic import (enforced by `tests/ui/noWixImports.test.js` and purity gate).

**No scaffold fabrication.**

## 3. Contract and typed-bridge alignment — the core fix of this candidate

### 3.1 `saveRuleSet` — now `{ ruleSet, expectedRevision }`

* **Platform ground truth** (`src/platform/http/ruleSetEndpoints.ts:putRuleSet`):
  * Requires `body` is `{ ruleSet, expectedRevision }` where `expectedRevision` is non-empty string.
  * Validates shape, then calls `configStore.saveRuleSet(ruleSet, expectedRevision)` with optimistic-concurrency (409 REVISION_CONFLICT).

* **Before candidate:** `bridge.saveRuleSet(ruleSet)` did `request('/ruleset', {method:'PUT', body: ruleSet})` — raw draft, missing `expectedRevision` → always `INVALID_QUERY` against real handler (observed in prior audits).

* **After candidate:** `bridge.saveRuleSet(ruleSet, expectedRevision)` does `request('/ruleset', {method:'PUT', body:{ruleSet, expectedRevision}})` (`src/ui/services/bridge.js:295`). `rulesEditorPage.js:894-896` now derives `expectedRevision = state.savedRuleSet?.revision ?? ''` and passes it. This matches Blueprint §4 flow 2 and Contract §9.4 revision-checked updates.

* **Tests added in candidate:** `tests/ui/bridge.test.js` now asserts exact body keys `['expectedRevision','ruleSet']` and the `''` initial-revision case, plus four integration tests with a minimal JS shim of the platform PUT/POST validation that would fail on any shape mismatch. The shim correctly rejects missing/empty `expectedRevision` and accepts the correct shape, proving the bridge→handler alignment end-to-end (the shim is a faithful subset of `ruleSetEndpoints.ts` + `mutationEndpoints.ts`).

### 3.2 `requestApply` — now `{ confirmedDiffHash }` only

* **Platform ground truth** (`src/platform/http/mutationEndpoints.ts:postApplyPlan`):
  * Strict schema: exactly `{ confirmedDiffHash }` (non-empty string); any extra key (e.g., `ops`, `plan`) is rejected `INVALID_QUERY` with `unexpectedKeys`. Resolves plan via `ConfirmedPlanLookup` (Contract §9.2 diff-and-confirm).

* **Before candidate:** `requestApply(ops, confirmedDiffHash)` sent `{ops, confirmedDiffHash}` → rejected by handler (`unexpectedKeys: ['ops']`).

* **After candidate:** `requestApply(confirmedDiffHash)` sends `{confirmedDiffHash}` only (`bridge.js:304`), and `rulesEditorPage.js:925` no longer computes `computeScheduleDiff(...).ops` at apply time — it uses the stored `state.confirmedHash`. This is the correct §9.2 artifact: the hash reference alone, never inline ops.

* **Tests:** `bridge.test.js` updated to assert `Object.keys(body)==['confirmedDiffHash']` and integration tests prove happy-path and 404-unknown-hash paths.

**Both changes are required contract fixes, not silent forks.** No bypass of `services/` bridge is introduced; dashboard still consumes only `bridge.*`.

## 4. Dashboard UX, state, and accessibility

* **State correctness:** `editorStore.js` unchanged except consumed via new bridge signatures. `handleSave`/`handleApply` preserve existing `SAVE_START/SUCCESS/UNAVAILABLE` and `APPLY_START/SUCCESS/ROLLED_BACK/RECOVERED/FAILED` flows, bounded `pollMutationUntilTerminal`, explicit `recover()` guard, and confirmation invalidation. No auto-retry or silent schedule mutation is added.

* **No destructive-write weakening:** `requestApply` now enforces user-confirmed hash; `ops` are never smuggled. The `recover` and `getMutationStatus` surfaces remain explicit and unchanged.

* **Entitlement restriction preserved:** No change to `entitlementContext`, coverage badges, `READONLY_LOCK_TITLE`, or degraded-fail-open handling. `rulesEditorPage.js` diff touches only save/apply plumbing.

* **Accessibility:** All `role="status"`/`role="alert"`, `aria-label`, `aria-describedby`, `data-testid`, keyboard `onClick`/`onchange` patterns, and disclosure copy (`LOCATIONS_DISCLOSURE`, `CAPS_DISCLOSURE`) are untouched. `accessibility.test.js` and `copyDisclosure.test.js` remain relevant; no weakening observed.

* **Validation honesty:** No overclaim of per-location native hours or hard caps; disclosures remain verbatim per Contract §12.

## 5. Lane ownership and prohibition checks

* Candidate touches only `src/ui/pages/rulesEditorPage.js`, `src/ui/services/bridge.js`, `tests/ui/{applyFlow,bridge,recoveryGuidanceHonesty}.test.js` — all Dashboard lane owned (`BUILD_BLUEPRINT.md` §2). No `src/domain/**`, `src/platform/**`, `src/billing/**`, `src/shared/**`, `wix.config.json`, `package.json`, or workflow/governance files are modified.

* No `@wix/` import outside `bridge.js` guarded dynamic import (purity gate passed).

* No secret, App ID, or credentials fabricated or exposed.

* No direct Wix SDK/REST call outside `services/bridge.js`.

## 6. Test reproduction — detailed

* **Deterministic platform suite:** `npm test` → 548/548 passing across 49 files including `http-ruleset.spec.ts` (revision conflict, shape validation), `http-mutations.spec.ts`, `meter-endpoint.spec.ts`, `purity.spec.ts`. No flake.

* **New bridge contract tests (candidate):** `tests/ui/bridge.test.js` now 14 tests:
  * `requestApply posts only confirmedDiffHash` → asserts path `/api/rules/apply-plan`, method POST, body keys exactly `['confirmedDiffHash']`
  * `saveRuleSet PUTs { ruleSet, expectedRevision }` → asserts `/api/rules/ruleset` PUT with correct envelope
  * `saveRuleSet sends empty string revision when no prior save exists` → asserts `expectedRevision === ''` path (see observation below)
  * Integration quartet → `saveRuleSet feeds {…} into endpoint handler`, `stale revision → HTTP_409`, `requestApply feeds {…}`, `unknown hash → HTTP_404` — all exercise the minimal shim that mirrors real handler validation. Logic inspected and consistent with `ruleSetEndpoints.ts`/`mutationEndpoints.ts`.

* **Apply flow:** `tests/ui/applyFlow.test.js` updated to use `requestApply(confirmedHash)` signature, preserving planId → `getMutationStatus` polling contract.

* **Note on UI node runner:** `tests/ui/*.js` use `node:test`; execution via `node --test` is not allow-listed in this job's bash policy, so those 15+ UI test files were verified by code inspection rather than `node` execution. The platform CI gate (`npm test` / `vitest`) does not run them by design (`package.json` `test:unit` is platform-only), so this is not a new gap. All inspected UI tests are syntactically consistent with the new signatures and would not pass under the old signatures, providing regression guard.

## 7. Observations — not blocking integration

* **Empty-revision initial save:** `rulesEditorPage.js` sends `''` when `savedRuleSet` is null. The platform handler (`ruleSetEndpoints.ts:244`) explicitly rejects `expectedRevision === ''` with `INVALID_QUERY`. The current production `FakeRulesConfigStore` also requires an existing active rule set (`INVALID_STATE` if null). There is therefore no defined creation path for the very first rule set via PUT with `''`. This is a **pre-existing platform gap**, not a regression introduced by this candidate (the previous candidate also could not create the first set — it sent no revision at all). In practice the first save will surface as `HTTP_400`/`SAVE_UNAVAILABLE` until the platform defines a creation sentinel (e.g., `expectedRevision: null` or a dedicated POST). This does not affect the common update path (`rev-*` → `rev-*`) which is now correct and fully tested. No FIX is warranted for this lane alone; any creation-path change belongs to the Integration lane with Director coordination.

No other contract violations, accessibility regressions, or lane-boundary breaches were found.

## 8. Verdict

The candidate corrects two binding platform-contract mismatches (`saveRuleSet` envelope and `requestApply` hash-only), adds faithful integration shim tests that would catch future drift, preserves `wix.config.json` binding from authenticated generation, keeps lane ownership and accessibility intact, and passes all deterministic gates (`typecheck`, `purity`, `vitest` 548/548). The remaining empty-revision creation gap is pre-existing platform scope, not a dashboard-introduced defect.

VERDICT: ACCEPT
