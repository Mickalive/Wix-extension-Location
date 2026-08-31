# Factory Integrated Audit — Wix Bookings Advanced Rules

**Auditor role:** integrated-auditor (fresh cross-system reviewer; independent of all builders and lane auditors)
**Candidate SHA:** `e3be155e5a3887fbf72333029c430e4c788b5c20` (HEAD)
**Candidate:** `candidate(integration): generation 114` — INT-REPAIR-111
**Scope:** full integrated product at HEAD, with focus on the candidate commit's registration-binding repair and the cross-lane contracts between integration, rules, dashboard, and billing, plus failure/rollback behavior.
**Date:** 2026-08-31

---

## 1. Executive summary

The candidate is an integration-lane repair (INT-REPAIR-111) that adds `src/platform/registration/{index.ts,registrationBinding.ts}` and `tests/platform/registration-binding.spec.ts`. It addresses four audit findings from the prior registration-surface review. I verified the repair is correct, in-scope, and consistent with the binding contracts, and that the broader integrated product's cross-lane contracts (integration ↔ rules ↔ dashboard ↔ billing) and failure/rollback behavior are coherent.

**Verdict: ACCEPT.**

---

## 2. Deterministic verification (run in this audit)

| Check | Result |
|---|---|
| `npm test` (vitest, 50 files) | **568/568 passed** |
| `npm run typecheck` (`tsc --noEmit`) | **passed** (no errors) |
| `npm run check:purity` (via `npm test` preamble) | **passed** — "Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration." |

Note: the `PURITY GATE FAILED` text in the test output is emitted by `tests/platform/purity-gate.spec.ts`, which intentionally creates fixture files containing `@wix/` imports to prove the gate catches them. It is a test of the gate, not a real failure; the actual `check:purity` step passed.

The candidate's own spec (`tests/platform/registration-binding.spec.ts`, 20 tests) and the related `registration-surface.spec.ts` (17 tests) and `registration-project-config.spec.ts` (13 tests) all pass.

---

## 3. Candidate commit scope and lane boundary

The candidate adds only:
- `src/platform/registration/index.ts` (re-exports)
- `src/platform/registration/registrationBinding.ts` (new binding utilities)
- `tests/platform/registration-binding.spec.ts` (new tests)

All three are inside the integration lane's allowed scope (`src/platform/**`, `tests/platform/**`). No domain, dashboard, or billing files were touched. The lane boundary is respected.

The working tree contains uncommitted changes to governance files (`.opencode/**`, `AGENTS.md`) and untracked auditor fiches. These are **not** part of the candidate SHA and are outside product scope; I did not audit them as product code.

---

## 4. INT-REPAIR-111 findings — verified fixes

### FINDING-1 (HIGH/BLOCKING): repoRootFromImportMeta three-parent traversal
`registrationBinding.ts` `repoRootFromImportMeta` now uses `new URL('../../..', importMetaUrl)`, correctly traversing three parents from `src/platform/registration/` to the repo root (the buggy version used two, landing on `src/`). The test simulates a module URL at `src/platform/registration/registrationBinding.ts` and asserts the resolved root equals `process.cwd()` and contains `package.json` and `src/`, and explicitly asserts it does **not** land on `src`. **Correct.**

### FINDING-2 (HIGH/BLOCKING): tests must not hard-depend on gitignored wix.config.json
`loadRealBindingFromRepoRoot` returns `FILE_NOT_FOUND` on absent config; tests skip gracefully when the real file is absent (e.g. the "real wix.config.json linkage" test returns early when the file does not exist). The `.gitignore` structural guarantee is asserted (`/^wix\.config\.json$/m`). **Correct.**

