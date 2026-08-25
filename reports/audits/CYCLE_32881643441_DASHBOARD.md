# Cycle Audit — Dashboard Lane (DASH-C4-1)

- **Run:** 32881643441 · **Role:** dashboard-builder · **Auditor:** independent lane audit
- **Candidate:** `/tmp/wix_dashboard_candidate` @ `a388837` ("Wix build 32881643441: dashboard candidate (active)")
- **Accepted base:** `adb0b23` ("Wix build 32792897988: director attempt") — current checkout, untouched (`git status --porcelain` empty); candidate parent `a388837^` verified byte-identical to base
- **Task:** DASH-C4-1 from `docs/NEXT_CYCLE.json` (cycle 4, phase `build`; `docs/state.json.phase = "build"` verified — directive precondition met)
- **Repair priority rule:** latest persisted lane audit is `reports/audits/CYCLE_32792897988_DASHBOARD.md` (**ACCEPT**, residual N-A/N-B/N-C). This candidate executes scheduled work DASH-C4-1 **and** folds all three residuals as its sub-items (b)/(c)/(d) — correct ordering per the repair-priority rule.

---

## 1. Real diff inspected

`git diff --name-status adb0b23 a388837`: **11 files, +1508/−5**:

```
A  src/extensions/dashboard/locations-usage.page.js
A  src/ui/pages/locationsUsagePage.js
A  src/ui/upgrade/upgradeUrl.js
M  src/ui/README.md
M  src/ui/pages/rulesEditorPage.js
M  src/ui/services/bridge.js
M  src/ui/state/mutationPoller.js
A  tests/ui/locationsUsagePage.test.js      (19 tests)
A  tests/ui/meterBridge.test.js             (16 tests)
A  tests/ui/pollerObserverSafety.test.js    (3 tests)
A  tests/ui/recoveryGuidanceHonesty.test.js (5 tests)
```

Scope verification against the workflow-enforced lane paths:

```
git diff --name-only adb0b23 a388837 | grep -v -E '^(src/ui/|src/extensions/dashboard/|tests/ui/)' → NO_OUT_OF_SCOPE_FILES
git diff --name-only adb0b23 a388837 | grep -E '^(MAIN_PROMPT.md|.github/|.opencode/|opencode.json|AGENTS.md|directives/)' → NO_IMMUTABLE_FILES_TOUCHED
git diff adb0b23 a388837 -- src/domain src/billing src/shared src/platform src/platform/vitest.config.ts → EMPTY (no cross-lane edits; vitest glob rule respected)
git diff adb0b23 a388837 -- src/ui/validation/ruleDraftValidators.js → EMPTY (byte-for-byte unchanged, parity-ledger constraint honored)
```

Additional boundary checks:
- **No direct Wix SDK calls outside the bridge**: repo grep shows exactly one `@wix/` reference in the lane — the pre-existing guarded dynamic `import('@wix/essentials')` in `bridge.js`; `noWixImports.test.js` stays green with its anti-vacuity assertion.
- **No fabricated identifiers**: GUID-literal grep over all added diff lines → zero matches. Upgrade identifiers arrive only via host-injected options; tests use obviously synthetic values; missing/invalid identifiers suppress the link while keeping the restriction notice (tested).
- **Copy bans (Contract §12)**: banned-claim grep over new user-facing strings → clean. The counting disclosure states the ratified billable-location definition (not archived + referenced by ≥1 service) without inventing a native per-location hours object; no reschedule/hard-cap promises anywhere.

## 2. Executable checks actually run

| Check | Command (in `/tmp/wix_dashboard_candidate`) | Result |
|---|---|---|
| Lane suite (full) | `cd tests/ui && node --test` | **186/186 pass, 0 fail, 0 skipped, 0 todo**, offline, credential-free (~730 ms) |
| Baseline preservation | `git diff --name-status -- tests/ \| grep -v '^A'` | empty — all 12 pre-existing files byte-unmodified; 143 baseline + 43 new = 186 |
| New-test breakdown | `node --test <file>` × 4 | locationsUsagePage 19, meterBridge 16, pollerObserverSafety 3, recoveryGuidanceHonesty 5 (= 43) |
| Repo gates | `npm run check` (typecheck → purity → platform vitest) | **exit 0**: `tsc --noEmit` strict clean; purity gate green; platform suite **392/392** across 38 files |
| Parity ledger | `npx vitest run … tests/domain/uiValidatorParity.spec.ts` | **30/30 pass** — both validators still pinned, loud-fail ledger intact |
| Offline gate | `npm run check:offline` (proxy-blocked env) | **exit 0**, 392/392 — credential-free/offline criterion proven |
| Skip/only scan | grep `\.(skip\|only\|todo)\(` over `tests/ui/**` | zero matches |

