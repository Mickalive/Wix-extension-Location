# Cycle Audit — BILLING lane (run 32792897988)

- **Auditor:** lane-auditor (billing), independent.
- **Candidate:** `/tmp/wix_billing_candidate` @ `4e57e8a` ("Wix build 32792897988: billing candidate (active)"), single commit on top of the current accepted checkout `108b9ae` (verified identical parent).
- **Task audited:** `BILL-C3-1` from `docs/NEXT_CYCLE.json` — plan-state projection & reconciliation machine (Contract §7 lifecycle; Blueprint §4 flow 5), folding accepted-audit observations 1–2 of `reports/audits/CYCLE_32787032785_BILLING.md`.
- **Binding references:** `docs/WIX_TECHNICAL_CONTRACT.md` §5.2/§6/§7/§11 (C2/C5), `docs/BUILD_BLUEPRINT.md` §1/§2/§4 flow 5/§6, `directives/BILLING.md`, canonical `src/domain/ports.ts` + `src/shared/types.ts`.

## 1. Diff scope and governance

Real diff (`git diff 108b9ae..4e57e8a`) touches exactly 9 files, all inside the billing lane's owned paths: `src/billing/**` (6 files: new `projection/{types,fold,projector,snapshotSource}.ts`, modified `enforcement/entitlementGate.ts`, updated `README.md`) and `tests/billing/**` (3 files: new `projection.spec.ts`, `projectionSnapshotSource.spec.ts`; extended `entitlementGate.spec.ts`). Verified empty diff over every other path including `src/domain`, `src/shared`, `src/platform`, `src/ui`, `docs/**`, `.github/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `MAIN_PROMPT.md`, `directives/**`, `package.json`, `package-lock.json`, `tsconfig.json`.

Verified clean:
- Canonical contracts consumed unforked: `src/domain/ports.ts`, `src/shared/types.ts`, `src/shared/errors.ts` byte-for-byte unchanged; `resolveFromPlanView` calls the accepted `resolveEntitlement` decision table verbatim (no parallel recognition logic); `projectedSnapshotSource` returns exactly the gate's own `BillingInstancePort` interface.
- Purity: zero `@wix/` occurrences anywhere under `src/billing/**` (grep clean); no I/O, clock, or network in the projection modules; `receivedAt` and expiration dates are structurally never consulted by transitions (Invariant C2 honored at the plan-view layer).
- No secrets; no fabricated Wix identifiers (fixtures are obviously synthetic `prod-test-*`, `inst-*`, `evt-*`); no banned-copy claims ("guarantee", "100%", "hard cap", native per-location hours, unconditional reschedule — grep clean across src/billing + tests/billing).
- No `.skip`/`.only`/`.todo` anywhere in tests/billing; no weakening of existing suites (prior 51 tests untouched except additive gate describe-block).
- Platform-owned vitest glob (`tests/**/*.spec.ts`) untouched; both new suites collected through it (30 files ran in the full gate).
- Worktree restored clean after my scratch adversarial spec was removed (`git status` clean; candidate tracked content untouched by me).

## 2. Executable checks actually run (explicit, not hand-waved)

All executed inside the candidate worktree (repo tooling mounted):

