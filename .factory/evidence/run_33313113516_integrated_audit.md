# Integrated Cross-System Audit — SHA 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc

Auditor role: fresh independent cross-system reviewer (distinct from all builders and lane auditors).
Candidate: `candidate(rules): generation 17` (rules lane).
Scope: verify integration/rules/dashboard/billing contracts, booking enforcement, rollback/recovery,
entitlements, accessibility-sensitive behavior, and the real Wix scaffold assumptions. Read-only; no fixes.

---

## 1. Candidate diff under audit

The candidate touches only `src/domain/` and `tests/domain/`:

- `src/domain/evaluate.ts` — removes the `LOCATION_NOT_COVERED` block from the entitlement family.
- `src/domain/explain/explain.ts` — removes `locationNotCovered` from `OUTCOME_CODES`.
- `src/domain/README.md` — documents the new "uncovered → no-op" entitlement posture.
- `tests/domain/evaluate.spec.ts`, `tests/domain/targets/matrixProperties.spec.ts`,
  `tests/domain/targets/targetAware.spec.ts` — updated to the new posture.

The core semantic change: the pure domain no longer hard-blocks uncovered locations. It relies on the
Integration layer (`handlers.ts`) to skip rule evaluation for uncovered locations before calling the
domain (`UNCOVERED_LOCATION_RULES_SKIPPED`). If the domain IS called with an uncovered location, the
entitlement family emits nothing and other rule families evaluate normally.

## 2. Deterministic checks

- `npm test` (purity gate + vitest): **548 tests / 49 files passed**. The `PURITY GATE FAILED` line in
  output is from the intentional `purity-gate.spec.ts` fixture (a negative test), not a real failure; the
  real `check:purity` step printed "Purity gate passed".
- The candidate's changed suites (`evaluate.spec.ts`, `matrixProperties.spec.ts`, `targetAware.spec.ts`)
  are green.

## 3. Integration contract (booking enforcement)

Verified `src/platform/validation-plugin/handlers.ts` (lines 646–663): the coverage gate skips rule
evaluation for an item when `!entitlement.degraded && locationId !== null && !allowedLocationIds.includes(locationId)`,
returning `valid: true` with disposition `UNCOVERED_LOCATION_RULES_SKIPPED` and `outcome: null`.

- Healthy + uncovered OWNER_BUSINESS location → skipped (valid, no gateway reads). ✓
- Healthy + covered location → evaluated with full rule strength. ✓
- Over-limit healthy decision → still restricts coverage (not a degradation). ✓
- CUSTOM/CUSTOMER (null locationId) → always evaluated (matches prior non-blocking behavior). ✓
- Degraded gate → fail-open coverage, evaluated normally with `ENTITLEMENT_DEGRADED` incident. ✓
- Throwing gate → synthetic degraded, never blocks a booking. ✓

These behaviors are pinned by `tests/platform/validation-plugin-entitlement.spec.ts` and
`tests/platform/composition-root.spec.ts` (end-to-end: purchase webhook expands coverage, downgrade
shrinks it, failed reconciliation leaves state untouched). The integration layer is the ONLY production
consumer of `evaluateRules` (verified by grep); no other production path can now allow an uncovered
location that previously blocked. The domain change is therefore safe and coherent with the integration
contract.

## 4. Billing / entitlements contract

`src/billing/enforcement/entitlementGate.ts` produces `PolicyDecision { allowedLocationIds, overLimit,
degraded, warning }` with the ratified fail-open posture (billing/listing/count failures never block
bookings; over-limit is a normal decision, not an error). The composition root
(`src/platform/composition/entitlementComposition.ts`) wires the billing projection → gate → handlers.
The candidate's domain change consumes exactly these signals: degraded → fail-open notice; uncovered →
no-op (coverage restricted upstream). This matches Contract §7 "restrict rule management/enforcement
coverage to the plan allowance; never delete user data" and §11 C5. Coherent.

## 5. Dashboard contract

The dashboard validation mirror (`src/ui/validation/mirror.js`) validates ruleset STRUCTURE
(configuration drafts), not booking-time entitlement. It does not call `evaluateRules` and does not
enforce location coverage, so the candidate's domain change introduces no dashboard mismatch. The
cross-lane parity contract (`tests/domain/uiValidatorParity.spec.ts`, 30 tests) passes. The candidate
does not touch dashboard code.

## 6. Rollback / recovery

`src/platform/schedule-mutation/orchestrator.ts` implements the full snapshot → diff → apply → verify →
rollback sequence with deterministic UUIDv5 idempotency keys, revision-conflict retry, crash-mid-apply
recovery (`recoverInterruptedApply`), and terminal-state guards. Tests
(`schedule-mutation.spec.ts`, `orchestrator-terminal-states.spec.ts`, `idempotency.spec.ts`,
`http-mutations.spec.ts`) pass. The candidate does not touch this path.

## 7. Accessibility-sensitive behavior

The candidate does not touch dashboard/UI code. The `accessibility` product gate remains OPEN
(pre-existing, dashboard-owned); it is unaffected by this rules-lane candidate.

## 8. Real Wix scaffold assumptions — cross-system observation (pre-existing)

The committed `wix.config.json` carries a real App ID `3e9ec3af-001b-4684-a197-a5133677844d`
(confirmed present in the candidate commit; corroborated by `reports/wix-live/BOOTSTRAP_BINDING.md` as
the bound "Advanced Booking Rules" app). `classifyProjectBinding` would therefore classify it LINKED.

However, `src/platform/registration/scaffoldPrerequisites.ts` `externalBlockerStatement()` still asserts
"No linked Wix CLI project exists" and "classified UNLINKED", and `reports/wix-live/CYCLE_32920420147.md`
states "The integrated product has no real wix.config.json." This is a genuine cross-system inconsistency
between the committed binding state and the committed blocker statement / live-QA report.

This inconsistency is PRE-EXISTING and NOT introduced by this candidate (the candidate diff touches only
`src/domain/` and `tests/domain/`). It is owned by the integration lane and does not affect the
correctness or coherence of the rules-lane change under audit. It is recorded here as a cross-system
observation for the integration lane to reconcile (align `externalBlockerStatement` and the live-QA
disposition with the actual committed binding, and reconcile the `.gitignore` intent with the committed
`wix.config.json`).

## 9. Conclusion

The candidate's change is correct, well-documented, and coherent with the integration, billing, and
dashboard contracts. The only production consumer of the domain (`handlers.ts`) skips uncovered locations
before evaluation, so removing the domain-level `LOCATION_NOT_COVERED` block introduces no enforcement
gap. All deterministic checks pass. The pre-existing scaffold-statement inconsistency is orthogonal to
this candidate and is an integration-lane concern, not a blocker for this rules-lane change.

VERDICT: ACCEPT
