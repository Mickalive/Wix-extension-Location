# Audit — Integration Lane, Cycle 32692407760 (build cycle 1, task INT-C1-1)

- **Auditor:** lane-auditor (independent)
- **Candidate:** `/tmp/wix_integration_candidate` @ `ef94fa9` ("Wix build 32692407760: integration candidate (active)")
- **Accepted base:** `12071a5` (untouched recon-accepted state; candidate is exactly one commit on top of it)
- **Diff shape:** 28 files, +4872 / −0 (purely additive). Paths: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `src/platform/**`, `tests/platform/**` — all inside the integration lane's shell allowlist (`wix-build-loop.yml` line 185). No immutable file touched (verified by name-grep over the full diff).
- **Verdict basis:** real diff inspected file-by-file; deterministic checks executed in the candidate worktree; adversarial probes run beyond the committed suite.

## 1. Executable checks actually run (not hand-waved)

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` (candidate worktree) | PASS |
| Unit + purity suite | `npm run test:unit` | PASS — 33/33 tests, 4 files |
| Full gate | `npm run check` (typecheck + purity + tests) | PASS |
| TypeScript | `npm run typecheck` (`tsc --noEmit`, strict, `noUncheckedIndexedAccess`) | PASS, zero errors |
| Network independence | `test:unit` rerun with `HTTP(S)_PROXY=http://127.0.0.1:9` (all egress dead) | PASS — 33/33 |
| Determinism | suite rerun 3× + proxy run | identical 33/33 every run |
| Purity negative proof | observed live during suite run | `PURITY GATE FAILED: 4 forbidden '@wix/' import(s)` emitted by the fixture test (expected stderr, captured by assertion) |
| Dependency hygiene | grep of `package.json`/`package-lock.json` for `@wix/` packages | 0 occurrences; devDeps only `typescript`, `vitest`, `@types/node` |
| Real-import scan | grep `@wix/` across `src/`+`tests/` | only comments, the scanner itself, and test fixtures — no live SDK call sites |

## 2. Acceptance-criteria verification (INT-C1-1)

1. **"`npm ci && npm run test:unit` passes with zero Wix credentials and no wixapis.com access"** — VERIFIED (table above). All fakes are in-memory; no fetch/socket code exists in `src/` or `tests/`.
2. **"Purity gate demonstrably fails on injected `@wix/` imports (negative test committed)"** — VERIFIED. `tests/platform/purity-gate.spec.ts` materializes temp fixtures under both protected roots covering static, type-only, dynamic-`import()`, and `require()` violation forms, asserts per-violation file/line/kind, asserts exit code 1 of the real CLI command, and asserts the clean-tree case passes. The gate scans `src/domain/**` and `src/billing/pure/**` (missing dirs skipped until billing lane lands), comment-stripping is quote-aware, and side-effect/dynamic/require patterns are covered.
3. **Orchestrator proofs** — ALL FIVE VERIFIED with dedicated tests in `tests/platform/schedule-mutation.spec.ts`:
   - *Snapshot persisted before first write:* shared ordered trace asserts `gateway.snapshot` → `journal.persistBaseline` precede any `gateway.apply`.
   - *Replay with identical idempotency key ⇒ exactly one applied change:* two orchestrators, same semantic plan; replay yields `SKIPPED_ALREADY_APPLIED` with the original eventId; schedule holds exactly 5 seeded + 1 created event.
   - *Stale-revision conflict retries with fresh revision then succeeds:* concurrent-writer simulation bumps revision; orchestrator re-snapshots, retries, `attempts=2`, final revision `'5'`; exhausted-retry variant rolls back and leaves content unchanged.
   - *Simulated crash mid-apply + recovery restores exact pre-apply state:* `SimulatedProcessCrash` thrown before write #2; journal durably holds `APPLY_IN_PROGRESS` + `confirmedChangeIds=['c-mon-am']`; recovery removes the orphan and restores `liveEvents` **equal to pre-apply including event ids**; record marked `RECOVERED`. Resume-instead-of-rollback path also proven.
   - *One audit entry per mutation:* asserted for success, verify-drift failure, conflict-exhaustion failure, empty plan, and recovery; entries carry who/when/what/why/snapshotRef/rollbackRef (Contract §9.7).
4. **"Every port has a fake exercised by at least one consumer test"** — VERIFIED for all seven ports: `Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`, `MutationJournalStore` (`fakes-consumers.spec.ts` drives realistic consumer flows; ScheduleGateway/Journal additionally exercised by 10 orchestrator tests). Fakes faithfully model bound Wix behaviors: UUID-keyed idempotent creates, revision-checked updates/cancels, terminal Cancel Event (rollback re-creates under new ids with caveat notes), full-JSON snapshots incl. revisions.
5. **Runbook** — substantively satisfied; see §3 (location deviation, forced by shell scope).

## 3. Deviations from the literal task text — examined, both forced and documented

The workflow shell's integration-lane allowlist (`wix-build-loop.yml` line 185) permits only `package*.json`, `tsconfig.json`, `.gitignore`, config globs, `src/env.d.ts`, `src/platform/**`, `src/extensions/backend/**`, `tests/platform/**`. It does **not** permit `docs/**`, `src/domain/**`, or `src/shared/**` — yet NEXT_CYCLE.json items (b)/(e) name those destinations. The builder resolved this the only compliant way, staging canonical content in-lane with explicit relocation protocols:

