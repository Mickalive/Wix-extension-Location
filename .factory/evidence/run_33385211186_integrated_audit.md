# Factory Integrated Audit — Cross-Lane Contract Verification

**Auditor:** `big-pickle` (independent cross-system reviewer)
**Audit target:** product tree at commit `ec916b75d5600e02d679d264648ac92333d721f1`
**Parent (product) tree:** `e5dda6b17e901db62c9a3a6daf8e9ed5284b02db`
**Date:** 2026-08-31
**Role:** read-only adversarial cross-lane audit. No code was modified.

---

## 1. Scope and method

This is a fresh, independent cross-system audit of the assembled product tree. It verifies the
contracts *between* the four lanes (integration, rules, dashboard, billing) and against the binding
authorities (`docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`), plus failure/rollback
behavior. It does not reuse or impersonate any lane audit.

The target commit `ec916b75` removes only four control-plane files (`.github/workflows/ci.yml`,
`.github/actions/setup-opencode/action.yml`, and two retry scripts). The product code is the parent
tree `e5dda6b1`, verified via `git show --stat`. The working tree carries uncommitted changes under
`.opencode/` (agent descriptors, job descriptions, `AGENTS.md`, new auditor agents). These are
governance files, not product code, and are explicitly out of scope for this audit.

**Deterministic checks executed:**
- `npm run check` → typecheck (`tsc --noEmit`) clean; purity gate passed (no `@wix/*` imports under
  `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`,
  `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`);
  **548 vitest tests across 49 files all pass** (the "PURITY GATE FAILED" block in output is a
  fixture test proving the gate detects violations, not a real failure).
- `npm test` in `tests/ui` (separate `wix-dashboard-lane-tests` package, Node built-in runner):
  **210 UI tests all pass** (accessibility names, keyboard operability, role=alert/status live
  regions, diff modal dialog semantics, apply polling → APPLY_COMPLETED, terminal-state polling
  stop, ROLLED_BACK guidance, bounded polling, recover-on-explicit-click-only).

---

## 2. Cross-lane contract verification

### 2.1 Canonical shared contracts (no forked shapes)

`src/shared/types.ts` is the single canonical DTO source: `RuleSetDTO`, `BookingFacts`,
`Explanation`/`RuleOutcome`, `ScheduleSnapshot`, `MutationPlan`, `PlannedChange`,
`ApplyResult`/`VerifyResult`/`RollbackResult`, `PersistedMutationRecord` with the
`MutationRecordState` terminal set (`SNAPSHOT_PERSISTED`/`APPLY_IN_PROGRESS`/`APPLY_COMPLETED`/
`ROLLED_BACK`/`RECOVERED`), `PolicyDecision`, and `DEFAULT_COUNT_INCLUDED_STATUSES =
[PENDING, CONFIRMED]`. `src/shared/errors.ts` provides the shared `ErrorCode` taxonomy,
`TargetOperation`, and `failureSemanticsFor`. Every lane consumes these verbatim; no lane forks a
canonical shape. Verified consistent across domain, billing, platform, and UI.

### 2.2 Rules ↔ Integration (validation seam, §5.3)

- `src/domain/validate.ts` is pure and total (never throws on shape-mismatched input), reports all
  issues in one pass, imports `RESERVED_RULE_IDS` from `model/primitives` (no drift risk), and
  enforces real-calendar dates, `24:00`-only-as-end, `end > start`, unique ids, and reserved-id
  rejection.
- `src/platform/http/ruleSetEndpoints.ts` performs structural validation (shape/enums/calendar
  formats only — deliberately no temporal semantics) and exposes a `RuleSetValidationSeam` for the
  domain validators to plug in. `putRuleSet` runs token verification → strict body shape →
  structural validation → optional domain seam → **revision-checked atomic save** (conflict ⇒ typed
  `REVISION_CONFLICT`, zero partial writes). `getActiveRuleSet` returns a typed `null` for "never
  saved" rather than an error. This matches Blueprint §4 flow 2 and never auto-applies to schedules.
- The dashboard mirrors the same validator (`src/ui/validation/mirror.js`) and the evaluator runs
  fail-closed before trusting configuration. UI parity test (`uiValidatorParity.spec.ts`, 30 tests)
  confirms message equality between the mirror and the domain validator.

### 2.3 Rules domain core (pure, Wix-free, §8.1)

