# Rules Lane Audit — Candidate ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** lane-auditor (independent, read-only except this report) — muse-spark-1.2-contributor-free
- **Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1` — lab/wix-rules HEAD
- **Candidate (workflow-named):** `ec916b75d5600e02d679d264648ac92333d721f1` — exact same SHA (deterministic no-op)
- **Task audited against:** `docs/NEXT_CYCLE.json` cycle 7, lanes.rules `status: complete` — no active rules task; prior no-op ACCEPT from run 32920420147
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `docs/NEXT_CYCLE.json` — candidate code and comments are untrusted unless they agree with those authorities

## 1. Diff inventory (exact, reproduced)

`git diff ec916b75..HEAD --stat` against candidate and `git status` in this auditor worktree:

- Product diff for rules lane: **zero files**. `src/domain/**` and `tests/domain/**` byte-identical to accepted base (verified via `git diff --stat HEAD` showing only `.opencode/**` and `AGENTS.md` unrelated to this lane).
- Candidate commit `ec916b75` itself changed only `.github/**` (4 files deleted, -306 lines, `product: remove obsolete control-plane workflows`) — no domain file touched.
- No governance, workflow, directive, contract, or cross-lane file touched by the rules candidate.
- Conclusion: candidate is a deterministic no-op; scope boundary `src/domain/**` + `tests/domain/**` respected (Rule Engine Builder fiche §Allowed product scope). No scope expansion, no Wix-owned scaffold mutation.

## 2. Wix-owned scaffold / binding — authenticated generation check

Per task instruction: *For integration, verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses.*

- Rules lane **must not** own or modify Wix scaffold (`wix.config.json`, `extensions.ts`, `src/platform/**`, `src/extensions/**`). Candidate correctly modifies **none** of these.
- `wix.config.json` exists in the working directory but is **gitignored** (`^wix.config.json$` in `.gitignore` with rationale comment referencing Contract §16 / T-VP0 and `src/platform/registration/README.md`). It is **not committed** and therefore not part of the candidate SHA. Auditor read it directly:
  ```json
  {"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
  ```
  This file is the ignored local binding placeholder; the only committed artifact is `wix.config.example.json` containing explicit placeholders (`<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`) and classified UNLINKED — no UUID/hex fabrication, no secrets, verified clean by `registration-surface` and `platform-scope` anti-fabrication sweeps (see §3).
- No hand-authored guess is persisted as evidence. The live job's own SHA-pinning verifies that no fabricated binding is being integrated.

## 3. Reproduction — purity, typecheck, and enforcement evidence (executed by this auditor)

**Gate 1 — Typecheck + purity:**
- `npm ci --ignore-scripts --no-audit --no-fund` → added 47 packages
- `npm run check` → **exit 0**
  - `tsc --noEmit` — strict typecheck passed (covers `extensions.ts` include)
  - `node src/platform/purity/check-purity.mjs` → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
  - `vitest run --config src/platform/vitest.config.ts` → **548/548 tests in 49 files** (arithmetic: 518 cycle-6 + 30 new registration = 548; no test lost)
  - The `PURITY GATE FAILED` stdout lines are the expected negative-control fixture inside `purity-gate.spec.ts` (passes).

**Gate 2 — Domain purity suite (`tests/domain/purity.spec.ts`):**
- Scanner sanity: discovers ≥10 domain sources including `evaluate.ts`
- Every `src/domain/**/*.ts` file: no `@wix/` specifier, no `Date.now`/`new Date`, no `process`/`require`, only relative `../`/`./` imports
- `ports.ts` canonical contract pins: `Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`, `from '../shared/types'` — all present; `EvaluationTargetContext` additive contract intact

**Gate 3 — Domain semantics (sample traces executed):**
- Weekly windows: split hours `09:00–12:00 + 14:00–18:00` — `effectiveWeeklyWindows` returns intersection when both service and location declare, single-source when only one, `[]` when weekday unconfigured (exhaustive-week), `null` when no weekly config at all (fresh-install default-open) — pinned by `splitWindows.spec.ts` (13 tests).
- Exceptions: `CLOSED` beats `OVERRIDE`; multiple overrides intersect; empty intersection ⇒ closed; exact-date expiry — pinned by `exceptions.spec.ts` (7 tests).
- Caps: `count >= maxCount` blocks, one-under allows, declared `includedStatuses`, site-zone day → UTC `CountQuery` conversion via `instantForLocalWall`, `countForQuery → null` fails open with visible `COUNT_UNAVAILABLE_FAIL_OPEN` notice — pinned by `caps.spec.ts` (7 tests).
- Duplicates: identity-free-first (same service + half-open overlap + start-day bucket), `IDENTITY_TIME_CONFLICT` cross-service same-key, `intervalsOverlap` half-open, `DUPLICATE_COUNTED_STATUSES` excludes `CANCELED/DECLINED/WAITING_LIST`, RESCHEDULE `subjectBookingId` exclusion conservative (only exact `bookingId` match) — pinned by `duplicates.spec.ts` (8 tests).
- Time/DST: IANA `Intl` only authority, spring-forward gap advances to next valid local time (`02:30 → 03:00 EDT`), fall-back resolves to first occurrence second occurrence not bookable, count bucket uses site zone not UTC — pinned by `wallClock.spec.ts` (10) and `localDate.spec.ts` (8).
- Fail-closed classification: invalid RuleSet → `RULESET_INVALID`, malformed slot → `INVALID_SLOT`, internal throw → `EVALUATION_ERROR`, never throws — pinned by `evaluate.spec.ts` §fail-closed (4 tests + invalid IANA → INVALID_SLOT).
- Entitlement: healthy allowance blocks uncovered location (`LOCATION_NOT_COVERED`), degraded signals fail open with `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice, `null` locationId (CUSTOM/CUSTOMER) skips check — pinned by evaluate entitlement suite.
- Target-aware matrix (RULES-C4-1): `targetContext` optional → absent = CREATE bit-for-bit; CREATE all families; CANCEL only classification (skip entitlement/windows/caps/duplicates); RESCHEDULE proposed-slot windows/caps + duplicate exclusion via `subjectBookingId`; fail-closed vs fail-open semantics unchanged (`failureSemanticsFor` CREATE/CANCEL FAIL_CLOSED, RESCHEDULE FAIL_OPEN) — pinned by `targetAware.spec.ts` (31) + `matrixProperties.spec.ts` (9) + evaluator matrix determinism/explanation sweeps inside `evaluate.spec.ts` (18, including DST fixtures across all three targets).
- Structural validation mirror: `validateRuleSet` rejects `RESERVED_RULE_IDS` imported from `model/primitives` (no drift), invalid weekday/time/window, duplicate limit/exception ids, missing `targetId`, empty statuses, malformed dates — pinned by `ruleset.validate.spec.ts` (10) and `uiValidatorParity.spec.ts` (30).

