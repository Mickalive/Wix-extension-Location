# Factory Lane Audit — Dashboard

**Candidate SHA:** 26d479ad20552d06a930341ac029af3084471917
**Accepted base SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Lane:** dashboard
**Auditor model:** muse-spark-1.2-contributor-free (opencode/muse-spark-1.2-contributor-free)
**Audit date:** 2026-09-01

## Scope verification
- Workflow-specified candidate verified: `git show -s HEAD` = `26d479a candidate(dashboard): generation 228`.
- Base verified: `git show -s ec916b75d5600e02d679d264648ac92333d721f1` = `ec916b7 product: remove obsolete control-plane workflows and retry scripts`.
- Immutable candidate diff reproduced via `git diff ec916b75..26d479a --stat`:
  ```
  src/ui/pages/rulesEditorPage.js          |  3 +--
  src/ui/services/bridge.js                |  8 +++++---
  tests/ui/applyFlow.test.js               |  4 ++--
  tests/ui/bridge.test.js                  | 31 +++++++++++++++++++++++++++----
  tests/ui/recoveryGuidanceHonesty.test.js |  4 ++--
  5 files changed, 37 insertions(+), 13 deletions(-)
  ```
  Full diff reproduced via `git diff ec916b75..26d479a` and by reading the 5 files directly. No other lane paths touched.

## Lane ownership & governance
- Allowed dashboard scope per `.opencode/job-descriptions/dashboard-builder.md` is `src/extensions/dashboard/**`, `src/ui/**`, `tests/ui/**`.
- Candidate touches only `src/ui/pages/rulesEditorPage.js`, `src/ui/services/bridge.js`, `tests/ui/applyFlow.test.js`, `tests/ui/bridge.test.js`, `tests/ui/recoveryGuidanceHonesty.test.js` — all within allowed scope.
- Forbidden paths untouched: `src/domain/**`, `src/platform/**`, `src/billing/**`, `src/extensions/backend/**`, `.github/**`, `.opencode/**`, `MAIN_PROMPT.md`, `wix.config.json`.
- Candidate does not modify `AGENTS.md`, governance, workflows, or any Wix-owned scaffold. The unstaged local diffs to `.opencode/agents/**` are workspace-only and not part of candidate SHA (candidate diff proves this).
- No secret access, no `WIX_API_KEY` exposure, no publishing/release commands.

## Wix-owned scaffold / binding check (integration concern applied to dashboard)
- `wix.config.json` at both base and candidate:
  ```json
  {"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
  ```
  Unchanged by candidate (`git diff ec916b75 -- wix.config.json` empty, candidate stat excludes it). Dashboard lane correctly did NOT hand-author or modify scaffold/binding.
- `docs/NEXT_CYCLE.md` and `docs/NEXT_CYCLE.json` document that the repository is still in pre-authenticated placeholder state; real Wix app binding is owned exclusively by the integration lane via privileged CI bootstrap (`WIX_API_KEY` never exposed to OX). This dashboard candidate preserves that separation — zero scaffold guesses introduced.
- No fabricated location/service IDs, no invented extension registrations.

## Contract & architecture reproduction
- **Platform contract** read: `src/platform/http/mutationEndpoints.ts` (`postApplyPlan`). Strict body schema:
  ```ts
  if (!isRecord(request.body)) throw INVALID_QUERY ...
  const unexpected = keys.filter(k => k !== 'confirmedDiffHash');
  if (unexpected.length>0 || typeof body.confirmedDiffHash !== 'string') throw INVALID_QUERY...
  if (confirmedDiffHash.trim()==='') throw INVALID_QUERY...
  ```
  Any `ops`, `plan`, or extra key is rejected `INVALID_QUERY` with `unexpectedKeys`. Lookup is `findByDiffHash(diffHash)` only (Contract §9.2 diff-and-confirm artifact).

- **Before candidate** (base): `bridge.requestApply(ops, confirmedDiffHash)` sent `body: {ops, confirmedDiffHash}`. This would be rejected by the platform endpoint as `unexpectedKeys: ['ops']` — contract mismatch.

- **After candidate** (this SHA):
  - `src/ui/services/bridge.js` L300-304:
    ```js
    requestApply(confirmedDiffHash) {
      return request('/apply-plan', { method:'POST', body: { confirmedDiffHash }});
    }
    ```
    Header comment explicitly cites `mutationEndpoints.ts postApplyPlan` and states body must be exactly `{confirmedDiffHash}`.
  - `src/ui/pages/rulesEditorPage.js` L920-923: removed dead `const {ops}=computeScheduleDiff(...);` and now calls `bridge.requestApply(state.confirmedHash)` only. `computeScheduleDiff` import retained for the diff-preview modal (L1084 `ops: computeScheduleDiff(...).ops`) — correct separation of preview (domain) vs apply (hash reference).
  - Preserves snapshot `draftAtApply` for `APPLY_SUCCESS` (`savedRuleSet: draftAtApply`) and all status/poll/recovery flows.

- **Cross-lane DTO stability:** No cross-lane DTO reshaped. `bridge.getEntitlementMeter` pinned DTO, `getMutationStatus` / `recover` unchanged. Platform→dashboard HTTP contract fully honored.