1. `npx vitest run tests/billing` → **10 files, 88 passed / 0 failed / 0 skipped** (51 baseline from BILL-C2-1-REPAIR + 37 new: 29 projection + 5 snapshot-source port + 3 observation-fold gate tests — matches the README's stated arithmetic exactly).
2. Full gate `npm run check` (= `tsc --noEmit && node src/platform/purity/check-purity.mjs && vitest run --config src/platform/vitest.config.ts`) → **293/293 tests green** across domain/platform/billing. The mid-run "PURITY GATE FAILED" console lines are the platform lane's own adversarial negative-test fixture asserting the scanner detects injected violations (documented since cycle 2); the overall command exits success.
3. `npx tsc --noEmit` standalone → exit 0 (strict config incl. `noUncheckedIndexedAccess`).
4. Purity grep: zero `@wix/` imports under `src/billing/**`.
5. **Independent adversarial reproduction (auditor-written scratch spec, not candidate code):**
   - A1: 300 seeded chaotic runs over a 5-event generation mixing numeric/string/null/missing `entityEventSequence`, immediate replays, late replays, and shuffled arrival orders → **identical JSON projection in every run** (convergence property holds under my independently generated chaos; my initial expectation about the final `autoRenewCancelled` marker was wrong, not the code — seq-null cancellation ranks oldest and later purchases legitimately re-enable renewal, exactly as the fold documents).
   - A2: replaying a stale pre-snapshot purchase AFTER `{isFree:true}` reconciliation returns `DUPLICATE` and cannot resurrect paid state (dedup memory survives snapshots).
   - A3: cancellation marker survives a `null`-snapshot reconciliation while the tier follows the accepted table to FREE (marker never flips tiers alone).
   - A4: scoped projector ignores foreign-`instanceId` events (`FOREIGN_INSTANCE`) while applying unscoped deliveries.
   - A5: blank-id envelope, unknown event type, and array snapshot are all rejected with TypeError BEFORE any state mutation (projection byte-identical after the rejected calls).
   - B1: independent gate repro of observation 1 — billing fails then heals while listing fails → `BILLING_API_FAILURE` cleared, `LOCATION_LISTING_FAILURE` recorded, decision degraded (per-source liveness proven outside the candidate's own fixtures).
   - B2: `projectedSnapshotSource(projector)` feeds `createEntitlementGate`; a purchase webhook between periodic polls grants TIER_2_3 coverage immediately (flow 5 → flow 1 handoff works without importing webhook types).

## 3. Task-subitem verification (a–e)

| Sub-item | Evidence | Status |
|---|---|---|
| (a) deterministic projection ingesting webhook EVENTS (Paid Plan Purchased, Auto Renewal Cancelled, App Installation Created/Updated — envelope semantics only) + Get App Instance SNAPSHOTS → current entitlement state | `projection/types.ts` (envelope/payload shapes, transport explicitly out of scope), `fold.ts` transitions, `projector.ts` state machine; 29-test suite | ✅ |
| (b) reconciliation supremacy: snapshot overrides event-derived state; out-of-order/duplicated/replayed events converge idempotently | Snapshot clears generation buffer but NOT dedup memory ("snapshot beats stale events", tested both directions); `(entityEventSequence, id)` total-order fold; 50-seeded-shuffle determinism test + my 300-run chaos repro | ✅ |
| (c) §7 lifecycle branches both ways | cancelled-until-expiry keeps paid identifiers (event way + confirming-snapshot way); dunning window stays PAID / future-date+isFree:true stays FREE; downgrade ONLY at period end given confirming snapshot; trial→paid conversion discoverable ONLY via reconciliation (negative proof included); clone markers never leak (foreign-instance isolation + markers grant nothing); UNKNOWN_PLAN_IDENTIFIER persists until operator mapping | ✅ |
| (d) fold observation 1 (per-source warning liveness) and observation 2 (explicit null fail-open tier) | Gate restructured: `clear('BILLING_API_FAILURE')` no longer skipped when listing fails; `FAIL_OPEN_RESOLUTION.tier === null` typed as `FailOpenResolution` (frozen sentinel), `GateResolution` discriminated union forces narrowing — billing-failed branch consumes only `maxLocations`; three dedicated regression tests + my independent B1 repro | ✅ |
| (e) narrow port exposing projection as gate snapshot source without webhook-type imports | `snapshotSource.ts` returns the canonical `BillingInstancePort`; compile-checked assignment in tests; README documents the exact INT-C3-1 wiring | ✅ |

## 4. Acceptance-criteria scorecard (BILL-C3-1)

| Criterion | Status |
|---|---|
| Projection tests prove snapshot-beats-stale-events; duplicate/out-of-order/replayed convergence idempotent; every §7 lifecycle branch asserted both ways | ✅ PASS (+ independent 300-run chaos repro) |
| Warning-liveness test proves BILLING_API_FAILURE clears on billing recovery even while listing still fails | ✅ PASS (+ independent repro) |
| FAIL_OPEN_RESOLUTION tier placeholder resolved (explicit null tier) | ✅ PASS (typed `null`, frozen, misuse forbidden by type system, tested) |
| `npx vitest run` green (51 baseline + new), `tsc --noEmit` strict clean, purity gate green (zero `@wix/` under src/billing) | ✅ PASS (88/88 billing; 293/293 full; tsc exit 0) |
| Scope limited to src/billing/** + tests/billing/**; canonical shared/domain shapes consumed unforked | ✅ PASS (9-file diff verified; ports.ts byte-for-byte identical) |
| Fresh independent lane audit ends VERDICT: ACCEPT | ✅ THIS AUDIT |

## 5. Contract/directive conformance spot-checks

- **§7 plan identification:** missing/empty identifier ⇒ FREE even when a purchase event asserts paid-holding (merge discipline: absent values never clobber; decision table still governs); trial signup counts as paid via mapped identifier; `billingExpirationDate` never consulted (C2) — dunning/expiry driven exclusively by snapshot `isFree`, tested both ways.
- **§7 lifecycle:** auto-renewal cancellation writes ONLY the durable marker (never downgrades); new purchase re-enables renewal; downgrades happen exclusively through confirming snapshots — matching "no mid-cycle downgrade path exists".
- **Fail-open posture (§7/C5):** gate behavior on infrastructure failure unchanged (degraded decisions, persisted warnings, unlimited fail-open coverage); observation-1 fold strictly improves warning liveness without altering enforcement semantics; meter posture untouched.
- **Directive fail-safe:** unknown paid identifier still under-serves (TIER_1) with persistent warning and `restrictionReliable:false`; over-limit preserves configuration (stable default-first ordering, no deletion path introduced).
- **No scope creep:** no pricing-page UI, no real Wix transport, no tier feature differences beyond location count, no trial numerics (UQ5 respected), no edits outside owned paths.

## 6. Non-blocking observations (for Director / future cycles)

1. **Docstring overstatement:** `projection/types.ts` claims payload types "deliberately carry NO expiration fields," but `InstallationBillingPayload` aliases `AppInstanceBillingSnapshot`, whose optional `billingExpirationDate` therefore can ride along in an installation payload. No transition ever reads it and the rendered snapshot omits it, so C2 holds in behavior; tighten the wording in a future docs-only pass.
2. **Unbounded dedup memory:** `seenEventIds` grows for the projector's lifetime. Correct for the pure core; the Integration lane should define retention/compaction when wiring long-lived serverless processes (INT-C3-1 concern, record at integration).
3. **Rendered-shape fidelity:** `currentSnapshot()` renders only `{isFree, vendorProductId, packageName}` on post-snapshot refinement, dropping advisory/trial/clone fields (intentional, resolver never reads them) and potentially `packageName` carried only by an earlier snapshot — affects only unknown-plan warning message text, never tier or coverage.
4. **Labeling nuance:** a never-reconciled, zero-event projector reports `source:'EVENT_DERIVED'` (nothing derived yet). Cosmetic; initial FREE default is conservative and documented.

None of these blocks integration; none hides a silent failure, destructive path, entitlement bypass, or unsupported platform assumption.

## 7. Verdict rationale

The candidate delivers exactly BILL-C3-1: a pure, Wix-import-free, deterministic plan-state projection and reconciliation machine whose supremacy/idempotency/isolation properties survived independent adversarial chaos testing beyond its own suite; both accepted-audit observations folded with genuine regression coverage; and the narrow port the Integration lane's enforcement task requires, exposed through canonical shapes only. All executable gates pass in place (88/88 billing, 293/293 full, strict typecheck clean, purity green), scope discipline is exact, canonical contracts are consumed unforked, and no unsupported Wix assumption, production-capability claim, silent failure, or cross-lane edit exists.

VERDICT: ACCEPT
