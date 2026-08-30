# Factory Integrated Audit — candidate `d475f3d8700f5ad3230fe64f285e595c2d1ead67`

- Auditor: fresh independent cross-system reviewer (integrated-auditor role).
- Candidate: `d475f3d8700f5ad3230fe64f285e595c2d1ead67` — `candidate(dashboard): generation 46` (author `wix-dashboard-builder`).
- Parent: `ec916b75` (workflow cleanup). Accepted base: `aec73b05eefb17a3643043f3d4f7a6bcba92fc0b` (HEAD~25).
- Scope: integration / rules / dashboard / billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior, real Wix scaffold assumptions.
- Method: read-only. Inspected real diffs (`git diff HEAD~1 HEAD`), ran both deterministic suites, traced every changed call path against the platform endpoints and the store/reducer semantics. No files modified except this report.

## Candidate diff (5 files, +238/−24)

`src/ui/pages/rulesEditorPage.js`, `src/ui/services/bridge.js`, `tests/ui/applyFlow.test.js`, `tests/ui/bridge.test.js`, `tests/ui/recoveryGuidanceHonesty.test.js`.

Behavior change: `handleSave` now sends `expectedRevision`; `handleApply` no longer sends computed ops — it sends only `{ confirmedDiffHash }` via `bridge.requestApply(state.confirmedHash)`. Platform HTTP endpoints were NOT changed by this candidate.

## Deterministic checks at this SHA

| Check | Result |
|---|---|
| `npm run check` (typecheck + purity gate + vitest, `tests/**/*.spec.ts`) | PASS — 548/548 |
| `cd tests/ui && npm test` (node:test, dashboard lane) | **FAIL — 213/215 pass, 2 fail** |

The candidate's own lane suite is RED. Per the workflow, failed deterministic checks reject the integrated cycle; this alone is a hard blocker.

## Findings

### F1 — CRITICAL: candidate's own bridge integration tests fail (2)

1. `integration: saveRuleSet feeds { ruleSet, expectedRevision } into endpoint handler` (`tests/ui/bridge.test.js:265`) — `AssertionError: saved rule set must have a revision` (line 295). The test documents the contract: "Endpoint returns { ruleSet, savedBy }; bridge returns the ruleSet unwrapped" (line 293). `bridge.saveRuleSet` (`src/ui/services/bridge.js:295-297`) uses plain `request()`, which returns the full `{ ruleSet, savedBy }` envelope un-unwrapped, so `saved.revision` is `undefined`.
2. `integration: requestApply with unknown hash returns HTTP_404` (`tests/ui/bridge.test.js:342`) — `AssertionError: Missing expected rejection.` (line 349). `bridge.request()` maps 404 → `null` (documented at `bridge.js:13` and implemented at line 145), so `requestApply('unknown-hash')` resolves `null` instead of rejecting `HTTP_404`. The platform returns 404 NOT_FOUND for an unknown hash (`mutationEndpoints.ts:104-111`); the bridge must surface that as an error, not as a successful-but-empty result.

### F2 — CRITICAL: first save is impossible (cross-lane contract break)

- `handleSave` (`rulesEditorPage.js:895`): `const expectedRevision = state.savedRuleSet?.revision ?? '';`
- Platform `putRuleSet` (`ruleSetEndpoints.ts:244-246`): rejects `expectedRevision === ''` with `INVALID_QUERY` (400) — "expectedRevision (non-empty string) is required".
- The faithful test shim rejects `''` identically (`bridge.test.js:225-227`), so the passing test `saveRuleSet sends empty string revision when no prior save exists` (test 28) only asserts the request body, never the outcome.
- No first-save convention exists anywhere in the product: no seeding, no sentinel revision, no create-vs-update distinction. `GET /ruleset` returns `{ ruleSet: null }` as a documented "typed, explicit empty" (`ruleSetEndpoints.ts:200-211`), and the dashboard handles a null `savedRuleSet`, so the first-save path is real and reachable — and always fails with HTTP_400. A fresh install can never persist its first rule set.

### F3 — CRITICAL: a successful save corrupts editor state and crashes the render

- Platform PUT /ruleset success body is `{ ruleSet: saved, savedBy: caller.subject }` (`ruleSetEndpoints.ts:267`).
- `bridge.saveRuleSet` returns that envelope verbatim (plain `request`).
- `handleSave` dispatches `SAVE_SUCCESS` with `savedRuleSet: saved` (`rulesEditorPage.js:897`); the reducer sets `savedRuleSet = envelope` and `draft = cloneDraft(envelope)` (`editorStore.js:346`).
- Render then reads `draft.locationWindows` (undefined → empty windows, `rulesEditorPage.js:1114`) and `draft.exceptions.length` (`rulesEditorPage.js:583`) → `TypeError` on `undefined` → the editor crashes after any successful save.
- Page-level tests mask this because their fake bridges return the draft directly (`async saveRuleSet(draft) { return draft; }` in `applyFlow.test.js:66`, `rulesEditorPage.test.js:213`, `rulesEditorEntitlement.test.js:129`) and ignore `expectedRevision`.

