# Factory Lane Audit — Integration Candidate b8ac3832f355adc631fa30db2182515e225a5535 vs base ec916b75d5600e02d679d264648ac92333d721f1

## Verdict Preamble
Independent audit of exact integration candidate SHA b8ac3832f355adc631fa30db2182515e225a5535 against accepted base ec916b75d5600e02d679d264648ac92333d721f1. No fixes applied. Evidence reproduced directly.

## 1. Wix-Owned Scaffold / Binding Provenance
- **Authenticated official-scaffold evidence inspected via `git show origin/main:.factory/evidence/...`:**
  - `run_33321707099_official_scaffold.json`: `source: authenticated official Wix existing-app scaffold`, `appId: 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId: advanced-booking-rules`, `projectType: App`, `createNewVersion: 0.0.105`, `wixCliVersion: 1.1.238`, `pristineWixBuild: PASS`, `scaffoldPackageSha256: 1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd`, `developmentSiteProvisioned: true`.
  - `run_33321707099_official_scaffold_pristine_build.txt`: full `wix build` log with `@wix/astro-wix-hosting-adapter`, `✓ Completed` in 320ms, vite build `✓ built in 2.49s` server and `✓ built in 7.81s` client, `Server built in 10.70s Complete!` — no errors.
- **Candidate wix.config.json** (`git show b8ac3832:wix.config.json`): `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}` — identical to base (`git show ec916b75:wix.config.json`) and to official scaffold appId/projectId. No hand-authored guess, no App ID rotation, no scaffold field invention.
- **Diff scope** `git diff ec916b75..b8ac383` touches only 7 files: `src/platform/composition/confirmedPlanComposition.ts` (new), `src/platform/composition/index.ts`, `src/platform/http/README.md`, `src/platform/http/index.ts`, `src/platform/http/mutationEndpoints.ts`, `tests/platform/helpers/httpTestDoubles.ts`, `tests/platform/http-mutations.spec.ts`. No `wix.config.json` mutation, no secret materialization, no marketplace submission, no external infrastructure.
- **Conclusion:** Wix-owned scaffold/binding came from authenticated official generation, not hand-authored guesses. Binding preserved.

## 2. Candidate Scope & Lane Ownership
- Lane ownership check per `BUILD_BLUEPRINT.md` and `WIX_TECHNICAL_CONTRACT.md`: integration lane owns `src/platform/**`, `src/pages/api/**` adapters, data-collection schemas, webhook handlers, schedule-mutation safety. All changes are within `src/platform/composition`, `src/platform/http`, and `tests/platform` — allowed.
- No domain semantics in `src/domain`, no billing policy, no dashboard UX mutation. Shared types untouched. Cross-lane boundary respected. Dashboard bridge remains consumer-not-producer; integration correctly notes downstream dashboard fixes as out-of-scope separate task (comment in `http-mutations.spec.ts` lines 694-722).
- No deprecated paths used (no legacy CLI, no Bookings-scoped Calendar, no `businessSchedule` mutation, no API keys at runtime). No PREVIEW_GATED claim.

## 3. Reproducible Evidence — Deterministic Checks Run Independently
Executed credential-free checks from candidate checkout (workdir `/home/runner/work/_temp/wix-factory-33354768227/product`):

- `npm ci` — PASS (added 47 packages, no script errors after initial typecheck cache miss resolved by install).
- `npm run typecheck` (`tsc --noEmit`) — PASS after `npm ci`; before install error was `Cannot find type definition file for 'node'` which is environment missing deps, not code defect, resolved by `npm ci`.
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — PASS: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- `npm test` (which runs `check:purity && vitest run --config src/platform/vitest.config.ts`) — PASS: `Test Files 49 passed (49) | Tests 566 passed (566) | Duration ~7.45s`. The only printed failure is intentional fixture scanning in `purity-gate.spec.ts` (`PURITY GATE FAILED: 4 forbidden... under /tmp/purity-gate-fixture-...`) which is expected test behavior and itself passes (`✓ tests/platform/purity-gate.spec.ts (4 tests)`).
- `npm run build` (`npm run check` = typecheck + purity + vitest) — PASS (same 49/566).
- All tests including new suite reproduced:
  - `POST confirm-diff registers a user-reviewed diff` — 12 cases: happy path, extra keys INVALID_QUERY, missing fields, empty hash, non-object plan, missing planId, non-array changes, idempotent re-register, bodiless, unauthenticated before store touch.
  - `confirm-diff → apply-plan round-trip` — 3 cases: round-trip resolves, NOT_FOUND without confirm, stale/replaced hash resolves to v2.
  - `InMemoryConfirmedPlanStore` — 3 cases: store/retrieve, null unknown, idempotent.
  - `POST apply-plan requires the confirmed-diff hash reference`, `GET mutation status`, `POST recover` — existing suites still pass.
