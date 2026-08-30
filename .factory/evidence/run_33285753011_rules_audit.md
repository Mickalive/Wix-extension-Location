# Lane Audit Report — Rules Engine (candidate SHA 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc)

**Auditor:** lane-auditor (adversarial, read-only)
**Base commit:** ec916b75d5600e02d679d264648ac92333d721f1
**Candidate commit:** 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc
**Date:** 2026-08-30

---

## 1. Scope Verification

The candidate modifies only files within the Rules Engine Builder's allowed scope:
- `src/domain/README.md` — domain documentation
- `src/domain/evaluate.ts` — pure rule evaluation logic
- `src/domain/explain/explain.ts` — outcome codes and explanations
- `tests/domain/**` — domain test suites

No files outside `src/domain/**` or `tests/domain/**` are modified. No `@wix/*` imports appear in domain code (purity gate passes).

---

## 2. Change Summary

The candidate implements a single semantic change to **entitlement coverage** behavior:

### Before (base commit)
- Uncovered locations (locationId not in `allowedLocationIds`) were **hard-blocked** with `LOCATION_NOT_COVERED` outcome code
- Degraded billing signals emitted `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice (allow with warning)

### After (candidate commit)
- **Uncovered locations are a no-op in the domain**: the entitlement family emits nothing; other rule families (windows, caps, duplicates) evaluate normally
- Degraded billing signals still emit `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice (allow with warning)
- `LOCATION_NOT_COVERED` outcome code **removed entirely** from `OUTCOME_CODES`
- Integration layer (`handlers.ts`) is documented to **skip rule evaluation entirely** for uncovered locations upstream (`UNCOVERED_LOCATION_RULES_SKIPPED` disposition)

### Documentation updates
- Matrix table in `README.md` updated: "Entitlement coverage (degraded → notice; uncovered → no-op)" with CREATE=yes (allow), CANCEL=no, RESCHEDULE=yes (allow)
- Detailed rationale added explaining the Integration-skip posture and Contract §7 alignment ("coverage restriction, never data trapping")

### Test updates
All domain tests updated to reflect new behavior:
- Uncovered location scenarios now expect `allow` decision with `BOOKING_ALLOWED` explanation (no entitlement explanation)
- `FAMILY_OUTCOME_CODES.entitlement` reduced to only `ENTITLEMENT_DEGRADED_FAIL_OPEN`
- CANCEL-tail drift guard forbidden-injection set reduced from 10 to 9 entries (removed `entitlement|LOCATION_NOT_COVERED`)
- Matrix consistency probes use degraded entitlement as representative for entitlement family

---

## 3. Contract Compliance Verification

### WIX_TECHNICAL_CONTRACT.md §7 (Billing mechanism)
> "Over-limit behavior: restrict rule management/enforcement coverage to the plan allowance using stable ordering...; never delete user data; show upgrade CTA."
> "Entitlement error posture (ratified): fail-open on billing/counting API errors for enforcement continuity, with prominent persistent dashboard warning; never block a paying merchant's bookings due to a transient billing-API failure."

**Compliance:** ✅ The change aligns with "coverage restriction, never data trapping." The domain no longer blocks uncovered locations; the Integration layer enforces coverage upstream by skipping evaluation. Degraded billing signals remain fail-open with visible notice.

### WIX_TECHNICAL_CONTRACT.md §5.3 (Validation-plugin payload contract)
> "Fail-closed on error/timeout: CREATE, CANCEL (+multi-service). Fail-open: RESCHEDULE (+multi-service) — reschedule guarantees are best-effort forever."

**Compliance:** ✅ Classification families (RULESET_INVALID, INVALID_SLOT, EVALUATION_ERROR) remain fail-closed for all targets. Entitlement coverage is skipped for CANCEL (no notice emitted). RESCHEDULE evaluates entitlement against proposed slot (allow with degraded notice; uncovered no-op).

### WIX_TECHNICAL_CONTRACT.md §11 C6 (Honesty)
> "TOCTOU residual risk for count caps disclosed in-product; reschedule enforcement labeled best-effort; capability #1 described as staff-working-hours mechanism, never as a native per-location hours object."

**Compliance:** ✅ The change honestly documents that uncovered locations are handled by Integration-skip upstream, not by domain hard-block. The domain's no-op behavior for uncovered locations is explicitly documented as a deliberate design choice.

### BUILD_BLUEPRINT.md §2 (Ownership boundaries)
> Rules lane owns `src/domain/**`, `tests/domain/**`. Must NOT: Any `@wix/*` import, any I/O, any network/time dependence not injected via ports.

**Compliance:** ✅ Zero `@wix/*` imports in modified files. Pure deterministic logic only.

### BUILD_BLUEPRINT.md §3 (Core ports)
> Rule evaluation signature (pure): `evaluateRules(input: BookingFacts, rules: RuleSet, deps: {clock; counts; entitlement}): RuleOutcome`