### FINDING-3 (MEDIUM): no hardcoded account-specific appId
Tests use structural assertions (`isValidAppIdStructure`, `looksLikeScaffoldPlaceholder`) rather than account-specific values. The anti-fabrication test asserts `registrationBinding.ts` does not contain `/3e9ec3af/i` (the bound App ID). The committed `wix.config.example.json` carries only the placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` and classifies as UNLINKED. **Correct.**

### FINDING-4 (LOW): anti-fabrication tests must contain real expect() assertions
The FINDING-4 block contains real `expect()` assertions (UUID-like shape scan, SDK-import-shape scan, byte-equality pin of the example template). **Correct.**

---

## 5. Cross-lane contract verification

### 5.1 Integration ↔ Rules (validation targets / failure semantics)
- `src/platform/validation-plugin/targets.ts` defines the six `ValidationTarget`s and maps them onto the canonical three-operation `EvaluationTarget` union via `evaluationTargetOf` (strip `_MULTI_SERVICE`). This is the single source of truth.
- `src/platform/registration/validationExtension.ts` derives `VALIDATION_TARGETS` from `../validation-plugin/targets.ts` (test-enforced: `registration-surface.spec.ts` asserts the registered config's targets equal `VALIDATION_TARGETS` exactly, length 6, canonical order). No drift between the registered surface and the implemented handler matrix.
- Failure semantics (`src/shared/errors.ts` `failureSemanticsFor`): CREATE/CANCEL → FAIL_CLOSED; RESCHEDULE → FAIL_OPEN. This matches the binding platform facts (Contract §5.3). The handler matrix (`handlers.ts`) implements these: fail-closed targets block every item with a retry hint on internal error/timeout; RESCHEDULE fails open forever with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'` and never claims enforcement.
- Target-aware evaluation in `src/domain/evaluate.ts`: CANCEL evaluates classification families only (frees capacity); RESCHEDULE evaluates availability against the proposed slot and excludes the subject booking via `subjectBookingId` (inert by default until evidence-backed payload access). Consistent with the domain port contract.

### 5.2 Integration ↔ Billing (entitlement composition)
- `src/platform/composition/entitlementComposition.ts` wires `projector → projectedSnapshotSource → createEntitlementGate → ValidationPluginDeps.entitlementGate` and the `GET /meter` source. The only surface crossing into billing is the accepted `AppInstanceBillingSnapshot` shape behind `BillingInstancePort` (test-pinned in `composition-root.spec.ts`).
- The validation handler consumes the gate: healthy decision + uncovered location ⇒ rule evaluation skipped (native Wix applies); degraded decision ⇒ fail-open coverage; throwing gate ⇒ synthetic degraded decision (billing failure never blocks a booking). Consistent with Contract §7/§11 C5.

### 5.3 Integration ↔ Dashboard (meter DTO)
- `src/platform/http/meterEndpoint.ts` pins the response DTO `{ meter: { count, degraded }, coverage: { allowedLocationIds, overLimit, degraded, warning } }`.
- `src/ui/services/bridge.js` `getEntitlementMeter()` consumes the identical pinned DTO with strict shape validation (`isEntitlementMeterDto`), surfacing `BAD_RESPONSE` on drift — the dashboard never renders entitlement state invented from a drifted payload. Consistent.

### 5.4 Dashboard ↔ Billing (downgrade / entitlement restriction)
- `src/ui/pages/rulesEditorPage.js` (DASH-C5-1): locations outside `coverage.allowedLocationIds` are badged + disabled for NEW rule configuration; EXISTING configuration stays rendered read-only and is never deleted; degraded coverage fails open (restricts nobody off an unreliable list); anti-trap rule keeps controls contributing validation issues correctable.
- `src/billing/enforcement/entitlementGate.ts` + `tests/billing/downgradeThroughGate.spec.ts`: auto-renewal cancellation alone never shrinks coverage (merchant stays paid until period end); period-end confirming snapshot downgrades coverage with stable ordering (default location first, then alphabetical); user configuration is never deleted (byte-identical across all steps); over-limit surfaces as an upgrade-CTA state, not an incident. Consistent with the billing lane fiche ("never deletes customer configuration on downgrade") and Contract §7.

### 5.5 Accessibility-sensitive dashboard behavior
- `rulesEditorPage.js` and `locationsUsagePage.js` use `role="status"`, `role="alert"`, `aria-live="polite"`, `aria-label`, and native buttons/anchors. Loading uses `role="status"`; degraded/error states use `role="alert"`. Upgrade CTAs open in a new tab with `rel="noopener noreferrer"` and descriptive `aria-label`. No accessibility regression introduced by the candidate.

---

## 6. Failure / rollback / recovery behavior

