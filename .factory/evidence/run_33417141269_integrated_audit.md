# Integrated Cross-System Audit — Integration Lane Candidate

- **Auditor role:** cross-system integrated auditor (fresh, independent of all builders and prior lane auditors)
- **Candidate SHA:** `71e2bc6290731c3997e42c00c59381129b1b23ac` (integration lane, generation 194)
- **Working tree match:** verified — `git diff 71e2bc6...` returns no output for the four candidate files
- **Date:** 2026-08-31
- **Scope:** integration / rules / dashboard / billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior, and real Wix scaffold assumptions

---

## 1. Candidate scope

The candidate modifies exactly four files, all in the integration lane's registration surface:

1. `src/platform/registration/README.md` — documents the observed real scaffold shape.
2. `src/platform/registration/exampleProjectConfig.ts` — adds the `projectId` field to the committed shape template.
3. `tests/platform/registration-project-config.spec.ts` — adds a test asserting the real `wix.config.json` classifies as `LINKED` with the observed App ID.
4. `wix.config.example.json` — adds the `projectId` field.

The change is a direct response to task `INT-C7-LIVE`: "Validate the generated project metadata, adapt only the integration/registration surface required for the unified Wix CLI project." It resolves the previously-quarantined UQ4 uncertainty about the exact `wix.config.json` field set using real scaffold evidence.

## 2. Real Wix scaffold assumptions

The candidate's central claim is that the real Wix CLI scaffold produces exactly three fields — `projectType`, `projectId`, `appId` — and that the `projectType` value is `"App"` (capital A).

**Evidence supporting the claim:**
- The real `wix.config.json` present in the working tree contains exactly `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}` — three fields, matching the claim.
- `reports/wix-live/BOOTSTRAP_BINDING.md` records that GitHub Actions authenticated with a protected Wix API key, bound the product to the existing app "Advanced Booking Rules" (App ID `3e9ec3af-001b-4684-a197-a5133677844d`), and that a real `wix build` completed before binding persisted; only `appId`/`projectId`/`projectType` were persisted and no credentials were persisted.
- The real config is gitignored (`.gitignore` line 19), consistent with the README policy that account-bound identifiers are never committed.

**Assessment:** The claim is consistent with the persisted evidence and does not fabricate identifiers. The candidate does not overclaim: it resolves only the `wix.config.json` field-set portion of UQ4/T-VP0 and does not assert the full T-VP0 gate (e.g., whether Bookings Validation appears in the `wix generate` menu) is closed. `docs/PRODUCT_GATES.json` still lists `real_wix_scaffold_registration` as `OPEN`, which is consistent — the candidate validates metadata but does not claim gate closure.

**Minor fidelity note (non-blocking):** the committed example template uses `projectType: 'app'` (lowercase) while the observed real scaffold produces `"App"` (capital A). The README explicitly documents this discrepancy, and the example is a scaffold-pending placeholder that must classify as `UNLINKED`. This is a documentation/template fidelity nuance, not a correctness defect.

## 3. Deterministic checks

All deterministic gates pass on the exact candidate working tree:

- `npm run typecheck` — passes (tsc --noEmit, no errors).
- `npm run build` (typecheck + purity + vitest) — passes.
- Purity gate — passes: no `@wix/` imports under `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`.
- Full suite — **549 tests pass across 49 files**, including the candidate's `tests/platform/registration-project-config.spec.ts` (14 tests). The "PURITY GATE FAILED" text in the build output is emitted by the intentional `purity-gate.spec.ts` fixture that verifies the gate catches violations; it is expected test behavior, not a real failure.

The candidate's new test verifies: the real `wix.config.json` classifies as `LINKED`; the App ID equals the observed value; `projectType` and `projectId` fields are present; the committed `wix.config.example.json` is byte-identical to the module serialization; and the example classifies as `UNLINKED` by construction.

## 4. Cross-lane contract verification

### 4.1 Rules domain (rules lane)
- Pure deterministic domain core with no Wix SDK/network/filesystem dependency (purity gate enforced).
- Target-aware evaluation implements Contract §5.3 semantics across CREATE/CANCEL/RESCHEDULE; determinism property test confirms identical results per scenario.
- Weekly windows, split windows, exceptions/closures, limits/caps, and duplicate protection are covered by negative and edge-case tests.

