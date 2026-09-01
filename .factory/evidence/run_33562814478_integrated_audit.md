# Factory Integrated Audit — Wix Bookings Advanced Rules

- Auditor role: `integrated-auditor` (fresh cross-lane audit, independent of all builders and lane auditors)
- Audited SHA: `8a38eec35dd42a4de9956684f63754c58dccf40e` — `candidate(integration): generation 238`
- Audit date: 2026-09-01
- Scope: exact committed tree at the audited SHA; working-tree harness changes (fiche edits, deleted lane-auditor fiches) are NOT part of the audited state and were excluded.
- Method: read-only inspection of the full source tree, deterministic checks, and adversarial cross-lane contract verification. No code was modified. No Wix credentials were used or required.

---

## 1. Deterministic checks (executed in this audit)

| Check | Result |
|---|---|
| `npm run check` (tsc + purity gate + vitest) | PASS — 548/548 tests across 49 files, typecheck green, purity gate green |
| `npm run check:offline` (network egress guard) | PASS — zero network egress |
| Dashboard lane UI tests (`tests/ui`) | PASS — 211/211 |

`npm run build` (the real `wix build`) cannot be executed in this sandbox (no authenticated Wix CLI). This is an infrastructure limitation, not product evidence. See §5.

## 2. Cross-lane contract verification performed

