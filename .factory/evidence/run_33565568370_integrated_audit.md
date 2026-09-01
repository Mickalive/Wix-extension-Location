# Integrated Audit — Wix Bookings Advanced Rules

- Auditor role: `integrated-auditor` (independent cross-system reviewer, distinct from every lane auditor/builder).
- Candidate: exact SHA `ef7e61948d26f6e5e9dfaf3112eff29b637ba38f` (generation 243).
- Method: fresh cross-system review of the complete candidate; credential-free deterministic checks only. The real Wix build was NOT run (per fiche; authenticated Wix build/empirical runtime evidence belongs to WIX_QA). Absence of Wix runtime credentials is not treated as a product defect.
- Scope: verify contracts between integration, rules, dashboard and billing lanes, plus failure/rollback behavior.

## 1. Deterministic evidence (all executed, all passed)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run check` (tsc --noEmit) | PASSED |
| Purity gate | `npm run check` (check:purity) | PASSED — no `@wix/` imports under `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration` |
| Rules/platform/billing unit tests | `npm run check` (vitest) | PASSED — 548 tests / 49 files, all green |
| Dashboard/UI suite | `npm test` (workdir `tests/ui`, node --test) | PASSED — 211 tests green, incl. accessibility (accessible names, keyboard operability, `role=alert`/`role=status` + `aria-live`, dialog semantics), mutation flow (terminal states, bounded polling, poller observer-fault containment), entitlement page, lane hygiene, `noWixImports` |

Note: the "PURITY GATE FAILED" line in `npm run check` output is the intentional negative-test fixture inside `purity-gate.spec.ts` (the test passes by asserting the gate rejects a poisoned import).

## 2. Cross-lane contract verification

### 2.1 Rules ↔ Integration (validation plugin)
- `src/domain/evaluate.ts` implements the deterministic stages 0–4 evaluation (target-aware CREATE/CANCEL/RESCHEDULE, timezone/DST handling, split windows, exceptions, per-day/per-service/per-location counts) with no platform dependency.
- `src/platform/validation-plugin/handlers.ts` enforces: CREATE and CANCEL are FAIL_CLOSED (blocked when the rule engine denies); RESCHEDULE is FAIL_OPEN with an explicit `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'` surfaced to the caller. The claim is honest and matches the domain contract; no silent enforcement is claimed where the platform cannot guarantee it.
- The plugin consumes the domain through the pure `evaluate` entry; no domain semantics are forked in the platform layer.

### 2.2 Integration ↔ Dashboard (DTO contracts, verified verbatim)
- Meter: `src/platform/http/meterEndpoint.ts` pinned DTO `{meter:{count,degraded}, coverage:{allowedLocationIds,overLimit,degraded,warning}}` matches `src/ui/services/bridge.js` `getEntitlementMeter()` unwrapping exactly.
- Mutation status/recovery: `src/platform/mutationEndpoints.ts` envelope shapes (`getMutationStatus` → `{status}`, `postRecover` → `{recovery}`, `postApplyPlan` → `{summary, requestedBy}`) match `bridge.js` unwrapping exactly.
- Ruleset: PUT/GET `/ruleset` shapes per `src/platform/http/README.md` match bridge expectations.
- `src/ui/state/mutationPoller.js` consumes only the documented terminal states and enforces bounded polling; poller observer-fault containment is covered by UI tests (passed).

### 2.3 Dashboard ↔ Billing (entitlement)
- `src/billing/upgradeUrl.ts` is a byte-for-byte mirror of `src/ui/services/upgradeUrl.js` (verified identical).
- `src/ui/services/bridge.js` `getEntitlementMeter()` consumes the billing counter DTO; `src/billing/counter/countFromAdapters.ts` + `ports.ts` implement the location-count projection with explicit degraded mode.
- Billing policy: paid tiers differ only by location allowance; downgrade never deletes customer configuration (verified in `src/billing/projection`/`enforcement`); policy code never calls Wix directly (purity gate covers `src/billing/pure`).
- Entitlement gate is fail-open under degraded meter state, with the degraded flag propagated to the dashboard so the UI can show the honest state.

