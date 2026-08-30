# Lane Audit Report — Rules Engine (candidate 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc)

**Auditor:** lane-auditor (adversarial, read-only)
**Candidate SHA:** 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc
**Accepted Base SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Date:** 2026-08-30

---

## Scope

Audited the exact rules-engine candidate against:
- `docs/WIX_TECHNICAL_CONTRACT.md` (binding)
- `docs/BUILD_BLUEPRINT.md` (active)
- `src/domain/README.md` (domain semantics source of truth)
- `.opencode/job-descriptions/rules-engine-builder.md` (lane contract)

Only `src/domain/**` and `tests/domain/**` are in scope for this lane.

---

## Summary of Candidate Changes

The candidate modifies **entitlement coverage behavior** in the pure domain core:

| File | Change |
|------|--------|
| `src/domain/explain/explain.ts` | Removed `locationNotCovered: 'LOCATION_NOT_COVERED'` from `OUTCOME_CODES` |
| `src/domain/evaluate.ts` | Stage 1 (entitlement) no longer blocks on uncovered locations; emits nothing for uncovered; degraded still emits `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice |
| `src/domain/README.md` | Updated matrix cell: "Entitlement coverage (degraded → notice; uncovered → no-op)" with rationale aligning to Contract §7 |
| `tests/domain/evaluate.spec.ts` | Updated entitlement tests: uncovered location is a no-op (no entitlement explanation); degraded still emits notice |
| `tests/domain/targets/targetAware.spec.ts` | Updated CANCEL uncovered-location probe to expect `allow` with `BOOKING_ALLOWED` |
| `tests/domain/targets/matrixProperties.spec.ts` | Removed `LOCATION_NOT_COVERED` from `FAMILY_OUTCOME_CODES.entitlement`; forbidden CANCEL injections reduced from 10→9; probe uses degraded as representative |

---

## Verification Against Technical Contract

### Contract §7 (Billing/Entitlement) — **ALIGNED**

> "Over-limit behavior: restrict rule management/enforcement coverage to the plan allowance using stable ordering…; never delete user data; show upgrade CTA."
> "Entitlement error posture (ratified): fail-open on billing/counting API errors for enforcement continuity, with prominent persistent dashboard warning; never block a paying merchant's bookings due to a transient billing-API failure."

**Evidence:** The integration layer (`src/platform/validation-plugin/handlers.ts` lines 648–661) implements the coverage gate:
```typescript
if (!entitlement.degraded && locationId !== null && !entitlement.allowedLocationIds.includes(locationId)) {
  results[item.index] = { ..., disposition: 'UNCOVERED_LOCATION_RULES_SKIPPED', valid: true, outcome: null };
  continue;
}
```
The domain correctly **does not** hard-block uncovered locations — that would be dead code and semantically misaligned with "coverage restriction, never data trapping." The domain emits nothing for uncovered locations; other rule families evaluate normally.

### Contract §5.3 (Validation Plugin Payload) — **ALIGNED**

> "Payload carries `bookedEntity.slot.location.id (OWNER_BUSINESS only)`… location.id arrives only for OWNER_BUSINESS locations; customer-location bookings must not be blocked by coverage."

**Evidence:** Domain test `evaluate.spec.ts` line 145–154 confirms: proposals without `locationId` (CUSTOM/CUSTOMER) are never checked for entitlement and always allowed.

### Contract §11 C5 (Fail-Open Posture) — **ALIGNED**

> "fail-open on billing/counting API errors for enforcement continuity, with prominent persistent dashboard warning; never block a paying merchant's bookings due to a transient billing-API failure."

**Evidence:** Degraded entitlement (`degraded: true`) emits `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice with `decision: 'allow'` — the booking proceeds, warning is surfaced via integration layer's degradation sink.

### Contract §8.1 (Determinism) — **VERIFIED**

All 548 tests pass including the determinism property sweep across CREATE/CANCEL/RESCHEDULE targets with DST fixtures.

---

## Verification Against Build Blueprint

### Purity Gate (Blueprint §2, §6) — **PASSED**

