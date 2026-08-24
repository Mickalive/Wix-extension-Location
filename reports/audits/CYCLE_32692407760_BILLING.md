# Cycle Audit — BILLING lane (run 32692407760)

- **Auditor:** lane-auditor (billing), independent.
- **Candidate:** `/tmp/wix_billing_candidate` @ `e57569e` ("Wix build 32692407760: billing candidate"), based on accepted `12071a5`.
- **Task audited:** `BILL-C1-1` from `docs/NEXT_CYCLE.json` (billable-location counter + entitlement engine).
- **Binding references:** `docs/WIX_TECHNICAL_CONTRACT.md` §7/§11 (C2/C3/C5), `docs/BUILD_BLUEPRINT.md` §1/§2/§6, `directives/BILLING.md`.

## 1. Diff scope and governance

Real diff (`git diff 12071a5 --name-only`) touches exactly 18 files, all inside the billing lane's owned paths:

- `src/billing/**` (10 files: types, counter core + ports + driver, pure tiers/entitlement/coverage, enforcement gate, upgrade URL/warnings, README)
- `tests/billing/**` (8 files)

Verified clean:
- No edits to `MAIN_PROMPT.md`, `.github/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `directives/**`, `docs/**`, or any other lane's paths (`src/domain`, `src/platform`, `src/dashboard`, `src/shared` untouched — correct, since `src/shared/**` is Director-only and tooling is INT-C1-1's deliverable).
- No secrets, no fabricated Wix identifiers (vendorProductId override table is operator-configured and empty by default; test IDs are obvious fixtures).
- No real Wix API calls, no pricing-page UI, no trial configuration — matches the task's `out_of_scope`.
- No PREVIEW_GATED/UNSUPPORTED mechanisms; no production-capability claims in code or docs.

## 2. Executable checks actually run (explicit, not hand-waved)

The candidate contains **no** `package.json`, `tsconfig.json`, or Vitest config. Per `docs/NEXT_CYCLE.json`, project tooling (`npm run test:unit`) is item (a) of **INT-C1-1** (integration lane), so its absence here is not a billing-lane defect and adding it would have collided with integration-lane ownership. To avoid an unexecutable audit, I provisioned an auditor harness at `/tmp/opencode/billing-audit-harness` (vitest@3.2.4, typescript@5.9.2, @types/node@24.3.0), copied the candidate's `src/` and `tests/` **verbatim**, and ran:

1. `npx vitest run` (all 7 candidate test files) → **48 passed / 3 failed (51 total)**; all failures in `tests/billing/counterAdapters.test.ts`.
2. `npx tsc --noEmit` with plain `strict: true` → **3 errors** (details in findings F1/F4/F5). The Blueprint §6 global CI gate explicitly includes typecheck.
3. Adversarial purity negative check (scratch copy only): injected `import { something } from '@wix/services'` into `src/billing/pure/tiers.ts` → both purity tests **fail as designed**. The gate has teeth.
4. Root-cause confirmation (scratch copy only): a one-line fix to F1 turns the suite to 49/51, leaving exactly the two test-fixture defects F2/F3 — proving the inventory below is complete and the algorithm itself is sound.

## 3. Acceptance-criteria scorecard (BILL-C1-1)

| Criterion | Status |
|---|---|
| Pagination >50 locations / >100 services, dedup, archived-excluded-despite-ACTIVE, hidden-service exclusion, CUSTOM-only floor | ✅ PASS (`counter.test.ts`, 13 green incl. 130-location × 50/50/30 pages and 250-service × 100/100/50 pages) |
| Entitlement decision table (isFree, trial IN_PROGRESS paid, expired-but-isFree=false dunning, cancelled-until-expiry, isFree-after-expiry→free, clone independence) | ✅ PASS (`entitlement.test.ts`, 12 green; C2 advisory-only expiration honored) |
| Over-limit ordering stable (default first, then alphabetical id); no deletion path | ✅ PASS (`coverage.test.ts`: 50 repeated runs over reversed copies, inputs deep-frozen-equal, result exposes no function keys) |
| Billing/count failure ⇒ fail-open AND raised persistent warning, never silent | ✅ PASS (`entitlementGate.test.ts`: billing failure, count failure, listing failure, recovery-clears, shared-ledger persistence) |
| Zero `@wix/` imports under `src/billing/pure/**` + counter core | ✅ PASS (grep clean; lane purity test green; negative injection check fails correctly) |
| Upgrade URL byte-exact `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` | ✅ PASS (`upgradeUrl.test.ts`) |
| Implicit gate: lane's own tests pass + typecheck (Blueprint §6) | ❌ **FAIL** — findings F1–F5 below |

## 4. Blocking findings

### F1 — Adapter driver crashes on every invocation and fails typecheck (src bug)
`src/billing/counter/countFromAdapters.ts:50-54`. `collectAllPages()` returns `{ pages, pageCount }`, but the results are destructured positionally and the **wrapper objects** are passed to the pure core:

```ts
const [locationPages, servicePages] = await Promise.all([
  collectAllPages(locations),
  collectAllPages(services),
]);
return countBillableLocations(locationPages, servicePages); // passes {pages,pageCount}, not arrays
```

Runtime effect: `TypeError: locationPages is not iterable` from `countBillableLocations` (reproduced on both "drains multi-page adapters…" and "handles empty first pages…"). Type effect: `error TS2345` under plain `strict: true`. This is the exact handoff surface the integration lane will back with paginated `listLocations`/`queryServices`, so it must work.
**Fix:** `return countBillableLocations(locationPages.pages, servicePages.pages);` (verified in scratch harness: crash disappears).

### F2 — Impossible assertion: fixture yields 123 distinct ids, test demands 130
`tests/billing/counterAdapters.test.ts:67` expects `result.count === 130`, but the fixture's modulo patterns reference only **123** distinct location ids (verified: `{0..99} ∪ {7i mod 130, i<100} ∪ {11i mod 130, i<30}` has size 123). The preceding `expect(result).toEqual(plain)` passes, so the algorithm is consistent — the hardcoded constant is wrong. After F1's fix this test still fails (49/51 state).
**Fix:** either assert `123` (with a comment deriving it) or redesign the reference patterns to provably cover all 130 ids.

### F3 — Runaway-adapter negative test can never pass
`tests/billing/counterAdapters.test.ts:88-97`: the `runaway` fixture's `fetchPage` never increments `calls`, yet line 96 asserts `expect(runaway.calls).toBe(MAX_PAGES_PER_SOURCE)` (observed 0 vs 10000). The safety guard itself works (`BillingPagingError` rejection assertion passes).
**Fix:** increment `calls` inside the fixture's `fetchPage` (e.g., `this.calls += 1` via a closure counter).

### F4 — Missing type import breaks typecheck
`tests/billing/counterAdapters.test.ts:16` uses `BillingPagingAdapter<T>` but imports only `FetchedPage` from `./ports` → `error TS2552` under any config. Vitest's transpile-only run hides it; `tsc --noEmit` (Blueprint global gate) does not.
**Fix:** add `BillingPagingAdapter` to the type import from `../../src/billing/counter/ports`.

### F5 — Invalid cast breaks typecheck
`tests/billing/coverage.test.ts:65`: `result as Record<string, unknown>` → `error TS2352` under `strict: true` (interface without index signature cannot cast directly).
**Fix:** `result as unknown as Record<string, unknown>`, or iterate `Object.keys(result)` with explicit typing.

## 5. Non-blocking observations (for the repair cycle / Director)

1. **Null-snapshot semantics handoff:** `resolveEntitlement(null)` ⇒ FREE with `restrictionReliable: true` and *no warning*. That is correctly conservative for a genuinely absent billing section, but if a future integration adapter swallows a transport error and returns `null`, a paying merchant would be silently restricted. Integration-lane contract note: adapters must **throw** on infrastructure failure; return `null` only when Wix genuinely reports no billing data. Worth one sentence in the ports docstring during repair.
2. Free tier `maxLocations = 1` is a lane judgment consistent with the single-location floor and "never destroy user data"; documented in `src/billing/README.md`. Accepted.
3. Unknown-paid-identifier policy (tier_1 + persistent `UNKNOWN_PLAN_IDENTIFIER` warning) satisfies `directives/BILLING.md`'s "fail safely … rather than silently over-serving". Accepted.
4. Healthy-path coverage selection consumes `listManagedLocations()` while the meter shows `countBillableLocations()`; consistency between the two is an integration-adapter responsibility. No action needed this cycle.

## 6. Verdict rationale

The ratified counting algorithm, entitlement decision table, coverage ordering, fail-open posture, warning ledger, and upgrade URL are all correctly implemented and well tested (48 green tests, purity verified including adversarial negative check, perfect scope discipline). However, the lane's paging-driver entry point — the precise surface handed to the integration lane — crashes on every call and fails typecheck, and three of its own tests are red for src + fixture reasons. Blueprint §6 makes typecheck part of the mandatory CI gate, and acceptance requires these pagination tests to pass. All five findings are precise, same-cluster, and trivially reproducible, so this returns to the billing builder for repair rather than a rebuild.

**Required repairs before re-audit:** F1, F2, F3, F4, F5 (plus regression proof that `npx vitest run` is 51/51 and `tsc --noEmit` strict is clean for `src/billing/**` + `tests/billing/**`).

VERDICT: FIX_BEFORE_INTEGRATION