**Compliance:** ✅ Signature unchanged. `EvaluationDeps.entitlement` (PolicyDecision) still provides `allowedLocationIds`, `degraded`, `overLimit`, `warning`. The domain now interprets `allowedLocationIds` differently (no-op instead of block), which is a semantic evolution within the same port contract.

---

## 4. Test Evidence

### Deterministic test suite results (548 tests, all passing)
```
Test Files  49 passed (49)
Tests       548 passed (548)
```

### Key domain test validations
- **Entitlement coverage tests** (`tests/domain/evaluate.spec.ts`):
  - Uncovered location → allow, no entitlement explanation emitted
  - Degraded entitlement → allow with `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice
  - No locationId (CUSTOM/CUSTOMER) → allow, no entitlement check

- **Target-aware matrix tests** (`tests/domain/targets/targetAware.spec.ts`):
  - CANCEL skips entitlement family entirely (zero count queries, no notice even under degraded)
  - RESCHEDULE evaluates entitlement against proposed slot (degraded notice; uncovered no-op)
  - CREATE evaluates entitlement (degraded notice; uncovered no-op)

- **Matrix property tests** (`tests/domain/targets/matrixProperties.spec.ts`):
  - README matrix ↔ evaluator behavior consistency verified for all 5 families × 3 targets
  - CANCEL-tail drift guard: CANCEL outcomes contain ONLY classification explanations
  - Forbidden-injection set derived from README CANCEL column (9 entries, down from 10)
  - Anti-vacuity proofs: guard rejects every forbidden family injected as block/allow
  - Frozen `ports.ts` contract pinned at SHA-256 `d46e0743fa825315a80456962d0f4412c02cbd437f0acabce909356f43c18802`

- **Determinism property** (`tests/domain/evaluate.spec.ts`):
  - 100 repeated evaluations per scenario × 3 targets = byte-identical outcomes
  - Corpus includes split windows, midnight boundaries, DST spring-forward/fall-back

- **Explanation well-formedness** (matrix sweep):
  - Every outcome under ANY target carries complete `{ruleId, code, customerMessage}`
  - Customer messages are jargon-free (prose sentences, no internal IDs, no machine codes)

### Purity gate
```
Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, ...
```

### Typecheck
```
tsc --noEmit → clean (no errors)
```

---

## 5. Adversarial Findings

### Finding 1: Integration-layer dependency documented but not verified in this lane
The candidate documents that "the Integration layer (handlers.ts) SKIPS rule evaluation for uncovered locations BEFORE calling the domain." This is a cross-lane contract claim. The Rules lane correctly implements the domain-side no-op behavior, but the actual Integration-layer skip (`UNCOVERED_LOCATION_RULES_SKIPPED` disposition) must be verified in the Integration lane audit. **This is not a Rules-lane defect** — the domain correctly handles the case where it IS called with an uncovered location (no-op, other families evaluate).

### Finding 2: `LOCATION_NOT_COVERED` removal is a breaking change for external consumers
The `OUTCOME_CODES.locationNotCovered` constant is removed. Any external consumer (dashboard, logging, analytics) referencing this code will break at compile time. This is acceptable because:
- The constant was only used internally in the domain (now removed)
- The matrix properties test pins the accepted outcome codes per family
- The change is documented in the README matrix and rationale
- No evidence of external consumers in the current codebase

### Finding 3: CANCEL-tail drift guard correctly tightened
The forbidden-injection set reduced from 10 to 9 entries (removed `entitlement|LOCATION_NOT_COVERED`). The guard now correctly derives forbidden families from the README CANCEL column (entitlement, exceptionsWindows, caps, duplicates all documented as "no" for CANCEL). Anti-vacuity tests prove the guard catches injected notices from all four forbidden families.

### Finding 4: No silent behavior drift
The default-contract pin tests (Part 1 of `targetAware.spec.ts`) verify that absent `targetContext`, the evaluator reproduces pre-cycle-4 behavior **bit-for-bit** — except for the intentional entitlement uncovered-location change, which is now the intended default behavior. The pinned scenarios include the "uncovered location noop" case with the new expected outcome.

---

## 6. Verdict

The candidate correctly implements the entitlement coverage semantic change as mandated by the Technical Contract §7 ("coverage restriction, never data trapping") and the Integration audit observation that uncovered locations should be skipped upstream. The change is:

- **Narrow and focused**: Single semantic change with supporting documentation and test updates
- **Contract-compliant**: Aligns with §7, §5.3, §11 C6
- **Well-tested**: All 548 tests pass, including matrix consistency, CANCEL-tail drift guard, determinism, and explanation completeness across all three targets
- **Pure**: Zero Wix imports, deterministic, no I/O
- **Backward-compatible at the port level**: Same `EvaluationDeps` interface, same `RuleOutcome` shape (minus one removed code)

No blocking defects found. The candidate is ready for integration.

---

**VERDICT: ACCEPT**