# Integrated Audit — Candidate `704a639c1d03a1556d185efdbc0f009ea9b32063`

- **Auditor role:** integrated-auditor (fresh, independent, cross-system; distinct from all builders and lane auditors)
- **Candidate:** `704a639c1d03a1556d185efdbc0f009ea9b32063` — `candidate(integration): generation 234`
- **Candidate parent:** `26d479ad20552d06a930341ac029af3084471917`
- **Candidate author:** `wix-official-scaffold`, dated 2026-09-01
- **Working tree:** detached HEAD at candidate SHA; `git diff 704a639c…` shows only governance drift (`.opencode/**`, `AGENTS.md`) — product code at HEAD matches the candidate exactly.
- **Method:** read-only, credential-free, deterministic. No real `wix build` executed (out of scope; unavailable Wix runtime credentials are not treated as a product defect). Empirical execution of `npm run check`/`npm run typecheck` was blocked by the sandbox permission allowlist; the typecheck behavior below is established by static analysis of the exact candidate files and TypeScript resolution semantics (TS6053 for a missing `/// <reference path>` target).

---

## 1. Composition / SHA integrity

- Candidate commit `704a639c` changes exactly 6 files (verified via `git show --stat`):
  - `.gitignore` (+3: `.astro/`)
  - `astro.config.mjs` (new, 14 lines)
  - `package-lock.json`
  - `package.json`
  - `src/env.d.ts` (new, 4 lines)
  - `tsconfig.json`
