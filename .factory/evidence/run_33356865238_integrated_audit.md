# Integrated Cross-Lane Audit — SHA 810c8b88be41aa2dba5ca2f251182a93cdb81518

- **Audited commit:** `810c8b88be41aa2dba5ca2f251182a93cdb81518` — "candidate(integration): generation 98" (wix-integration-builder, Mon Aug 31 04:19:00 2026 +0000)
- **Parent:** `ec916b75d5600e02d679d264648ac92333d721f1`
- **Candidate diff:** 9 files, +805/−16 — `src/platform/http/confirmDiffEndpoint.ts` (new), `src/platform/http/confirmedPlanStore.ts` (new), `src/platform/adapters/fakes/confirmedPlanStore.ts` (new), `src/platform/http/index.ts` (+14), `src/platform/http/mutationEndpoints.ts` (+18), `tests/platform/confirm-diff-durability.spec.ts` (new, 454 lines), `tests/platform/helpers/httpTestDoubles.ts` (+44), `tests/platform/http-auth.spec.ts`, `tests/platform/http-mutations.spec.ts`
- **Method:** fresh independent cross-system audit of the exact SHA. Read the binding contract (`docs/WIX_TECHNICAL_CONTRACT.md` §9.2, F1/F3/F5), blueprint, gates ledger, state, Director plan, all candidate files, the platform HTTP layer, the dashboard bridge/page/store/modal, both lanes' test suites, and the Wix-live evidence. Ran `npm run check` (root) and `npm test` (tests/ui). No code was modified.

## Executive summary

The candidate implements the platform half of Contract §9.2 durable confirmed-plan storage (F1/F3/F5) with internally sound, well-tested code. However, the integrated preview at this SHA cannot execute the core schedule-apply flow: the dashboard's apply request is structurally rejected by the platform endpoint, the new `/confirm-diff` endpoint is unreachable from the dashboard, and the F3 hash-parity claim between UI and platform is not achieved and not tested. The two lanes' test suites codify mutually contradictory payload contracts and both pass because they are siloed. This is a critical cross-lane contract break; the candidate neither fixes it nor completes the confirm-diff flow it was built to support.

## Critical cross-lane findings

### C1 — Dashboard apply flow always fails with INVALID_QUERY (core flow broken)
- `src/ui/pages/rulesEditorPage.js:924` (`handleApply`) calls `bridge.requestApply(ops, state.confirmedHash)`.
- `src/ui/services/bridge.js:298-303` sends `POST /apply-plan` with body `{ ops, confirmedDiffHash }`.
- `src/platform/http/mutationEndpoints.ts` (`postApplyPlan`) strictly rejects **any** key other than `confirmedDiffHash` (`unexpected.length > 0` → `INVALID_QUERY`), so `ops` is always rejected. The dashboard apply path can never succeed; no schedule mutation can be executed from the dashboard.
- The contradiction is codified in both lanes' tests: `tests/ui/bridge.test.js:112-127` ("requestApply posts ops plus the confirmed diff hash") asserts `{ ops, confirmedDiffHash }` is sent; `tests/platform/http-mutations.spec.ts:115-128` ("rejects any extra key next to confirmedDiffHash") asserts that exact payload is rejected. Both suites pass because the root vitest config (`src/platform/vitest.config.ts`, `include: ['tests/**/*.spec.ts']`) excludes `tests/ui/*.test.js`, which run only via the separate `cd tests/ui && node --test` runner.
- This break is pre-existing (bridge and endpoint are byte-identical to the parent), but the candidate's stated purpose is the confirm-diff flow, and the integrated preview remains non-functional for apply regardless of when the break was introduced.

