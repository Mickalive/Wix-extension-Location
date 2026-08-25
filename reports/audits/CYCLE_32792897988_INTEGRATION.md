# Lane Audit — Integration Candidate, Cycle 3 (run 32792897988)

- **Auditor:** independent lane-auditor (`wix-integration-builder` candidate)
- **Candidate worktree:** `/tmp/wix_integration_candidate` (single commit `00a37a0` on accepted base `3c42295`)
- **Accepted base:** current checkout HEAD `3c42295` ("Wix build 32787032785: director attempt"), untouched
- **Assigned task:** `INT-C3-1` from `docs/NEXT_CYCLE.json` (cycle 3): booking-time enforcement wiring (Blueprint §4 flow 1) inside `src/platform/validation-plugin/**` + `tests/platform/**`, plus hardening nits N3/N4/N5 from `reports/audits/CYCLE_32787032785_INTEGRATION.md`
- **Binding references:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md` (§4.7, §5.3, §7, §11 C1/C5/C6), `docs/BUILD_BLUEPRINT.md` (§2, §4 flows 1/4, §5), `directives/INTEGRATION.md`, `.opencode/job-descriptions/lane-auditor.md`

---

## 1. Real diff inspection

Diff `3c42295..00a37a0`: 22 files, +2626/−38. Path filter confirms **every changed file is under `src/platform/**` or `tests/platform/**`** — exact task scope, zero cross-lane edits.

New product code (all pure, Wix-import-free):
- `src/platform/validation-plugin/handlers.ts` — handler factory `createValidationHandlers(deps)` producing six per-target handlers; pre-resolved `EvaluationDeps` (entitlement `PolicyDecision`, synchronous `countForQuery`, existing-bookings snapshot) built from injected ports; coverage gate skipping rule evaluation for uncovered locations under healthy entitlement decisions; target-semantics guard converting internal errors/deadline expiry into explicit per-item results.
- `payload.ts` — structural parser mapping ONLY documented Contract §5.3 fields; `MAX_BULK_ITEMS = 12`; OWNER_BUSINESS-only location-id extraction; structural-only observation of `metadata.identity`.
- `targets.ts` — six targets mapped to binding failure semantics via canonical `failureSemanticsFor` from `src/shared/errors.ts` (consumed, not forked).
- `counters.ts` — short-TTL (default 2000 ms) cache over the `BookingCountGateway` port, injected-clock driven, order-stable query keys.
- `incidents.ts` — typed `DegradationRecord` taxonomy + `DegradationSink` port + `safeRecord` guard (sink failures can never alter a booking outcome).
- `index.ts`, `README.md` — barrel + staging/wiring protocol mirroring the cycle-2 http staging pattern, including the explicit no-production-claim disclaimer until gates T-VP0–T-VP5.

Hardening repairs on integrated code:
- **N3:** `isWebhookEnvelope` duck-typing bypass deleted from `webhooks/pipeline.ts`; every ingest path (pre-parsed or raw) now passes full `parseWebhookEnvelope` structural validation. Grep confirms no residual bypass anywhere in `src/` or `tests/`.
- **N4:** `http/mutationEndpoints.ts` `postRecover` rejects non-string/empty `scope.locationId` with `INVALID_QUERY`; string values pass through unchanged.
- **N5:** `webhooks/README.md` documents the bounded markCompleted→removeBuffered buffer-residue window and why it cannot double-dispatch.

Canonical contracts: `git diff 3c42295..HEAD -- src/domain src/shared` is **empty** (byte-for-byte unchanged); `src/platform/adapters/**` fakes untouched; `package.json`, `tsconfig.json`, vitest config untouched — the `tests/**/*.spec.ts` glob that collects all lanes' suites is intact (cross-lane `vitest_glob_rule` respected). No secrets, no fabricated UUIDs, no account-specific identifiers in the new code (grepped).

## 2. Executed checks (all run by this auditor in the candidate worktree)

| Check | Result |
|---|---|
| `npm ci` | green (47 packages, credential-free) |
| `npm run check` (tsc strict + purity gate + vitest) | **exit 0**, 35 files / **325 passed** (accepted base: 28 files / 256 passed → +69 tests, all in `tests/platform/**`) |
| `npm run check:offline` (proxy-blocked rerun, HTTP(S)_PROXY=127.0.0.1:9) | **exit 0**, 325 passed |
| `npx tsc --noEmit` standalone | exit 0 |
| Purity gate roots | `DEFAULT_PROTECTED_ROOTS` now includes `src/platform/validation-plugin`; standalone gate run lists all five protected roots and passes; `platform-scope.spec.ts` pins the root list AND runs the standalone binary |
| Skip/todo/only scan (`grep -rE "\.(skip|todo|only)\("` over tests/) | none |
| Scope scan | no changed file outside `src/platform/**`+`tests/platform/**` |

Note: one console line "PURITY GATE FAILED" appears during the suite — it is the *positive-control* fixture in `purity-gate.spec.ts` planting violations in a temp dir to prove the scanner detects them; the test itself passes and `npm run check` exits 0.

## 3. Acceptance-criteria verification

1. **`npm ci && npm run check` offline, zero credentials** — VERIFIED (table above).
2. **Handler matrix** — VERIFIED. All six targets prove allow outcomes deep-equal to a direct `evaluateRules` call with identical inputs (`validation-plugin-handler-matrix.spec.ts`); block outcomes verbatim incl. customer-safe message + machine code (`OUTSIDE_BOOKING_HOURS`); config-store error and hanging-store deadline expiry produce FAIL_CLOSED blocks-with-retry-hint (`VALIDATION_UNAVAILABLE`) on CREATE/CANCEL(+multi) and FAIL_OPEN pass-through + `ENFORCEMENT_FAIL_OPEN` record + `enforcementClaim:'FAIL_OPEN_NOT_ENFORCED'` on RESCHEDULE(+multi); failing duplicate-input read degrades visibly without fabricating blocks, with a healthy-input control proving the same scenario blocks. Zero rule logic outside `src/domain` is enforced by the refined marker scanner with positive controls (both scanners proven non-rubber-stamp).
3. **Bulk explicitness** — VERIFIED. Mixed skip/block/allow repro asserts indices `[0..n-1]` present exactly once with correct dispositions; 12-item boundary answered explicitly on CREATE_MULTI_SERVICE and on fail-closed CANCEL; 13 items rejected `INVALID_QUERY` before any dependency runs (gateway/existing/sink all untouched).
4. **Entitlement** — VERIFIED. Uncovered location under healthy decision ⇒ `UNCOVERED_LOCATION_RULES_SKIPPED` with zero gateway reads (evaluation skip made observable through a detector cap ruleset); degraded gate ⇒ uncovered locations evaluated like covered ones + `ENTITLEMENT_DEGRADED` surfaced in-result AND persisted via sink; throwing gate ⇒ synthetic degraded decision, booking never blocked (`ENTITLEMENT_GATE_FAILURE`), including for previously-uncovered locations; over-limit healthy decision restricts coverage without being an error.
5. **Counter failure** — VERIFIED. Gateway throw ⇒ item stays valid, domain emits its per-limit `COUNT_UNAVAILABLE_FAIL_OPEN` notice inside the verbatim outcome, `COUNT_GATEWAY_FAILURE` incident logged+surfaced with stable query key; in-request dedup (12 identical items ⇒ 1 read), distinct-query isolation, TTL expiry refetch driven by injected FakeClock.
6. **Purity/scope/no production claims** — VERIFIED (§2). README staging note explicitly disclaims capability until T-VP0–T-VP5; thin-adapter protocol defers all SDK shape assumptions to scaffold evidence (no guessed API shapes).
7. **N3/N4 regressions** — VERIFIED. New `webhooks-envelope-validation.spec.ts` proves malformed pre-parsed envelopes (negative/non-integer/string sequence, empty id) reject `INVALID_QUERY` with zero dispatch, valid pre-parsed envelopes keep exact prior behavior, and `parseWebhookEnvelope` is idempotent. `http-mutations.spec.ts` adds the N4 case ([42, null, object, array, ''] all rejected before orchestrator contact) plus string pass-through.

Invariant C1 handling is exemplary: documented-fields-only mapping proven by a junk/PII-dropping test asserting `contactDetails` content (incl. the UNPROVEN `contactId` survivor) never reaches any parsed structure; identity consumption default-OFF with flag-ON behavioral proof both ways.

## 4. Adversarial probes executed by the auditor

I wrote and ran two temporary probe specs against the candidate rig (removed afterwards; worktree left clean):

1. **CANCEL of the only booking on an at-capacity day** (day cap 1, one seeded CONFIRMED booking, existing-bookings snapshot containing it): handler returned `valid:false` with `QUOTA_EXCEEDED`. Cancelling frees capacity, yet the uniform rule evaluation lets the cap stage (and potentially windows/duplicates) block the cancellation of the very booking the count includes.
2. **RESCHEDULE whose new slot overlaps the booker's own still-existing booking**: returned `DUPLICATE_BOOKING`.

**Disposition: NOT blocking for this candidate.** Both behaviors are direct consequences of the assigned design — the task mandates consuming canonical `evaluateRules` uniformly across all six targets, and `evaluateRules` (Rules-lane-owned, byte-for-byte canonical here) has no target parameter. Any in-lane "fix" (stripping limits or emptying duplicates for CANCEL locally) would implement rule policy outside `src/domain`, violating the harder lane boundary and the candidate's own scanner. No code path reaches production before gates T-VP0–T-VP5, so integrating this wiring ships nothing harmful. **Escalation required:** the Director must track a cross-lane disposition (domain-level target-aware evaluation or sanctioned dep-scoping) before CANCEL/RESCHEDULE enforcement is ever enabled; the simulated-Wix QA lane's create/cancel/reschedule charter should confirm. Recorded below as Observation A.

## 5. Findings

### Blocking findings
None.

### Non-blocking observations (for the Director / future lanes; do not gate)
- **A. Target-uniform rule evaluation vs. CANCEL/RESCHEDULE semantics** — reproduced as in §4. Root cause lives in canonical domain semantics, not in this wiring. Route to Rules lane under Director coordination; must be resolved before any production enablement of CANCEL/RESCHEDULE validation and reflected in dev-site gates T-VP1–T-VP5.
- **B. Throwing injected clock escapes the target-semantics guard** — `targetFailureResult` calls `clock.now()` for the degradation record; a throwing clock implementation would propagate out of the handler instead of producing guarded results. Injected-port misconfiguration only (contract mandates deterministic injected clocks); the T-VP0 thin adapter owns the final platform error surface. Optional defensive hardening.
- **C. Matrix "verbatim" comparisons use limit-free rulesets** — the deep-equality fixtures exercise window/exception paths; limit-path verbatimness is evidenced by exact domain codes (`QUOTA_EXCEEDED`, `COUNT_UNAVAILABLE_FAIL_OPEN`) rather than full deep-equal. Adequate; noting for future suite depth.

## 6. Verdict

The candidate delivers the entirety of INT-C3-1: a complete, pure, Wix-import-free enforcement wiring consuming the canonical evaluator through injected ports with pre-resolved deps; explicit per-index bulk results neutralizing the omitted-items-default-valid hazard at the maxItems 12 boundary; binding fail-closed/fail-open target semantics with logged+surfaced degradations and honest enforcement claims; ratified entitlement coverage posture (skip when healthy, fail-open when degraded, never block on billing); short-TTL cached counters with configured cap degradation; identity-free-first duplicate inputs with the UNPROVEN-payload flag defaulting off; N3/N4/N5 repairs each carrying a regression test; extended purity gate; exact scope discipline; and 69 new deterministic tests, all green offline. Canonical contracts are consumed unforked, no unsupported platform assumption or production claim exists, and the one genuine semantic risk found by adversarial probing originates in assigned canonical domain semantics and cannot be repaired inside this lane.

VERDICT: ACCEPT
