# Billing & Entitlements Lane

Owner: billing-builder (`directives/BILLING.md`). Binding truth:
`docs/WIX_TECHNICAL_CONTRACT.md` §5.1/§7/§11 (C2/C3/C5), `docs/BUILD_BLUEPRINT.md`
§1/§2/§6. Current state: **BILL-C4-1** — downgrade-through-gate regression plus
projection-fidelity folds (accepted-audit observations 1, 3, 4 of
`reports/audits/CYCLE_32792897988_BILLING.md`) on top of the BILL-C3-1
plan-state projection & reconciliation machine (Contract §7 lifecycle;
Blueprint §4 flow 5).

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
| `projection/types.ts` | Webhook envelope/event types (semantics only), projection output |
| `projection/fold.ts` | Deterministic event-layer fold (dedup/order-safe transitions) |
| `projection/projector.ts` | The §7 entitlement state machine: events + snapshots → projection |
| `projection/snapshotSource.ts` | Narrow port: projector → gate's `BillingInstancePort` |
| `enforcement/entitlementGate.ts` | Canonical `EntitlementGate` implementation + dashboard meter + warning ledger |
| `upgrade/upgradeUrl.ts` | Byte-exact contracted upgrade URL builder |

## Plan-state projection & reconciliation (BILL-C3-1, Blueprint §4 flow 5)

`createBillingPlanProjector({ instanceId?, overrides? })` ingests:

- **EVENTS** — app-billing webhook envelopes (`PAID_PLAN_PURCHASED`,
  `PAID_PLAN_AUTO_RENEWAL_CANCELLED`, `APP_INSTALLATION_CREATED/UPDATED`).
  Envelope semantics ONLY: dedup on envelope `id`, ordering on
  `entityEventSequence` (Contract §6); transport/signature/retry stay in the
  platform pipeline. Purchase/cancellation payload types carry NO expiration
  field; installation payloads alias `AppInstanceBillingSnapshot` and CAN
  carry the optional `billingExpirationDate`, but no transition ever reads it
  and the rendered refinement omits it — webhook dates are never consulted
  (Invariant C2).
- **SNAPSHOTS** — periodic Get App Instance results (`null` = genuinely absent
  billing ⇒ FREE per accepted semantics).

Binding behaviors (all proven in `tests/billing/projection.spec.ts`):

1. **Reconciliation supremacy** — ingesting a snapshot re-seeds the event
   layer and discards all pre-snapshot event effects. Trial→paid conversion
   fires NO event (§7), so periodic reconciliation is MANDATORY: without a
   snapshot no amount of webhook traffic can discover a conversion.
2. **Snapshot beats stale events** — the envelope-id dedup memory survives
   reconciliation, so replayed/duplicated pre-snapshot deliveries can never
   resurrect old state on top of a fresher snapshot.
3. **Idempotent convergence** — within one generation, unique events fold in
   `(entityEventSequence, id)` order with idempotent transitions; missing or
   unparseable sequences rank oldest and the envelope id tiebreaks.
   Out-of-order, duplicated and replayed deliveries converge to identical
   projections (50-seeded-shuffle determinism test).
4. **Post-snapshot refinement** — unique events delivered after a snapshot
   legitimately refine the projection until the next reconciliation (a
   purchase webhook grants paid coverage immediately; no mid-cycle downgrade
   event exists, so events can only upgrade or mark cancellation).
