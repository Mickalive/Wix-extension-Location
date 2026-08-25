# Billing & Entitlements Lane

Owner: billing-builder (`directives/BILLING.md`). Binding truth:
`docs/WIX_TECHNICAL_CONTRACT.md` §5.1/§7/§11 (C2/C3/C5), `docs/BUILD_BLUEPRINT.md`
§1/§2/§6. Current state: **BILL-C2-1-REPAIR** — repair of the cycle-1 candidate
(`BILL-C1-1`) per `reports/audits/CYCLE_32692407760_BILLING.md`.

## Module map

| Path | Role |
|---|---|
| `types.ts` | Billing DTOs, plan-tier model, warning signals |
| `counter/ports.ts` | Paging port + page-size/runaway constants + `BillingPagingError` |
| `counter/countBillableLocations.ts` | Pure counting core (pages in, count out) |
| `counter/countFromAdapters.ts` | Paging driver: drains adapters, feeds `.pages` to the core |
| `pure/tiers.ts` | The four contract plans + free state, prices, location allowances |
| `pure/entitlement.ts` | Pure plan recognition decision table |
| `pure/coverage.ts` | Stable over-limit coverage ordering (default first, then alphabetical) |
| `enforcement/entitlementGate.ts` | Canonical `EntitlementGate` implementation + dashboard meter + warning ledger |
| `upgrade/upgradeUrl.ts` | Byte-exact contracted upgrade URL builder |

## Billable-location definition (ratified, Contract §7)

A business location L is billable iff (1) it exists with `archived === false`
(liveness is never `status`; INACTIVE is unsupported and archiving does not
change status) and (2) at least one counted service references L via
`locations[type='BUSINESS'].business.id`. Counted-service policy v1: every
non-hidden service counts regardless of `onlineBooking.enabled`. Distinct-set
intersection prevents double counting. Connectivity is computed through the
services cross-reference, never aggregate-only location fields (Invariant C3).

**Single-location floor:** a computed count of 0 is billed as 1. The floor
bumps only `BillableCountResult.count`; `billableLocationIds` stays the true
computed set (possibly empty). It is a reporting set, not an entitlement grant.
The dashboard documents the floor to merchants.

## Paging adapter semantics (handoff to the Integration lane)

`counter/ports.ts` is the seam the Integration lane backs with paginated Wix
`listLocations` / `queryServices` adapters:

1. Adapters **MUST THROW on infrastructure failure** (network, timeout, 5xx,
   auth/token, malformed payload). Throwing means "state UNKNOWN"; the gate
   converts that into the contracted fail-open + persistent-warning posture.
2. Adapters may return `null` **only when Wix genuinely reports no (more)
   billing data** — a definitive end-of-list. `null` asserts a trustworthy
   empty snapshot.
3. Swallowing a transport error into `null` would make a paying merchant
   silently look FREE/restricted. Never do that.

Runaway protection: more than `MAX_PAGES_PER_SOURCE` (10,000) pages from one
source raises `BillingPagingError`. Locations paginate at 50/page, services at
100/page (Contract §11 C5).

## Plan recognition (Contract §7, Invariant C2)

- Primary signals: webhooks + `isFree` + `vendorProductId`/`packageName` +
  periodic reconciliation. `billingExpirationDate` is advisory-only and is
  intentionally never read by `resolveEntitlement`.
- `null` snapshot ⇒ FREE with reliable restriction and no warning (genuinely
  absent billing section). Missing/empty `vendorProductId` ⇒ FREE. A trial
  status alone never grants a paid tier; trial users are paid through
  `isFree:false` + their plan identifier.
- Unknown paid identifier ⇒ TIER_1 (fail SAFE: under-serve rather than
  over-serve) + persistent `UNKNOWN_PLAN_IDENTIFIER` warning +
  `restrictionReliable: false`.
- Clone markers never change an instance's own resolution.
- `DEFAULT_VENDOR_PRODUCT_OVERRIDES` is empty by default: account-specific Wix
  identifiers are never fabricated in code or tests. The human owner
  configures real product ids at deploy time.

## Tiers

All paid tiers expose identical features; only the maximum managed active
Bookings locations differs: Free/1 → 1, 2–3 → 3, 4–10 → 10, 11+ → unlimited.
Free allowance = 1 location (lane judgment ratified in the cycle-1 audit:
consistent with the single-location floor and "never destroy user data").

## Over-limit / downgrade behavior

Coverage ordering is stable and deterministic: default location first, then
alphabetical by location id. Excess locations become `unmanagedLocationIds` —
management is disabled, configuration is NEVER deleted, so an upgrade restores
coverage without data loss. Over-limit is a normal state (`overLimit: true`,
upgrade CTA), not an error.

## Fail-open posture

Entitlement/counting/listing infrastructure errors degrade gracefully:
decisions carry `degraded: true`, warnings persist in the injected ledger, and
consumers must not block bookings while degraded. Transient warnings clear on
recovery; `UNKNOWN_PLAN_IDENTIFIER` persists until mapped. The meter
(`gate.meter()`) follows the same posture and returns `{count: null,
degraded: true}` instead of throwing.

## Tests

Run from the repo root:

- `npx vitest run tests/billing` → exactly **51 tests, 0 skipped** (regression
  proof for the repair brief).
- `npm run check` → strict typecheck + purity gate + full unit suite
  (platform + billing) — the Blueprint §6 CI gate.

Note on file names: the cycle-1 audit refers to these suites as
`*.test.ts` (the unmounted candidate had no repo tooling); they are persisted
here as `*.spec.ts` so the accepted repository vitest config
(`tests/**/*.spec.ts`) runs them in the mandatory CI gate. Mapping:
`counter.test.ts→counter.spec.ts`, `counterAdapters.test.ts→counterAdapters.spec.ts`,
`entitlement.test.ts→entitlement.spec.ts`, `tiers.test.ts→tiers.spec.ts`,
`coverage.test.ts→coverage.spec.ts`,
`entitlementGate.test.ts→entitlementGate.spec.ts`,
`upgradeUrl.test.ts→upgradeUrl.spec.ts`, purity suite → `purity.spec.ts`.

Repair provenance: F1 (`countFromAdapters` passes `.pages`), F2 (modulo
fixture pinned to its provable 123 distinct ids with full inclusion–exclusion
derivation in `counterAdapters.spec.ts`), F3 (runaway fixture counts calls
inside `fetchPage`), F4 (`BillingPagingAdapter` type import restored), F5
(double-step cast removed in favor of typed key iteration in
`coverage.spec.ts`), plus the throw-vs-null docstring handoff above.
