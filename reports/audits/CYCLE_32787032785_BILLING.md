# Cycle Audit — BILLING lane (run 32787032785)

- **Auditor:** lane-auditor (billing), independent.
- **Candidate:** `/tmp/wix_billing_candidate` @ `5cb33f9` ("Wix build 32787032785: billing candidate (active)"), single commit on top of the current accepted checkout `53f51d9`.
- **Task audited:** `BILL-C2-1-REPAIR` from `docs/NEXT_CYCLE.json` (mandatory repair of `BILL-C1-1`, blockers F1–F5 of `reports/audits/CYCLE_32692407760_BILLING.md`).
- **Binding references:** `docs/WIX_TECHNICAL_CONTRACT.md` §5.1/§7/§11 (C2/C3/C5), `docs/BUILD_BLUEPRINT.md` §1/§2/§6, `directives/BILLING.md`, canonical `src/domain/ports.ts` + `src/shared/types.ts`.

## 1. Diff scope and governance

Real diff (`git diff 53f51d9..5cb33f9`) is purely additive: exactly 18 files, all inside the billing lane's owned paths — `src/billing/**` (10 files) and `tests/billing/**` (8 files). Because the cycle-1 billing candidate was never integrated (its audit was FIX_BEFORE_INTEGRATION), this repair candidate re-adds the full lane with repairs applied; nothing else exists to modify.

