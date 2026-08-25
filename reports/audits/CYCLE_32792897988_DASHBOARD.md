# Cycle Audit — Dashboard Lane (DASH-C3-1)

- **Run:** 32792897988 · **Role:** dashboard-builder · **Auditor:** independent lane audit
- **Candidate:** `/tmp/wix_dashboard_candidate` @ `d2c6106` ("Wix build 32792897988: dashboard candidate (active)")
- **Accepted base:** `3c42295` ("Wix build 32787032785: director attempt") — current checkout, untouched; candidate parent verified = base
- **Task:** DASH-C3-1 from `docs/NEXT_CYCLE.json` (cycle 3, phase `build`; `docs/state.json.phase = "build"` verified — directive precondition met)
- **Repair priority rule:** latest persisted lane audit is `reports/audits/CYCLE_32787032785_DASHBOARD.md` (**ACCEPT**, residual N-1/N-2/N-3); this candidate was audited as new scheduled work with regression checks on top.

---

## 1. Real diff inspected

`git diff --name-status 3c42295 d2c6106`: **11 files, +1565/−31**:

```
A  src/ui/state/mutationPoller.js
A  tests/ui/applyFlow.test.js
A  tests/ui/mirrorServerSource.test.js
A  tests/ui/mutationBridge.test.js
A  tests/ui/mutationPoller.test.js
M  src/ui/README.md
M  src/ui/modals/diffPreviewModal.js
M  src/ui/pages/rulesEditorPage.js
M  src/ui/services/bridge.js
M  src/ui/state/editorStore.js
M  src/ui/validation/mirror.js
```

Scope verification against the workflow-enforced lane paths:

```
git diff --name-only 3c42295 d2c6106 | grep -v -E '^(src/ui/|src/extensions/dashboard/|tests/ui/)' → NO_OUT_OF_SCOPE_FILES
git diff --name-only 3c42295 d2c6106 | grep -E '^(MAIN_PROMPT.md|.github/|.opencode/|opencode.json|AGENTS.md|directives/)' → NO_IMMUTABLE_FILES_TOUCHED
```

Additional boundary checks:
- **No cross-lane edits**: zero changes under `src/domain/**`, `src/platform/**`, `src/billing/**`, `src/shared/**`; canonical contracts untouched; vitest config glob untouched (cross-lane `vitest_glob_rule` respected).
- **No direct Wix SDK calls outside the bridge's injected transport**: manual grep over all touched sources → the only Wix runtime reference remains the pre-existing guarded dynamic `import('@wix/essentials')` in `bridge.js`; `noWixImports.test.js` stays green with its anti-vacuity assertion.
- **No secrets / fabricated identifiers**: GUID-literal and credential-pattern grep over all new code → zero matches.
- **Copy bans (Contract §12)**: new user-facing strings claim nothing about reschedule guarantees, hard caps, or native per-location hours; failure copy is explicitly honest ("It is not known whether the change set completed").

## 2. Executable checks actually run

