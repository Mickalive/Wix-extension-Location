# Cycle Audit — Dashboard Lane (DASH-C2-1-REPAIR)

- **Run:** 32787032785 · **Role:** dashboard-builder · **Auditor:** independent lane audit
- **Candidate:** `/tmp/wix_dashboard_candidate` @ `0fab299` ("Wix build 32787032785: dashboard candidate (active)")
- **Accepted base:** `53f51d9` ("Wix build 32692407760: director attempt") — current checkout, untouched; candidate parent verified = base
- **Task:** DASH-C2-1-REPAIR from `docs/NEXT_CYCLE.json` (cycle 2, phase `build`; `docs/state.json.phase = "build"` verified — directive precondition met)
- **Repair priority rule applies:** the latest persisted audit for this lane is `reports/audits/CYCLE_32692407760_DASHBOARD.md` (**FIX_BEFORE_INTEGRATION**, blockers F-B1/F-B2, non-blocking F-N1–F-N7). This candidate was therefore audited primarily as a repair, with scope-creep and regression checks on top.

---

## 1. Real diff inspected

`git diff --name-status 53f51d9 0fab299`: **28 files, +4641 lines, 0 deletions** — all additions (correct: the cycle-1 dashboard candidate was never integrated, so the accepted base contains no `src/ui/**`; the repair re-delivers the whole lane with fixes applied).

Scope verification against the workflow-enforced lane paths (`.github/workflows/wix-build-loop.yml` lines 187/362 — exactly `src/extensions/dashboard/**`, `src/ui/**`, `tests/ui/**`):

```
git diff --name-only 53f51d9 0fab299 | grep -v -E '^(src/ui/|src/extensions/dashboard/|tests/ui/)' → NO_OUT_OF_SCOPE_FILES
git diff --name-only 53f51d9 0fab299 | grep -E '^(MAIN_PROMPT.md|.github/|.opencode/|opencode.json|AGENTS.md|directives/)' → NO_IMMUTABLE_FILES_TOUCHED
```

Additional boundary checks:
- **No cross-lane imports** (`grep -rE "from '.*(src/domain|src/platform|src/billing|src/shared)"` over lane sources → none). Canonical frozen contracts (`src/domain/ports.ts`, `src/shared/{types,errors}.ts`) untouched.
- **No secrets, no fabricated Wix identifiers**: GUID-literal grep over all lane sources → zero matches; the only Wix runtime reference remains the single guarded dynamic `import('@wix/essentials')` inside `src/ui/services/bridge.js`, enforced by `noWixImports.test.js` with an anti-vacuity assertion.
- **Copy bans (Contract §12)**: independent grep for reschedule-guarantee / hard-cap / 100%-proof phrasing → zero violations; negation-only native-hours disclosure and the C6 soft-limit phrase are asserted verbatim by `copyDisclosure.test.js`.

## 2. Executable checks actually run