5. **Lifecycle branches (both ways)** — cancelled-until-expiry KEEPS paid
   identifiers; auto-renewal cancellation downgrades ONLY at period end given
   a confirming snapshot; dunning window (expired advisory date +
   `isFree:false`) stays PAID while `isFree:true` stays FREE regardless of
   dates; clone markers never leak across instances (foreign-`instanceId`
   events are ignored; markers never alter an instance's own resolution);
   UNKNOWN_PLAN_IDENTIFIER persists across refinements until the operator
   maps the identifier.
6. **Durable marker** — `autoRenewCancelled` survives reconciliations until a
   NEW purchase re-enables renewal; it never changes the tier by itself.

### Narrow port for the enforcement path (INT-C3-1)

```ts
const projector = createBillingPlanProjector({ instanceId });
const gate = createEntitlementGate({
  instance: projectedSnapshotSource(projector), // IS a BillingInstancePort
  ...
});
```

The enforcement path consumes RECONCILED state without importing any webhook
type: the only surface crossing the port is the accepted
`AppInstanceBillingSnapshot` shape. The port serves the latest reconciled
snapshot verbatim while no post-snapshot events are pending, otherwise the
refined view rendered into snapshot shape, else `null`.

## Downgrade-through-gate lifecycle (BILL-C4-1a)

`tests/billing/downgradeThroughGate.spec.ts` proves END-TO-END through the
public gate API (`createEntitlementGate` + `projectedSnapshotSource`) that §7's
"downgrade only at period end via confirming snapshot" is ENFORCED, not merely
projected:

1. an auto-renewal-cancellation event alone never shrinks coverage;
2. a confirming period-end snapshot downgrading the tier shrinks
   `allowedLocationIds` exactly to the new allowance in stable order (default
   location first, then alphabetical by id; archived locations stay excluded);
3. user configuration and the management inventory are never deleted — they
   survive byte-identical across every step, and repeated reconciliations keep
   the same restricted set (no progressive loss);
4. the over-limit upgrade state surfaces (`overLimit: true`, reliable
   restriction, no incident warning);
5. a confirming re-upgrade snapshot restores full coverage from the preserved
   configuration.

## Projection fidelity folds (BILL-C4-1 b/c/d)

`tests/billing/projectionFidelity.spec.ts` folds accepted-audit observations
1, 3 and 4 of `reports/audits/CYCLE_32792897988_BILLING.md`:

- **Observation 1 (C2 docstring truth):** installation payloads CAN carry the
  optional `billingExpirationDate` alias (they reuse
  `AppInstanceBillingSnapshot`); transitions never read it and the rendered
  refinement omits it. Proven behaviorally both ways (past date cannot lapse a
  paid plan; future date cannot grant coverage) plus a render-shape test.
- **Observation 3 (packageName fidelity):** preservation through post-snapshot
  refinement already holds (merge discipline never clobbers known values), so
  the fold documents+tests why the only two drop cases are correct-by-design:
  fields the resolver never reads are omitted from the rendered shape, and a
  newer confirming snapshot supersedes an older name (reconciliation
  supremacy). Unknown-plan warning-text fidelity is proven through the public
  gate API.
- **Observation 4 (initial source label):** `'EVENT_DERIVED'` names the
  SUPPLYING LAYER — a never-reconciled zero-event projector reports it because
  the event layer's empty view folds to the conservative FREE default. The
  precise initial-state discriminators are
  `reconciledAtLeastOnce === false && generationEventCount === 0`; pinned by
  test together with the transition to `'SNAPSHOT_RECONCILED'`.

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
   converts that into the contracted fail-open + persistent-warning posture;
   it never converts it into data.
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
consumers must not block bookings while degraded. Warning liveness is
PER-SOURCE (audit observation 1, folded at BILL-C3-1): each transient code
clears as soon as its OWN source is healthy again — a failing listing no
longer keeps a healed billing failure alive. UNKNOWN_PLAN_IDENTIFIER persists
until mapped. The fail-open sentinel carries an EXPLICIT null tier
(`FAIL_OPEN_RESOLUTION.tier === null`, audit observation 2): billing being
unreadable claims no tier at all. The meter (`gate.meter()`) follows the same
posture and returns `{count: null, degraded: true}` instead of throwing.

## Tests

Run from the repo root:

- `npx vitest run tests/billing` → exactly **96 tests, 0 skipped**
  (88 baseline after BILL-C3-1 + 8 new for BILL-C4-1: downgrade-through-gate
  lifecycle regression + projection-fidelity folds for observations 1, 3, 4).
- `npm run check` → strict typecheck + purity gate + full unit suite
  (platform + domain + billing) — the Blueprint §6 CI gate.

Note on file names: the cycle-1 audit refers to these suites as
`*.test.ts` (the unmounted candidate had no repo tooling); they are persisted
here as `*.spec.ts` so the accepted repository vitest config
(`tests/**/*.spec.ts`) runs them in the mandatory CI gate. Mapping:
`counter.test.ts→counter.spec.ts`, `counterAdapters.test.ts→counterAdapters.spec.ts`,
`entitlement.test.ts→entitlement.spec.ts`, `tiers.test.ts→tiers.spec.ts`,
`coverage.test.ts→coverage.spec.ts`,
`entitlementGate.test.ts→entitlementGate.spec.ts`,
`upgradeUrl.test.ts→upgradeUrl.spec.ts`, purity suite → `purity.spec.ts`;
BILL-C3-1 adds `projection.spec.ts` and `projectionSnapshotSource.spec.ts`.

Repair provenance: F1 (`countFromAdapters` passes `.pages`), F2 (modulo
fixture pinned to its provable 123 distinct ids with full inclusion–exclusion
derivation in `counterAdapters.spec.ts`), F3 (runaway fixture counts calls
inside `fetchPage`), F4 (`BillingPagingAdapter` type import restored), F5
(double-step cast removed in favor of typed key iteration in
`coverage.spec.ts`), plus the throw-vs-null docstring handoff above.
BILL-C3-1 provenance: accepted-audit observations 1 (per-source warning
liveness) and 2 (explicit null fail-open tier) folded with dedicated
regression tests in `entitlementGate.spec.ts`.
BILL-C4-1 provenance: downgrade-through-gate lifecycle regression
(`downgradeThroughGate.spec.ts`) and accepted-audit observations 1 (C2
docstring truth + alias behavior tests), 3 (packageName fidelity: preserved
through refinement, drops correct-by-design, warning-text fidelity through the
gate) and 4 (initial `'EVENT_DERIVED'` label documented with precise
initial-state discriminators) folded in `projectionFidelity.spec.ts`.
