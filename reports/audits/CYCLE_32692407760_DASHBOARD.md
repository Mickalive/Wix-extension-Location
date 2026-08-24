# Cycle Audit — Dashboard Lane (DASH-C1-1)

- **Run:** 32692407760 · **Role:** dashboard-builder · **Auditor:** independent lane audit
- **Candidate:** `/tmp/wix_dashboard_candidate` @ `2337dac` ("Wix build 32692407760: dashboard candidate (active)")
- **Accepted base:** `12071a5` ("Wix recon 32686475370: accepted architecture state") — current checkout, untouched
- **Task:** DASH-C1-1 from `docs/NEXT_CYCLE.json` (cycle 1, phase `build`; `docs/state.json.phase = build` verified — directive precondition met)
- **Prior audits for this lane:** none (`reports/audits/` contains only `RECON.md`) → no repair-priority override applies; this is a first audit.

---

## 1. Real diff inspected

`git diff --stat 12071a5 2337dac`: **32 files, +3509 lines, 0 deletions** — all additions:

- `src/ui/**` (page, sections, modal, explain panel, editor store, diff engine, validation mirror + bundled validators, services bridge, DOM kit, README)
- `src/extensions/dashboard/{rules-editor.page.js,diff-confirm.modal.js}` (registration shapes)
- `tests/ui/**` (10 test files + headless DOM/a11y helpers + nested `package.json`)

Scope verification against the workflow-enforced lane paths (`.github/workflows/wix-build-loop.yml` lines 187 and 362 whitelist exactly `src/extensions/dashboard/**`, `src/ui/**`, `tests/ui/**` for the dashboard role):

```
git diff --name-only 12071a5 2337dac | grep -v -E '^(src/ui/|src/extensions/dashboard/|tests/ui/)' → NO_OUT_OF_SCOPE_FILES
```