### C2 — New POST /confirm-diff endpoint is unreachable from the dashboard
- The bridge exposes no `confirmDiff` method and no UI module calls `/confirm-diff` (verified by grep over `src/ui`).
- `state.confirmedHash` is set client-side from `computeScheduleDiff(...).hash` (`src/ui/state/editorStore.js:286-302`), never from a platform response.
- The endpoint's own header comment says "Dashboard calls POST /confirm-diff with { ops, plan }" (`confirmDiffEndpoint.ts:8`), but the strict schema requires exactly `{ plan }` and rejects `{ ops, plan }` (`confirmDiffEndpoint.ts:133-140`). The doc and the schema contradict each other.
- The dashboard never constructs a MutationPlan (no `planId`/`scope`/`ruleVersion`/`changes`/`createdAt`/`reason` builder exists anywhere in `src/ui`), so even a wired dashboard could not produce a body the endpoint accepts.

### C3 — F3 hash parity between UI and platform is not achieved and not tested
- UI hash domain: `fnv1aHex(stableStringify(ops))` over the **diff ops array** (`src/ui/diff/computeScheduleDiff.js:203`).
- Platform hash domain: `fnv1aHex(canonicalPlanSerialization(plan))` over the **full MutationPlan** including `planId`, `scope`, `ruleVersion`, `createdAt`, `createdBy`, `reason` (`src/platform/http/confirmDiffEndpoint.ts:36-69`).
- These serializations can never agree for a well-formed plan, so the F3 claim ("Must produce the same output as the UI's stableStringify", `confirmDiffEndpoint.ts:29-30`) is false in practice.
- The durability spec test titled "produces the same hash as the UI FNV-1a for identical plan content" (`tests/platform/confirm-diff-durability.spec.ts:73-78`) only asserts `/^[0-9a-f]{8}$/` — it never imports or compares the UI hash. The parity claim is untested.
- Consequence: even if the dashboard were wired to `/confirm-diff`, the returned `confirmedDiffHash` (plan-domain) could never equal the dashboard's locally computed `confirmedHash` (ops-domain), so the `CONFIRM_DIFF_PREVIEW` gate (`editorStore.js:293-303`) could never accept it.

## Positive findings (candidate's own platform-side work)

- `postConfirmDiff` is internally sound: strict `{ plan }` schema, F3 server-side hash recomputation (client hash ignored), F5 `confirmedBy` derived from the verified caller token, durable `save` via the `ConfirmedPlanStore` port.
- `ConfirmedPlanStore` port + in-memory fake with shared backing Map correctly model F1 cross-invocation durability; the production adapter is honestly deferred to a Wix data collection.
- F3 hardening added to `postApplyPlan` (recompute hash from stored plan, reject `INVALID_STATE` on corruption/tampering) is correct and covered by tests.
- The 22 new tests in `confirm-diff-durability.spec.ts` pass; `http-auth.spec.ts` and `http-mutations.spec.ts` were correctly updated to use real `computePlanHash` instead of fake `'hash-abc'` references.
- Deterministic checks at the SHA: `npm run check` → typecheck clean, purity gate clean, **570/570** tests pass (domain/platform/billing). UI lane suite (`cd tests/ui && npm test`) → **210/210** pass, including accessibility tests (named controls, keyboard operability, live regions, dialog semantics, focus management F-N2). No `.skip/.only/.todo`.

## Per-lane verification

- **Rules:** no changes in this candidate; domain core remains pure/deterministic (no Wix/network/fs imports); evaluate/validate/limits/duplicates/windows/exceptions tests pass. No regression.
- **Billing:** no changes in this candidate; entitlement gate fail-open on infrastructure errors, meter DTO pinned identically across lanes, downgrade-never-deletes-config semantics intact; tests pass. No regression.
- **Dashboard:** no changes in this candidate; a11y-sensitive behavior verified green. But the apply flow is broken (C1) and the confirm-diff flow is not wired (C2) — the dashboard lane is not actually complete despite `docs/NEXT_CYCLE.md` declaring "Dashboard … complete".
- **Integration:** the candidate's platform-side confirm-diff machinery is well-built in isolation but disconnected from the dashboard (C2) and rests on an unachieved hash-parity assumption (C3).

