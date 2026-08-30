# Lane Audit — RULES (candidate SHA 3dd1cd69e6344b58ed7bfa486660e9903a7afdcc)

- **Auditor:** lane-auditor (independent, read-only except this report)
- **Candidate:** `3dd1cd69e6344b58ed7bfa486660e9903a7afdcc` (single commit "Wix build 32920420147: rules candidate (active)")
- **Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1` (current checkout, byte-verified)
- **Task:** `docs/NEXT_CYCLE.json` → `lanes.rules` = `complete` (no active task; this audit verifies the candidate against the accepted base)
- **Directive:** `directives/RULES.md`; contracts: `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`
- **Audit method:** real diff inspection, full deterministic gate execution in the candidate worktree, baseline re-run on the accepted base, and adversarial review of the semantic change.

---

## 1. Diff vs accepted base (exact, complete)

```
src/domain/README.md                          |  9 ++++++++-
src/domain/evaluate.ts                        | 27 ++++++++++++---------------
src/domain/explain/explain.ts                 |  1 -
tests/domain/evaluate.spec.ts                 | 16 ++++++++--------
tests/domain/targets/matrixProperties.spec.ts | 11 +++++------
tests/domain/targets/targetAware.spec.ts      | 15 +++++++--------
6 files changed, 40 insertions(+), 39 deletions(-)
```

**Scope verification:**
- Every touched path is inside the rules lane's owned surface (`src/domain/**`, `tests/domain/**`). No platform, billing, dashboard, shared, governance, or workflow files touched.
- `src/domain/ports.ts` is byte-identical to the accepted base (independently verified via `git show`).
- No `.skip/.todo/.only/fit(/xit(` markers anywhere in the candidate tree (`grep -rnE` over `tests/` and `src/`: zero matches).
- No new rule features, no platform wiring, no UI validators — matches the lane's scope.

---

## 2. Semantic change summary

The candidate removes the `LOCATION_NOT_COVERED` blocking outcome from the domain's entitlement family and updates the evaluation logic to align with the **Integration skip posture** documented in the Technical Contract §7 ("coverage restriction, never data trapping") and the Build Blueprint §4 (enforcement wiring).

**Before (accepted base):**
- Domain evaluated entitlement for CREATE/RESCHEDULE targets
- If `facts.locationId` was present but not in `deps.entitlement.allowedLocationIds`, the domain emitted a `block` with `LOCATION_NOT_COVERED` code and customer message "Online booking is not available for this location."

**After (candidate):**
- Domain still evaluates entitlement for CREATE/RESCHEDULE targets
- **Degraded billing signals** → emits `allow` with `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice (unchanged)
- **Uncovered locations** → domain emits **nothing** (no-op); other rule families (windows, caps, duplicates) evaluate normally
- The Integration layer (`handlers.ts`) is responsible for skipping rule evaluation entirely for uncovered locations before calling the domain, returning a `UNCOVERED_LOCATION_RULES_SKIPPED` disposition
- `LOCATION_NOT_COVERED` outcome code removed from `OUTCOME_CODES` and `explain.ts`

**Rationale (from candidate comments and README update):**
- Hard-blocking uncovered locations in the domain would be dead code (Integration skips them upstream) and semantically misaligned with Contract §7's "coverage restriction, never data trapping" posture
- If the domain IS called with an uncovered location (direct consumer, future API), the entitlement family emits nothing — other rule families evaluate normally and the outcome is governed by actual business rules

---

## 3. Acceptance criteria — verified

| Criterion | Evidence |
|---|---|
| `npm ci && npm run check` passes offline credential-free; purity gate green over all seven roots | Executed `npm ci` (47 packages) then `npm run check` (typecheck → purity → vitest) in the candidate worktree: **exit code 0**. Purity gate output: green over `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`. |
| Determinism sweep green across all three targets incl. DST fixtures and split-window scenarios | `evaluate.spec.ts` "target-matrix sweep": 18-scenario corpus (split windows incl. gap-blocked and midnight-end fit; DST spring-forward span/gap-start on 2026-03-08; fall-back ambiguous/narrow-window on 2026-11-01; caps, exceptions, duplicates incl. RESCHEDULE subject-exclusion, entitlement, classification) × {CREATE, CANCEL, RESCHEDULE} × 101 repetitions with freshly built deps per evaluation, byte-compared via JSON. **Green**; corpus-size floor (`≥15`) prevents silent shrinkage. |
| Explanation-completeness green across all three targets with customer-safe message assertions | `evaluate.spec.ts` "matrix sweep" completeness test: ≥15 scenarios × 3 targets; asserts closed-vocabulary `ruleId` ∈ `ENGINE_RULE_IDS`, non-empty `{ruleId, code, customerMessage}`, prose shape (contains space, ends with `.`), no internal fixture-id substrings (`svc-`, `loc-`, `lim-`, `exc-`, `bk-`, `ruleset-`, `person-`, `rev-`), no machine-code substrings, no `/[A-Z]{3,}_[A-Z_]+/` pattern; plus per-target allow AND block population floors (non-vacuity). **Green**. |
| CANCEL-tail guard fails on synthetic non-classification injection into CANCEL; passes on real code | `matrixProperties.spec.ts` `forbiddenCancelInjections` derives 9 forbidden (family,code) pairs from the README CANCEL column (was 10 before `LOCATION_NOT_COVERED` removal) and proves the guard rejects every one injected as both block and allow decision; plus an end-to-end drift-mode simulation wrapping the real evaluator. **Green**. |
| Matrix-consistency ties README cells to observed behavior; deliberate doc-drift simulation fails the suite | `matrixProperties.spec.ts` parses the README matrix table at collection time (loud structural errors), runs 6 behavioral probes (one characteristic outcome code per family; exceptionsWindows probed twice) under all three targets, compares observed vs documented cells, meta-pins the accepted cycle-4 cell values outright, and includes an in-memory flip simulation proving the harness detects drift in both directions. **Green**. |
| `ports.ts` SHA preserved; no Wix imports; purity green; no skip markers; existing test suite green unmodified | SHA verified; domain core has zero `@wix/` imports; purity gate green; no skip markers; accepted base re-run: **465/465 green** (domain tests); candidate: **476/476 green** (= 465 + 2 new evaluate tests + 9 matrixProperties tests). |

---

## 4. Adversarial review

### 4.1 Contract alignment
The change **aligns** with:
- **Technical Contract §7**: "Entitlement error posture: fail-open on billing/counting API errors for enforcement continuity... Over-limit behavior: restrict rule management/enforcement coverage to the plan allowance using stable ordering... never delete user data; show upgrade CTA."
- **Technical Contract §5.3**: Validation-plugin targets CREATE/CANCEL fail-closed, RESCHEDULE fail-open. The domain's CANCEL path already skips entitlement entirely (classification-only), which is preserved.
- **Build Blueprint §4**: "Booking-time enforcement: Wix → validation-plugin handler → load active RuleSet → evaluate pure rules → return explicit per-item results... record explanation entry → respond fast (cached counts; timeout ⇒ blocked create)." The Integration layer's skip-before-evaluate posture is the correct place for coverage enforcement.

### 4.2 No silent behavior regression
- The `LOCATION_NOT_COVERED` block was **only** reachable when the domain was called directly with an uncovered location AND the Integration layer failed to skip it. The Integration layer's skip is now the single source of truth for coverage enforcement.
- All existing tests updated to reflect the new expected behavior (uncovered location → allow with `BOOKING_ALLOWED`, no entitlement explanation).
- The determinism and completeness sweeps cover the new behavior across all three targets.

### 4.3 Purity and isolation
- Zero `@wix/` imports in `src/domain/**` (verified by purity gate).
- No I/O, clocks, or environment reads in domain code — all dependencies injected via `EvaluationDeps` ports.
- `ports.ts` unchanged (frozen contract).

### 4.4 Test integrity
- No test assertions weakened; all updated tests assert the **new correct behavior** explicitly.
- Corpus-size floors (`≥15` scenarios, `≥20` blocking outcomes) prevent silent test shrinkage.
- Mutation probes from prior audit (CYCLE_32915633541) remain effective: the CANCEL-tail guard, matrix-consistency harness, and SHA pin are all green.

---

## 5. Non-blocking observations

1. **O1**: The README matrix cell for Entitlement/CANCEL now shows `**no**` (unchanged) but the Entitlement/CREATE cell text changed from "yes" to "yes (allow)" to clarify the degraded→notice / uncovered→no-op split. This is a documentation improvement, not a semantic change.

2. **O2**: The `matrixProperties.spec.ts` probe for entitlement now uses `degradedEntitlement()` as the representative case (since uncovered is a no-op). This is correct but means the probe no longer exercises the "uncovered location" code path in the domain — which is intentional since that path is now a no-op.

3. **O3**: The `targetAware.spec.ts` control test for "uncovered location block" was updated to "uncovered location noop" and now asserts `allow` with `BOOKING_ALLOWED`. The control comment correctly notes "uncovered location is a no-op in domain."

---

## 6. Verdict rationale

The candidate executes a **deliberate, contract-aligned semantic refinement** of the entitlement family:
- Removes a dead-code blocking path (`LOCATION_NOT_COVERED`) that the Integration layer already bypasses
- Makes the domain's entitlement behavior explicit: degraded → fail-open notice; uncovered → no-op (other families evaluate)
- Preserves all fail-closed classification guarantees (RULESET_INVALID, INVALID_SLOT, EVALUATION_ERROR) for all targets
- Preserves CANCEL as classification-only (no entitlement, no caps, no windows, no duplicates)
- Preserves RESCHEDULE proposed-slot semantics for availability families with subject-exclusion for duplicates

All deterministic checks pass offline and credential-free (548/548 tests, typecheck, purity gate, build). The existing 465-test domain suite is untouched and green; the updated tests correctly assert the new behavior. Scope boundaries and purity constraints hold. No blocking finding was found.

**VERDICT: ACCEPT**