| Check | Command (in `/tmp/wix_dashboard_candidate`) | Result |
|---|---|---|
| Lane suite (full) | `cd tests/ui && node --test` | **143/143 pass, 0 fail, 0 skipped**, offline, credential-free (~570 ms) |
| Baseline preservation | `node --test` over the 12 pre-existing test files | **98/98 pass**; `git diff --name-status` proves none were modified |
| New-test breakdown | `node --test <file>` × 4 | applyFlow 12, mirrorServerSource 7, mutationBridge 15, mutationPoller 11 (= 45 new) |
| Repo gates | `npm run check` (typecheck → purity → platform vitest) | **exit 0**: `tsc --noEmit` strict clean; purity gate passed (the loud "PURITY GATE FAILED" stdout lines are the platform lane's own negative-test fixtures inside `tests/platform/purity-gate.spec.ts`, which passed); platform suite **256/256** |
| Offline gate | `npm run check:offline` (proxy-blocked env) | **exit 0**, 256/256 — credential-free/offline criterion proven |
| Skip/only scan | grep `\.(skip\|only\|todo)\(` over `tests/ui/**` | zero matches |

Missing checks (explicit, not hand-waved): `wix build`, dev-site gates (T-RB1/T-VP*) and any scaffold-dependent verification remain impossible pre-credentials (Contract §16) — structural to the phase, not lane negligence. Carried-over prior-audit note N-2 still holds: root `tsc` does not type-check this lane's plain JS (`checkJs:false`), so the Node runner remains the lane's executable gate until the T-VP0 React port.

## 3. DTO-fidelity verification against accepted platform code

The task mandates matching "the accepted platform DTOs". I verified each mirror against the actual accepted sources, not the candidate's claims:

- `GET /mutation-status?planId=` → handler returns `{ status: MutationStatusProjection }` (`src/platform/http/mutationEndpoints.ts` L135–163); missing record throws `PlatformError('NOT_FOUND')` → mapped to HTTP 404 by `transport.ts` L57 ⇒ bridge `404→null` semantics are correct. Projection fields (`planId,state,scope,confirmedChangeIds,totalChanges,updatedAt,snapshotId`) match the bridge doc comment verbatim.
- `POST /recover` body `{ scope }` → `{ recovery: RecoverySummary | null }` (L180–207); legit `null` ("nothing pending") passes through the envelope unwrap correctly.
- `POST /apply-plan` response `{ summary: MutationSummary, requestedBy }` — page reads `response?.summary?.planId`; `MutationSummary.planId` exists (`orchestrator.ts` L71–80).
- Terminal-state allowlist `{SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS}` mirrors `orchestrator.ts` L98–101 exactly, including the fail-safe "anything else is terminal" inversion — a future state addition can never silently keep the UI polling.
- `RecoverySummary {planId, snapshotId, complete, mismatches, notes, auditEntryId}` — rendered fields match exactly.
- Mirror seam target shape `{valid, issues[{path,code,message}]}` equals canonical `ValidationResult`/`ValidationIssue` in `src/domain/validate.ts` L22–32.

## 4. Adversarial probes (independent falsification attempts)

All executed directly against candidate modules; results:

1. **Bounded-poll termination**: always-non-terminal journal stops at exactly `maxAttempts` (EXHAUSTED, no delay awaited after the final allowed attempt); `maxAttempts=0` → immediate EXHAUSTED with zero probes; missing/non-string states treated non-terminal only when absent, any real foreign state string is terminal (fail-safe stop).
2. **Permanent stop**: after terminal or error, extra event-loop turns produce zero further probes (asserted in tests; re-verified).
3. **First-probe failure path** (my probe): requestApply succeeds, very first status probe rejects → `applyStatus='failed'`, exactly 1 probe, no polling resume, `lastMutation=null`. See finding N-A below on the guidance text in this state.
4. **Concurrent-apply lock**: Apply button disabled while `applyStatus==='pending'` (page L534) — no second destructive apply during an in-flight poll.
5. **Consent lifecycle**: every terminal outcome (applied/rolled_back/recovered/failed) clears `confirmedHash` and closes the diff session — one confirmed diff = one apply attempt; re-apply requires fresh review+confirm (tested + probed).
6. **Recover affordance gating**: hidden while no scope observed, while a poll is in flight, and on clean terminals; fires only from the click handler; keyboard Enter activation works; renders mismatches/notes verbatim including incomplete recovery (`complete:false`) without pretending success.
7. **Same-tick multi-click** (my probe): triple synchronous click on Recover fired 3 bridge calls (render/disable lands between event ticks only). Server-side `recoverInterruptedApply` is idempotent (post-RECOVERED lookups find nothing → `null` → honest "Nothing was pending" render), so no destructive duplication is reachable. N-B below.
8. **Observer-throw propagation** (my probe): an exception thrown from `onObservation` escapes the poller rather than mapping to ERROR — theoretical only: the page's callback is fully defensive and sits inside `handleApply`'s try/catch. N-C below.
9. **Mirror hardening**: injected server result is snapshotted (later external mutation of the response object cannot rewrite what was validated); 14 malformed source shapes rejected fail-closed with previous source retained; unconfigured default byte-identical to bundled validators; `resetValidationSource()` restores fallback.
10. **Strict status envelope**: empty/envelope-less 2xx on mutation endpoints → BAD_RESPONSE (never misread as "no record" mid-poll), while legacy GET /ruleset empty-body→null semantics are unchanged — deliberate, documented asymmetry, correct reasoning.

## 5. Acceptance-criteria scorecard (DASH-C3-1)

| # | Criterion | Status |
|---|---|---|
| 1 | Node runner suite green (98 baseline + new), credential-free, offline | **PASS** — 143/143 (98 untouched + 45 new), 0 skipped; `check:offline` green |
| 2 | Bridge tests prove transport failures, non-2xx, empty bodies, malformed JSON → typed BridgeErrors with 404⇒null | **PASS** — 15 dedicated tests incl. URL-encoding, envelope unwrap, `{recovery:null}` |
| 3 | UI tests prove terminal outcome rendered once; bounded polling stopped after terminal/error; recover click-only with rendered summary; no auto-apply/auto-retry | **PASS** — render-once asserted by split-count; bound/error stop asserted incl. post-stop event-loop churn; recover count 0 while waiting, exactly-once per click with tracked scope; `requestApply` count invariant |
| 4 | Mirror accepts injected server-shaped source without behavior change when unconfigured; existing 98 untouched and green | **PASS** — verbatim-injection + snapshot + fail-closed rejection tested; baseline suite byte-unmodified and green |
| 5 | Scope discipline: only src/ui/**, src/extensions/dashboard/**, tests/ui/**; no direct Wix SDK calls outside bridge transport | **PASS** — zero out-of-scope files; purity/no-Wix greps clean |
| 6 | Fresh independent lane audit ends VERDICT: ACCEPT | **This report** |

Task sub-items: (a) typed client methods ✓; (b) bounded poll wired into apply flow with role="status" terminal rendering ✓; (c) explicit crash-recovery affordance, never auto ✓; (d) F-N1 repoint seam extension with contract documentation ✓; (e) N-3 documented cosmetically in `diffPreviewModal.js` header + inline comment, kit internals untouched ✓.

## 6. Remaining findings (non-blocking)

- **N-A (UX honesty, narrow edge):** when the FIRST status probe fails, or every probe returns null (scope never observed), the failed-state guidance says `Use "Recover interrupted apply" if your schedules seem stuck.` but the button cannot render — correctly so, because the accepted recover DTO requires a `ScheduleScope` that only a successful status observation can supply (the apply-plan summary carries only `planId`). The instruction is therefore unfollowable in exactly that state. No safety impact (state description remains truthful; nothing auto-runs). Suggested repair: make the recovery sentence conditional on `state.lastMutation?.scope` (pure message-text change in `dispatchApplyOutcome`). Recorded for a future dashboard cycle; does not block integration.
- **N-B (cosmetic):** same-tick synthetic multi-click can fire `bridge.recover` more than once before the disabled re-render lands. Unreachable through real event-loop-separated clicks and harmless server-side (idempotent recovery → `null` → honest render). Optional debounce later.
- **N-C (theoretical):** `pollMutationUntilTerminal` lets an `onObservation` exception propagate instead of returning an ERROR outcome. Current page wiring cannot throw (defensive reducer, try/catch upstream). Document or wrap at next touch.

None of these affect correctness, consent integrity, bounded polling, destructive-write safety, accessibility, or scope discipline.

## 7. Verdict rationale

The candidate implements exactly the Director-assigned slice — the Blueprint §4 flow-3 mutation-lifecycle surface — with no unrelated scope: bridge methods provably match the accepted platform DTOs, polling is bounded and provably permanent-stopping, recovery is strictly click-gated with honest verbatim outcome rendering, one consent covers exactly one apply attempt, and the F-N1 repoint seam now accepts server-shaped validation results without changing offline behavior. All executable checks pass offline in the candidate worktree (143/143 lane, 256/256 platform, tsc strict, purity gate). The three residual findings are narrow-edge UX/theoretical items with concrete suggested fixes, none of which make the candidate unsafe to integrate.

VERDICT: ACCEPT