`src/domain/evaluate.ts` is a single decision function, target-aware for CREATE/CANCEL/RESCHEDULE.
`time/intlZone.ts` uses Intl IANA zones with DST gap→advance and overlap→first semantics;
`time/wallClock.ts` carries the B1/B4 repairs; `windows/weeklyWindows.ts` computes the
location∩service intersection (never expands availability) with default-open; `exceptions/`
makes CLOSED beat OVERRIDE and intersects override windows; `limits/` maps site-zone day → UTC
bounds with declared statuses; `duplicates/` uses identity-free-first and half-open overlap;
`explain/` produces typed explanations. All pure, stdlib-only, host-timezone-free (proleptic
Gregorian civil-day algorithms in `model/primitives.ts`). Determinism property test sweeps the
target matrix under explicit CREATE/CANCEL/RESCHEDULE contexts.

### 2.4 Billing ↔ Integration (entitlement, §7, §11 C2/C5)

- `src/billing/types.ts` models the four paid tiers plus FREE; feature availability identical across
  paid tiers, differing only by location allowance. `billingExpirationDate` is **advisory only**
  (Invariant C2) — never consulted for tier flips.
- `src/billing/pure/entitlement.ts`: unknown plan → `TIER_1` fail-safe + `UNKNOWN_PLAN_IDENTIFIER`
  warning; `restrictionReliable=false` when the allowance had to be guessed.
- `src/billing/pure/coverage.ts`: stable ordering (default first, then alphabetical) — never
  reordered client-side.
- `src/billing/counter/countBillableLocations.ts` applies the ratified single-location floor
  (computed 0 billed as 1) while `billableLocationIds` stays the true computed set.
- `src/billing/counter/countFromAdapters.ts` uses `collectAllPages` with the `.pages` fix (C5).
- `src/billing/enforcement/entitlementGate.ts` is fail-open degraded (C5 alignment with the
  dashboard).
- `src/billing/projection/` implements reconciliation supremacy: snapshot re-seeds truth; webhook
  transitions are refinements between polls; trial→paid conversion fires no event so periodic
  reconciliation is mandatory; auto-renewal cancellation stays paid until period end (no mid-cycle
  downgrade). `snapshotSource.ts` adapts the projector to the gate's `BillingInstancePort` without
  importing any webhook type.
- `src/platform/composition/projectorCompaction.ts` bounds the projector's dedup memory with
  reconciliation retirement + forced compaction, fences stale ranked replays via a watermark, and
  preserves the durable `autoRenewCancelled` marker across rebuilds. Documented tradeoffs are all
  healed by the mandatory periodic reconciliation.
- `src/billing/upgrade/upgradeUrl.ts` builds `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`.
- Billing never deletes customer configuration on downgrade and never calls Wix directly from policy
  code (purity gate enforces this).

### 2.5 Integration platform (schedule mutation, webhooks, HTTP, §6, §9)

- `src/platform/schedule-mutation/orchestrator.ts`: snapshot → diff → apply → verify → rollback,
  with `APPLY_IN_PROGRESS` crash semantics and serverless multi-invocation safety. Terminal states
  mirror the shared `MutationRecordState` allowlist.
- `src/platform/idempotency.ts`: UUIDv5 with a fixed namespace for deterministic idempotency keys.
- `src/platform/webhooks/pipeline.ts`/`envelope.ts`/`ports.ts`: 1250ms deadline, ≤12 retries, dedup
  on envelope `id`, out-of-order buffering on `entityEventSequence`.
- `src/platform/validation-plugin/handlers.ts`/`targets.ts`/`payload.ts`: 6 targets,
  `MAX_BULK_ITEMS=12`, **FAIL_CLOSED for CREATE/CANCEL, FAIL_OPEN for RESCHEDULE**, and an
  `UNPROVEN` metadata flag for honesty about unverified Wix behavior.
- `src/platform/counters.ts`: short-TTL cached gateway (default 2000ms).
- `src/platform/http/auth.ts`: fail-closed `UNAUTHORIZED` via `UnauthorizedRequestError`.
- `src/platform/http/mutationEndpoints.ts`: POST apply-plan accepts only a confirmed-diff hash (no
  inline plans); `meterEndpoint.ts` pins the DTO shape.
- `src/platform/registration/validationExtension.ts`/`extensionsManifest.ts`: honest
  `PLANNED_UNTIL_T_VP0` flag — no production claim for unverified Wix capabilities.

