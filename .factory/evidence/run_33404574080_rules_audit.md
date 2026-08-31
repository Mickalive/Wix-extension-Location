# Factory Lane Audit — rules

**Role:** rules-auditor (independent, read-only)
**Candidate SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Accepted base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Audit date:** 2026-08-31
**Contracts:** `MAIN_PROMPT.md` + `docs/WIX_TECHNICAL_CONTRACT.md` + `docs/BUILD_BLUEPRINT.md` + `docs/NEXT_CYCLE.json` (cycle 7)

## Scope

- Exact rules candidate as pinned by workflow, no builder edits.
- Base == candidate: zero delta in product code expected; verified by `git diff --stat ec916b75` showing only unstaged `.opencode/**` control-plane drift not part of candidate commit, and `git show ec916b75 --stat` showing only 4 workflow deletions (no `src/` changes).
- Rules lane owns only `src/domain/**` and `tests/domain/**` (immutable fiche). No Wix SDK/REST/MCP/network/fs/process allowed in domain core.

## Evidence reproduced (independent)

1. **Diff / status**
   - `git status` → detached at ec916b75, unstaged modifications limited to `.opencode/agents`, `.opencode/job-descriptions`, `AGENTS.md` — none in `src/domain`, `tests/domain`, `src/shared`, `src/platform`, `src/billing`. Candidate commit itself has no domain mutation.
   - `git diff --stat ec916b75` vs working tree confirms same: 13 files, all control-plane docs, zero `src/domain/**` changes.
   - `git show ec916b75 --stat` → 4 deletions under `.github/**` only.

2. **Wix-owned scaffold / binding provenance (integration check per brief)**
   - `wix.config.json` at candidate (`git show ec916b75:wix.config.json`) → `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}` — no secret material.
   - `origin/main:.factory/evidence/run_33321707099_official_scaffold.json` via `git show` → `schemaVersion 3`, `source:"authenticated official Wix existing-app scaffold"`, `appId:"3e9ec3af-001b-4684-a197-a5133677844d"`, `projectId:"advanced-booking-rules"`, `pristineWixBuild:"PASS"`, `wixCliVersion:"1.1.238"`, `secretsPersisted:false`, `scaffoldPackageSha256:1768e7a6...` Matches candidate `wix.config.json` exactly; not a hand-authored guess.
   - `origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` → full `wix build` log ending `Complete!` with server + client vite builds, 6864 modules, no errors. Binding came from authenticated `npm create @wix/new@latest` / unified CLI scaffold, not fabricated IDs.

3. **Purity gate (domain core)**
   - `node src/platform/purity/check-purity.mjs` → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
   - `tests/domain/purity.spec.ts` (14 tests) → 14/14 passed. Scanner asserts no `@wix/`, no `Date.now`/`new Date`, no `process`/`require`, only relative imports under `src/domain/**`, and ports canonical markers present.
   - Manual read of `src/domain/evaluate.ts`, `ports.ts`, `duplicates/duplicates.ts`, `validate.ts`, `index.ts`, `explain/explain.ts`, `windows/`, `exceptions/`, `limits/`, `time/` → zero `@wix` imports, deterministic, injected `Clock`/`IanaZone`, no I/O.

4. **Type & deterministic build**
   - `npm ci --ignore-scripts --no-audit --no-fund` → 47 packages, no secrets.
   - `npm run typecheck` → pass (after ci).
   - `npm run check` (`typecheck + check:purity + vitest run --config src/platform/vitest.config.ts`) → pass.
   - `wix build` not required for rules lane; integration-owned scaffold already proved pristine build PASS in official evidence. Candidate `npm run build` aliases to `npm run check` and passed.

5. **Tests (re-run, no builder claims trusted)**
   - Full unit run: 49 test files, 548 tests, all passed (7.41s). Includes every rule-domain suite:
     - `tests/domain/evaluate.spec.ts` (18, incl. determinism property 100× repetitions + matrix sweep across CREATE/CANCEL/RESCHEDULE with DST fixtures)
     - `tests/domain/targets/targetAware.spec.ts` (31) and `matrixProperties.spec.ts` (9) — per-target matrix, explanation completeness, CANCEL-tail drift guard, ports freeze SHA-256 `d46e0743...18802` pin
     - `tests/domain/windows/splitWindows.spec.ts` (13), `exceptions/exceptions.spec.ts` (7), `limits/caps.spec.ts` (7), `duplicates/duplicates.spec.ts` (8), `time/wallClock.spec.ts` (10), `time/localDate.spec.ts` (8), `ruleset.validate.spec.ts` (10), `uiValidatorParity.spec.ts` (30), `purity.spec.ts` (14)
     - Billing/platform suites also green, proving shared glob `tests/**/*.spec.ts` intact (Blueprint §6, audit N3).
   - Negative/edge cases present: RULESET_INVALID, INVALID_SLOT (>24h, inverted, malformed, invalid IANA zone → INVALID_SLOT), EVALUATION_ERROR, entitlement fail-open, violation accumulation (3 families), midnight boundary 1440, DST spring-forward/fall-back.

6. **Rule-domain & enforcement evidence**
   - `src/domain/evaluate.ts` fail-closed classification (RULESET_INVALID/INVALID_SLOT/EVALUATION_ERROR) never throws, accumulates violations, delegates to `validateRuleSet`, `resolveSlot` (site-zone wall clock, Contract §4.7), `effectiveWeeklyWindows` (split windows, intersection), `resolveDayExceptions` (CLOSED > OVERRIDE, override intersection), `applicableLimits`/`countQueryForLimit` (UTC bounds, inclusive `count >= maxCount` → QUOTA_EXCEEDED, null → fail-open notice), `findDuplicateConflict` (half-open overlap, start-bucket, identity-free-first, excludeBookingId on RESCHEDULE).
   - B4 midnight repair verified: end at 1440 fits, genuine overnight → `overnight_slot`.
   - Target-aware (cycle-4 RULES-C4-1, additive, absent → CREATE bit-for-bit): CREATE all families, CANCEL only classification, RESCHEDULE proposed-slot semantics + subject exclusion. Determinism and explanation completeness swept across ALL_TARGETS (see evaluate.spec.ts matrix).
   - Time/DST: `intlZone.ts` + `wallClock.ts` use IANA via Intl, spring-forward advances to next valid, fall-back first occurrence, deterministic fixtures present.

7. **Lane ownership / prohibitions**
   - No `src/platform/**`, `src/extensions/**`, `src/ui/**`, `src/billing/**`, `.github/**`, `.opencode/**`, `MAIN_PROMPT.md`, `AGENTS.md` edits in candidate domain code.
   - No secrets committed; no Wix IDs fabricated beyond the authenticated `wix.config.json` proven above.
   - No silent destructive schedule rewrites in domain (orchestrator belongs to integration lane).

## Findings

No reproducible finding against the rules contract. Candidate is pure deterministic domain semantics with exhaustive tests, correct fail-closed/open posture, documented honest residuals (RESCHEDULE same-day self-count, subjectBookingId UNPROVEN payload, overnight start-bucket limitation, TOCTOU disclosure per Contract §11 C1/C6), and passes all gates.

## Verdict rationale

Integration binding provenance verified as authenticated official scaffold (not hand-authored), domain purity and determinism reproduced green, 548/548 tests passed, no lane-boundary or secret violations. Same SHA as accepted base remains integrable.

VERDICT: ACCEPT
