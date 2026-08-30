# Lane Audit — Rules Candidate 3dd1cd69

- Auditor: independent lane-auditor (not builder)
- Candidate SHA: `3dd1cd69e6344b58ed7bfa486660e9903a7afdcc` ("candidate(rules): generation 17")
- Accepted base SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Scope: `src/domain/**`, `tests/domain/**` only (verified via `git diff --name-only base..candidate` = 6 files, all within allowed `rules-engine-builder` scope)
- Binding refs: `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md` (§5.3, §7, §11 C5), `docs/BUILD_BLUEPRINT.md` (§2, §5, §6), `.opencode/job-descriptions/rules-engine-builder.md`, `docs/NEXT_CYCLE.json` (cycle 7, rules=complete)

---

## 1. Real diff inspection (reproduced via `git diff base..candidate`)

- `src/domain/README.md` (+): documents entitlement matrix cell as "degraded → notice; uncovered → no-op" with rationale citing Contract §7 "coverage restriction, never data trapping" and Integration `handlers.ts` `UNCOVERED_LOCATION_RULES_SKIPPED` disposition. Consistent with validated `src/platform/validation-plugin/handlers.ts` lines 50-58 and 641-662 which already implement skip-before-domain.
- `src/domain/evaluate.ts`: retains degraded allow-with-notice; removes `LOCATION_NOT_COVERED` block (previously `!allowedLocationIds.includes(locationId)`). Adds comment explaining Integration skip posture and that domain no-op is intentional, not dead code. CANCEL still skips entitlement entirely (`if target !== 'CANCEL'` preserved).
- `src/domain/explain/explain.ts`: removes `locationNotCovered: 'LOCATION_NOT_COVERED'` from `OUTCOME_CODES`. No other codes changed.
- `tests/domain/evaluate.spec.ts`, `tests/domain/targets/matrixProperties.spec.ts`, `tests/domain/targets/targetAware.spec.ts`: update expectations from `block LOCATION_NOT_COVERED` to `allow, no entitlement explanation` / `uncovered-location-noop`. Matrix derived injection set drops from 10 to 9 (entitlement family now only `ENTITLEMENT_DEGRADED_FAIL_OPEN`), and suite reflects that.

Zero cross-lane edits: `src/platform/**`, `src/billing/**`, `src/dashboard/**`, `src/shared/**`, `wix.config.json`, `package.json`, `.github/**`, governance files unchanged. No secrets, no fabricated Wix identifiers.

## 2. Wix-owned scaffold/binding provenance (lane-auditor expanded check per workflow)

Although this is a rules-only candidate, the workflow requires verification that any Wix-owned scaffold/binding did not come from hand-authored guesses:

- Candidate diff touches **no** Wix-owned scaffold files (`wix.config.json` unchanged in diff; verified `git diff --name-only` has no scaffold entry).
- Current `wix.config.json` at base and candidate is `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}` — exactly the three fields persisted by the authenticated bootstrap per `reports/wix-live/BOOTSTRAP_BINDING.md` (GitHub Actions authenticated with protected `WIX_API_KEY`, bound to existing Wix app "Advanced Booking Rules", real `wix build` succeeded; no secret material persisted). This is not a hand-authored guess; it matches the privileged CI binding evidence.
- No candidate commit fabricates appIds, extensionIds, or credentials (grep of diff for GUID-like literals shows only test fixtures).
- `src/domain/**` remains free of `@wix/*` imports (purity gate passes).

=> Scaffold/binding integrity holds; no hand-authored guess introduced by this rules candidate.

## 3. Purity & lane ownership (reproduced)

- Purity gate: `npm run check:purity` → PASS ("no '@wix/' imports under src/domain, src/billing/pure, ...").
- Manual grep: `src/domain/**` contains only doc-comment mention of `@wix/` ban (in `ports.ts` header), zero live imports.
- Typecheck: `npx tsc --noEmit` (via `npm run check`) → exit 0 after `npm ci`.
- No filesystem/network/process imports in domain; deps injected via `EvaluationDeps`.

## 4. Enforcement evidence reproduced

Executed in candidate worktree (credential-free):