Missing checks (explicit, not hand-waved): `wix build`, dev-site gates (T-VP0/T-RB1/T-VP*) and any scaffold-dependent verification remain impossible pre-credentials (Contract §16) — structural to the phase, not lane negligence. Carried-over prior-audit note still holds: root `tsc` does not type-check this lane's plain JS (`checkJs:false`), so the Node runner remains the lane's executable gate until the T-VP0 React port.

## 3. Contract/DTO fidelity verified against binding sources, not candidate claims

- **Pinned GET /meter DTO** (`docs/NEXT_CYCLE.json cross_lane_compatibility.pinned_dto_get_meter`, shared with INT-C4-1c): `{meter:{count:number|null,degraded:boolean}, coverage:{allowedLocationIds:string[],overLimit:boolean,degraded:boolean,warning:string|null}}`. The bridge's `isEntitlementMeterDto` enforces exactly these types (null-tolerant count/warning, boolean scalars, string-array ids, array/null body rejection); additive extra fields are tolerated so a purely additive backend extension cannot break the dashboard (tested). Drift of any pinned field ⇒ typed `BAD_RESPONSE`, never invented entitlement state.
- **404⇒null n/a semantics** implemented exactly as tasked; every other non-2xx ⇒ `HTTP_<status>` typed error (401 explicitly tested).
- **Upgrade URL contract (Contract §7)**: I ran an independent **differential parity probe** transpiling the accepted billing builder `src/billing/upgrade/upgradeUrl.ts` and comparing against the dashboard mirror on 9 cases (valid ids, long ids, GUID-shaped ids, dash/underscore ids, plus undefined/empty/whitespace/embedded-space/null inputs): **identical outputs and identical TypeError behavior on all 9**; exact contracted shape `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` confirmed. The README's "mirror" claim (decision 7) is true in behavior, consciously ledgered for repoint at T-VP0.
- **N-A/N-B/N-C mapping**: each fix corresponds verbatim to the finding text in `reports/audits/CYCLE_32792897988_DASHBOARD.md` §6 — conditional recovery sentence keyed on `state.lastMutation?.scope` in ALL THREE failed branches (FAILED_TERMINAL / EXHAUSTED / ERROR), synchronous in-flight guard around `handleRecover` with `finally` reset, and observer-exception wrapping inside `pollMutationUntilTerminal` returning the standard ERROR outcome with permanent stop.

## 4. Adversarial probes (independent falsification attempts)

All executed directly against candidate modules; results:

1. **Upgrade-URL mirror parity** (probe suite above): 9/9 identical including error parity; no encoding deviation from the contracted shape.
2. **Over-limit + degraded simultaneously**: banner (role=alert) AND over-limit notice AND CTA render together; positive "within your plan" note correctly suppressed — fail-open never renders as silently healthy.
3. **Destroy-during-in-flight-load**: `destroy()` then late resolution → no crash, no stale render (guarded `destroyed` checks before both view mutation and trailing render).
4. **Reload dedupe**: three concurrent `reload()` calls collapse into exactly one bridge call (`loadInFlight` guard) — mirrors the retry-button guard.
5. **Repeated failures**: two consecutive transport errors each render the alert state; third retry recovers to the healthy meter.
6. **Floor-note gating**: renders at exactly `count===0`; suppressed when count is unreadable (`null`) — never claims the floor for an unknown count.
7. **Covered-list ordering**: backend order rendered verbatim even when deliberately unsorted (`zzz,aaa,mmm,default-first`) — client never reorders the stable cut.
8. **Empty-string warning**: treated as absent (no banner, within-plan note intact) — sensible reading of `warning: string|null`.
9. **N-A ERROR-with-scope** (my probe): status probe fails AFTER a scoped observation → guidance still offers "Recover interrupted apply" and the button renders (control proving the condition isn't over-broad). **ERROR-no-scope** omits it; **clean apply** never mentions it.
10. **N-C containment edges** (my probes): observer throwing on a non-terminal observation mid-poll → ERROR outcome carrying the original error, polling permanently stopped (post-stop event-loop churn produces zero further probes); observer throwing only AFTER the terminal observation → classification unaffected (APPLIED), matching the wrap-before-classify ordering.
11. **Bridge strictness re-probe via suite**: malformed JSON (cause preserved as SyntaxError), empty body, missing meter/coverage keys, wrong-typed scalars, non-string array entries, array/null bodies → all BAD_RESPONSE; 404→null; 500/401→HTTP_*; transport rejection→TRANSPORT_FAILURE.

## 5. Acceptance-criteria scorecard (DASH-C4-1)

| # | Criterion | Status |
|---|---|---|
| 1 | Node runner suite green (143 baseline + new tests), credential-free, offline | **PASS** — 186/186 (143 untouched + 43 new), 0 skipped; `check:offline` green |
| 2 | Meter page tests prove pinned-DTO rendering incl. count:null degraded, over-limit + CTA visibility rules, floor note, warning-banner persistence, new-tab upgrade link with exact URL contract | **PASS** — 19 page tests cover each item (persistence across reloads, recovery-only-on-health, exact href/target=_blank/rel, no-link-without-identifiers); independently re-probed |
| 3 | Bridge tests prove getEntitlementMeter maps transport failures/non-2xx/malformed JSON to typed BridgeErrors | **PASS** — 16 dedicated tests incl. 401, empty body, shape drift, additive-field tolerance |
| 4 | N-A regression: guidance mentions Recover only when scope known; N-C regression: throwing observer yields ERROR outcome with polling stopped | **PASS** — 5 + 3 dedicated regressions plus my A1–A3/C1–C2 probes |
| 5 | No direct Wix SDK calls outside the bridge's injected transport; scope limited to src/ui/**, src/extensions/dashboard/**, tests/ui/**; ruleDraftValidators.js byte-for-byte unchanged | **PASS** — zero out-of-scope files; single pre-existing guarded import; validator diff empty; parity ledger 30/30 |
| 6 | Honest copy only (no banned claims per Contract §12); fresh independent lane audit ends VERDICT: ACCEPT | **PASS** — copy greps clean; disclosure matches ratified §7 definitions; this report |

Task sub-items: (a) LocationsUsage page + typed `getEntitlementMeter()` + registration-shape file ✓; (b) N-A conditional guidance ✓; (c) N-C observer containment ✓; (d) N-B trivial debounce ("only if trivial" — it is) ✓. Out-of-scope items respected: no platform/billing/domain changes, no live Wix fetching, no React mount, no validator-semantics change.

## 6. Remaining findings (non-blocking)

- **N-1 (UX polish, deferred):** the numeric plan allowance renders only in the over-limit state (and descriptively under tier-restriction); a fully healthy within-plan user sees the count and the within-plan note but not the allowance number itself. The acceptance criteria pin "over-limit + CTA visibility rules", which this satisfies; surfacing the allowance always is reasonable future polish once INT-C4-1 lands and real plan state exists.
- **N-2 (cosmetic):** with `count=0` AND `coverage.degraded=true` the floor note co-renders with the degraded banner. The floor sentence remains a factual statement of billing policy and the banner warns concurrently, so nothing is silently misrepresented.
- **N-3 (conscious duplication):** `src/ui/upgrade/upgradeUrl.js` duplicates accepted billing logic until the T-VP0 TypeScript port can import the billing module directly. Ledgered in README decision 7 with an explicit repoint obligation; behavioral parity independently proven in §4.1 of this audit. Same conscious-mirror pattern as the validation seam; must be tracked at the future repoint like the R1–R4 ledger.

None of these affect correctness, entitlement honesty, destructive-write safety, accessibility, scope discipline, or the parity ledger.

## 7. Verdict rationale

The candidate implements exactly the Director-assigned slice — the Blueprint §1 `pages/LocationsUsage` meter fed by the pinned GET /meter DTO, plus the three concrete accepted-audit repairs — with no unrelated scope. DTO fidelity was verified against `docs/NEXT_CYCLE.json` and the accepted billing builder rather than the candidate's own claims; the upgrade-URL mirror was differentially proven equivalent; all four acceptance-test criteria have dedicated passing coverage that survived independent adversarial probing; every executable check available pre-credentials passes offline (186/186 lane, 392/392 platform incl. the untouched parity ledger, tsc strict, purity gate). The three residual findings are polish-level items with clear future homes, none of which make the candidate unsafe to integrate.

VERDICT: ACCEPT