### 6.1 Schedule mutation (Contract §9)
`src/platform/schedule-mutation/orchestrator.ts` implements the full sequence: snapshot-before-write (journal baseline persisted before any write), idempotent writes (deterministic UUIDv5 keys), revision-checked updates with bounded retries, verify-before-mark-applied, rollback on failure, and crash recovery via `recoverInterruptedApply`. Terminal-state hardening rejects every terminal journal state before any gateway call (no double-rollback, no second audit entry). Crash semantics intentionally leave `APPLY_IN_PROGRESS` so a dying process is never trusted to roll back; the next run resumes or recovers from the persisted snapshot. Consistent with Contract §9 and gate T-RB1.

### 6.2 Webhooks (Contract §6)
`src/platform/webhooks/pipeline.ts` honors the 1250 ms deadline (no network I/O beyond injected ports), ≤12 retries (Wix redelivery is the recovery driver), dedup on envelope `id`, and out-of-order buffering via `entityEventSequence`. Signature verification happens before any store interaction (fail closed). Consistent with the binding platform constraints.

### 6.3 HTTP auth (Contract §6)
`src/platform/http/auth.ts` `requireVerifiedCaller` fails closed on missing/invalid/expired tokens and on verifier infrastructure failure, before any store interaction. Consistent with the binding fact that HTTP endpoints have no built-in permission model.

### 6.4 Billing fail-open
`entitlementGate.ts` fails open on billing/counting/listing infrastructure errors (degraded decisions never block bookings), with per-source warning liveness. The meter endpoint degrades each half independently and always returns 200 after authentication. Consistent with Contract §7/§11 C5.

---

## 7. wix.config.json / scaffold binding

- The working-tree `wix.config.json` (gitignored, line 19 of `.gitignore`) contains `appId: 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId: advanced-booking-rules`, `projectType: App`. This matches the persisted `reports/wix-live/BOOTSTRAP_BINDING.md`, which records the authenticated binding of the existing Wix app **Advanced Booking Rules** (App ID `3e9ec3af-001b-4684-a197-a5133677844d`). The integration lane is permitted to repair the real non-secret `wix.config.json` only while preserving the bound existing App ID; the App ID is preserved. No credential is present in the file.
- The committed `wix.config.example.json` carries only the placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` and classifies as UNLINKED by `classifyProjectBinding` (byte-equality pinned).
- The candidate commit does not touch `wix.config.json`; it is not part of the candidate SHA.
- **Note (non-blocking, Director-owned):** `docs/PRODUCT_GATES.json` still lists `real_wix_scaffold_registration` as `OPEN` with no evidence, and `docs/state.json` reports `last_result: NOT_READY` / `product_promoted: false`. The `BOOTSTRAP_BINDING.md` report claims the binding was established, but the gate ledger has not been updated. This is a Director ledger responsibility, not a defect in the candidate commit, and does not affect the integrability of this candidate. The candidate makes no claim of real Wix registration or readiness.

---

## 8. Anti-fabrication / honesty

- No UUID-like or account-specific identifier shapes in the registration source modules (test-enforced).
- No `@wix/` SDK imports in protected paths (purity gate enforced).
- The registration surface explicitly documents that nothing is registered yet (`PLANNED_UNTIL_T_VP0`), that the exact app-project field set is UNVERIFIED (UQ4), and that reschedule enforcement is best-effort. No production-capability claim is made.
- The candidate does not fabricate Wix capabilities, IDs, credentials, or readiness.

---

## 9. Findings

No blocking findings. The candidate is correct, in-scope, and consistent with the binding contracts and cross-lane contracts.

Non-blocking observations (Director-owned, not candidate defects):
1. `PRODUCT_GATES.json` `real_wix_scaffold_registration` remains `OPEN` despite `BOOTSTRAP_BINDING.md` recording a binding; the ledger should be reconciled by the Director when the gate is genuinely proven by live evidence.
2. The working-tree governance changes (`.opencode/**`, `AGENTS.md`) are uncommitted and outside the candidate; they should be handled by the trusted workflow, not by product lanes.

---

## 10. Conclusion

The candidate commit `e3be155e5a3887fbf72333029c430e4c788b5c20` correctly repairs all four INT-REPAIR-111 findings, stays within the integration lane's scope, passes all deterministic checks (568 tests, typecheck, purity gate), and is consistent with the cross-lane contracts between integration, rules, dashboard, and billing, including failure/rollback/recovery behavior. The integrated product is coherent and honest about its scaffold state.

VERDICT: ACCEPT
