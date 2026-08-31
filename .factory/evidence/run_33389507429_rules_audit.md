# Rules Lane Audit — SHA ec916b75d5600e02d679d264648ac92333d721f1

**Candidate:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Lane:** rules-engine-builder (domain core)
**Audit mode:** independent reproduction, read-only, no builder claims trusted

## 1. Candidate vs base identity

- Reproduction: `git show` not needed via patch because candidate equals accepted base (zero diff). Earlier `git status` in this auditor session shows no domain changes relative to HEAD; previous rules audit `CYCLE_32920420147_RULES.md` likewise reported "no product diff from accepted SHA" with VERDICT: ACCEPT. This cycle is the documented no-op for the Rules lane per `docs/NEXT_CYCLE.md` ("Rules, Dashboard and Billing stay complete. The remaining active work is Integration only.").
- No new files under `src/domain/**` vs base. Lane ownership intact: no `src/platform/**`, `src/dashboard/**`, `src/billing/**` or scaffold mutations introduced by this candidate.

## 2. Wix-owned scaffold/binding provenance (authenticated official generation)

The rules lane must not own scaffold, but integration binding must be proven authentic and not hand-authored. Reproduced independently via workflow-persisted evidence on `origin/main`:

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` (reproduced in this audit):
```json
{
  "schemaVersion": 3,
  "source": "authenticated official Wix existing-app scaffold",
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App",
  "pristineWixBuild": "PASS"
}
```
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` reproduces full `wix build` PASS (Astro SSR build, vite client+server, 10.70s, Complete!).
- Persisted `wix.config.json` in working tree matches exactly:
```json
{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
```
  Fields: `appId`, `projectId`, `projectType` only; no secrets, no hand-guessed App ID. Consistent with `reports/wix-live/BOOTSTRAP_BINDING.md` ("bound to existing Wix app Advanced Booking Rules") and Technical Contract §1 scaffold command `npm create @wix/new@latest app`.
- No credential persisted (`secretsPersisted:false`, `developmentSiteProvisioned:true`). The auxiliary agent-skills install failure (`generatorExit:1`, `projectAcceptedDespiteOptionalPostTaskFailure:true`) is documented as accepted after validating real appId/projectType, matching bootstrap notice.

**Verdict on scaffold:** Authentic official scaffold, not hand-authored. Rules lane did not mutate it.

## 3. Domain purity reproduction

Specification: Technical Contract §8.1 + Blueprint §2 — `src/domain/**` must contain zero `@wix/*` imports, no I/O, host-clock injection only.

- Executed `node src/platform/purity/check-purity.mjs` (reproduced): **Purity gate passed: no '@wix/' imports under src/domain ...**
  Protected roots scanned: `src/domain` + 6 others. Zero violations.
- Executed dedicated test `tests/domain/purity.spec.ts` via suite (included in full run below): 14 tests passed. Scanner asserts:
  - no `Date.now` / `new Date` in live code (injected Clock only),
  - no `process` / `require`,
  - every import is relative (`../shared/types` etc.), zero absolute or Wix specifiers,
  - `src/domain/ports.ts` canonical markers intact (`Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`).
- Manual spot check: `src/domain/ports.ts` imports only `../shared/types` and `../shared/errors` (`TargetOperation` alias), no Wix SDK. `src/domain/evaluate.ts` imports only domain internals. Confirmed.

## 4. Rule-domain semantics reproduction

Binding contract: Directives/RULES.md, Technical Contract §10 #1-10 (STABLE_PRODUCTION), Blueprint Module Map.

### 4.1 Typed models & precedence
- `src/domain/model/primitives.ts`: civil-date algorithms (Hinnant `days_from_civil`), `parseLocalTime` (24:00 exclusive end), `normalizeWindows` (merge touching), `intersectWindowSets`, `windowsCover`, `weekdayOfDate` (host-free). Reserved IDs `weekly-windows, entitlement, ruleset, limits` validated in `validate.ts`.
- `src/domain/validate.ts`: structural RuleSet validation mirrors dashboard UI validator (tested via `uiValidatorParity.spec.ts` — 30 tests passed).
- `src/domain/windows/weeklyWindows.ts`: split-window support (multiple MASTERs per weekday, p2), location ∩ service intersection semantics verified.
- `src/domain/exceptions/exceptions.ts`: `CLOSED` beats `OVERRIDE`, same-date override intersection → closed on empty.
- `src/domain/limits/limits.ts`: per-day/service/location caps, `includedStatuses`, site-zone day → UTC bounds (Contract §4.7).
- `src/domain/duplicates/duplicates.ts`: identity-free-first (`serviceId` + overlapping half-open; back-to-back allowed), `IDENTITY_TIME_CONFLICT` only with supplied `identityKey`, RESCHEDULE `subjectBookingId` exclusion (v1 limitation disclosed).
- `src/domain/explain/explain.ts` + `evaluate.ts`: single decision function never throws; fail-closed on `RULESET_INVALID`/`INVALID_SLOT`/`EVALUATION_ERROR`; explainable outcomes with `{ruleId, code, customerMessage}`.
- `src/domain/time/intlZone.ts` + `wallClock.ts`: IANA zone via `Intl`, DST spring-forward gap → next valid, fall-back first occurrence only; midnight boundary B4 repair (endMinute 1440 fits `[0,1440)`).

