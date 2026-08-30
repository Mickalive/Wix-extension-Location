# Integrated Cross-System Audit — exact candidate SHA `ec916b75d5600e02d679d264648ac92333d721f1`

- **Auditor:** independent integrated auditor (fresh cross-system reviewer; distinct from all builders and prior lane auditors). Read-only except this report. No product code, planning, or governance modified. No Wix credentials accessed.
- **Subject:** the exact integrated candidate at SHA `ec916b75d5600e02d679d264648ac92333d721f1` (working tree product code read as-is; the only uncommitted changes are governance/agent-fiche restructuring under `.opencode/**` and `AGENTS.md`, which are outside product scope and not part of this audit).
- **Method:** adversarial cross-lane contract verification across integration, rules, dashboard, and billing, plus failure/rollback behavior. Every load-bearing claim re-derived from source; no builder intent consulted.
- **Execution note:** the sandbox denies arbitrary command execution (only `git status`/`git diff` and npm test/check/build patterns are permitted), so runtime probes were assessed statically against the shipped suites and source. The two blocking findings below are proven by direct source-to-source contract comparison, not by runtime.

---

## 1. Scope and composition

The candidate is the integrated product at the pinned SHA. Product code spans:
- **Integration:** `src/platform/{validation-plugin,schedule-mutation,http,composition,registration,adapters,webhooks}`, `wix.config.json` (real binding), `extensions.ts`.
- **Rules:** `src/domain/**` (pure deterministic core + canonical ports).
- **Dashboard:** `src/ui/**`, `src/extensions/dashboard/**`.
- **Billing:** `src/billing/**`, `src/platform/composition/entitlementComposition.ts`.

Governance/Director-owned paths (`MAIN_PROMPT.md`, workflows, `docs/state.json`, `NEXT_CYCLE.*`, contract/blueprint, gates) are outside the candidate and were not modified by it.

---

## 2. BLOCKING FINDINGS — cross-lane contract mismatches (dashboard bridge ↔ platform HTTP endpoints)

These are genuine, previously-uncaught cross-lane contract violations. The dashboard's two core write flows (save a rule set, apply a plan) cannot succeed against the real platform endpoints. No test catches them because the bridge tests use a mock transport and the endpoint tests use a fake bridge — there is no bridge→endpoint integration test.

### F-1: `saveRuleSet` (bridge) sends the wrong body shape for `putRuleSet` (endpoint)

- **Bridge** (`src/ui/services/bridge.js` L291–293):
  ```js
  saveRuleSet(ruleSet) {
    return request('/ruleset', { method: 'PUT', body: ruleSet });
  }
  ```
  The body is the `ruleSet` object **directly** (e.g. `{ ruleSetId, revision, version, locationWindows, ... }`).
- **Endpoint** (`src/platform/http/ruleSetEndpoints.ts` `putRuleSet` L240–246):
  ```ts
  if (!isRecord(request.body) || !isRecord(body?.ruleSet)) {
    throw new PlatformError('INVALID_QUERY', 'body must be { ruleSet, expectedRevision }');
  }
  if (typeof body?.expectedRevision !== 'string' || body.expectedRevision === '') {
    throw new PlatformError('INVALID_QUERY', 'expectedRevision (non-empty string) is required');
  }
  ```
  The endpoint requires a wrapper `{ ruleSet, expectedRevision }`. The bridge sends the ruleSet as the top-level body, so `body.ruleSet` is `undefined` (not a record) and `body.expectedRevision` is `undefined` → **INVALID_QUERY (400)**.
- **Caller** (`src/ui/pages/rulesEditorPage.js` `handleSave` L894): `bridge.saveRuleSet(store.getState().draft)` — sends the draft directly.
- **Endpoint test** (`tests/platform/http-ruleset.spec.ts` L82) confirms the endpoint only accepts `{ ruleSet, expectedRevision }`.
- **Bridge test** (`tests/ui/bridge.test.js` L129–141) only asserts path/method, never the body shape against the endpoint contract.
- **Impact:** the dashboard **cannot save a rule set**. The save flow always fails with 400.

### F-2: `requestApply` (bridge) sends an extra `ops` key that `postApplyPlan` (endpoint) rejects

- **Bridge** (`src/ui/services/bridge.js` L298–303):
  ```js
  requestApply(ops, confirmedDiffHash) {
    return request('/apply-plan', {
      method: 'POST',
      body: { ops, confirmedDiffHash },
    });
  }
  ```
  Body is `{ ops, confirmedDiffHash }`.