Verified clean:
- Zero edits outside owned paths: `src/domain`, `src/platform`, `src/shared`, `src/dashboard`, `docs/**`, `.github/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `MAIN_PROMPT.md`, `directives/**`, `package.json`, `package-lock.json`, `tsconfig.json` all untouched (empty diff over those paths).
- Canonical contracts consumed, not forked: `entitlementGate.ts` imports `EntitlementGate`/`PolicyDecision` from `../../domain/ports`; the returned decision matches the canonical `{allowedLocationIds, overLimit, degraded, warning}` shape field-for-field. `src/domain/ports.ts` unchanged byte-for-byte.
- Dependency direction respected: billing imports only `domain/ports` + `shared/types` + intra-lane modules (verified by import grep). No platform imports, no UI, no real Wix calls, no trial configuration — matches the task's `out_of_scope`.
- No secrets, no GUID-like fabricated identifiers (grep clean); test plan identifiers are obviously synthetic (`prod-test-*`) and `DEFAULT_VENDOR_PRODUCT_OVERRIDES` ships empty with operator configuration documented.
- No banned-copy claims ("guarantee", "100%", "hard cap", native per-location hours, unconditional reschedule): grep clean across src/billing + tests/billing.
- Test files renamed `*.test.ts` → `*.spec.ts` to match the accepted repo vitest config (`tests/**/*.spec.ts`) now that repo tooling is mounted; mapping documented in `src/billing/README.md`. Correct adaptation, not a red flag.

## 2. Executable checks actually run (explicit, not hand-waved)

The candidate worktree contains the accepted repo tooling (package.json, tsconfig strict + `noUncheckedIndexedAccess`, vitest config), so checks ran in-place:

1. `npx vitest run tests/billing` → **8 files, 51 passed / 0 failed / 0 skipped** (verbose run inspected: no `.skip`/`.todo`/`.only` anywhere in tests/billing).
2. Full gate `npm run check` → **typecheck + purity + 84/84 tests green** (51 billing + 33 platform; the mid-run "PURITY GATE FAILED" console lines are the platform lane's own adversarial negative-test fixture asserting the scanner detects injected violations — the overall run passes).
3. `npx tsc --noEmit` under the repo's strict config → **exit 0** (covers `src/billing/**` + `tests/billing/**` plus the rest of the repo).
4. Purity greps: zero `@wix/` occurrences anywhere under `src/billing/**` (not just pure/counter).
5. Adversarial regression proof for F1 (scratch copy at `/tmp/opencode/billing-f1-scratch`, candidate untouched): restored the cycle-1 buggy line (`countBillableLocations(locationPages as never, servicePages as never)` passing wrapper objects) → the F1 crash-repro test fails with exactly the audited `TypeError: locationPages is not iterable` (4 driver tests fail). The fix is real and the test has teeth.
6. Independent recomputation of the F2 fixture arithmetic (node): A={i<100}, B={(7i) mod 130, i<100}, C={(11i) mod 130, i<30} ⇒ |A∩B|=78, |A∩C|=25, |B∩C|=23, |A∩B∩C|=19, union = **123 distinct ids** — matching both the test's derivation comment and its programmatic pin (`expect(expectedIds).toHaveLength(123)` computed from the actual fixture construction).

## 3. Blocking-finding repair verification (F1–F5)

| Finding | Repair evidence | Status |
|---|---|---|
| **F1** wrapper-object crash + TS2345 | `countFromAdapters.ts:71-76` destructures into `locationCollected`/`serviceCollected` and passes `.pages` arrays; documented in module docstring. Crash-repro test green on candidate, red with the exact audited TypeError when the bug is reintroduced (check 5 above). | ✅ REPAIRED |
| **F2** impossible 130-vs-123 assertion | Test pinned to the provable 123 with a full inclusion–exclusion derivation comment; derivation independently recomputed (check 6 above); programmatic pin fails loudly if the fixture drifts. | ✅ REPAIRED |
| **F3** runaway fixture never counted calls | Counter incremented inside `fetchPage` (`fixture.calls += 1`, counterAdapters.spec.ts:167); assertion `runaway.calls === MAX_PAGES_PER_SOURCE` now observes the adapter the driver actually drove; guard fires after exactly 10,000 fetches. | ✅ REPAIRED |
| **F4** missing type import (TS2552) | `BillingPagingAdapter` imported from `./ports` (counterAdapters.spec.ts:14); tsc clean. | ✅ REPAIRED |
| **F5** invalid cast (TS2352) | The invalid direct cast was removed entirely (tests use typed assertions instead of either suggested workaround) — satisfies the underlying gate: `tsc --noEmit` exit 0. | ✅ REPAIRED |

Non-blocking observation 1 from the prior audit (throw-vs-null semantics handoff) is also implemented: `counter/ports.ts` docstring states adapters MUST throw on infrastructure failure and may return `null` only when Wix genuinely reports no more data, with the paying-merchant-silently-free hazard spelled out; a dedicated test proves infrastructure failures propagate instead of being swallowed into a null snapshot.

## 4. Acceptance-criteria scorecard (BILL-C2-1-REPAIR)

| Criterion | Status |
|---|---|
| countFromAdapters drains multi-page adapters, correct billable count, crash repro green | ✅ PASS (incl. adversarial bug-reintroduction proof) |
| `npx vitest run` 51/51, zero skips; tsc --noEmit strict clean over src/billing + tests/billing | ✅ PASS (51 passed/0 skipped; tsc exit 0; full `npm run check` 84/84) |
| Runaway-guard test asserts calls === MAX_PAGES_PER_SOURCE with a counting fixture | ✅ PASS |
| Zero `@wix/` imports under src/billing/pure/** + counter core; scope limited to src/billing/** + tests/billing/** | ✅ PASS (grep clean across entire lane; purity suite scans whole tree + negative-injection check has teeth; diff touches only owned paths) |
| Paging-port docstring: throw-on-infrastructure-failure / null-only-when-genuinely-absent | ✅ PASS |
| Fresh independent lane audit ends VERDICT: ACCEPT | ✅ THIS AUDIT |

## 5. Contract/directive conformance spot-checks

- **Tier table:** exactly four contract plans (9.99/19.99/34.99/49.99 USD monthly) + free; labels ≤23 chars; a structural test forbids any per-tier key beyond identity/label/price/allowance — feature parity across tiers is enforced by test, per directives/BILLING.md.
- **Billable-location definition (§7):** liveness = `archived=false` (never `status`), BUSINESS-type service cross-reference connectivity (Invariant C3), non-hidden-service policy v1, distinct-set dedup, floor 0→1 bumping only `count` while `billableLocationIds` stays truthful. All asserted by dedicated tests including archived-despite-ACTIVE-reference, hidden-service exclusion, CUSTOM-only floor, cross-page duplicates, malformed refs.
- **Fail-open posture (§7/§11 C5):** billing/listing/counting failures produce degraded decisions + persisted ledger warnings; recovery clears transient codes; UNKNOWN_PLAN_IDENTIFIER persists across gate instances sharing a ledger and a healthy known-plan cycle does not clear it. Meter degrades to `{count: null, degraded: true}` rather than throwing.
- **Unknown paid identifier:** TIER_1 (under-serve) + persistent warning + `restrictionReliable:false` — the directive's "fail safely … rather than silently over-serving".
- **Downgrade/over-limit:** stable default-first-then-alphabetical ordering; excess locations become `unmanagedLocationIds` (management disabled, configuration preserved, upgrade CTA state); determinism/non-mutation proven over 50 shuffled runs on frozen inputs; no deletion path exists.
- **C2 advisory-only expiration:** `billingExpirationDate` never read by resolution logic; dunning-window and future-expiry-with-isFree=true branches tested both ways.

## 6. Non-blocking observations (for Director / future cycles)

1. **Stale-warning liveness nuance:** if billing recovers while listing is still failing, the early-return degraded path skips `clear('BILLING_API_FAILURE')`, so that warning can linger until the next fully healthy `allowedLocationIds()` call. Advisory dashboard signal only; heals on recovery (tested); no enforcement or safety impact. Fine to leave.
2. `FAIL_OPEN_RESOLUTION.tier = 'TIER_11_PLUS'` is a placeholder whose `tier` is documented as never consumed (only `maxLocations` is read on that branch). Documented; acceptable, but a future refactor could make it an explicit `null` tier.
3. Healthy-path coverage consumes `listManagedLocations()` while the meter shows `countBillableLocations()`; consistency between the two remains an integration-adapter responsibility (carried from prior audit observation 4 — unchanged disposition).

## 7. Verdict rationale

Every blocking finding F1–F5 is repaired with genuine, adversarially verified regression coverage; the required non-blocking docstring handoff landed; all executable gates pass in-place (51/51 billing, 84/84 full suite, strict typecheck clean, purity green with teeth); scope discipline is perfect; canonical contracts are consumed verbatim without fork; and the lane implements exactly the assigned repair with zero feature creep. The paging-driver handoff surface the Integration lane will back now works, terminates safely under runaway pagination, and propagates infrastructure failures per the ratified fail-open posture.

VERDICT: ACCEPT