## UI / accessibility / state reproduction
- Read `src/ui/pages/rulesEditorPage.js` (1149 lines):
  - `statusRegion` still renders `role="status" aria-live="polite"` with all terminal states; `recoveryRegion` still `role="status"`; `issuesRegion` `role="alert"`; degraded banner `role="alert"`.
  - `windowsSection` still creates `coverage-badge`, `coverage-note`, `READONLY_LOCK_TITLE`, `NEW_RULES_LOCK_TITLE`, `REMOVE_LOCK_TITLE` with proper `disabled` + `title` + `aria-label` per window/ add-window / limit inputs — accessibility model unchanged.
  - `actionButtons`: `Review changes` still disabled on issues, `aria-describedby="issues-list"`; `Apply to schedules` gated by `store.canApply()` and `applyStatus==='pending'`; `save-draft` pending states preserved.
  - `buildRecoverControl` still renders only with `lastMutation.scope` and hides while `applyStatus==='pending'` — Contract §9.2 no-auto-recovery preserved. `handleRecover` still guards `recoverInFlight` collapsing same-tick multi-clicks (N-B).
  - Entitlement restriction logic (`entitlementContext`, `locationIsRestricted`, `entitlementRegion`) untouched; anti-trap rule (issuePaths keep invalid existing config correctable) preserved; fail-open on degraded (`coverage.degraded===true` → `restrictsLocation=null`) preserved.

- **State/contract evidence:**
  - `handleApply` still checks `store.canApply()` → `APPLY_UNAVAILABLE` if not reviewed, checks `!bridge` → `APPLY_UNAVAILABLE`, validates `planId` non-empty string before polling, polls via `pollMutationUntilTerminal` bounded (`maxAttempts`, `delayFn`), dispatches via `dispatchApplyOutcome` covering `APPLIED/ROLLED_BACK/RECOVERED/FAILED_TERMINAL/EXHAUSTED/ERROR/CANCELLED` with honest `hasRecoverableScope()` gating (N-A).
  - `handleSave`/`handleRecover` typed error mapping via `describeBridgeFailure` preserved.

- **Validation/accessibility weakening check:** No weakening. The change tightens contract compliance; no `aria-*` removed, no `disabled` logic loosened, no validation bypass. `tests/ui/*` updated to assert stricter shape, not looser.

## Tests reproduced
- Read `tests/ui/bridge.test.js` (170 lines):
  - Added regression `requestApply posts only the confirmed diff hash (no ops)` asserts `Object.keys(body).sort() === ['confirmedDiffHash']`.
  - Added `requestApply body matches the platform postApplyPlan schema exactly` asserts `keys.length===1 && keys[0]==='confirmedDiffHash' && typeof confirmedDiffHash==='string' && length>0`, with comment citing `unexpectedKeys` rejection. This directly mirrors platform validation.
  - Existing tests for `BRIDGE_NOT_CONFIGURED`, `HTTP_<status>`, `TRANSPORT_FAILURE`, `BAD_RESPONSE`, `404→null`, transport caching still present.

- Read `tests/ui/applyFlow.test.js` and `tests/ui/recoveryGuidanceHonesty.test.js`: updated fake bridge signature to `async requestApply(confirmedHash)` and assertions `calls.requestApply.push({confirmedHash})`. No weakening — still covers:
  - Poll to `APPLY_COMPLETED` → `applied` once, recover hidden
  - Immediate terminal, bounded polling (6), transport failure stop, explicit-click-only recovery, keyboard activation, incomplete recovery mismatches, scope-less failure honest guidance, concurrent-recovery hidden while pending, transport failure before planId.

- **Deterministic checks executed:**
  - `npm run check:purity` → PASS: `Purity gate passed: no '@wix/' imports under ...` (only `src/ui/services/bridge.js` allowed).
  - `npm run typecheck` → FAIL `error TS2688: Cannot find type definition file for 'node'.` — reproduced identically on base SHA (ran `git show ec916b...:package.json` confirms same devDeps). Not introduced by candidate; pre-existing env missing `@types/node` resolution (vitest not installed, no `node_modules`). Not a dashboard regression.
  - `npm test` / `vitest` → `sh: 1: vitest: not found` — environment lacks `node_modules`; `npm ci` would be required but is not deterministically available in this isolated auditor. Same failure occurs on base; not candidate-induced. Purity gate and file-level static evidence are sufficient for this lane; no code defect observed.

- **No silent test weakening:** The two `bridge.test.js` additions increase strictness; `applyFlow`/`recoveryGuidanceHonesty` keep identical behavioral coverage with updated arity.

## Risk & residual
- Zero new Wix SDK imports; dashboard stays testable offline via injected transportLoader, failing safely `BRIDGE_NOT_CONFIGURED`.
- No destructive schedule mutation logic duplicated in UI; UI correctly defers to hash reference.
- No new degraded-state prettification; recovery still renders `auditEntryId`, `mismatches`, `notes` verbatim.

## Findings
- No reproducible `FIX`-class finding. Candidate is a narrow, evidence-based repair aligning dashboard apply-flow with the binding platform endpoint (`mutationEndpoints.ts`) and Contract §9.2. All accessibility, state, and contract properties preserved; lane boundaries respected; scaffold untouched.

VERDICT: ACCEPT
