# Integrated Audit — cycle 6 preview, run 32915633541

- **Auditor:** independent integrated auditor (lane-auditor fiche). Builder intent not consulted; every load-bearing claim re-derived or reproduced.
- **Subject:** `/tmp/wix_integrated_preview` = git commit `fb4a9ac` (`cycle/wix-build/32915633541/preview`), the exact integrated Wix preview for cycle 6.
- **Accepted base:** `fd480aadb3e9b980492f5ccd2a1c3f5efe7926dd` (current checkout, byte-verified identical to `origin/lab/wix-rules` head).
- **Inputs read:** `MAIN_PROMPT.md`, `AGENTS.md`, `.opencode/job-descriptions/lane-auditor.md`, binding `docs/WIX_TECHNICAL_CONTRACT.md` + `docs/BUILD_BLUEPRINT.md`, `docs/NEXT_CYCLE.json` (cycle-5 queue), all four cycle-6 lane audits, `reports/integration/CYCLE_32915633541_MANIFEST.json`, prior director records.
- **Product code modified by this audit:** none. Scratch probes ran only under `/tmp/opencode/**`.

---

## 1. Composition integrity (mechanical)

The preview is exactly four commits on the accepted base:

| Commit | Content | Verified |
|---|---|---|
| `ceccab0` | integration candidate (INT-C5-1): 7 files, +1189/−7 | tree **byte-identical** to mounted candidate `4115570c` (`git diff` = 0 lines) |
| `9502b35` | rules candidate (RULES-C5-1): 4 files, +1250/−2 | own files byte-identical to mounted `62800955`; cross-diff touches ONLY integration-lane paths (stacking artifact, no content drift) |
| `ac74a11` | dashboard candidate (DASH-C5-1): 4 files, +927/−11 | own files byte-identical to mounted `dcfcf14f`; cross-diff touches ONLY integration+rules paths |
| `fb4a9ac` | reports-only: 4 lane audits + integration manifest (+259, zero product paths) | manifest `audit_sha` commits resolve locally; `e33e71cb` content sha256 `140e125e…` byte-matches the persisted INTEGRATION audit |

- Lane path sets are **disjoint**: `src/platform/validation-plugin/**`+`tests/platform/**` / `src/domain/**`(README)+`tests/domain/**` / `src/ui/**`+`src/extensions/dashboard/**`+`tests/ui/**`. No merge-conflict resolution occurred anywhere (no hunk overlaps exist).
- Billing (`4893bb49`) is a **true no-op**: `git diff fd480aa 4893bb49 -- src/ tests/ package.json package-lock.json tsconfig.json` = empty. Matches its ACCEPT-with-zero-product-diff audit and the queue's `complete` status; no busywork was invented.
- Governance paths (`MAIN_PROMPT.md`, `.github/**`, `.opencode/**`, `AGENTS.md`, `opencode.json`, `directives/**`) and Director-owned state (`docs/state.json`, `docs/NEXT_CYCLE.*`, contract/blueprint): **zero diff**. Correct — those advance only after this verdict.

## 2. Frozen canonical contracts

Independently recomputed SHA-256 on the integrated tree:

| Artifact | Pinned | Measured |
|---|---|---|
| `src/domain/ports.ts` | `d46e0743fa825315…f43c18802` | **exact match** |
| `src/shared/types.ts` | `af03134c…` | **exact match** |
| `src/shared/errors.ts` | `8b12ec16…` | **exact match** |
| `src/ui/validation/ruleDraftValidators.js` | `871df113…` (parity-ledger constraint) | **exact match** |

Zero diff on `src/shared/**`, `src/billing/**`, `src/domain/ports.ts`. The cycle-5 freeze held across all three active lanes.

## 3. Executable checks (all executed by this auditor on the integrated tree)