- No other product file is touched by the candidate commit itself. The `.github/**` deletions and `src/ui/**`/`tests/ui/**` changes visible in `ead6d3db..704a639c` belong to intermediate lineage commits, not to this candidate.
- `wix.config.json` is tracked at the candidate and preserves the bound App ID `3e9ec3af-001b-4684-a197-a5133677844d` (integration lane obligation: preserve the bound existing App ID — satisfied).
- `wix.config.example.json` retains the placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`; the registration classifier (`src/platform/registration/projectConfig.ts`) truthfully distinguishes `MISSING_FILE` / `UNPARSEABLE` / `UNLINKED` / `LINKED` and never invents identifiers.

## 2. Contract parity — integration lane

- **Purity gate** (`src/platform/purity/check-purity.mjs`): protected roots are `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`. The candidate touches none of these paths → `check:purity` unaffected.
- **Vitest gate** (`src/platform/vitest.config.ts`): `include: ['tests/**/*.spec.ts']`, node environment, `passWithNoTests: false`. The candidate touches no test files and no vitest config → `test:unit` vitest run unaffected.
- **Registration surface** (`src/platform/registration/extensionsManifest.ts`): every extension is `PLANNED_UNTIL_T_VP0`; no identifier-shaped strings are invented; channels are honestly classified (`UNIFIED_CLI_GENERATE`, `APP_DASHBOARD_FALLBACK`, `INTERACTIVE_CLI_MENU`, `FILE_BASED_NO_REGISTRATION`). `extensions.ts` remains an intentionally empty frozen anchor. No fabricated Wix capabilities or IDs.
- **Scaffold honesty:** `astro.config.mjs` is the standard Wix/Astro unified-CLI config (`@wix/astro`, `@astrojs/react`, `@wix/astro-wix-hosting-adapter`, `output: "server"`). `src/env.d.ts` is the standard auto-generated Astro type-reference file. These are consistent with the T-VP0 scaffold runbook and the unified-CLI path in the blueprint.

## 3. Contract parity — rules lane (domain core)

- `src/domain/evaluate.ts` implements staged evaluation with fail-closed classification and target-aware semantics (RULES-C4-1); `src/domain/ports.ts` defines injected clock/zone ports; `src/shared/types.ts` and `src/shared/errors.ts` are pure.
- Domain tests (`tests/domain/**/*.spec.ts`) cover windows/split hours, targets, caps, exceptions, duplicates, time/DST, ruleset validation, evaluate, and purity. The candidate does not touch the domain core or its tests.
- No `@wix/*` imports in `src/domain/**` (purity gate + `tests/domain/purity.spec.ts`).

## 4. Contract parity — dashboard lane

- `src/ui/pages/rulesEditorPage.js` and `src/extensions/dashboard/*.page.js` consume typed contracts through the platform bridge; no silent fork of domain semantics.
- Mutation flow: bounded poller, explicit crash-recovery button (never silent destructive rewrites), honest platform framing (`PLANNED_UNTIL_T_VP0`).
- Accessibility suite (`tests/ui/accessibility.test.js`): every control has an accessible name; every clickable element is keyboard operable (Enter/Space proven); issues region `role=alert`; status region `role=status` + `aria-live=polite`; diff modal exposes full dialog semantics; disabled review button explains why via `title`. Matches the contract's accessibility bar.
- UI tests (`tests/ui/*.test.js`) are exercised by the dashboard lane's own harness; the candidate does not touch them.

## 5. Contract parity — billing lane

- `src/billing/pure/tiers.ts`: 5 tiers, labels ≤ 23 chars, paid tiers differ only by location allowance (contract §7).
- `src/billing/pure/entitlement.ts`: fail-safe resolution; `billingExpirationDate` intentionally never read (no invented entitlement mechanism).
- `src/billing/pure/coverage.ts`: over-limit coverage selection with stable ordering (default location first, then alphabetical by location id); never deletes customer configuration on downgrade.
- `src/billing/enforcement/entitlementGate.ts`: ratified fail-open posture — billing/counting/listing infrastructure errors never block a paying merchant's bookings; degraded decisions carry `degraded: true` and a persisted warning; `UNKNOWN_PLAN_IDENTIFIER` persists until operator mapping; over-limit is a normal decision, not an error.
- Billing tests (`tests/billing/**/*.spec.ts`) cover pagination, intersection dedup, archived exclusion, CUSTOM-only floor, entitlement decision table, fail-open warning emission, downgrade-through-gate, projection fidelity. Candidate does not touch them.

## 6. Booking enforcement semantics (fail-closed / fail-open)

- `src/shared/errors.ts` `failureSemanticsFor`: `CREATE` → `FAIL_CLOSED`, `CANCEL` → `FAIL_CLOSED`, `RESCHEDULE` → `FAIL_OPEN`. Matches the contract mapping exactly.
- Validation-plugin wiring (`src/platform/validation-plugin/`) is pure (no Wix SDK imports); the real `bookingsValidation.provideHandlers()` SDK adapter is deferred to the T-VP0 thin adapter per the validation-plugin README §6 protocol. Enforcement claims stay gated on T-VP1–T-VP5; no production claim is made.

## 7. Rollback / recovery (contract §9)

`src/platform/schedule-mutation/orchestrator.ts` implements the full binding sequence:
1. **Snapshot** before any write (journal baseline persisted first, §9.1).
2. **Diff** = the user-confirmed MutationPlan from the dashboard confirm modal (§9.2); the orchestrator adds no rule logic.
3. **Idempotent writes** — deterministic UUIDv5 keys derived from (site, schedule, rule-version, weekday, window) via `src/platform/schedule-mutation/idempotency.ts` (RFC 4122 §4.3, namespace `7c9e6679-7425-40de-944b-e07fc1f90ae7`); replay yields SKIPPED_ALREADY_APPLIED (§9.3).
4. **Revision-checked updates** with bounded retries (default 3) (§9.4).
5. **Verify** — re-read mutated schedule; only then mark applied (§9.5).
6. **Rollback** — restore persisted snapshot with fresh idempotency keys on failure or user revert; Cancel Event documented as terminal (§9.6).
7. **Audit** — exactly one audit entry per completed mutation run (§9.7).
- **Crash semantics (T-RB1):** unexpected exceptions/process death intentionally leave the journal record `APPLY_IN_PROGRESS` — no in-process rollback by a dying process; the next run either RESUMES via `applyNextChange` (safe: idempotent writes) or calls `recoverInterruptedApply`, which restores the exact pre-apply state from the persisted snapshot and verifies at working-hours-window granularity.
- **Terminal-state hardening:** every state outside `{SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS}` is treated as terminal; `completeApply`/`failApply` reject terminal states with `INVALID_STATE` before any gateway call, journal write, or audit entry.
- Tests: `tests/platform/schedule-mutation.spec.ts`, `orchestrator-terminal-states.spec.ts`, `idempotency.spec.ts` cover the sequence, kill-the-power recovery, and terminal-state guards.

## 8. Entitlement (contract §7)

- Fail-open on billing/counting/listing API errors with prominent persistent dashboard warning; never blocks bookings on transient billing-API failure.
- Over-limit restricts coverage to the plan allowance with stable ordering; never deletes user data; upgrade CTA surfaced.
- Billable-location definition matches the ratified definition (exists, `archived=false`, referenced by a counted service; distinct-set intersection prevents double counting; CUSTOM-only floor 0→1).
- Tests: `tests/billing/entitlementGate.spec.ts`, `downgradeThroughGate.spec.ts`, `coverage.spec.ts`, `counter.spec.ts`, `counterAdapters.spec.ts`.

## 9. Accessibility-sensitive behavior

- Verified in `tests/ui/accessibility.test.js` (labels, keyboard operability, dialog semantics, live regions) and `src/ui/pages/rulesEditorPage.js` (role=status feedback, bounded poller, explicit recovery button). No weakening of validation/accessibility to make tests pass.

## 10. Real Wix scaffold assumptions

- The candidate is the authenticated scaffold output (`wix-official-scaffold` author). It adds the standard Astro/Wix unified-CLI surface: `astro.config.mjs`, `src/env.d.ts`, `tsconfig.json` extending `astro/tsconfigs/strict`, `.astro/` gitignore, and the Wix/Astro dependency set (`@wix/astro`, `@wix/cli`, `@wix/astro-wix-hosting-adapter`, `@wix/sdk-types`, `@astrojs/react`, etc.).
- `package.json` `build` script changed from `npm run check` to `wix build` — consistent with the contract §8.6 gate (`npm ci && npm run test:unit && wix build`), which invokes `wix build` directly. The `check` script (typecheck + purity + vitest) remains available.
- No fabricated identifiers, no secret material, no invented Wix capabilities. The scaffold state is honestly reported as `PLANNED_UNTIL_T_VP0` / `UNLINKED`-until-real-binding.

---

## 11. BLOCKING FINDING — deterministic `npm run check` gate is broken in a credential-free environment

**Context (authoritative):** the Director's acceptance criteria for this exact task (INT-C7-LIVE, `docs/NEXT_CYCLE.json` line 33) require:

> `npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm run build pass.`

`npm run check` = `npm run typecheck && npm run check:purity && vitest run --config src/platform/vitest.config.ts`, and `typecheck` = `tsc --noEmit`.

**What the candidate introduced:**
- `src/env.d.ts` (new) contains `/// <reference path="../.astro/types.d.ts" />`.
- `tsconfig.json` (modified) extends `astro/tsconfigs/strict` and includes `.astro/types.d.ts` in `include`.

