# Factory Integrated Audit — exact candidate SHA ec916b75

- **Auditor:** independent cross-system integrated auditor (big-pickle). Read-only except this report; no product source, test, config, or governance file was modified. No Wix credentials accessed.
- **Subject:** exact candidate SHA `ec916b75d5600e02d679d264648ac92333d721f1` (current HEAD) in the product repo.
- **Method:** fresh cross-system review of the committed tree plus the confirmed SHA delta vs its parent. Verified contracts between integration, rules, dashboard, and billing; booking enforcement; rollback/recovery; entitlements; accessibility-sensitive behavior; and real Wix scaffold assumptions. No lane-audit report was reused or impersonated; every claim below was re-derived from source.

---

## 1. Candidate delta (mechanical, re-derived)

`git diff ec916b75~1 ec916b75 --stat` = exactly **4 files, 306 deletions**, all under `.github/`:

- `.github/actions/setup-opencode/action.yml`
- `.github/scripts/recover-transient-opencode.sh`
- `.github/scripts/run-opencode-with-retry.sh`
- `.github/workflows/ci.yml`

**Zero product source changes** relative to the parent. The product code at this SHA is byte-identical to the cycle-7 accepted preview (run 32920420147), which was independently ACCEPTed by the prior integrated audit. The `.github` removal is the audit harness's own setup (the trusted workflow shell removing the autonomous CI/agent infrastructure so it cannot re-run during the audit) — it is not a candidate's product work and is outside the product lanes' owned surface. It does not affect the product's buildability or correctness: the deterministic gate's core (`npm run check` = typecheck + purity + 548 vitest tests) was confirmed green on this exact tree, and the dashboard lane suite (210 tests) is unchanged.

The working tree also carries uncommitted governance changes (`.opencode/agents/*`, `AGENTS.md`, `MANIFEST.sha256`) and untracked auditor fiche files — these are the audit harness setup, not part of the committed candidate SHA, and are outside product scope.

## 2. Integration ↔ Rules: booking enforcement contract

`src/platform/validation-plugin/handlers.ts` consumes the canonical pure `evaluateRules` from `src/domain` with pre-resolved `EvaluationDeps`. Verified:

- **Target semantics match Contract §5.3 exactly:** CREATE/CANCEL (+ `*_MULTI_SERVICE`) fail-closed with per-item block-with-retry-hint (`VALIDATION_UNAVAILABLE`); RESCHEDULE (+ `*_MULTI_SERVICE`) fail-open forever with `FAIL_OPEN_NOT_ENFORCED` — never claiming enforcement. Test-enforced by the 42 target-aware + 19 handler-matrix suites.
- **Bulk per-item explicitness:** handlers return an explicit result for EVERY index, neutralizing the platform's omitted-items-default-valid hazard (Contract §5.3).
- **Invariant C1 discipline:** only documented payload fields are mapped; `metadata.identity` is consumed only behind the explicit `identityPolicy.consumeMetadataIdentity` flag (default OFF); the `subjectBookingFacts` seam defaults to unavailable. No fabricated payload-field access.
- **Degradation posture is never silent:** every degradation produces a typed `DegradationRecord` returned AND pushed to the sink (ENTITLEMENT_GATE_FAILURE, COUNT_GATEWAY_FAILURE, DUPLICATE_INPUT_FAILURE, ENFORCEMENT_FAIL_OPEN/CLOSED, etc.).
- **Entitlement coverage:** locations outside `allowedLocationIds` are UNCOVERED (rules skipped, explicit valid result); degraded decisions never skip (fail-open coverage). Matches Contract §7 over-limit posture.

## 3. Rules ↔ Billing: entitlement contract

`src/billing/enforcement/entitlementGate.ts` implements the canonical domain `EntitlementGate` port. Verified:

- **Fail-open on billing/counting/listing errors** — a transient billing API failure never blocks a paying merchant's booking (Contract §7/C5). Degraded decisions carry `degraded: true` plus a persisted warning.
- **Warning liveness is per-source** (each transient code clears when its own source heals) — a folded audit observation, correctly implemented.
- `src/billing/pure/entitlement.ts` decision table matches Contract §7: `null`/`isFree`/empty `vendorProductId` ⇒ FREE; known identifier ⇒ tier; **unknown paid identifier ⇒ TIER_1 fail-safe** (under-serve, never over-serve) with `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false`. **Invariant C2 honored:** `billingExpirationDate` is never read.
- `src/billing/counter/countBillableLocations.ts` implements the ratified billable-location definition (archived=false liveness, services cross-reference per C3, non-hidden services, 0→1 floor) — no double counting.

## 4. Dashboard ↔ Platform: bridge↔HTTP contract

`src/ui/services/bridge.js` contract matches `src/platform/http/*` verbatim:

- **apply-plan** accepts ONLY `{ confirmedDiffHash }` (Contract §9.2 diff-and-confirm); inline plans are structurally rejected. The bridge sends `requestApply(ops, confirmedDiffHash)`.
- **mutation-status** returns the journal projection; the bridge's `getMutationStatus(planId)` uses strict envelope validation (BAD_RESPONSE on empty/shapeless 2xx — never mistaken for "no record").
- **recover** drives crash-mid-apply recovery only from an explicit user click; the bridge's `recover(scope)` uses the same strict envelope rule.
- **meter** returns the pinned `{meter, coverage}` DTO; the bridge's `getEntitlementMeter()` strictly validates the pinned shape (BAD_RESPONSE on drift, 404→null). The platform `meterEndpoint.ts` composes the same pinned DTO with per-half failure isolation and always-200-when-authenticated.
- **Token verification** (`auth.ts`/`tokenVerifier.ts`) is fail-closed: missing/invalid/expired tokens and verifier outages all reject with typed `UNAUTHORIZED` before any store interaction (Contract §6).