All 548 tests green; no `*.skip/*.only/*.todo/*.fails` under `tests/`.

## 4. Adversarial questions

- **Hidden degraded states / silent fail-open?** None. Count-unavailable and entitlement-degraded both emit explicit `allow`-with-notice explanations (`COUNT_UNAVAILABLE_FAIL_OPEN`, `ENTITLEMENT_DEGRADED_FAIL_OPEN`); never silent, never thrown. Caps mismatched to no thrown bypass.
- **Weakened tests to make parity pass?** No. Tests are stored in candidate at same SHA; auditor executed the exact committed suites — they are unchanged from the prior ACCEPT audit.
- **Unsupported Wix assumptions / banned claims?** None in domain. No per-location native hours object claimed (§10 #1), no unconditional reschedule guarantee (§12 banned claim 2 — domain docs label RESCHEDULE best-effort FAIL_OPEN), no hard-cap promise (TOCTOU disclosed), no invented entitlement.
- **Determinism / host-clock leakage?** None. Domain has zero `Date.now`/`new Date`/`process`; all clocks/zones injected via `ports.ts` `Clock`/`timezone` params; `Intl` decomposition via `formatToParts(epochMs)` never constructs host-zone `Date`; repetition test 100× identical outcomes per (scenario, target) passes.
- **Cross-lane drift?** None this cycle — zero diff on `src/shared/**`; `RuleSet` re-exports `RuleSetDTO` and `EvaluationTarget` aliases `TargetOperation` (compile-time sync).

## 5. Non-blocking observations (no repair required)

- N1: `wix.config.json` present locally but correctly gitignored and not part of candidate evidence; no action for rules lane.
- N2: No new platform contract evolution this cycle; `ports.ts` SHA remains `d46e0743…18802` pinned by matrixProperties.

## 6. Verdict rationale

Candidate `ec916b75` is a byte-identical no-op against the accepted base — proven by diff, not assumed. The rules lane correctly does nothing when `docs/NEXT_CYCLE.json` marks it `complete`. I reproduced every headline claim: typecheck green, seven-root purity green, 548/548 tests green, domain semantics for split windows, exceptions, caps, duplicates, DST, fail-closed classification, and the full CREATE/CANCEL/RESCHEDULE matrix remain exactly as previously ACCEPT-audited, with no Wix imports, no host I/O, no scope violation, and no fabricated binding.

VERDICT: ACCEPT
