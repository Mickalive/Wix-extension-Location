# Cycle Audit — BILLING lane (run 32881643441)

- **Auditor:** lane-auditor (billing), independent.
- **Candidate:** `/tmp/wix_billing_candidate` @ `b1e3dcf` ("Wix build 32881643441: billing candidate (active)"), single commit directly on top of the current accepted checkout `adb0b23` (verified identical parent).
- **Task audited:** `BILL-C4-1` from `docs/NEXT_CYCLE.json` — downgrade-through-gate regression + projection-fidelity folds (accepted-audit observations 1, 3, 4 of `reports/audits/CYCLE_32792897988_BILLING.md` §6).
- **Binding references:** `docs/WIX_TECHNICAL_CONTRACT.md` §7/§11 (C2/C5), `docs/BUILD_BLUEPRINT.md` §1/§2/§4 flow 5/§6, `directives/BILLING.md`, canonical `src/domain/ports.ts` + `src/shared/{types,errors}.ts`.

## 1. Diff scope and governance

Real diff (`git diff adb0b23..b1e3dcf`) touches exactly 5 files, all inside the billing lane's owned paths: `src/billing/**` (3 files: docstring-only updates to `projection/types.ts` and `projection/projector.ts`, updated `README.md`) and `tests/billing/**` (2 new files: `downgradeThroughGate.spec.ts` 292 lines, `projectionFidelity.spec.ts` 303 lines). Verified empty diff over every other path including `src/domain/**`, `src/shared/**`, `src/platform/**`, `src/ui/**`, `docs/**`, `.github/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `MAIN_PROMPT.md`, `directives/**`, `package.json`, `package-lock.json`, `tsconfig.json`, and both vitest configs.

Verified clean:
- Canonical contracts consumed unforked: `src/domain/ports.ts` SHA-256 `af68e698…fbc` matches the value pinned in NEXT_CYCLE.json's canonical_contracts_notice; `src/shared/types.ts` / `src/shared/errors.ts` byte-for-byte identical to accepted state.
- Production-code changes are comment/docstring ONLY (verified line-by-line): the C2 wording in `projector.ts` and `types.ts` was corrected to be truthful; zero behavior-bearing lines changed in `src/billing`.
- Purity: zero `@wix/` occurrences under `src/billing/**` (grep clean); no I/O, clock, or network introduced.
- No secrets; no fabricated Wix identifiers (fixtures are obviously synthetic `prod-test-*`, `evt-*`, `loc-*`, `inst-other`).
- No banned copy ("guarantee", "100%", "hard cap", native per-location hours, unconditional reschedule — grep clean across changed files).
- No `.skip`/`.only`/`.todo` in tests/billing; existing suites untouched (diff adds files, never edits prior specs).
- Platform-owned vitest glob (`tests/**/*.spec.ts`) untouched; both new suites collected through it (confirmed present in the platform-config run: 40 files / 400 tests).
- Worktree restored clean after my scratch adversarial spec was removed (`git status` empty; candidate tracked content untouched by me).

## 2. Executable checks actually run (explicit, not hand-waved)

All executed inside the candidate worktree:

1. `npx vitest run tests/billing` → **12 files, 96 passed / 0 failed / 0 skipped** (88 baseline from BILL-C3-1 + 8 new: 6 projectionFidelity + 2 downgradeThroughGate — matches the README arithmetic verbatim).
2. Full gate `npm run check` (= `tsc --noEmit && node src/platform/purity/check-purity.mjs && vitest run --config src/platform/vitest.config.ts`) → **exit 0, 400/400 tests green across domain/platform/billing**. (293→400 growth vs cycle 3 is the Director-integrated four-lane baseline at `adb0b23`; candidate contributes exactly 8.) Mid-run "PURITY GATE FAILED" console lines remain the platform lane's own adversarial negative-test fixture, documented since cycle 2; overall command exits success.
3. `npx tsc --noEmit` standalone → exit 0 (strict config incl. `noUncheckedIndexedAccess`).
4. Purity grep: zero `@wix/` imports under `src/billing/**`.
5. **Independent adversarial reproduction (auditor-written scratch spec, removed afterward):**
   - P1: stale pre-lapse purchase REPLAYED after a `{isFree:true}` reconciliation returns `DUPLICATE` and cannot resurrect paid coverage through the gate (dedup memory survives snapshots; lapse holds).
   - P2: auto-renewal-cancellation event ingested AFTER a downgrading snapshot never re-expands coverage (marker alone grants nothing).
   - P3: zero-state gate call under-serves to the FREE default (allowance 1, default location only, `overLimit:true`, not degraded, no crash); discriminator pair `reconciledAtLeastOnce===false && generationEventCount===0` confirmed unique to the initial state.
   - P4: duplicate location ids in the listing dedupe first-wins in stable order (default first, then alphabetical).
   - P5: installation payloads carrying junk `billingExpirationDate` cannot flip the tier either way (past date + `isFree:false` stays PAID dunning; future date + `isFree:true` stays FREE) — C2 holds independently of the candidate's own fixtures.
   - P6: a genuinely NEW purchase webhook between reconciliations re-expands coverage immediately (event refinement per §7 — the correct counterpart to snapshot-supremacy).
   - P7: unknown-plan fail-safe path surfaces `UNKNOWN_PLAN_IDENTIFIER` in the ledger with warning text containing the preserved packageName, coverage limited to TIER_1, `degraded:false`.
   - P8: five repeated reconciliations of the same downgraded snapshot produce byte-identical gate decisions (idempotent, no progressive loss).