- **Endpoint** (`src/platform/http/mutationEndpoints.ts` `postApplyPlan` L90–98):
  ```ts
  const keys = Object.keys(request.body);
  const unexpected = keys.filter((k) => k !== 'confirmedDiffHash');
  if (unexpected.length > 0 || typeof request.body.confirmedDiffHash !== 'string') {
    throw new PlatformError('INVALID_QUERY', ...);
  }
  ```
  The endpoint accepts **exactly** `{ confirmedDiffHash }` and rejects any extra key. The bridge's `ops` key is an unexpected key → **INVALID_QUERY (400)**.
- **Caller** (`src/ui/pages/rulesEditorPage.js` `handleApply` L924): `bridge.requestApply(ops, state.confirmedHash)`.
- **Endpoint test** (`tests/platform/http-mutations.spec.ts` L107–119) explicitly proves an extra key (`planId`) is rejected with `INVALID_QUERY` and zero orchestrator execution; `ops` is rejected identically.
- **Bridge test** (`tests/ui/bridge.test.js` L112–127) asserts the bridge sends `ops` in the body — the exact shape the endpoint rejects.
- **Impact:** the dashboard **cannot apply a plan**. The apply flow always fails with 400 before any schedule mutation.

### Why these are blocking

The product's core promise is "one app that controls WHEN/WHERE/UNDER WHAT CONDITIONS a booking may happen," configured through the Wix dashboard. The dashboard's two primary write operations — persisting a rule set and applying a confirmed schedule diff — are both broken end-to-end against the platform transport. This is a cross-lane contract violation between the dashboard lane (bridge) and the integration lane (HTTP endpoints), exactly the class of defect the integrated audit exists to catch. The thin `src/pages/api/*` adapters (deferred to scaffold) only parse the body and pass it through — they do not and cannot reconcile the shape mismatch.

---

## 3. Verified-correct contracts (no finding)

The following cross-lane contracts are consistent and correct:

- **Meter DTO parity:** `getEntitlementMeter()` (bridge) ↔ `getEntitlementMeter` (endpoint) both use the pinned `{ meter: { count, degraded }, coverage: { allowedLocationIds, overLimit, degraded, warning } }` shape. Bridge strictly validates the pinned DTO (`isEntitlementMeterDto`) and surfaces `BAD_RESPONSE` on drift; endpoint composes the same shape from `gate.meter()` + `gate.allowedLocationIds()`. ✓
- **Mutation-status:** bridge `getMutationStatus(planId)` → GET `/mutation-status?planId=` ↔ endpoint reads `request.query.planId`. ✓
- **Recover:** bridge `recover(scope)` → POST `/recover` body `{ scope }` ↔ endpoint `postRecover` expects `{ scope }`. ✓
- **Auth fail-closed:** every endpoint begins with `requireVerifiedCaller`; missing/invalid/expired tokens and verifier failures all reject with typed `UnauthorizedRequestError` (401) before any store interaction. ✓
- **Apply-plan security posture (endpoint side):** `postApplyPlan` accepts only a confirmed-diff hash reference, rejects inline plans and extra keys, resolves the plan through `ConfirmedPlanLookup`, and executes the exact confirmed plan. This is correct and strong — the defect is purely that the bridge sends the wrong body, not that the endpoint is weak. ✓
- **RuleSet structural validation:** `validateRuleSetStructure` enforces shape/enums/calendar dates; domain seam plugs in for temporal semantics. ✓

---

## 4. Rules core (domain) — verified

- `src/domain/evaluate.ts`, `validate.ts`, `ports.ts`, `limits/duplicates/windows/exceptions/time` implement pure deterministic semantics with no Wix/network/fs dependency (purity gate enforced).
- Target-aware evaluation: `evaluationTargetOf`/`semanticsOf` map the six platform targets onto the three-member `EvaluationTarget` union; `failureSemanticsFor` is the single source of the CREATE/CANCEL fail-closed vs RESCHEDULE fail-open mapping. Consistent across domain, platform, and registration surface.
- Timezone/DST handling via `instantForLocalWall` and UTC-bounded count queries; half-open bucket conventions are consistent between limits and duplicates.
- No fabrication of Wix identifiers; ports are injected.

---

## 5. Billing / entitlement — verified

- `src/billing/pure/{tiers,entitlement,coverage}.ts`, `counter/*`, `projection/*`, `enforcement/entitlementGate.ts` implement plan recognition, location-count policy, and entitlement gating.
- **Fail-open posture:** a throwing gate ⇒ synthetic degraded fail-open decision (`restrictionReliable:false`); billing failures never block bookings (Contract §7/C5). Degraded ⇒ no coverage skip + persisted `ENTITLEMENT_DEGRADED`.
- **Downgrade safety:** paid tiers differ only by location allowance; no customer configuration is deleted on downgrade.
- **Composition:** `entitlementComposition.ts`/`reconciliation.ts` wire billing → enforcement; meter endpoint and editor restriction both consume `allowedLocationIds()` from the same gate decision (no forked semantics).
- Counter floor semantics and reconciliation supremacy are consistent.

