# Lane Audit — INTEGRATION candidate, cycle 6 (task INT-C5-1)

- **Candidate:** `4115570cb0f94158f66ad94a2fc83841ca13b3e0` (mounted at `/tmp/wix_integration_candidate`)
- **Accepted base:** `fd480aadb3e9b980492f5ccd2a1c3f5efe7926dd` (current checkout, verified identical)
- **Auditor:** independent lane-auditor (integration lane). Builder intent not consulted; every load-bearing claim re-derived or reproduced.
- **Task audited:** `docs/NEXT_CYCLE.json` → `lanes.integration` = **INT-C5-1** ("Activate target-aware enforcement wiring"), directive `directives/INTEGRATION.md`, binding contracts `docs/WIX_TECHNICAL_CONTRACT.md` (esp. §5.3, §7, §10 #9, §11 C1/C5/C6) and `docs/BUILD_BLUEPRINT.md` (§2 ownership, §4 flows, §5 error model).

---

## 1. Real diff inspection

`git diff fd480aa..4115570 --stat` — exactly 7 files, 1189 insertions / 7 deletions:

| File | Change |
|---|---|
| `src/platform/validation-plugin/handlers.ts` | +202: target context on EVERY `evaluateRules`; injectable subject-facts seam (default unavailable); observation-B self-count adjustment |
| `src/platform/validation-plugin/targets.ts` | +15: `evaluationTargetOf()` canonical mapping (strips `_MULTI_SERVICE`) |
| `src/platform/validation-plugin/incidents.ts` | +6: new `SUBJECT_FACTS_FAILURE` degradation kind |
| `src/platform/validation-plugin/index.ts` | +11/−1: exports for the above |
| `src/platform/validation-plugin/README.md` | +79: §1.1 active target-awareness, §1.2 seam + C1 discipline, §1.3 self-count disposition table, incident table row, T-VP probe obligation #7 |
| `tests/platform/helpers/validationPluginRig.ts` | +23/−7: `configStoreOverride`, `subjectBookingFacts` rig options (behavior-preserving for existing options) |
| `tests/platform/validation-plugin-target-aware.spec.ts` | +860: 42 tests in PART 1 pins / PART 2 activations / planning guard |

**Scope boundary:** PASS. No file outside `src/platform/validation-plugin/**` + `tests/platform/**`. Verified untouched: `src/domain/**` (incl. frozen `ports.ts`), `src/shared/**`, `src/billing/**`, `src/ui/**`, `src/platform/vitest.config.ts` (glob rule intact), all other test trees. No governance files touched.

**Frozen contract:** `sha256sum src/domain/ports.ts` on candidate HEAD = `d46e0743fa825315a80456962d0f4412c02cbd437f0acabce909356f43c18802` — exactly the SHA pinned by `canonical_contracts_notice`. The seam consumes the existing optional `targetContext`/`subjectBookingId` fields unforked; zero domain edits.

## 2. Correctness analysis of the wiring (item a)

- `evaluationTargetOf()` strips `_MULTI_SERVICE`; the stripped union is by construction `TargetOperation` (`src/shared/errors.ts`: `'CREATE' | 'CANCEL' | 'RESCHEDULE'`), which `EvaluationTarget` aliases — the cast is sound and compile-time anchored.
- `executeRequest` now builds `targetContext` unconditionally (`{ target: operation }` or `{ target, subjectBookingId }`) and passes it on every `evaluateRules` call. For CREATE-family this equals the domain's `DEFAULT_TARGET_CONTEXT`, so CREATE semantics are unchanged bit-for-bit (confirmed by execution below).
- CANCEL now runs classification families only (domain stage order: ruleset validity + slot shape; entitlement/windows/exceptions/caps/duplicates skipped) ⇒ cancel-frees-capacity is live at runtime.
- RESCHEDULE evaluates windows/caps against the proposed slot; duplicate self-exclusion activates only via `subjectBookingId`.
- Prefetch planning (`planCountQueries`) untouched — mechanical for all targets; only consumption became target-aware (pinned by the guard test asserting the exact planned UTC bucket `2026-08-12T04:00:00.000Z/2026-08-13T04:00:00.000Z` for EDT).
- Fail-closed/fail-open semantics per §5.3 preserved: internal failures still route through `targetFailureResult` (`FAIL_CLOSED_BLOCKED` vs `FAIL_OPEN_NOT_ENFORCED`), proven under an injected seam.

## 3. Subject-facts seam (item b) — C1 discipline

- `SubjectBookingFactsPort` is injectable, pure/synchronous (fast-response budget §5.3), consulted ONLY for RESCHEDULE* and ONLY when ≥1 item will actually be evaluated. Default port returns null ⇒ `subjectBookingId` undefined ⇒ behavior identical to pre-change (pinned).
- Non-proving values (missing/empty/non-string id) treated as unavailable; a throwing seam degrades VISIBLY via `SUBJECT_FACTS_FAILURE` without altering any verdict (tested, including sink persistence).
- **No fabricated payload access:** no product code reads any payload field for the subject id. `rawRequest` is handed to the seam for FUTURE evidence-backed adapters only; README §6 item 7 records the T-VP3/T-VP5 probe-before-activation obligation. This matches the task's explicit C1 constraint.
- Seam consultation counts asserted at 0 for CREATE and CANCEL (spy tests) — no exclusion leakage across targets.

## 4. Same-day self-count adjustment (item d) — adversarial review

`subjectAwareCountLookup` + `subjectProvablyInBucket`:

- Adjustment applies ONLY when operation=RESCHEDULE AND a snapshot fact carries EXACTLY the subject id AND every proof clause holds positively: start instant parseable, start ∈ `[query.fromUtc, query.toUtc)` (half-open, matching the domain caps/duplicates start-bucket convention), status defined AND in `query.includedStatuses`, service/location dimension match when narrowed. Every unprovable clause ⇒ pass-through (degrade as today). I cross-checked each clause against `src/domain/limits/limits.ts` (UTC bucket from site-zone day) and `src/domain/duplicates/duplicates.ts` (start-bucket + exact-id exclusion): consistent.
- Lookup-time only: cache keeps authoritative values; degraded `null` stays `null`; result clamped at 0 (no negative counts); failed count reads stay fail-open with `COUNT_GATEWAY_FAILURE` surfaced. All pinned by tests including defect-baseline controls.
- Residual honestly documented (README §1.3): one subject id per request for multi-service RESCHEDULE; no enforcement claim beyond best-effort (§5.3/§10 #9/§12). No banned claims found anywhere in the diff (§12 scan).

## 5. Executable checks (all run by this auditor, not trusted from the candidate)

1. **Candidate full gate:** `npm ci && npm run check` → exit 0. Typecheck clean; purity gate green over all SIX protected roots (verified standalone too: `node src/platform/purity/check-purity.mjs` → pass; six roots incl. `src/platform/composition`). Vitest: **46 files, 507/507 passed** (= 465 accepted baseline + 42 new; existing suites green UNMODIFIED — incl. `validation-plugin-handler-matrix.spec.ts` 19/19).
2. **Offline/credential-free:** `npm run check:offline` (proxied egress) → exit 0, 507/507.
3. **Anti-vacuity reproduction (the decisive check):** fresh worktree at accepted `fd480aa`, candidate's `tests/platform/**` copied in, ran the new spec against the UNMODIFIED pre-wiring handlers: **29 pass / 13 fail**. All 12 PART 2 activation tests fail exactly as the spec header claims (CANCEL blocked on at-capacity day; RESCHEDULE flags mover's own booking; self-count residual; per-item bulk exclusion; clamping/degradation probes) — independently proving both the dormant-semantics gap and that the pins are not vacuous. The 13th failure is the throwing-seam test's `SUBJECT_FACTS_FAILURE` visibility assertion, which necessarily requires the new incident kind (see O1). On the candidate tree: 42/42 pass.
4. **Banned modifiers:** grep for `.skip/.todo/.only/.fails(` over changed test files → none.
5. **No secrets/fabricated identifiers:** no `wix.config.json`, app IDs, project IDs, or credentials added.

## 6. Acceptance-criteria scorecard (INT-C5-1)

| Criterion | Result |
|---|---|
| `npm ci && npm run check` offline credential-free; purity green over six roots | ✅ exit 0 (incl. `check:offline`); standalone purity pass |
| Handler-level proof of CANCEL-frees-capacity + RESCHEDULE self-exclusion through REAL `createValidationHandlers`, with third-party-overlap and defect-baseline controls | ✅ PART 2 probe 1/probe 2 + CREATE/CANCEL controls + mismatched-id control |
| CREATE-family outcomes unchanged (existing suites green unmodified; byte-equality pins) | ✅ deep-equality pins vs direct context-free `evaluateRules`; existing specs byte-identical per diff |
| Seam default keeps today's exact behavior; activation only via injected facts; no fabricated payload access | ✅ default-port/residual pins; empty/junk/throwing-seam probes; no payload reads |
| Self-count adjustment only behind provable facts; degradation documented + tested | ✅ README §1.3 clause table; DEGRADE-BASELINE + 8 unprovable-clause tests |
| ports.ts SHA preserved; scope limited; no production-capability claims; fresh audit ACCEPT | ✅ SHA verified; scope verified; copy honest |

## 7. Non-blocking observations (for the record; no repair required)

- **O1 (comment precision):** the spec header says "PART 1 pins passed on the unmodified tree", but one PART 1 test (throwing seam → `SUBJECT_FACTS_FAILURE` visibility) cannot pass pre-wiring because the incident kind ships with this change. My reproduction confirms exactly this split (12 PART 2 + 1 PART 1 failure). All enumerated pin categories (CREATE byte-equality, no-subject-facts residual, classification fail-closed) did pass pre-wiring. Cosmetic; consider splitting the visibility assertion into PART 2 in a later cycle.
- **O2:** `existing.find(fact => fact.bookingId === subjectBookingId)` takes the first matching fact if a snapshot ever contained duplicate ids — deterministic and conservative (adjustment at most −1); acceptable.
- **O3:** standing obligation recorded in README §6.7: the T-VP3/T-VP5 payload probe must be extended to capture the real RESCHEDULE subject-id field before any production adapter injects `subjectBookingFacts`. Until then the default port keeps facts unavailable. This belongs to the scaffold-gated track (T-VP0), not to this lane.

## 8. Verdict rationale

The candidate does exactly what INT-C5-1 mandates and nothing more: it closes the last known enforcement-correctness gap (dormant CANCEL/RESCHEDULE semantics) through the real handler path, keeps CREATE byte-identical, introduces the subject-facts capability strictly behind an injectable, default-inert, evidence-gated seam, disposes Rules-audit observation B with provable-clause-only arithmetic plus honest degradation, and documents every residual without making any production-capability claim. Every load-bearing claim survived independent reproduction, including the anti-vacuity demonstration on the unmodified base. No blocking finding was falsifiable.

VERDICT: ACCEPT