- No pipes/redirects used in reproduction; direct allowed commands only.

## 4. Functional Correctness Review (Read-Only, Adversarial)
- **mutationEndpoints.ts** implements `ConfirmedPlanStore extends ConfirmedPlanLookup` with `InMemoryConfirmedPlanStore` (Map-backed, `findByDiffHash` async, `register` sync overwrite, `size` getter). Composition note explicitly states single-instance serverless sufficiency and durable-store requirement upon horizontal scaling — honest per Contract invariant C6 and §9, not fabricated HA claim.
- **postConfirmDiff**: calls `requireVerifiedCaller` first (auth-before-store), strict `isRecord` body check, allow-set `confirmedDiffHash, plan, confirmedBy`, rejects unexpected keys with `INVALID_QUERY` + details, validates non-empty strings, structural `plan.planId` + `changes` array + `scope` record, creates `ConfirmedPlanReference` with `confirmedAt: deps.clock.now()` (injected clock for determinism), calls `register`, returns 200. Idempotent by overwriting same hash.
- **composeConfirmedPlan**: creates single `InMemoryConfirmedPlanStore`, wires `confirmDiffDeps` (`tokenVerifier, confirmedPlanStore, clock`) and `applyPlanDeps` (`tokenVerifier, confirmedPlanLookup: store, orchestrator`) — ensures both endpoints share backing store at app-lifetime scope. Correct seam per Contract §9.2 sequence.
- **Auth discipline**: both endpoints invoke `requireVerifiedCaller` before any mutation; unauthenticated test asserts `registerCalls()==0` and `lookupCalls` unchanged — zero-store-mutation enforced.
- **Purity**: `src/platform/http` and `src/platform/composition` contain no `@wix/` imports; purity gate enforces it.
- **Documentation**: `src/platform/http/README.md` endpoint map updated to include `POST /api/confirm-diff`; thin-adapter protocol unchanged, staging note preserved.
- **Tests**: `httpTestDoubles.ts` adds `makeConfirmedPlanStoreSpy` counting both `lookupCalls` and `registerCalls`; all new tests deterministic with injected `FIXED_TIME` and `FakeTokenVerifier`.

## 5. Security, Contract & Policy Checks
- No secrets committed; `WIX_API_KEY` not present; no `~/.wix` read.
- HTTP endpoints have NO built-in permissions — token verification required and implemented (Contract §6).
- Schedule mutation safety: diff-and-confirm hash pattern prevents inline unreviewed plan smuggling (strict schema `exactly { confirmedDiffHash }` for apply-plan, extra keys rejected). Snapshot→apply→verify→rollback orchestrator untouched and remains mandatory; this candidate only adds the confirmation seam.
- Billing: no tier differentiation by feature, no entitlement fabrication, no location-count mutation.
- No destructive overwrite of Wix schedule without explicit user intent; no `Update Location` / `Set Service Locations` / `Assign Working Hours Schedule` bypass.
- No external DB/infrastructure; in-memory map documented as ephemeral and acceptable for single-instance.

## 6. Cross-Lane Consistency Note (Not a Blocker for Integration)
- Candidate correctly documents that `src/dashboard/services/bridge.ts` currently sends `{ ops, confirmedDiffHash }` and will be rejected by the strict apply-plan schema — expected. The spec file notes required dashboard-lane follow-ups: `bridge.requestApply` must drop `ops`, add `bridge.confirmDiff`, and call confirm before apply. This is properly staged as downstream work, not part of integration scope. Integration lane must not fix dashboard lane code — candidate respects this.

## 7. Findings
- No reproducible defects found. Scaffold provenance authenticated. Deterministic checks pass. Endpoint contracts enforce §9.2. Tests provide negative, edge, idempotency, and round-trip coverage. No lane boundary violation, no secret exposure, no fabricated Wix capability.

VERDICT: ACCEPT