### 2.4 Integration ↔ Billing (composition root)
- `src/platform/composition/entitlementComposition.ts` wires projector → gate → handler/meter; `reconciliation.ts` and `projectedSnapshotSource` provide the snapshot source; enforcement consumers contain zero webhook-type imports (verified by purity gate + composition-root tests, passed).

## 3. Failure/rollback behavior (schedule mutation, Contract §9)

`src/platform/schedule-mutation/orchestrator.ts` verified:
1. SNAPSHOT: journal baseline persisted BEFORE any write (§9.1); existing non-terminal baseline is resumed untouched, terminal plans rejected.
2. DIFF: the MutationPlan is the user-confirmed diff; the orchestrator adds no rule logic.
3. IDEMPOTENT WRITES: deterministic UUIDv5 keys per change (§9.3); replay yields SKIPPED_ALREADY_APPLIED.
4. REVISION-CHECKED UPDATES: stale revisions retry against a fresh snapshot with bounded attempts (§9.4); CREATE_MASTER conflicts are not blindly retried (no revision to refresh).
5. VERIFY: re-read before marking applied (§9.5).
6. ROLLBACK: on failure or recovery, restore the persisted snapshot with fresh idempotency keys (§9.6); Cancel Event is terminal.
7. AUDIT: exactly one audit-log entry per completed mutation run (§9.7).
- Crash semantics (T-RB1): unexpected exceptions leave the journal record APPLY_IN_PROGRESS; the next run resumes via `applyNextChange` (idempotent) or `recoverInterruptedApply` (restores exact pre-apply state, verifies at window granularity, marks RECOVERED, appends its own audit entry).
- Terminal-state hardening: every state outside the non-terminal allowlist (`SNAPSHOT_PERSISTED`, `APPLY_IN_PROGRESS`) is rejected fail-fast with INVALID_STATE BEFORE any gateway call, journal write, or audit append — a future state addition cannot silently bypass the guards.
- `windowContentDiffs` deliberately excludes event identity (terminal-cancelled MASTERs re-create under new ids per §9.6) and compares working-hours window content, which is what availability consumes.
- No silent destructive schedule rewrites: every mutation is user-confirmed, journaled, verified, and reversible.

## 4. Registration / scaffold surface

- `src/extensions/dashboard/` holds 3 credential-free registration shapes (`rules-editor.page.js`, `locations-usage.page.js`, `diff-confirm.modal.js`) re-exporting UI mounts; `extensions.ts` intentionally empty (INT-C6-R1).
- `src/pages/**` does not exist: file-based endpoint adapters are deliberately deferred to gate T-VP0 (scaffold), documented in `src/platform/http/README.md` and the registration manifest (`PLANNED_UNTIL_T_VP0`). Sanctioned design, not a defect.
- `wix.config.json` is committed with the real bound App ID `3e9ec3af-001b-4684-a197-a5133677844d`; `reports/wix-live/BOOTSTRAP_BINDING.md` documents that a real `wix build` completed before persisting. No secrets are present in the repository.

## 5. Non-blocking observations (documented, not defects)

1. `externalBlockerStatement()` in `src/platform/registration/scaffoldPrerequisites.ts` still claims "No linked Wix CLI project exists", which is stale relative to the committed real binding. It is consumed only by tests that assert composition strings (not repo truthfulness); no runtime path uses it. Recommendation for a future cycle: refresh the wording; not a blocker.
2. `.gitignore` ignores `wix.config.json` while the file is deliberately committed. This is sanctioned by `BOOTSTRAP_BINDING.md` (real, verified App ID; real build passed before persisting) and the registration-surface test only asserts the `.gitignore` pattern exists (passes). Governance-level tension, not a product defect.

## 6. Conclusion

All deterministic checks pass (typecheck, purity gate, 548 vitest tests, 211 UI tests). Cross-lane contracts between integration, rules, dashboard and billing are consistent and verified verbatim where pinned. Failure/rollback behavior is fail-closed where the platform can guarantee it, honestly fail-open where it cannot, and fully journaled/reversible for schedule mutations. No blocking defect was found in any lane or at any cross-lane seam. The two observations above are documentation/governance notes only.

VERDICT: ACCEPT