## Wix scaffold evidence — contradictory, gate not proven

- `reports/wix-live/BOOTSTRAP_BINDING.md` claims: authenticated binding to existing app "Advanced Booking Rules" (App ID `3e9ec3af-001b-4684-a197-a5133677844d`), real `wix.config.json` generated, real `wix build` completed, no credentials persisted.
- `reports/wix-live/CYCLE_32920420147.md` states: "The integrated product has no real wix.config.json. It is not yet registered as a testable Wix CLI app … VERDICT: FIX_BEFORE_INTEGRATION".
- `docs/PRODUCT_GATES.json`: `real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release` all still **OPEN** (all 11 gates OPEN).
- `docs/state.json`: `NOT_READY`, `last_reason: final_auditor_unavailable_or_failed`, cycle 21, protocol 4.
- `docs/NEXT_CYCLE.md` claims run 32920420147 is "accepted product progress: Integration audit ACCEPT, integrated audit ACCEPT" with only Integration work remaining — directly contradicted by the wix-live report and the gates ledger.
- Per AGENTS.md, only persisted `reports/wix-live/**` evidence can prove real scaffold registration; the two wix-live reports contradict each other, so the gate is **not proven**. The `wix.config.json` at the SHA (`appId 3e9ec3af-001b-4684-a197-a5133677844d`, `projectType App`) is unchanged from the parent and its authenticity cannot be externally verified from the repository.

## Environment integrity note (outside the audited SHA)

The working tree contains uncommitted governance modifications that are **not** part of the audited SHA: deleted `.opencode/agents/lane-auditor.md` and `wix-simulation-auditor.md` (plus their job descriptions), modified `AGENTS.md`, `.opencode/job-descriptions/MANIFEST.sha256`, and several agent fiches; untracked new auditor agent files (`billing-auditor.md`, `dashboard-auditor.md`, `integrated-auditor.md`, `integration-auditor.md`, `model-probe.md`, `rules-auditor.md`, `wix-live-auditor.md`). AGENTS.md forbids agents from modifying these files. Product code (`src`, `tests`, `docs`) matches the SHA exactly, so this does not affect the SHA verdict, but the governance state of the environment is compromised and should be investigated by the trusted workflow shell before any further cycle.

## Required repairs (same-lane routing)

1. **Dashboard lane (critical):** wire the confirm-diff flow — add `bridge.confirmDiff(plan)` calling `POST /confirm-diff` with exactly `{ plan }`, build a MutationPlan in the UI (or accept a platform-returned hash), store the platform-returned `confirmedDiffHash` in `state.confirmedHash`, and change `requestApply` to send only `{ confirmedDiffHash }`. Update `tests/ui/bridge.test.js` and `applyFlow.test.js` to the new payload; add a cross-lane parity test that imports both `computeScheduleDiff` and `computePlanHash` and proves agreement on identical content.
2. **Integration lane (critical):** resolve the F3 hash-domain mismatch (C3) — either hash the ops array on the platform (matching the UI) or move the UI to hash the plan; the two must agree and the parity must be tested, not asserted. Fix the `confirmDiffEndpoint.ts` header comment (`{ ops, plan }` vs `{ plan }`).
3. **Director:** correct `docs/NEXT_CYCLE.md` (Dashboard is not complete; run 32920420147 is not accepted product progress per the wix-live report and gates ledger) and reconcile the contradictory Wix-live evidence before claiming scaffold progress.

## Verdict

The integrated preview at this SHA cannot apply schedule changes from the dashboard (C1), the new confirm-diff endpoint is dead code from the dashboard's perspective (C2), and the F3 hash-parity foundation is false and untested (C3). The candidate's platform-side work is sound in isolation but does not make the integrated product coherent or functional. The cross-lane contract is broken; this preview must not be adopted.

VERDICT: FIX