### 2.6 Dashboard ↔ platform bridge (typed, guarded)

- `src/ui/services/bridge.js` is the **only** Wix-referencing module in the UI; it uses a guarded
  lazy dynamic import and maps all failures to typed `BridgeError` codes (HTTP_<status>,
  TRANSPORT_FAILURE, BAD_RESPONSE, BRIDGE_NOT_CONFIGURED). UI test 152/153 confirm no Wix imports
  outside the bridge and that the guarded reference is real (anti-vacuity).
- `src/ui/pages/rulesEditorPage.js`: role=status live region, explicit recover button that **never
  auto-applies**, entitlement restriction that never bricks editing, honest degraded banner
  (role=alert), and the §7 upgrade CTA in a new tab only when identifiers exist (never fabricated).
- `src/ui/pages/locationsUsagePage.js`: degraded banner role=alert, upgrade CTA new tab, stable
  ordering rendered verbatim.
- `src/ui/diff/computeScheduleDiff.js` + `modals/diffPreviewModal.js`: full dialog semantics, focus
  management, confirm reports the rendered hash exactly once, stale-hash replay rejected, blocking
  issues disable confirm.
- `src/ui/validation/mirror.js`: server-validation inject, fail-closed, snapshots the payload so
  later external mutation cannot rewrite history.

### 2.7 Failure / rollback behavior

- Schedule mutation: snapshot persisted before apply; on failure the orchestrator rolls back to the
  snapshot; `ROLLED_BACK` terminal renders rollback guidance and consumes consent; recovery fires
  only on explicit click, exactly once, with the tracked scope (never auto). UI tests 6–17, 141–161
  cover terminal-state polling stop, bounded polling (no infinite loop), and recover-on-explicit-
  click-only.
- Webhooks: bounded retries, dedup, out-of-order buffering; chaos test (13 tests) exercises
  duplicates/out-of-order.
- Billing: fail-open degraded enforcement (C5) so a billing API failure never bricks the product;
  unknown plan → conservative TIER_1 + prominent warning.
- HTTP: fail-closed auth; revision-checked atomic save with zero partial writes.
- Validation plugin: FAIL_CLOSED for CREATE/CANCEL (a validation failure blocks the booking),
  FAIL_OPEN for RESCHEDULE (documented, honest).

---

## 3. Findings

No critical or high blockers were found. The cross-lane contracts are consistent, the canonical
shapes are not forked, the purity boundary is enforced and tested, and failure/rollback behavior is
defensive and honest. The following are observations, none of which block integration:

1. **Governance-only working-tree changes** (`.opencode/` agent descriptors, job descriptions,
   `AGENTS.md`, new auditor agents, deletion of `lane-auditor.md`) are uncommitted and out of scope
   for this product audit. They do not affect the product tree at the audited SHA.
2. **Wix Live gates remain OPEN** (`docs/PRODUCT_GATES.json` shows all 11 gates OPEN; `state.json`
   phase `build`, cycle 21, `NOT_READY`). Real Wix scaffold/empirical/build proof requires the
   human-owned `WIX_API_KEY` and a dedicated Development Site — an external prerequisite, not a
   product defect. The code honestly marks unverified Wix capabilities (`PLANNED_UNTIL_T_VP0`,
   `UNPROVEN` metadata) rather than claiming them.
3. **RESCHEDULE is FAIL_OPEN** in the validation plugin. This is a documented, deliberate policy
   choice (Wix native reschedule behavior is not fully proven), surfaced honestly. It is not a
   regression and does not contradict the contract.

---

## 4. Conclusion

The assembled product tree at `ec916b75` (product = parent `e5dda6b1`) satisfies the binding
contracts across integration, rules, dashboard, and billing. Canonical DTOs are shared, not forked;
the domain core is pure and Wix-free; billing policy is fail-open-degraded and never deletes
configuration on downgrade; schedule mutation is snapshot→diff→apply→verify→rollback with explicit
consent and no silent destructive rewrites; the dashboard consumes typed contracts through a single
guarded bridge and never weakens validation/accessibility. All deterministic checks pass (548 vitest
+ 210 UI tests + typecheck + purity gate). The only remaining gates are the human-owned Wix Live
prerequisites, which are external and non-terminal.

VERDICT: ACCEPT