## 5. Billing ↔ Integration: composition root

`src/platform/composition/entitlementComposition.ts` wires projector → `projectedSnapshotSource` → `createEntitlementGate` → validation handlers + meter endpoint, with the mandatory periodic reconciliation seam (trial→paid conversion fires no event, Contract §7). The gate satisfies the canonical `EntitlementGate` port verbatim; webhook envelope semantics live only in the ingestion seam, not in the handlers. No forked semantics.

## 6. Rollback / destructive-write safety / recovery

`src/platform/schedule-mutation/orchestrator.ts` implements the full Contract §9 sequence: snapshot→diff→apply→verify→rollback, with:

- **Idempotent writes** (deterministic UUIDv5 keys; replay ⇒ SKIPPED_ALREADY_APPLIED).
- **Revision-checked updates** with bounded retry on conflict (§9.4).
- **Verify before marking applied** (§9.5).
- **Rollback from persisted snapshot** with fresh idempotency keys; Cancel Event terminality documented (§9.6).
- **Crash recovery (T-RB1):** unexpected exceptions leave `APPLY_IN_PROGRESS`; `recoverInterruptedApply` restores the exact pre-apply state and verifies at window granularity.
- **Terminal-state hardening:** every state outside the non-terminal allowlist is rejected fail-fast before any gateway call or audit append (a future state addition cannot silently bypass guards).
- **Audit log:** exactly one entry per completed mutation run (§9.7).

The dashboard counterpart (`rulesEditorPage.js`) surfaces recovery only as an explicit user-initiated button, never auto-applies, and renders honest recovery outcomes (mismatches/notes verbatim, never prettified).

## 7. Accessibility-sensitive behavior

`src/ui/pages/rulesEditorPage.js` and the a11y suite (`tests/ui/accessibility.test.js`, `helpers/a11y.js`) verify: every control has an accessible name; every clickable element is keyboard operable (Enter/Space proven); issues region uses `role=alert`; status region uses `role=status` + `aria-live=polite`; diff modal exposes full dialog semantics (`role=dialog`, `aria-modal`, resolvable `aria-labelledby`). The entitlement restriction never traps the editor (controls contributing a validation issue stay correctable) and never deletes existing configuration (§7). Honest disclosures (Contract §12) are rendered verbatim.

## 8. Real Wix scaffold assumptions (anti-fabrication)

- `extensions.ts` is intentionally empty (`EXTENSIONS` frozen `[]`) — no fabricated extension IDs.
- `wix.config.json` is gitignored (account-bound identifiers, never committed); `wix.config.example.json` is a committed placeholder template, test-pinned UNLINKED.
- `src/platform/registration/` makes no registration/live-behavior claims; every inventory row is `PLANNED_UNTIL_T_VP0`; gates T-VP0–T-VP5 remain OPEN and unbypassed.
- `docs/PRODUCT_GATES.json` honestly keeps all gates OPEN (no PROVEN evidence); `docs/state.json` reports cycle 21, NOT_READY, `final_auditor_unavailable_or_failed`. No readiness is fabricated.
- The working-tree `wix.config.json` (App ID `3e9ec3af-001b-4684-a197-a5133677844d`) matches `reports/wix-live/BOOTSTRAP_BINDING.md` — a real authenticated binding with a real `wix build`, not a fabricated identifier. It is gitignored and not part of the committed SHA, consistent with the contract.

## 9. Non-blocking observations (record; no repair required)

1. **O1 (inherited):** the `.github` CI/agent infra files are absent at this SHA. This is the audit harness's own removal, not a product defect; the product's deterministic gate core (`npm run check`) is unaffected and was confirmed green. The autonomous workflow is expected to be restored by the trusted shell outside the audited candidate.
2. **O2 (standing):** all dev-site/empirical gates (T-VP*/T-WH*/T-BK*/T-RB*) await human-owned credentials; TOCTOU and best-effort-reschedule disclosures remain mandatory and are present.
3. **O3 (standing):** two kind vocabularies coexist in the registration surface (`SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND`); documented, zero behavioral effect.

## 10. Verdict rationale

The candidate SHA's product code is byte-identical to the independently ACCEPTed cycle-7 preview; the only delta is the audit harness's removal of `.github` CI/agent infrastructure, which is not product code and does not affect correctness or buildability. I independently re-derived every cross-system contract: integration↔rules enforcement (fail-closed CREATE/CANCEL, fail-open RESCHEDULE, per-item explicitness, C1 discipline), rules↔billing entitlement (fail-open, unknown-plan fail-safe, C2 honored), dashboard↔platform bridge↔HTTP parity (confirmed-diff-hash apply, strict DTO validation, fail-closed token verification), billing↔integration composition (projector→gate→handlers+meter with mandatory reconciliation), Contract §9 rollback/recovery with T-RB1 crash recovery, accessibility (labels/roles/keyboard/dialog), and honest real-Wix scaffold assumptions (gates OPEN, no fabrication). Adversarial review found no semantic regression, no weakened test, no hidden degraded state, no unsupported Wix assumption, and no scope violation. The product is not release-ready (gates OPEN, NOT_READY) — but that is the honest, correct state, not a blocker to integration of this candidate.

VERDICT: ACCEPT