Immutable boundaries (`MAIN_PROMPT.md`, `.github/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `directives/*`) are untouched. No secrets, no fabricated Wix identifiers (no app IDs, instance IDs, or account-specific values anywhere). Note: the blueprint's `src/dashboard/**` naming is superseded by the workflow shell's actual enforced paths (`src/ui/**`); the candidate matches the enforcing authority, so the directory naming is **not** a violation.

## 2. Executable checks actually run

| Check | Command | Result |
|---|---|---|
| Unit/component tests | `cd tests/ui && npm run test:unit` (Node built-in runner, Node v22.13.0) | **63/63 pass, 0 fail**, credential-free, no network |
| Scope purity | `git diff --name-only` filtered against workflow whitelist | clean |
| Copy-ban grep | `grep -rniE 'reschedule\|guarantee\|hard cap\|100%\|native ... hours'` over lane sources | only compliant disclosures (see §4) |
| Adversarial probes | direct module execution (adjacent windows, overlap chains, leap years, cap inputs, diff fidelity repros) | results below |

Missing checks (explicit, not hand-waved): no typecheck/lint/build gate ran because root project tooling (`package.json`, `tsconfig`, Vitest) is owned by the integration lane (INT-C1-1) and does not exist at base; the candidate's nested `tests/ui/package.json` makes its own suite runnable today and documents the handoff. `wix build` cannot run pre-scaffold (human credentials, Contract §16). These absences are structural to cycle 1, not lane negligence.

## 3. Acceptance-criteria scorecard (DASH-C1-1)

| # | Criterion | Status |
|---|---|---|
| 1 | Editor covers all v1 rule types: per-location windows, per-service windows, ≥2 split windows on one weekday, dated exceptions, caps day/service/location | **PASS** — `RulesEditorPage` renders both scopes × 7 weekdays with unlimited split rows; exceptions (CLOSED/OVERRIDE); three cap dimensions. Proven by `rulesEditorPage.test.js` ("editor covers all v1 rule types…"). |
| 2 | Accessibility assertions: labeled controls, keyboard operability, roles for diff modal | **PASS** — `auditLabels` (zero unnamed controls), `assertKeyboardOperable`, Enter/Space activation tests, dialog `role`/`aria-modal`/`aria-labelledby`/Escape tests. |
| 3 | Invalid input blocked with messages EQUAL to domain validator messages | **PASS WITH CAVEAT (see F-N1)** — end<=start, zero-length, overlapping windows, negative/non-integer caps, missing date are all blocked; rendered text is asserted equal to validator output. Caveat: the "domain validators" are currently the lane-bundled pure module, since `src/domain/**` does not exist at base and path ownership forbids the dashboard lane from creating it. Equality is therefore by construction within the lane, not yet against the rules-lane canonical module. |
| 4 | Apply disabled until diff modal rendered AND explicitly confirmed; test proves gating | **PASS (mechanism)** — hash-bound `DIFF_RENDERED`+`CONFIRM_DIFF_PREVIEW` binding, edit invalidates confirmation, stale-hash replay rejected, invalid draft overrides any confirm (`canApply`). Proven at state level *and* end-to-end through the UI, including negative tests. Two fidelity gaps in the preview content itself are filed as blocking findings F-B1/F-B2 below. |
| 5 | Grep test proves no `@wix/` imports outside the single services-bridge | **PASS** — `noWixImports.test.js` scans `src/ui` + `src/extensions/dashboard`, asserts offenders === `[src/ui/services/bridge.js]`, plus an anti-vacuity test proving the bridge really contains the reference. Bridge uses a lazy dynamic `import('@wix/essentials')` inside the only permitted module; fails safely to `BRIDGE_NOT_CONFIGURED` offline (tested). |
| 6 | Component tests green under `npm run test:unit` without Wix credentials | **PASS** — 63/63, offline. |

Out-of-scope respect: no live Wix data fetching (bridge unconfigured ⇒ typed failure), no release/hot-reload claims, no evaluation logic beyond configuration-draft validation. Directive items not in this cycle's task (locations meter / upgrade state, React/design-system mount) are correctly deferred and documented in `src/ui/README.md`.

## 4. Contract & directive compliance

- **§9.2 diff-and-confirm:** gating logic is genuinely strong (rendered-hash-bound confirm, edit invalidation, server re-validation anticipated via `requestApply(ops, confirmedDiffHash)`). However the *content* fidelity of the preview violates "shows exactly what will change" for exception mutations and for invalid drafts → **F-B1, F-B2**.
- **§12 copy bans:** location section honestly discloses "Wix has no native per-location hours object"; caps carry the C6 soft-limit disclosure ("can briefly exceed it") asserted verbatim in tests; no reschedule-enforcement promises anywhere. **Compliant.**
- **§8.4/UQ3 honesty:** React/@wix/design-system mounts are explicitly deferred to T-VP0 dependency pinning instead of being faked — correct treatment of the UNVERIFIED pin.
- **Directive DASHBOARD.md:** loading/empty/error/save/apply states all present and tested; accessible keyboard-friendly controls delivered; upgrade-state display remains future work consistent with the assigned task.

## 5. Blocking findings

### F-B1 — Diff preview misrepresents exception mutations (violates binding Contract §9.2)

`DiffPreviewModal.describeOp()` renders `UPDATE_EXCEPTION` as only `Change exception - <date>` and `REMOVE_EXCEPTION` as only `Remove exception - <date>`. Reproduced directly:

```
saved exception e1 = CLOSED all day  →  draft e1 = OVERRIDE 10:00–14:00
computeScheduleDiff → [{kind:'UPDATE_EXCEPTION', …}]
describeOp → "Change exception - 2026-12-25"
```

The user confirming this dialog cannot see that a full-day closure becomes a 10:00–14:00 opening override. Exceptions are precisely the highest-risk mutation class in this product: per Contract §4.4, updating an INSTANCE auto-creates an irreversible calendar EXCEPTION and Cancel Event is terminal. A consent dialog that hides the new state (and what is being removed) for irreversible operations does not satisfy §9.2 "UI shows exactly what will change", nor the lane criterion "renders exactly what a proposed schedule apply would change". The existing test asserts modal lines equal `describeOp(op)` output — equality with the same lossy renderer proves nothing about fidelity.

**Required fix (same lane):**
1. `describeOp('UPDATE_EXCEPTION')` must include before→after detail: prior kind (+hours if OVERRIDE) → new kind (+hours), e.g. `Change exception - 2026-12-25: closed all day → open 10:00–14:00`; include note changes when present.
2. `describeOp('REMOVE_EXCEPTION')` must describe the entry being removed including its kind/hours.
3. Extend `diffPreviewModal.test.js` / `computeScheduleDiff.test.js` with assertions that the rendered line for a CLOSED→OVERRIDE update exposes the new hours, and that removal lines expose the removed entry's kind.

### F-B2 — Review/confirm flow reachable while the draft is invalid

"Review changes" is enabled whenever the modal isn't open (`disabled: state.diffPreview.open` only). With validation issues present, the modal happily lists degenerate operations — reproduced: an empty row renders as `Add window - Location l1, Monday: -` — and offers an enabled "Confirm changes" button. Verified that `canApply` still refuses apply while issues exist (no enforcement bypass; tested in `editorStore.test.js`), but §9.2 informed consent is broken: the user can "confirm" content that is not a valid proposal, and the modal presents unreviewable garbage as schedule changes.

**Required fix (same lane, either approach acceptable):**
- Disable "Review changes" while `state.issues.length > 0` with an explanatory `title`, **or**
- Keep it enabled but disable the modal's Confirm button and render an in-modal warning listing the blocking issues.
Add a negative UI test proving Confirm cannot reach `confirmed:true` through the UI while any issue is open.

## 6. Non-blocking findings (fix in this lane or coordinate at integration)

- **F-N1 (structural, obligation recorded):** `src/ui/validation/ruleDraftValidators.js` duplicates configuration-validation logic that Blueprint §2 assigns to the rules lane. Literal compliance with "IMPORTS the pure domain validators" was impossible this cycle: `src/domain/**` does not exist at base and the workflow shell forbids the dashboard lane writing there. The builder documented this as a decision-of-record with a single repoint seam (`mirror.setValidationSource()`). **Obligation:** the Director must, at integration/next cycle, repoint `mirror.js` to the canonical `src/domain` validators and add a cross-lane parity contract test asserting message equality, so this duplication cannot silently become permanent. Until repointed, UI messages are provisional.
- **F-N2:** `DiffPreviewModal.js` header claims "focus is moved into the dialog on open and restored on close" — restoration is not implemented anywhere (grep confirms). Implement restore-on-close or correct the comment.
- **F-N3:** `src/ui/probe.txt` is a leftover write-scope placeholder committed to the product tree ("Safe to delete at integration"). Delete it; do not port it.
- **F-N4:** In `rules-editor.page.js` the assembled controller's `onSave`/`onApply` effects are silent no-ops: clicking Save/Apply in the shell gives zero feedback (no `SAVE_START`/error dispatch). Dispatch a visible pending/unavailable state or disable these actions until backend wiring lands — silent controls contradict the directive's "show validation, loading, error and save/apply states".
- **F-N5:** `bridge.request()` parses 2xx bodies with bare `JSON.parse`; a malformed body throws raw `SyntaxError` instead of a typed `BridgeError`. Wrap and map (e.g. `BAD_RESPONSE`); add a test.
- **F-N6:** `tests/ui/zzDebug.test.js` — content is a legitimate permanent regression guard (row-scoped weekday resolution); rename the file descriptively (e.g. `windowRowWeekdayResolution.test.js`).
- **F-N7:** `computeScheduleDiff.windowOpsForScope` iterates only canonical `WEEKDAY_ORDER` keys; a non-canonical weekday bucket in saved/draft data would be silently invisible to the diff. Low risk (the phantom-bucket regression is guarded), but validate/surface unknown keys rather than dropping them.

## 7. What was verified positively (for the record)

- Hash-gated confirm design is sound: OPEN recomputes ops+hash; confirm requires `open && renderedHash===hash && currentHash===hash`; every draft edit calls `invalidateConfirmation`; `canApply` additionally re-checks `confirmedHash === currentDiff(state).hash` and `issues.length === 0`. Stale-confirm replay after edits is explicitly tested and rejected.
- Determinism: diff ordering stable (scope sort, weekday order, id maps); FNV-1a hash stable across runs (tested); identical inputs ⇒ identical outcomes.
- Validation quality beyond the ACs: real calendar validation incl. leap years (probed: `2028-02-29` valid, `2027-02-29`/`2026-02-30` rejected); adjacency `09:00-12:00`+`12:00-14:00` correctly allowed, chained overlaps produce per-pair issues; `-0` cap accepted as zero; `+5` rejected as non-integer.
- Error model: typed `BridgeError` codes (`BRIDGE_NOT_CONFIGURED`, `TRANSPORT_FAILURE`, `HTTP_<status>`), 404→null semantics, injected fetchWithAuth transport, guarded dynamic Wix import — all tested.
- Accessibility implementation is real, not decorative: programmatic label association, `aria-describedby`/`aria-invalid` wiring, `role="alert"` errors, native keyboard semantics with Enter/Space activation proven through the headless DOM.
- No race/idempotency hazards introduced client-side; no destructive schedule-mutation capability exists in this lane (apply only POSTs confirmed ops to the future backend orchestrator).

## 8. Verdict rationale

The candidate is a disciplined, well-tested cycle-1 shell with strong gating mechanics and honest platform framing. It is not integrable as-is because the deliverable whose entire purpose is §9.2 informed consent misrepresents the most destructive operation class (F-B1) and permits confirming invalid proposals (F-B2). Both are concrete, narrowly scoped fixes in the same lane's components and tests. Per the mandatory repair feedback loop, these findings return to the dashboard-builder; F-N1's repoint-and-parity obligation is recorded for the Director's next-cycle plan.

VERDICT: FIX_BEFORE_INTEGRATION