- **Apply path (dashboard → platform HTTP):** `bridge.requestApply(confirmedDiffHash)` posts exactly `{ confirmedDiffHash }` — the only key — matching the platform `postApplyPlan` strict schema. Regression-pinned in `tests/ui/bridge.test.js` (L130–150) and confirmed against `src/platform/http/mutationEndpoints.ts`. **Consistent.**
- **Rules domain:** weekly windows (per-location/per-service + intersection), exceptions (CLOSED beats OVERRIDE, override intersection), limits (declared-status counting, UTC-bounded site-zone day buckets), duplicates (identity-free first, half-open overlap, RESCHEDULE subject exclusion), explain outcomes (jargon-free, no internal identifiers), timezone math (Intl-based, DST gap→advance, ambiguous→first occurrence). All consistent with Technical Contract §4.7/§10/§11 and the domain README.
- **Validation plugin:** six targets (CREATE/CANCEL fail-closed, RESCHEDULE fail-open with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'`), short-TTL count cache preserving gateway throw contract, payload DTO pinned, incidents typed. Consistent.
- **Schedule mutation:** snapshot-before-first-write, durable journal, idempotency keys, `recoverInterruptedApply` restoring exact pre-apply state from persisted snapshot, `SimulatedProcessCrash` intentionally uncatchable (real crash semantics), audit entries with duplicate-id integrity guard. Consistent with Contract §9.
- **Webhooks:** claim semantics (FIRST_CLAIM / RECLAIM_IN_FLIGHT / ALREADY_COMPLETED), monotonic sequence heads, buffering with deterministic total order, completion-only terminal state. Consistent.
- **Billing:** tier table (1 / 2–3 / 4–10 / 11+ locations), entitlement decision table (null⇒FREE, missing vendorProductId⇒FREE, unknown⇒TIER_1 fail-safe + UNKNOWN_PLAN_IDENTIFIER warning), projection with reconciliation supremacy and dedup memory surviving snapshots, deterministic fold order, counter adapters returning `.pages` arrays to the pure core (never wrappers), downgrade never deletes customer configuration. Consistent with the pricing model and Contract §7.
- **HTTP endpoints:** fail-closed `requireVerifiedCaller` before any store interaction (TOKEN_MISSING / TOKEN_INVALID / TOKEN_VERIFIER_FAILED), frozen error taxonomy, meter endpoint always-200 with per-half degradation, token verifier with expiry→null mapping. Consistent.
- **Registration surface:** `projectConfig.ts` classifier (MISSING_FILE / UNPARSEABLE / UNLINKED / LINKED) requires positive evidence of a real appId; `extensionsManifest.ts` uses RegistrationChannel + PLANNED_UNTIL_T_VP0 honesty; `validationExtension.ts` derives targets from the single source of truth. Consistent — **except** the stale-surface contradiction in §4 (F2).
- **Fakes:** reference implementations without Wix SDK imports; purity gate enforced. Consistent.

## 3. What is proven

- The deterministic domain core, platform orchestration, billing projection, and dashboard UI are internally coherent and mutually consistent at the audited SHA.
- The apply path (`requestApply` ↔ `postApplyPlan`) is correctly wired end-to-end with a regression test.
- The committed `wix.config.json` (`appId: 3e9ec3af-001b-4684-a197-a5133677844d`, `projectType: App`) is a real, non-placeholder binding; `BOOTSTRAP_BINDING.md` documents that a real scaffold preceded persistence and that no credentials are persisted.
- No secrets, fabricated identifiers, or invented Wix capabilities were found in the audited tree.

## 4. Blocking findings

### F1 — Dashboard `saveRuleSet` sends the wrong body shape (save path always fails)

- Platform contract: `PUT /rule-sets/:ruleSetId` (`src/platform/http/ruleSetEndpoints.ts`) requires body `{ ruleSet, expectedRevision }`; the same shape is documented in `src/platform/http/README.md` (endpoint map) and pinned by `tests/platform/http-ruleset.spec.ts`.
- Dashboard bridge: `saveRuleSet(ruleSet)` (`src/ui/services/bridge.js` L291) sends the **raw ruleSet** as the PUT body — no `{ ruleSet, expectedRevision }` envelope, no `expectedRevision`. Its only caller, `rulesEditorPage.js` (L894), passes `store.getState().draft`.
- Consequence: the platform handler rejects every save with `INVALID_QUERY` ("body must be { ruleSet, expectedRevision }"). The dashboard cannot persist any rule configuration.
- Why undetected: no test connects the bridge to the platform handler; `git diff aec73b0..HEAD` shows `ruleSetEndpoints.ts` unchanged and only `requestApply` changed in `bridge.js`, so the mismatch is pre-existing in the accepted base.
- Severity: **blocking** — the primary merchant configuration flow is broken end-to-end.

### F2 — Registration surface contradicts the committed real binding

- `src/platform/registration/README.md` §1 ("Why there is no committed wix.config.json"; table states the file is gitignored and never committed) is **false**: `wix.config.json` IS committed (binding commit `468618fa`).
- `src/platform/registration/scaffoldPrerequisites.ts` `externalBlockerStatement()` still says "No linked Wix CLI project exists" — false; `projectConfig.ts` would classify the committed real appId as `LINKED`.
- `.gitignore` comment ("never commit") is contradicted by the deliberate, Director-planned persistence of the binding.
- `docs/runbooks/T_VP0_SCAFFOLD.md` was not updated after the binding.
- `tests/platform/registration-surface.spec.ts` (L207) passes only because it asserts `.gitignore` content; its stated invariant ("can never be committed by accident") is violated in fact.
- `docs/NEXT_CYCLE.md` task INT-C7-LIVE explicitly includes adapting the registration surface for the unified Wix CLI project — not done.
- Severity: **blocking** — the registration surface misreports the project's true binding state to tooling, runbooks, and future cycles.

## 5. Non-blocking observations (not verdict drivers)

- A real `wix build` on the repo tree is not verifiable in this sandbox. `BOOTSTRAP_BINDING.md` itself states "The subsequent real `wix build` remains mandatory" — the build gate remains open and must be proven by Wix Live QA with authenticated credentials.
- No `src/pages/` directory and no `.astro/` directory exist on disk; the `src/pages/api/*` thin adapters remain scaffold-time. Consistent with the documented plan, but the scaffold-time surface is not yet materialized.
- `docs/state.json` reports cycle 21, `NOT_READY`, `final_auditor_unavailable_or_failed`, `product_promoted false`; `docs/PRODUCT_GATES.json` shows all 11 gates OPEN. These are consistent with a product that is not yet release-ready.

## 6. Required repairs (same-lane routing)

- **F1 → Dashboard lane (with Integration lane support):** make `saveRuleSet` send `{ ruleSet, expectedRevision }` per the platform contract, wire `expectedRevision` from the store, and add a bridge↔platform contract test that pins the envelope (mirroring the existing `requestApply` regression test).
- **F2 → Integration lane:** update `src/platform/registration/README.md` §1, `scaffoldPrerequisites.ts` `externalBlockerStatement()`, the `.gitignore` comment, and `docs/runbooks/T_VP0_SCAFFOLD.md` to reflect the committed real binding; strengthen `tests/platform/registration-surface.spec.ts` to assert the actual committed state rather than `.gitignore` content alone.

---

VERDICT: FIX