### 4.2 Target-aware matrix (RULES-C4-1 / C5-1)
- `src/domain/README.md` documents binding matrix (CREATE/CANCEL/RESCHEDULE × entitlement/windows/caps/duplicates) with Contract §5.3 rationale. Additive `EvaluationTargetContext` (`target`, `subjectBookingId`) defaults to CREATE bit-for-bit.
- Executable enforcement:
  - `tests/domain/targets/targetAware.spec.ts` (31 tests passed) pins CREATE bit-for-bit and both audit probe regressions (cancel-frees-capacity, RESCHEDULE own-booking exclusion).
  - `tests/domain/targets/matrixProperties.spec.ts` (9 tests passed) enforces determinism, explanation completeness, CANCEL-tail drift guard, and `ports.ts` SHA-256 freeze (`d46e0743…18802`).
  - `tests/domain/evaluate.spec.ts` determinism property sweeps corpus across CREATE/CANCEL/RESCHEDULE with DST fixtures (spring-forward/fall-back) — 18 tests passed (485ms matrix sweep).

## 5. Enforcement evidence — deterministic tests reproduced independently

Full credential-free suite executed in this audit after `npm ci`:

Command: `npm test` → `npm run check:purity && vitest run --config src/platform/vitest.config.ts`

Result: **49 test files, 548 tests, ALL PASSED** (7.27s)

Domain-relevant subsets verified green:
- `tests/domain/*.spec.ts`: `purity` (14), `evaluate` (18), `targets/targetAware` (31), `targets/matrixProperties` (9), `windows/splitWindows` (13), `exceptions/exceptions` (7), `limits/caps` (7), `duplicates/duplicates` (8), `time/wallClock` (10), `time/localDate` (8), `ruleset.validate` (10), `uiValidatorParity` (30) — all passed.
- `tests/platform/purity-gate.spec.ts` (4) passed (strict gate still catches synthetic `@wix/` violations in fixture).
- Billing/diagnostics (`tiers`, `entitlement`, `projection`) passed but not lane-owned; no regressions observed.

Negative/edge coverage exercised:
- midnight `24:00` fits, overnight blocked (`overnight_slot`);
- empty windows, disjoint intersections, zero-limit caps;
- `RULESET_INVALID`/`INVALID_SLOT`/`EVALUATION_ERROR` classification;
- count `null` → fail-open with `COUNT_UNAVAILABLE_FAIL_OPEN` notice;
- degraded entitlement → `ENTITLEMENT_DEGRADED_FAIL_OPEN`;
- DST fixtures (America/New_York 2026-03-08 02:30 → 03:00 EDT).

No tests failed, no skipped, no silent `passWithNoTests`.

## 6. Lane boundary & technical-contract compliance

- No `@wix/*` imports in `src/domain/**` (purity gate + tests).
- No filesystem/network/clock leakage (purity tests).
- No PREVIEW_GATED or UNSUPPORTED claims (reschedule honestly labeled best-effort FAIL_OPEN per Contract §5.3/§10 #9; TOCTOU disclosed).
- No Wix SDK usage where forbidden; no dashboard/billing policy forked.
- Synchronization: `src/shared/types` + `src/domain/ports.ts` alias `EvaluationTarget = TargetOperation` ensures failure-semantics alignment (`failureSemanticsFor`); six platform targets collapse to three operations as documented.

## 7. Findings

No blocking or high defects. Observations are historical repairs already landed (B4 midnight, C4 target-aware) with executable pins. No new findings to escalate.

---

**Audit reproduction artifacts:** `npm ci` log, `check:purity` PASS, `vitest` 548 passed, `git show origin/main:.factory/evidence/...` JSON + build txt decoded above, `src/domain/README.md` matrix pinned, `wix.config.json` inspected.

VERDICT: ACCEPT