## 3. Task-subitem verification (a–d)

| Sub-item | Evidence | Status |
|---|---|---|
| (a) Downgrade-through-gate END-TO-END regression via public API | `downgradeThroughGate.spec.ts` builds `createEntitlementGate({ instance: projectedSnapshotSource(projector), … })` (compile-checked narrow-port assignment) and asserts per step: paid TIER_4_10 covers 5 live locations; cancellation event alone does NOT shrink (§7 mid-cycle rule enforced at gate level); confirming period-end snapshot to TIER_2_3 shrinks `allowedLocationIds` EXACTLY to `['loc-m','loc-a','loc-b']` — default first then alphabetical, archived excluded both sides; `overLimit:true`, `degraded:false`, `warning:null` (upgrade-CTA state, not incident); backing store configs byte-identical and inventory intact after every step; repeated reconciliations stable; re-upgrade snapshot restores full coverage. Second test lapses to FREE (allowance 1, default survives) and restores honestly (`overLimit` stays true with 5 live locations vs allowance 3 — no false health claim). | ✅ |
| (b) Fold observation 1 (C2 docstring truth) | `types.ts`/`projector.ts` docstrings now state truthfully: purchase/cancellation payload types carry NO expiration field; installation payloads alias `AppInstanceBillingSnapshot` and CAN carry `billingExpirationDate`, which NO transition ever reads and the rendered refinement omits. NOT a silent doc-only skip: behavior proven both ways (past date can't lapse paid; future date can't grant coverage) plus a render-shape test asserting the rendered object has exactly `{isFree, vendorProductId, packageName}` keys while advisory/trial/clone fields rode along in the payload. My P5 reproduces independently. | ✅ |
| (c) Fold observation 3 (packageName fidelity) | Preservation through post-snapshot refinement PROVEN (snapshot-seeded name survives a name-less purchase event and reaches the gate warning text containing `"Mystery Plan"`); the only two drop cases are documented+tested as correct-by-design: (i) resolver-unread fields omitted from the rendered shape; (ii) a newer confirming snapshot that stops reporting the name supersedes it (reconciliation supremacy — snapshot is freshest full-state observation), with the unknown-plan flag persisting and the stale name correctly gone from warning text. Gate-level warning-text fidelity proven through the public API (my P7 concurs). | ✅ |
| (d) Fold observation 4 (initial source label) | Documented rationale on `ProjectionSource`: `'EVENT_DERIVED'` names the SUPPLYING LAYER; a never-reconciled zero-event projector folds the empty event view to the conservative FREE default (under-serves, never over-serves). Precise initial-state discriminators `reconciledAtLeastOnce === false && generationEventCount === 0` pinned by test together with the transition to `'SNAPSHOT_RECONCILED'` after reconciliation. Docstring claim cross-checked against `projector.project()` implementation — exact match. My P3 confirms discriminator uniqueness. | ✅ |

## 4. Acceptance-criteria scorecard (BILL-C4-1)