- **Ports/DTOs:** `src/platform/contracts/{domain-ports,shared-types,shared-errors}.ts` + barrel + `README.md` specifying verbatim relocation to `src/domain/ports.ts` / `src/shared/{types,errors}.ts` (single mechanical import rewrite) during Director integration. Shapes follow Blueprint §3 exactly (`Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`; `RuleOutcome={decision,explanations}` with `{ruleId,code,customerMessage}`). Types encode Contract §4.7 correctly: local dates + timeZone for slot queries vs UTC bounds for count queries; status-inclusion policy default PENDING+CONFIRMED (§10 #8); identity key optional/UNPROVEN-flagged per C1; fail-closed CREATE/CANCEL vs fail-open RESCHEDULE encoded in `failureSemanticsFor` (§5.3). `MutationJournalStore` is a necessary addition (no §9.1/§9.7 persistence otherwise) — justified, not creep.
- **Runbook:** `src/platform/registration/T_VP0_SCAFFOLD.runbook.md` with header mandating relocation to `docs/runbooks/T_VP0_SCAFFOLD.md`. Content is execution-ready: exact ordered commands (`wix login [--api-key]`, `npm create @wix/new@latest app`, `wix dev-site`, interactive `wix generate` menu check), evidence checklist E1–E6 mapping to UQ1–UQ4/B5/M1/N4, and the fallback extension-creation path quoted verbatim from RECON §2.2 and Contract §3 (Extensions → Create Extension → Bookings → JSON `deploymentUri` + `validationTargets`; handlers via `bookingsValidation.provideHandlers()` from `@wix/bookings/service-plugins`). Doc-lag hazard (legacy-CLI links) noted. No fabricated identifiers anywhere; `siteId` is injected runtime input; the UUIDv5 namespace is an application-defined constant, explicitly not a Wix identifier.

Both stagings are correct under the ownership table (Blueprint §2: `src/domain/**` = rules lane, `src/shared/**` = Director-only) and avoid guaranteed cross-lane collisions. **Director action required at integration (binding, mechanical):** relocate the three contract files and the runbook per `src/platform/contracts/README.md`, re-point platform/test imports, and add `reports/evidence/T_VP0/` capture per the runbook when credentials exist.

## 4. Adversarial findings

### Blocking findings
None.

### Non-blocking observations (record for next-cycle hardening; do not gate integration)
1. **Terminal-state guard too narrow in the step API.** `completeApply` rejects only `APPLY_COMPLETED`; called on a `ROLLED_BACK`/`RECOVERED` record it proceeds to re-verify/re-rollback before failing. Probed live: with a frozen clock it dies on the journal's duplicate-audit-id integrity guard; with an advancing clock it would append a second `MUTATION_FAILED_ROLLED_BACK` entry for one failed run. No data corruption (rollback is idempotent), composed `applyPlan` never hits it, and nothing silent occurs — but `completeApply`/`failApply` should reject all `TERMINAL_STATES` with `INVALID_STATE`. One-line fix candidate for the next integration-lane slice.
2. **Recovery marks `RECOVERED` even when `rollback.complete=false`**, surfacing drift via summary/audit ("WITH DRIFT") rather than retrying. Honest (nothing silent) and acceptable until the real adapter exists; revisit at empirical gate T-RB1.
3. **Rollback idempotency keys derived but unused by the fake** (`deriveRollbackIdempotencyKey` is exported and unit-tested; `FakeScheduleGateway.rollbackTo` doesn't consume keys). Contract §9.6 obligation rests on the future real adapter; mechanism exists and is documented.
4. **Root tooling files** (`package.json`, `tsconfig.json`, `.gitignore`) are shared-shell surface; if another lane also emits them the Director merges. Known cross-lane mechanics, not a defect.

### Scope / safety falsification attempts (all clean)
- Business-rule logic in platform code: none — the orchestrator applies exactly the user-confirmed plan; no availability/pricing logic anywhere.
- Silent destructive rewrite: impossible by construction — baseline persist precedes any write (trace-tested), pre-apply snapshot never replaced on resume (tested), verify-before-applied enforced, rollback on drift/exhaustion tested, empty plans perform zero writes.
- Unsupported Wix assumptions: fake behaviors match Contract §4.4/§4.5 facts (one weekday per MASTER, terminal cancels, revision concurrency); no production-capability claim appears anywhere; runbook explicitly keeps plugin claims gated behind T-VP0–T-VP5.
- Secrets/identifiers: `.gitignore` blocks `.env*`/`.wix/`; no IDs, keys, or credentials committed.
- Feature creep: none beyond the justified journal port; out-of-scope items (real scaffold, SDK call sites, business rules, pricing policy) all absent.

## 5. Verdict

The candidate fully delivers INT-C1-1's substance: credential-free tooling with a proven purity gate, finalized cross-lane contract shapes (staged for mandatory Director relocation the shell forces anyway), fakes for every port with consumer coverage, a Contract-§9-compliant mutation orchestrator whose five mandated behaviors are each proven by deterministic tests including kill-the-power recovery, and an execution-ready T-VP0 runbook quoting the documented fallback verbatim. All executable checks pass with zero credentials and zero egress. The two literal-location deviations are provably forced by the workflow shell's own allowlist and carry explicit, mechanical relocation protocols; the residual findings are hardening nits that cannot corrupt state or mislead users.

**Integration conditions for the Director (mechanical, non-discretionary):**
1. Relocate `src/platform/contracts/shared-types.ts` → `src/shared/types.ts`, `shared-errors.ts` → `src/shared/errors.ts`, `domain-ports.ts` → `src/domain/ports.ts` (rewrite its `'./shared-types'` imports to `'../shared/types'`), re-point platform/test imports per `src/platform/contracts/README.md`, then re-run `npm run check`.
2. Relocate `src/platform/registration/T_VP0_SCAFFOLD.runbook.md` verbatim → `docs/runbooks/T_VP0_SCAFFOLD.md`.

VERDICT: ACCEPT