### F4 — CRITICAL: apply flow cannot succeed end-to-end (missing ConfirmedPlanLookup producer)

- Platform `postApplyPlan` resolves the plan exclusively via `deps.confirmedPlanLookup.findByDiffHash(confirmedDiffHash)`; no record ⇒ 404 NOT_FOUND (`mutationEndpoints.ts:104-111`).
- `ConfirmedPlanReference` exists only as a type/interface and in test doubles: `src/platform/http/index.ts:39`, `mutationEndpoints.ts:40-50`, `tests/platform/helpers/httpTestDoubles.ts`, `tests/platform/http-mutations.spec.ts`, `tests/platform/http-auth.spec.ts`, `tests/ui/bridge.test.js`. **No producer exists anywhere in `src/`** — no confirm endpoint, no adapter, no composition wiring. The dashboard's confirm (`CONFIRM_DIFF_PREVIEW`) is purely client-side (`editorStore.js`).
- Therefore `findByDiffHash` always returns `null` and apply always fails with 404.
- Compounding: the bridge maps 404 → `null`, so `handleApply` (`rulesEditorPage.js:928-937`) sees `response?.summary?.planId` undefined and renders the misleading message "The apply result could not be confirmed: the server response did not include a change-set reference…" — the real cause (no confirmed plan exists for this hash) is hidden from the user. F1b demands 404 be surfaced as an error, which would at least be honest.
- Note: dropping `ops` from the payload does fix the previous 400 INVALID_QUERY (extra keys) failure mode — the wire shape now conforms to the platform — but it exposes the missing producer. Apply was broken before this candidate and remains broken.

### F5 — MEDIUM: test-double fidelity gap hides F2/F3

The bridge integration tests use a faithful shim (rejects `''`, rejects extra keys, 404 on unknown hash), but the page-level tests use fake bridges that return the raw draft and ignore `expectedRevision`. The suite is internally inconsistent: bridge tests demand envelope unwrapping and 404-as-error; page tests assume raw-draft returns. The page-level fakes must be upgraded to the faithful shim so the save/apply contracts are exercised end-to-end.

## Verified passing (cross-lane, unchanged by candidate)

- **Rules/domain**: purity gate passes; deterministic domain semantics and target-aware specs green (in the 548).
- **Booking enforcement**: validation-plugin path and entitlement gate composition intact; fail-open posture on billing/counting/listing failures (`entitlementGate.ts`); over-limit is a normal decision, never an error; no customer configuration is ever deleted on downgrade (coverage restriction only).
- **Billing/entitlements**: `meterEndpoint.ts` matches the pinned `{meter, coverage}` DTO exactly; bridge `getEntitlementMeter` strict-shape validation matches; per-source warning liveness correct.
- **Rollback/recovery**: `postRecover` + orchestrator + journal unchanged; bridge `recover(scope)`/`getMutationStatus(planId)` use strict envelope handling matching platform DTOs; polling hard-bounded, terminal classification mirrors the orchestrator allowlist; recovery is click-only, never automatic.
- **Accessibility-sensitive behavior**: candidate changes only `handleSave`/`handleApply` logic, not rendering; all accessibility tests pass (every control named, keyboard operable, live regions correct, dialog semantics, focus restore).
- **Real Wix scaffold**: `wix.config.json` binds real appId `3e9ec3af-001b-4684-a197-a5133677844d`; `reports/wix-live/BOOTSTRAP_BINDING.md` (commit `468618fa`) records a real `wix build` before persisting; no credentials in the repo; `extensions.ts` honestly empty until the authenticated T-VP0 scaffold. Scaffold-live behavior beyond the persisted binding evidence remains unproven (gates all `OPEN` in `docs/PRODUCT_GATES.json`).

## Governance / scope notes

- Working-tree modifications (`.opencode/agents/*`, `AGENTS.md`, `MANIFEST.sha256`) are environment/governance setup, not part of the candidate; all product files under `src/`, `tests/`, `docs/`, `wix.config.json`, `extensions.ts`, `package.json`, `tsconfig.json` are identical to HEAD.
- This is a dashboard-lane dispatch (generation 46) while `docs/NEXT_CYCLE.md` marks the dashboard lane complete and the integration lane active — a Director routing observation, not a code defect.

## Verdict

The candidate's own lane suite is RED (F1), the save flow is broken for both first save (F2) and subsequent saves (F3), and the apply flow cannot succeed end-to-end (F4). These are hard blockers: the candidate must not be integrated. Same-lane repair is required: unwrap the `/ruleset` save envelope, surface 404 as an error for `requestApply`, define and implement a first-save convention (or a create-vs-update path) that satisfies the platform's non-empty `expectedRevision` requirement, and either implement the `ConfirmedPlanLookup` producer or gate the apply affordance until it exists — with page-level tests upgraded to the faithful shim so these contracts are proven, not masked.

VERDICT: FIX