| Check | Command (in `/tmp/wix_dashboard_candidate`) | Result |
|---|---|---|
| Lane suite | `cd tests/ui && npm run test:unit` (Node built-in runner) | **99/99 pass, 0 fail, 0 skipped**, credential-free, offline (~391 ms). Baseline 63 preserved + 35 new real tests + 1 empty-file wrapper (see N-1). |
| Per-file breakdown | `node --test <file>` × 13 files | accessibility 5, bridge 11, computeScheduleDiff 18, copyDisclosure 5, diffPreviewModal 10, editorStore 15, laneHygiene 3, mirror 4, noWixImports 2, ruleDraftValidators 12, rulesEditorPage 9, windowRowWeekdayResolution 4, zzscratch(wrapper) 1 |
| Accepted-state gates in candidate worktree | `npm run check` (typecheck → purity → platform vitest) | **exit 0**: `tsc --noEmit` strict clean; purity gate passed over the real tree; platform suite 33/33. (The scary-looking "PURITY GATE FAILED" stdout lines originate from the platform lane's own negative-test fixtures inside `tests/platform/purity-gate.spec.ts`, which passed 4/4.) |
| Copy-ban grep | ripgrep-style pattern over `src/ui` + `src/extensions/dashboard` | no matches |
| Adversarial probes | direct module execution, 7 falsification families (below) | all passed |

Missing checks (explicit, not hand-waved): `wix build`, dev-site gates, and any scaffold-dependent verification remain impossible pre-credentials (Contract §16) — structural to the phase, not lane negligence. Note also that root `tsc` does not type-check this lane's plain JS (`checkJs:false`; tsconfig includes only `*.ts`), so the lane's Node runner is its executable gate for now; when the T-VP0 scaffold pins React/TS, the repo-level gate must be extended to dashboard paths (Director follow-up, consistent with the recorded deferral decision).

## 3. Adversarial probes (independent falsification attempts)

All executed against candidate modules; all behaved correctly:

1. **P1a Confirm bypass, invalid-from-birth draft**: store constructed directly with an incomplete row → `OPEN_DIFF_PREVIEW` refused; forced `CONFIRM_DIFF_PREVIEW` with the correct hash does NOT land; `canApply()` false.
2. **P1b Issue injected after opening preview**: valid draft → open → add invalid exception → replay the originally rendered hash → confirmation refused (reducer recomputes hash AND requires `issues.length === 0`).
3. **P1c/P1d Modal-level guards**: enabled confirm works on a valid diff (control); empty op list disables confirm even with `canConfirm:true`.
4. **P2 describeOp fidelity edges**: OVERRIDE→OVERRIDE hours-only change renders both hour sets; unknown exception kind renders `unknown type WEIRD` honestly; unknown op kind falls through to an explicit "Unsupported change" line; REMOVE_EXCEPTION of an override exposes its hours.
5. **P3 Hash determinism/sensitivity**: identical inputs ⇒ identical hash across calls; one-limit change ⇒ different hash.
6. **P4 Focus restore with dead trigger**: trigger removed from DOM while modal open → close() does not refocus the dead node.
7. **P5 Unknown weekday buckets**: surface as `UNKNOWN_WEEKDAY` ops; canonical keys sort before unknown ones.
8. **P6 Validator/diff parity**: incomplete rows produce issues but never schedule ops.
9. **P7 Cap input canonicalization**: junk (`'+5'`) kept verbatim in draft and flagged `LIMIT_NOT_INTEGER` instead of silently coerced.

## 4. Blocking-finding repair scorecard (F-B1, F-B2)

### F-B1 — Diff preview misrepresented exception mutations → **FIXED**

- `describeOp('UPDATE_EXCEPTION')` now renders full before→after detail: `Change exception - 2026-12-25: closed all day -> open 10:00-14:00` (the audit's exact required example, asserted verbatim), covering kind+hours on both sides, split-window override lists, and note changes in all three variants (changed / added / removed).
- `describeOp('REMOVE_EXCEPTION')` renders the removed entry's state incl. kind/hours/note: e.g. `Remove exception - 2026-11-26: open 10:00-13:00, 15:00-18:00 (note: 'thanksgiving short day')`.
- The diff op itself carries `before`/`after` (and `removed`) states, so fidelity does not depend on renderer-side reconstruction.
- Tests assert against **rendered modal DOM content**, not only the renderer function (`diffPreviewModal.test.js` lines 70–96), plus six dedicated F-B1 regressions in `computeScheduleDiff.test.js`. The cycle-1 weakness (equality-with-the-same-lossy-renderer proving nothing) is specifically corrected.

### F-B2 — Review/confirm reachable while draft invalid → **FIXED (both sanctioned approaches, triple-layered)**

- Layer 1 (reducer): `OPEN_DIFF_PREVIEW` refused while issues exist → visible `REVIEW_BLOCKED` notice; `CONFIRM_DIFF_PREVIEW` lands only if modal open ∧ rendered hash = current hash ∧ zero issues.
- Layer 2 (page): "Review changes" disabled while `issues.length > 0` with explanatory title (+ `aria-describedby` to the issue list); Apply disabled until `canApply()`.
- Layer 3 (modal): Confirm button disabled unless `canConfirm` (derived from `canConfirmDiff()`), rendered next to a `role="alert"` warning listing every blocking issue; click handler double-guards; empty diffs also cannot be confirmed.
- **Negative UI test** (`rulesEditorPage.test.js` "F-B2 negative UI test…") proves three attack paths fail: disabled-button click opens no modal; force-dispatched open action is refused with a notice; a forced-open modal renders disabled Confirm + warning and clicking can never set `confirmedHash`; Apply stays locked throughout. Store-level tests additionally prove forced confirm with a valid hash fails once any issue exists, and stale-hash replay after edits is rejected.

Contract §9.2 informed consent is now genuinely satisfied: the dialog shows exactly what will change, and an invalid proposal can neither be reviewed nor confirmed through any path I could construct.

## 5. Non-blocking findings — all addressed in this repair

| Finding | Status | Evidence |
|---|---|---|
| F-N2 focus restore | Implemented (not just comment fix) | `diffPreviewModal.close()` restores focus; tested incl. Escape path; dead-node edge handled (probe P4) |
| F-N3 probe.txt | Absent + regression guard | `laneHygiene.test.js`: probe.txt absence asserted; placeholder-artifact scan of `src/ui` |
| F-N4 silent Save/Apply | Fixed | Visible `role="status"` region; pending/unavailable/saved/applied states; buttons relabel+disable during pending; unavailable messaging when bridge missing; 4 dedicated tests |
| F-N5 raw SyntaxError | Fixed | `BridgeError('BAD_RESPONSE')` wraps JSON.parse failures, cause preserved; tested incl. empty-body→null |
| F-N6 zzDebug name | Renamed | `windowRowWeekdayResolution.test.js`, descriptive header, content preserved (4 tests) |
| F-N7 silent weekday drop | Fixed | Non-canonical buckets surface as explicit `UNKNOWN_WEEKDAY` ops (sorted after canonical), validator raises `WEEKDAY_UNKNOWN`, phantom-bucket pairing test |

Bonus during repair: the builder found and fixed a real latent defect (HH:MM pattern losing the minute capture group made NaN comparisons silently pass invalid rows) and locked it with a named regression test. This is legitimate repair-scope hardening of lane-owned validation, not feature creep.

Recorded obligation correctly NOT executed (per task text): the `mirror.setValidationSource()` repoint to canonical domain validators + cross-lane parity test remains Director-tracked until the Rules lane achieves ACCEPT. The seam is preserved, fail-closed (non-function sources rejected), documented in README and code headers. Correct scoping.

Out-of-scope respect: no live Wix fetching (bridge unconfigured ⇒ typed failure), no React/design-system mount (deferred per UQ3/T-VP0), no locations meter (future task), no evaluation logic beyond configuration-draft validation.

## 6. Remaining findings (non-blocking)

- **N-1 (integration action, mandatory at port time):** `tests/ui/zzscratch.test.js` is a comment-only empty remnant from a temporary diagnostic scaffold. It carries zero tests and zero behavior; the builder documents in the file header AND `src/ui/README.md` that the sandbox has no delete primitive and that the file must be deleted before integration. **The Director must delete this file when porting the candidate; do not integrate it.** Cosmetic corollary: the lane's hygiene scanner covers `src/ui` placeholder artifacts but not `tests/ui` `.js` remnants; the suite count (99) includes this empty wrapper, i.e. 98 real tests.
- **N-2 (follow-up, not a defect):** root `tsc` does not check this lane's JS; extend the repo gate to dashboard sources when the T-VP0 scaffold converts the lane to typed React.
- **N-3 (cosmetic):** modal `close()` calls the kit-internal `doc._adoptFocus(null)` fallback; works and is tested, but couples product code to a kit-internal API.

None of these affect correctness, consent integrity, safety, or scope discipline.

## 7. Acceptance-criteria scorecard (DASH-C2-1-REPAIR)

| # | Criterion | Status |
|---|---|---|
| 1 | UPDATE_EXCEPTION line exposes prior AND new kind+hours; REMOVE_EXCEPTION exposes removed kind/hours, asserted in tests | **PASS** — verbatim-line assertions at renderer and rendered-DOM level |
| 2 | Negative UI test proves Confirm cannot reach confirmed:true through the UI while any issue is open | **PASS** — three attack paths covered; independently reproduced via probes P1a/P1b |
| 3 | Existing hash-gating, accessibility, copy-disclosure suites stay green (63 baseline + new) under lane runner without credentials | **PASS** — 99/99, 0 skipped, offline; accepted-state `npm run check` also exit 0 in the candidate worktree |
| 4 | probe.txt absent; no silent Save/Apply controls; malformed bridge body maps to typed BridgeError | **PASS** — laneHygiene guard, status-region tests, BAD_RESPONSE test |
| 5 | Scope discipline: only src/ui/**, src/extensions/dashboard/**, tests/ui/** | **PASS** — zero out-of-scope files, immutable boundaries untouched |
| 6 | Fresh independent lane audit ends with VERDICT: ACCEPT | **This report** |

## 8. Verdict rationale

Every blocking finding from the cycle-1 audit is concretely fixed with meaningful negative coverage; all seven non-blocking findings were also addressed; scope is exactly the assigned repair with no unrelated features; the lane suite (99/99) and the accepted repo gates (typecheck/purity/platform 33/33) all pass offline in the candidate worktree; contract §9.2 informed consent and §12 copy constraints now hold under adversarial probing. The single residual item is a self-documented, behaviorless empty test file whose deletion is a trivial mandatory action at Director port time — it does not make the candidate unsafe to integrate.

VERDICT: ACCEPT