---

## 6. Failure / rollback behavior — verified sound

- **Orchestrator** (`src/platform/schedule-mutation/orchestrator.ts`): snapshot-before-write (journal baseline persisted before any write), idempotent UUIDv5 writes, revision-checked updates with bounded retry, verify-then-commit, rollback from persisted snapshot on failure, crash recovery via `recoverInterruptedApply` restoring exact pre-apply state, terminal-state guards (`assertNotTerminal`) preventing re-verify/re-rollback/re-audit.
- **Idempotency:** deterministic UUIDv5 keys; replay yields `SKIPPED_ALREADY_APPLIED`.
- **Webhooks:** dedup by envelope id + `entityEventSequence` ordering.
- **No silent destructive schedule rewrites:** apply-plan requires a user-confirmed diff hash; the diff-confirm modal shows exactly what will change before any mutation.
- **Counter cache:** short-TTL (2s) injected-clock cache; gateway failures degrade to cap degradation + `COUNT_GATEWAY_FAILURE` incidents, never a thrown error into the booking decision.
- **Degradation seam:** `safeRecord` guards sink writes so monitoring never alters a booking outcome; records always surface in `degradations[]`.

---

## 7. Accessibility-sensitive behavior — verified

- `tests/ui/accessibility.test.js` asserts accessible names on every control, keyboard operability (Enter/Space), dialog semantics for the diff modal, and `role=alert`/`role=status`+`aria-live` live regions.
- Editor restriction under entitlement coverage degrades to the unrestricted editor behind non-blocking notices (no weakened validation to pass tests).
- Diff-confirm modal requires explicit user intent before any schedule mutation.

---

## 8. Real Wix scaffold assumptions — verified

- `wix.config.json` now carries a real binding: appId `3e9ec3af-001b-4684-a197-a5133677844d`, projectId `advanced-booking-rules`, projectType `App`. `reports/wix-live/BOOTSTRAP_BINDING.md` confirms the real binding and a real `wix build` succeeded; no credentials persisted.
- `extensions.ts` is intentionally empty (`EXTENSIONS = Object.freeze([])`) — scaffold-owned; the registration inventory (`src/platform/registration/extensionsManifest.ts`) declares every planned extension with honest `PLANNED_UNTIL_T_VP0` status and contract-exact channels.
- `buildBookingsValidationExtensionConfig()` derives `validationTargets` from `VALIDATION_TARGETS` (single source of truth), so the registered surface cannot drift from the implemented handler matrix.
- `docs/PRODUCT_GATES.json` honestly keeps all 11 gates `OPEN`; `docs/state.json` reports `last_result: NOT_READY`. No fabricated Wix capability, ID, or readiness claim.

---

## 9. Non-blocking observations (record; no repair required for these)

1. **O1:** the bridge's `getActiveRuleSet()` returns the raw `{ ruleSet }` body; the rules editor page does not appear to call it at all (no `getActiveRuleSet`/`loadActiveRuleSet` reference in `src/ui/pages/rulesEditorPage.js`). If the editor is expected to load a previously saved rule set, this path is unused/latent. Not blocking the two write-flow findings, but worth confirming the editor's initial-load path at scaffold time.
2. **O2 (inherited):** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal; self-authored at scaffold time, minimal exposure.
3. **O3 (standing):** simulated-Wix QA has never completed; all dev-site gates await human credentials. Not affected by this candidate.

---

## 10. Verdict rationale

The candidate is well-engineered in most respects: the rules core is pure and deterministic; billing composes fail-open with downgrade safety; the orchestrator's snapshot→diff→apply→verify→rollback and crash-recovery machinery is sound; auth is fail-closed on every endpoint; accessibility is asserted; the real Wix binding is present and honestly gated.

However, the integrated product contains **two definitive, blocking cross-lane contract mismatches** between the dashboard bridge and the platform HTTP endpoints:

- **F-1:** `saveRuleSet` sends `body: ruleSet` but `putRuleSet` requires `{ ruleSet, expectedRevision }` → the dashboard cannot save a rule set.
- **F-2:** `requestApply` sends `{ ops, confirmedDiffHash }` but `postApplyPlan` accepts exactly `{ confirmedDiffHash }` and rejects extra keys → the dashboard cannot apply a plan.

These break the product's two core dashboard write flows end-to-end and are not caught by any test (bridge tests use a mock transport; endpoint tests use a fake bridge). They are exactly the class of cross-lane defect this integrated audit exists to surface. Because the dashboard cannot persist configuration or apply schedule changes, the product is not coherent as an integrated whole.

VERDICT: FIX