1. `npm run check` (strict tsc incl. `noUncheckedIndexedAccess` → purity gate → vitest): **exit 0, 47 files, 518/518 passed**. Arithmetic: 465 accepted + 42 platform target-aware + 11 rules (2 evaluate + 9 matrixProperties) = 518 — exact, no test lost or duplicated in the merge. The `PURITY GATE FAILED` stdout lines are the asserted negative-control fixture inside `purity-gate.spec.ts` (expected).
2. `npm run check:offline` (proxies pinned to dead port): **exit 0, 518/518** — zero network egress proven on the composed tree.
3. `node src/platform/purity/check-purity.mjs` standalone: green over all SIX roots incl. `src/platform/composition`.
4. Dashboard lane runner (`node --test` from `tests/ui`): **210/210** = 186 accepted baseline + 24 new entitlement tests; pre-existing UI files unmodified (diff = new file only).
5. Anti-vacuity reproduction: fresh worktree at `fd480aa`, candidate's `tests/platform/**` copied in, new spec run against UNMODIFIED pre-wiring handlers → **29 pass / 13 fail**, matching the integration audit's split exactly (12 PART-2 activations + 1 PART-1 incident-kind visibility assertion that necessarily requires the new `SUBJECT_FACTS_FAILURE`). The pins detect precisely the dormant-semantics gap INT-C5-1 closes; they pass only because of the wiring.
6. Hygiene: no `.skip/.only/.todo/.fails(` in changed tests; §12 banned-claims scan over every added line: clean; no secrets, app IDs, or fabricated identifiers introduced.

## 4. Cross-lane semantics (adversarial)

**Target mapping (six → three).** `evaluationTargetOf()` strips `_MULTI_SERVICE`; the stripped union is by construction `TargetOperation`, which `EvaluationTarget` aliases (compile-time sync, frozen files). `semanticsOf` keeps routing through the unchanged `failureSemanticsFor`. I verified the domain side end-to-end: `evaluate.ts` gives CANCEL classification families only (ruleset validity + slot shape ⇒ explicit allow), RESCHEDULE full families against the PROPOSED slot with `excludeBookingId` wired from `targetContext.subjectBookingId`, CREATE bit-for-bit legacy via `DEFAULT_TARGET_CONTEXT`. The domain README matrix, the evaluator code, and the handler wiring agree cell-for-cell, and RULES-C5-1's executable properties now pin that agreement (determinism sweep ×3 targets ×101 reps; completeness sweep; derived CANCEL-tail guard with anti-vacuity injections; README↔code consistency with meta-pins; five mutation probes M1–M5 reported tripped by the rules auditor).

**Bucket-convention consistency (self-count arithmetic).** `subjectProvablyInBucket` uses half-open `[fromUtc, toUtc)` over the START instant with declared-status and dimension-narrowing clauses — exactly mirroring `limits.ts` (`instantForLocalWall(tz, date, 0)` bounds) and the duplicates start-bucket rule. Every clause demands positive evidence; unprovable ⇒ pass-through (degrade as before); result clamped at 0; degraded `null` counts stay `null`. Adjustment applies at lookup time only — cache stays authoritative, prefetch planning untouched (guard test pins the planned EDT UTC bucket verbatim).

**My own runtime probes (7, scratch spec against the integrated tree — all passing):**
1. `RESCHEDULE_MULTI_SERVICE` strips to RESCHEDULE: mover's own overlap passes, genuine same-service third-party overlap still blocks `DUPLICATE_BOOKING`, exactly ONE seam consultation per request (not per item), target reported as `RESCHEDULE`.
2. A THROWING seam is never consulted for CANCEL/CREATE (no exclusion leakage across targets).
3. `CANCEL_MULTI_SERVICE` frees capacity on an at-capacity day while the CREATE control blocks `QUOTA_EXCEEDED` on identical inputs.
4. Degraded entitlement × self-count compose correctly: fail-open notice present AND the provable subject contribution subtracted (allowed), with DEGRADE-BASELINE proving the identical scenario blocks `QUOTA_EXCEEDED` without subject facts.
5. Mixed-coverage bulk RESCHEDULE: uncovered item skipped (`UNCOVERED_LOCATION_RULES_SKIPPED`, valid), covered item evaluated, one seam consult.
6. All-uncovered request ⇒ zero seam consultations (facts that cannot matter are never requested).
7. Probe-fixture falsification attempts initially produced 3 failures that were **my fixture errors, not product bugs** — an unseeded count gateway, and a cross-service overlap without identity key which the documented v1 duplicate semantics correctly do NOT block. Both re-verified as correct conservative behavior after fixing my fixtures.