| Criterion | Status |
|---|---|
| Downgrade-through-gate regression proves coverage shrink + stable ordering + preserved configuration + upgrade-state surfacing + restore-on-re-upgrade, all through the public gate API | ✅ PASS (both spec tests; every expectation traced by me against `fold.ts`/`coverage.ts`/`entitlement.ts`; probes P1/P2/P6/P8) |
| Observation folds each land with behavior fix + test OR documented rationale + test (no silent doc-only skips) | ✅ PASS (obs 1: corrected docs + dual-direction behavior tests + render-shape test; obs 3: preservation proof + documented/tested supremacy semantics; obs 4: documented rationale + discriminator/transition tests) |
| `npx vitest run` green (88 baseline + new), `tsc --noEmit` strict clean, purity gate green (zero `@wix/` under src/billing) | ✅ PASS (96/96 billing; 400/400 full, exit 0; tsc exit 0; grep clean) |
| Scope limited to src/billing/** + tests/billing/**; canonical shared/domain shapes consumed unforked; no production-capability claims | ✅ PASS (5-file diff verified; ports.ts SHA matches pinned `af68e698…fbc`; shared files byte-identical; banned-copy grep clean; README describes test provenance only) |
| Fresh independent lane audit ends VERDICT: ACCEPT | ✅ THIS AUDIT |

## 5. Contract/directive conformance spot-checks

- **§7 lifecycle at gate level:** downgrade happens ONLY through a confirming snapshot; cancellation event alone keeps full paid coverage; lapse-to-free shrinks to the single-location floor with the default location surviving; re-upgrade restores from preserved configuration. Matches "no mid-cycle downgrade path exists".
- **Over-limit posture (§7):** restricted set in stable order (default first, then byte-wise alphabetical id — locale-independent), `overLimit:true` surfaced, `degraded:false` (reliable restriction, not a degraded guess), no incident warning, nothing deleted. Directive's "never delete customer configuration" is structurally guaranteed (the gate exposes no write port) AND pinned behaviorally by the store-based assertions.
- **Fail-open posture (§7/C5):** untouched by this candidate; degraded paths still return fail-open bodies with persisted warnings (existing suite green).
- **C2:** expiration dates structurally unreadable in purchase/cancellation transitions; ride-along advisory fields provably ignored and omitted from renders (candidate tests + my P5).
- **Directive fail-safe:** unknown paid identifier still under-serves (TIER_1) with persistent warning; UQ5 respected (trial status appears only as an omitted ride-along field; no numeric trial claims).
- **No scope creep:** no real Wix transport, no pricing UI, no tier feature differences beyond location count, no ports.ts edits, no cross-lane files touched, parity ledger and validator mirror untouched.

## 6. Non-blocking observations (for Director / future cycles)

1. **Preservation assertion is port-bounded:** the downgrade spec proves configuration survival through the gate's public read-only API (and no write port exists today). If a future cycle ever introduces a mutating entitlement port, these assertions would need extending to that surface. No action required now.
2. **Supremacy nuance (documented, tested):** when a fresher snapshot stops reporting `packageName`, a previously known name disappears from the rendered view/warning text. This is now a conscious decision of record (reconciliation supremacy), not a defect; noting it so future operators don't misread the disappearing name as data loss.
3. **Full-suite arithmetic:** 400 = 392 integrated baseline at `adb0b23` + 8 candidate tests; consistent with the four-lane integration at run 32792897988. No masked pre-existing failures (all production changes are comments).

None of these blocks integration; none hides a silent failure, destructive path, entitlement bypass, race/idempotency defect, timezone/DST error, inaccessible UI, or unsupported platform assumption.

## 7. Verdict rationale

The candidate delivers exactly BILL-C4-1 and nothing else: the previously missing §7 lifecycle transition (downgrade-through-gate) now has dedicated end-to-end regression through the public gate API covering shrink, stable ordering, preserved configuration, upgrade-state surfacing and restore-on-re-upgrade; all three accepted-audit observations are folded with genuine behavioral proof rather than doc-only skips; production code changed only where the prior audit demanded truthful documentation. All executable gates pass in place (96/96 billing, 400/400 full suite, strict typecheck exit 0, purity green), scope discipline is exact, canonical contracts are consumed unforked, and eight independent adversarial probes (replay resurrection, marker-only expansion, zero-state, duplicate ids, C2 date flips, mid-cycle purchase refinement, warning-text fidelity, reconciliation idempotency) could not falsify any claimed property.

VERDICT: ACCEPT
