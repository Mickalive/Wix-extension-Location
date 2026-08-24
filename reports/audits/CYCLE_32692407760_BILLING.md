# Persisted recovery audit — BILLING, cycle 32692407760

Original independent verdict: `FIX_BEFORE_INTEGRATION`.

Mandatory repairs before new feature work:

1. `src/billing/counter/countFromAdapters.ts`: `collectAllPages()` returns `{pages,pageCount}` but wrapper objects are passed to `countBillableLocations`, causing `TypeError: locationPages is not iterable` and TS2345. Pass `.pages` arrays.
2. Pagination fixture/test hardcodes 130 distinct ids although its modulo pattern produces 123. Correct expected value with derivation or redesign fixture to cover 130.
3. Runaway-adapter test never increments `calls`, so its assertion can never pass. Fix fixture counter while retaining the safety-limit assertion.
4. `tests/billing/counterAdapters.test.ts` uses `BillingPagingAdapter<T>` without importing that type. Add the import.
5. `tests/billing/coverage.test.ts` uses an invalid strict cast to `Record<string, unknown>`; cast via `unknown` or use typed `Object.keys`.

Re-audit acceptance proof required: full billing suite 51/51 green plus strict `tsc --noEmit` clean for billing source/tests. Preserve the already-verified good behavior: >50/>100 pagination core, dedup, archived/hidden filtering, plan-state decision table, stable over-limit ordering, fail-open with persistent warning, purity, and exact upgrade URL.

Integration handoff note: adapters must throw on billing infrastructure failure and return `null` only when Wix genuinely reports no billing data; otherwise a paying merchant could be silently restricted.

Source of truth remains immutable branch `cycle/wix-build/32692407760/audit-billing`.

VERDICT: FIX_BEFORE_INTEGRATION