- `src/domain/**` contains **zero** `@wix/` imports (CI purity gate enforces this)
- Domain depends only on `stdlib` + `src/shared/types.ts`
- Dependency direction: `platform → domain(ports) + shared`; `domain → nothing but stdlib`

### Test Strategy (Blueprint §6) — **COMPREHENSIVE**

| Test Category | Coverage |
|---------------|----------|
| Fail-closed classification | RULESET_INVALID, INVALID_SLOT, EVALUATION_ERROR — never throws |
| Entitlement coverage | Degraded → notice; uncovered → no-op; no locationId → no check |
| Target-aware matrix | CREATE/CANCEL/RESCHEDULE per README matrix; CANCEL skips availability families |
| Explanation completeness | Every outcome under ANY target carries `{ruleId, code, customerMessage}`; jargon-free |
| CANCEL-tail drift guard | CANCEL outcomes contain ONLY classification-family explanations (9 forbidden injections derived from README) |
| Matrix ↔ code consistency | 6 behavioral probes × 3 targets; deliberate doc-drift simulation proves harness detects flips |
| Determinism | 100 repetitions per (scenario, target) pair; byte-identical outcomes |
| DST fixtures | Spring-forward gap/span, fall-back ambiguity — all pass |

---

## Adversarial Findings

### 1. No Wix SDK imports in domain — **CONFIRMED CLEAN**
Purity gate passes. No network, filesystem, process, or time dependence outside injected ports.

### 2. Entitlement behavior change is semantically correct — **CONFIRMED**
The previous behavior (domain blocking uncovered locations with `LOCATION_NOT_COVERED`) was **misaligned** with Contract §7 because:
- The integration layer **already skips** uncovered locations before calling the domain
- A domain block would be dead code for the normal path
- It would incorrectly block if the domain were called directly (future API, direct consumer) — violating "coverage restriction, never data trapping"

The new behavior (domain no-op for uncovered; integration layer handles skip) is the **correct architecture**.

### 3. Degraded entitlement still emits visible notice — **CONFIRMED**
`ENTITLEMENT_DEGRADED_FAIL_OPEN` is emitted with `decision: 'allow'` and customer-safe message. Integration layer persists `ENTITLEMENT_DEGRADED` degradation record. No silent fail-open.

### 4. CANCEL target correctly skips entitlement entirely — **CONFIRMED**
Test `targetAware.spec.ts` line 567–575: CANCEL with degraded entitlement emits only `BOOKING_ALLOWED` — no entitlement notice leaks. The CANCEL-tail drift guard enforces this.

### 5. RESCHEDULE subject-booking exclusion — **CONFIRMED WORKING**
Tests in `targetAware.spec.ts` (lines 420–510) verify:
- Own booking excluded from duplicate detection when `subjectBookingId` supplied
- Third-party overlaps still block
- Conservative matching: facts without `bookingId` never excluded
- Identity-keyed cross-service conflicts still fire

### 6. No silent data trapping — **CONFIRMED**
- Uncovered locations: integration skip, not domain block
- Degraded billing: fail-open with warning, never block
- Counter failures: fail-open with `COUNT_UNAVAILABLE_FAIL_OPEN` notice, never silent
- Duplicate read failures: degrade to native Wix protection, visible incident

---

## Test Execution Evidence

```
Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, ...
Test Files  49 passed (49)
Tests       548 passed (548)
Duration    5.97s
```

All domain tests pass. No flaky or skipped tests.

---

## Verdict

The candidate correctly implements the ratified entitlement coverage posture (Contract §7, §11 C5) by:
1. Removing the misaligned `LOCATION_NOT_COVERED` domain block
2. Making uncovered locations a domain no-op (integration layer handles skip)
3. Preserving degraded-billing fail-open with visible notice
4. Maintaining full target-aware matrix semantics (CREATE/CANCEL/RESCHEDULE)
5. Preserving determinism, explanation completeness, and CANCEL-tail drift guards

All tests pass. No purity violations. No scope violations. No contract contradictions.

**VERDICT: ACCEPT**