**Dashboard ↔ platform contract parity.** Both sides consume the SAME ordering source: `meterEndpoint.ts` projects `entitlementGate.allowedLocationIds()` into the pinned v1 DTO; enforcement skips uncovered locations off the same gate decision; the editor restricts NEW configuration for uncovered locations, preserves existing config (locked Remove proven DOM-no-op; save persists uncovered windows/limits verbatim), fails OPEN under degraded coverage exactly like enforcement (C5), surfaces the §7 upgrade CTA (new tab, host-injected identifiers only), and degrades 404/null/transport-failure to today's unrestricted editor behind non-blocking notices. Bridge reuse enforced (single `getEntitlementMeter` touch; no transport outside `services/bridge.js`); anti-trap issue-path unlock keeps the editor reachable under restriction; accessible markup asserted. `ruleDraftValidators.js` byte-frozen; parity ledger green.

**Billing/enforcement composition.** Entitlement gate resolves once per request; throwing gate ⇒ synthetic degraded fail-open decision (billing failures never block bookings, §7/C5); degraded ⇒ no coverage skip + persisted `ENTITLEMENT_DEGRADED`. Billing lane itself contributed zero diff; its accepted state machine/gate/ordering is consumed unforked.

## 5. Rollback, destructive-write safety, failure posture

- **Zero diff** on `src/platform/schedule-mutation/**`, `src/platform/adapters/**`, `src/platform/webhooks/**`: the Contract §9 snapshot→diff→apply→verify→rollback machinery and webhook counters are untouched; all orchestrator/idempotency/webhook suites remain green inside the 518.
- Failure semantics preserved post-wiring: structural parse precedes the guard; internal error/timeout routes through `targetFailureResult` (CREATE/CANCEL fail-closed block-with-retry-hint; RESCHEDULE fail-open with `FAIL_OPEN_NOT_ENFORCED`, never claiming enforcement); throwing-clock hardening (`guardedNow`) retained; `SUBJECT_FACTS_FAILURE` degrades visibly with sink persistence asserted (spec lines 401–403) and never alters a verdict.
- C1 discipline held: no product code reads any payload field for the subject id; activation is exclusively via an injectable, default-inert seam; README §6.7 records the T-VP3/T-VP5 probe-before-adapter obligation.

## 6. Scope

Every changed path sits inside its lane's assigned surface for INT-C5-1 / RULES-C5-1 / DASH-C5-1; billing correctly produced none. No feature creep, no refactors beyond task, no PREVIEW_GATED dependencies, no production-capability claims (reschedule stays best-effort; empirical gates T-VP*/T-WH*/T-BK*/T-RB* remain open and unbypassed).

## 7. Non-blocking observations (record; no repair required)

1. **O1 (inherited, cosmetic):** the new platform spec header says PART 1 pins pass on the unmodified tree; my reproduction shows exactly one PART-1 visibility assertion cannot (it needs the new incident kind). Split it into PART 2 whenever the file is next touched.
2. **O2:** the seam receives ALL parsed items rather than only the evaluated subset; harmless today (default port ignores input) but a future evidence-backed adapter should filter consciously.
3. **O3:** multi-service RESCHEDULE carries one subject id per request — honestly documented residual (validation-plugin README §1.3); consistent with §5.3 best-effort.
4. **O4 (standing, cross-cycle):** simulated-Wix QA has still never completed for any run, and all dev-site gates await human credentials. Neither blocks this integration; both remain mandatory release-readiness gates alongside the recorded residuals (TOCTOU disclosure, N-1 allowance display deferral, O1 projector symmetry, root-tsc UI gap).

## 8. Verdict rationale

The preview is exactly the sum of its independently ACCEPT-audited lane candidates — proven mechanically, not assumed — with frozen contracts intact, disjoint scopes, and a true no-op billing lane. The composed whole behaves correctly beyond what any single-lane audit covered: target-aware CREATE/CANCEL/RESCHEDULE semantics are live and consistent across domain, platform, and dashboard; management-side restriction mirrors enforcement coverage; billing composes fail-open; rollback and §9 machinery are untouched; failure posture matches §5.3 everywhere. My independent execution reproduced every headline claim (518/518 offline, 210/210 UI, purity six-root green, 29/13 anti-vacuity split) and seven additional adversarial cross-lane probes found no falsifying behavior — the only probe failures were my own fixture mistakes, each confirming conservative documented semantics once corrected. No blocking finding remains.

VERDICT: ACCEPT