### 4.2 Integration (platform)
- **Booking enforcement:** `validation-plugin/handlers.ts` implements FAIL_CLOSED for CREATE/CANCEL (block with retry hint) and FAIL_OPEN for RESCHEDULE (with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'`). Six platform targets map onto three operations. Bulk cap `maxItems 12`; omitted items default to valid so an explicit result is returned for every index.
- **Rollback/recovery:** `schedule-mutation/orchestrator.ts` binds snapshot → diff → idempotent write → revision-checked update → verify → rollback → audit. Crash semantics leave `APPLY_IN_PROGRESS` so the next run resumes or calls `recoverInterruptedApply`, which restores exact pre-apply state from the persisted snapshot. Deterministic UUIDv5 keys (`SCHEDULE_MUTATION_IDEMPOTENCY_NAMESPACE`) make writes idempotent.
- **Webhooks:** pipeline handles dedup/ordering/idempotency; chaos tests pass.
- **HTTP:** endpoints verify caller tokens; unauthenticated requests are rejected fail-closed before any gate interaction.

### 4.3 Dashboard (dashboard lane)
- Bridge consumes typed DTOs; `isEntitlementMeterDto` validates the exact shape the meter endpoint produces (`meter.count`, `meter.degraded`, `coverage.allowedLocationIds`, `coverage.overLimit`, `coverage.degraded`, `coverage.warning`). The meter endpoint's pinned response DTO matches the bridge's validator — no drift.
- **Accessibility-sensitive behavior:** the diff-preview modal implements `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`, `tabindex="-1"`, Escape-to-cancel (never confirms), and focus management (focus on open, restore on close). This satisfies the informed-consent gate and the accessibility gate's technical requirements.

### 4.4 Billing (billing lane)
- Entitlement gate is fail-open on degraded infrastructure; over-limit is not an error; stable coverage ordering; `billingExpirationDate` is never read (Invariant C2); unknown plan ⇒ TIER_1 with `restrictionReliable:false`; periodic reconciliation required (trial→paid fires no webhook event).
- The validation plugin consumes the billing gate's `PolicyDecision` shape (`allowedLocationIds`, `overLimit`, `degraded`, `warning`) consistently: degraded decisions never block (fail-open), uncovered locations skip rule evaluation.
- Downgrade never deletes customer configuration (downgrade-through-gate test passes).

## 5. Failure / rollback behavior

- **Booking enforcement failure:** gate port throwing ⇒ synthetic degraded decision, fail-open, never blocks a booking (§7/C5).
- **Meter endpoint failure:** per-half isolation — a failing meter never corrupts coverage and vice versa; always 200 after auth.
- **Schedule mutation failure:** rollback from persisted snapshot, then audit; crash leaves `APPLY_IN_PROGRESS` for deterministic recovery.
- **Registration test failure:** the candidate's test reads the gitignored `wix.config.json` and silently skips if absent (fresh clone), so it never fails a clean checkout.

## 6. Concerns and observations (non-blocking)

1. **Hardcoded App ID in committed test** (`registration-project-config.spec.ts` line 112): the test asserts `linkage.appId === '3e9ec3af-001b-4684-a197-a5133677844d'`. This is the real observed value (not fabricated) and a public identifier (not a secret; already documented in `BOOTSTRAP_BINDING.md`). It does, however, couple the committed test to the specific bound app: a re-scaffold to a different App ID would fail this test even though the classifier logic is correct. This is a maintainability concern, not a correctness or security defect.
2. **Environment-dependent test behavior:** the test passes trivially when `wix.config.json` is absent and asserts the hardcoded value when present. This is a design smell but does not break the deterministic gate in the current bound environment.
3. **`projectType` case mismatch** between the example template (`'app'`) and the observed scaffold (`"App"`): documented in the README; acceptable for a placeholder template.

None of these rise to a blocking defect. They are recommended follow-ups for the owning lane, not reasons to reject the candidate.

## 7. Conclusion

The candidate is a focused, well-scoped integration-lane change that correctly reflects the observed real Wix scaffold shape, resolves the UQ4 field-set uncertainty using genuine persisted evidence, and passes all deterministic checks (typecheck, purity, 549 tests). Cross-lane contracts between integration, rules, dashboard, and billing are intact: booking enforcement semantics, rollback/recovery, entitlement fail-open posture, meter DTO parity, and accessibility-sensitive dialog behavior are all verified consistent. No fabricated identifiers, no secret exposure, no overclaiming of gate closure.

VERDICT: ACCEPT