**Why it fails:**
- `.astro/` is gitignored (candidate added `.astro/` to `.gitignore`) and is generated only by the Astro CLI (`astro sync` / `wix dev` / `wix build`).
- The `.astro/` directory does **not** exist anywhere in the working tree (verified by glob), and there is **no** `postinstall` script or `astro sync` invocation anywhere in the repo (verified by grep across `*.{json,mjs,js,ts,yml,yaml,md}`) that could generate it before `npm run check`.
- `tsc --noEmit` resolves `/// <reference path>` directives during program construction; a missing reference target is a hard error **TS6053: File '...' not found**. `skipLibCheck: true` does not suppress resolution errors (it only skips type-checking of declaration files), and `noEmit: true` does not suppress error reporting.
- Therefore, in the exact acceptance-criteria sequence, step 2 (`npm run check`) fails at the typecheck step and step 3 (`npm run build`) is never reached. The `--ignore-scripts` flag guarantees no script can generate `.astro/types.d.ts` during `npm ci`.

**Why this is a candidate defect, not an infrastructure/credential issue:**
- The failure is in the credential-free deterministic gate, not in the authenticated `wix build`. The scaffold's generated-file dependency was introduced by the candidate's own files (`src/env.d.ts`, `tsconfig.json`) and was not adapted to keep the Director's published acceptance gate green (e.g., by running `astro sync` before typecheck in the `check` script, or by committing a checked-in stub, or by updating the acceptance criteria with the Director).
- The blueprint §6 also lists "typecheck" as part of the global CI gate, so the break contradicts the blueprint's published gate as well as the Director's acceptance criteria.

**Non-blocking observations (recorded, not verdict-driving):**
- `.github/` is absent from the candidate SHA and the working tree (deleted in lineage commits, not by this candidate). CI workflow enforcement is an orchestration concern handled by the trusted workflow shell; noted for the Director.
- `tsconfig.json` `include` lists root `vitest.config.ts`, which does not exist (actual config is `src/platform/vitest.config.ts`, covered by `**/*`). Benign unmatched include pattern.
- `build` script no longer runs deterministic checks (`wix build` instead of `npm run check`); consistent with contract §8.6, but the `check` script remains the deterministic gate and is currently broken as described.

---

## 12. Verdict

The candidate is compositionally clean, preserves the bound App ID, keeps the purity and vitest gates intact, and maintains full contract parity across integration/rules/dashboard/billing (enforcement semantics, rollback/recovery, entitlement, accessibility, honest scaffold surface). However, it **breaks the Director's published acceptance gate** `npm run check` in the credential-free environment: the new `src/env.d.ts` / `tsconfig.json` reference the Astro-generated `.astro/types.d.ts`, which does not exist and cannot be generated by the acceptance-criteria sequence (`npm ci --ignore-scripts && npm run check && npm run build`), causing `tsc --noEmit` to fail with TS6053.

This is a same-lane (integration) repair: adapt the scaffold surface so the credential-free deterministic gate passes (e.g., generate `.astro/types.d.ts` via `astro sync` inside the `check`/`typecheck` script chain, or otherwise satisfy the reference before typecheck), then re-audit.

VERDICT: FIX