- `npm ci --ignore-scripts --no-audit --no-fund` → 47 packages, green
- `npm run check` → **548 tests passed** (49 files), 0 failures/skips; `npm run check:purity` green; `tsc` green. This reproduces blueprint §6 deterministic CI gate `npm ci && npm run test:unit && wix build` (minus `wix build` credential-free scaffold check, which is integration-owned and unaffected by this diff).
- Key suites exercised:
  - `evaluate.spec.ts` 18 tests including uncovered-location no-op, degraded fail-open, CANCEL skips entitlement, CUSTOM/CUSTOMER null-location, violation accumulation, midnight/DST, invalid-slot classification.
  - `matrixProperties.spec.ts` 9 tests: deterministic CANCEL-tail guard (forbidden-family set derived from README CANCEL column, now 9 injections), matrix↔code consistency probes, determinism.
  - `targetAware.spec.ts` 31 tests: default-deps bit-for-bit CREATE preservation and per-target CREATE/CANCEL/RESCHEDULE matrix.
  - DST fixtures (spring-forward gap/span, fall-back ambiguous) and split-window cases covered in determinism and explanation sweeps.

Adversarial re-probes (manual reasoning + existing suites):
- Uncovered location with healthy entitlement → `allow`, zero `entitlement` explanations (other families still evaluate) — matches Integration skip contract.
- Degraded entitlement → `allow` with `ENTITLEMENT_DEGRADED_FAIL_OPEN` notice under CREATE/RESCHEDULE, none under CANCEL — correct per §5.3 fail-open posture.
- CANCEL with at-cap counter, outside-hours window, or duplicate → `allow` (families skipped) — correct cancel-frees-capacity.
- Malformed slot / invalid RuleSet / thrown deps → `block` with `INVALID_SLOT`/`RULESET_INVALID`/`EVALUATION_ERROR` — fail-closed preserved for every target.
- No `LOCATION_NOT_COVERED` emitted anywhere; matrix expectations updated consistently.

## 5. Contract & blueprint alignment

- Entitlement semantics: Candidate implements Contract §7 over-limit posture "restrict enforcement coverage ... never trap data; show upgrade CTA" via domain no-op + Integration `UNCOVERED_LOCATION_RULES_SKIPPED` (explicit valid, disposition tracked). Hard-blocking uncovered locations would trap bookings at over-limit locations; the no-op avoids that and delegates coverage restriction to the platform layer — consistent with `src/platform/validation-plugin/handlers.ts` and `README.md` rationale. Degraded still fails open with visible notice (Contract §7/C5), never blocking a paying merchant on billing API failure.
- Target-aware matrix: `README.md` matrix now reads "Entitlement coverage (degraded → notice; uncovered → no-op) | yes (allow) | no | yes (allow)" — accurately reflects code (entitlement checked for CREATE and RESCHEDULE proposed-slot, skipped for CANCEL). The narrowing to degraded-only is correctly reflected in `FAMILY_OUTCOME_CODES` and the CANCEL-tail derived set.
- `OUTCOME_CODES` removal of `LOCATION_NOT_COVERED` is a narrow public-contract contraction; it does not break platform consumers (platform never consumed that code — it consumed `UNCOVERED_LOCATION_RULES_SKIPPED` disposition). No billing/platform file references the removed code. The change is additive to the integration posture, not a silent weakening — fully documented and pinned by updated tests.

## 6. Findings

### Blocking findings
None. All deterministic checks green, purity intact, scope exact, scaffold provenance authentic, and entitlement posture aligns with the ratified "coverage restriction, never data trapping" contract.

### Non-blocking observations (do not gate integration)
- The removed `LOCATION_NOT_COVERED` code is a public-contract contraction; future callers that assumed domain-level hard blocking of uncovered locations must use the Integration disposition instead. The current codebase already does.
- The README now correctly states uncovered is a no-op in the domain and skipped upstream; any future domain consumer outside the validation-plugin path must be aware that uncovered filtering is not enforced by `evaluateRules` alone.

## 7. Verdict rationale

Candidate delivers a consistent, narrowly-scoped domain adjustment that aligns the pure rules core with the already-accepted Integration-layer over-limit posture, preserves fail-closed classification and fail-open degraded semantics, maintains zero Wix imports and exact lane ownership, keeps the deterministic 548-test suite green, and does not fabricate Wix scaffold material. Independent reproduction confirms all claims.

VERDICT: ACCEPT
