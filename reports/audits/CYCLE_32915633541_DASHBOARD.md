# Lane Audit — DASHBOARD candidate, cycle 6 (run 32915633541)

- **Auditor:** independent lane-auditor (dashboard lane)
- **Candidate:** SHA `dcfcf14f8c31a7e7871f8927a40ebdea914db448` mounted at `/tmp/wix_dashboard_candidate`
- **Accepted base:** SHA `fd480aadb3e9b980492f5ccd2a1c3f5efe7926dd` (verified: candidate's parent commit is exactly the accepted director commit)
- **Task:** DASH-C5-1 (docs/NEXT_CYCLE.json, cycle 5 queue) — management-side entitlement restriction in the RulesEditor per Contract §7
- **Verdict basis:** real diff inspected, deterministic checks executed in the candidate worktree, six independent adversarial probes executed against the rendered page

## 1. Scope and boundary verification

`git diff fd480aa..dcfcf14 --name-only` yields exactly four files, all inside the task's declared scope (`src/ui/**`, `src/extensions/dashboard/**`, `tests/ui/**`):

| File | Change |
|---|---|
| `src/ui/pages/rulesEditorPage.js` | +322/−11: meter load, restriction context, badge/note rendering, control locking, anti-trap issue-path unlock, degraded banner, over-limit CTA, n/a + error notices, `reload()` seam |
| `tests/ui/rulesEditorEntitlement.test.js` | +572 (new file): 24 tests |
| `src/extensions/dashboard/rules-editor.page.js` | comment-only doc update |
| `src/ui/README.md` | decision-of-record 9 documenting the behavior contract |

Boundary results:
- No governance paths touched (`MAIN_PROMPT.md`, `.github/**`, `.opencode/**`, `AGENTS.md`, `opencode.json`, `directives/**`, `docs/**` — empty diff).
- `src/domain/ports.ts` untouched and hash-verified to the frozen value `d46e0743fa825315…18802`.
- `src/ui/validation/ruleDraftValidators.js` byte-for-byte unchanged — SHA-256 `871df113e6793443…` identical in base and candidate (parity-ledger constraint honored).
- No domain/billing/platform files modified; the vitest suite count stays at the accepted 465.

## 2. Executable checks (all run by this auditor, offline, credential-free)

1. **Node runner suite from `tests/ui`:** 210/210 pass. Baseline verified independently on the accepted checkout: 186/186. Delta = exactly the 24 new entitlement tests; no pre-existing test file modified (diff contains only the new test file). No `.skip/.only/.todo` anywhere under `tests/ui`.
2. **Full integrated gate in the candidate worktree:** `npm run check` green — typecheck, purity gate (all protected roots), vitest 45 files / 465 tests passed.
3. **Parity ledger:** `tests/domain/uiValidatorParity.spec.ts` run alone: 30/30 green.
4. **Banned-claims scan (§12)** over all changed files: no hits (the only "native per-location" occurrences are the honest denials already accepted in prior cycles).

## 3. Acceptance-criteria verification

| Criterion | Evidence |
|---|---|
| Node runner suite green (186 baseline + new), credential-free, offline | 210/210; baseline reproduced on accepted base |
| Tests prove uncovered-location restriction rendering | `coverage-badge-*`, add-window/input/limit locks asserted for all 7 weekdays; probe P1 confirms locks are precise (an issue on a covered location does not unlock uncovered rows) |
| Stable-ordering note | Verbatim phrase "default location first, then alphabetical" asserted against Contract §7 wording |
| Existing-config preservation, no deletion path | Valid rows render read-only with values intact; locked Remove click proven to be a DOM-level no-op; draft proven never rewritten across re-renders; probe P6 proves save under restriction persists uncovered windows + limits verbatim (§7 "never delete user data" holds through the save path) |
| CTA visibility on overLimit | Exact contracted URL `https://www.wix.com/apps/upgrade/<appId>?appInstanceId=<instanceId>`, `target="_blank"`, `rel="noopener noreferrer"`; absent without valid host-injected identifiers (never fabricated); absent when not overLimit |
| Degraded banner persistence | `role="alert"` banner survives store-driven re-renders; covers `meter.degraded`, `coverage.degraded` (with DTO warning verbatim or honest default), and healthy-with-warning states |
| 404/null graceful degradation | `role="status"` polite notice, editor fully unrestricted, no alert; typed bridge failures (`TRANSPORT_FAILURE`, `BAD_RESPONSE`) degrade identically with honest wording; legacy bridge without the method stays silently idle; no bridge = today's editor |
| Bridge reuse only | Probe P4 with a recording proxy: the page touches only `getEntitlementMeter`; no transport access outside `services/bridge.js`; `noWixImports` test green within the suite |
| Accessible markup assertions | Composite restricted+over-limit+degraded state passes label audit and Enter/Space keyboard activation proof; disabled controls correctly inert |

## 4. Adversarial probes (behaviors beyond the candidate's own tests)

All executed against the real rendered page:

- **P1 Anti-trap precision:** an incomplete row on a *covered* location does not unlock rows of the *uncovered* location; uncovered valid rows stay locked while covered-issue rows stay removable. Meter fetched exactly once.
- **P2 Combined degraded+overLimit:** banner AND CTA render while nobody is restricted — matches enforcement's fail-open coverage posture (C5 alignment); restricting off an unreliable list would misstate what the rules actually enforce.
- **P3 Hostile-but-DTO-valid coverage lists:** empty list restricts everything (correct); duplicate/unknown ids cause no crash and no false unlock.
- **P4 Bridge reuse:** single method touch, no leakage to transport.
- **P5 Empty catalogs + ghost ids:** no crash, no phantom badges.
- **P6 Save under restriction:** uncovered configuration preserved byte-for-byte through `saveRuleSet`; save status honest.

## 5. Fail-safe review of new async code

- In-flight guard collapses concurrent initial-load/reload calls into one bridge request (tested).
- `destroy()` before resolution drops the late result without rendering or crashing (tested); no interleaving window exists between the destroyed-check and the synchronous re-render.
- The editor is interactive from first paint; the meter loads strictly in the background; every failure mode lands in a non-blocking notice rather than a crash.
- Restriction can never brick the editor: any control whose current value contributes a validation issue (row path, bucket-overlap path, `limits.LOCATION.<id>`) keeps its correction/removal path; probes confirm precision both ways.

## 6. Observations (non-blocking)

- **O1:** A *complete, valid* row added during the brief pre-meter-load window becomes non-removable once restriction lands (valid rows intentionally have no deletion path). Residual is harmless: enforcement skips uncovered locations entirely, the draft stays valid/reviewable/savable, and the lock direction is the §7-conservative one (never delete). Documented tradeoff in README decision 9; acceptable for this cycle.
- **O2:** `entitlementContext` assumes `dto.coverage` exists once status is `ready`. This is guaranteed by the only sanctioned source — the typed bridge's strict pinned-DTO validation (BAD_RESPONSE otherwise) — so it is unreachable through the real stack; noted for the future T-VP0 port.
- **O3:** Phantom-weekday issues (`WEEKDAY_UNKNOWN`) block review without a rendered control — pre-existing accepted behavior (F-N7 pairing), neither introduced nor worsened by this candidate.

## 7. Verdict rationale

The candidate implements exactly the assigned DASH-C5-1 slice, consumes the pinned v1 meter DTO verbatim through the shipped bridge method, aligns restriction semantics with Contract §7 (stable ordering note, nothing-deleted guarantee, upgrade CTA in a new tab, fail-open degraded posture) and adds precise, non-vacuous regression coverage including negative/degradation/lifecycle/a11y cases. All deterministic checks are green and independently reproduced; adversarial probes found no falsifying behavior; scope and frozen-artifact constraints hold. No blocking finding remains.

VERDICT: ACCEPT
