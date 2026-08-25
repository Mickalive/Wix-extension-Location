# Enforcement composition root — billing → enforcement wiring protocol

> **STAGING NOTE (integration lane, INT-C4-1 — mirrors the `../http/` and
> `../validation-plugin/` staging patterns).** Everything here is pure,
> Wix-import-free wiring over ACCEPTED billing exports
> (`projectedSnapshotSource`, `createEntitlementGate`) plus injected ports.
> The real Get App Instance adapter, the webhook transport and the thin
> `src/pages/api/*` files are created at the authenticated scaffold (gate
> T-VP0; Contract §16). **No production-capability claim is made or implied
> until gates T-VP0–T-VP5 pass on a real dev site.**

## 1. What this layer is

BILL-C3-1 sub-item (e) handoff (documented in `src/billing/README.md`):
the enforcement path consumes RECONCILED plan state through the accepted
narrow port, without importing any webhook type.

```
webhook pipeline (../webhooks) ──envelopes──▶ projector
Get App Instance adapter (T-VP0) ──snapshots──▶ projector
                                                 │
                                                 ▼
                projectedSnapshotSource(projector)   [billing/projection]
                                                 │
                                                 ▼
                     createEntitlementGate({ instance, listings,
                         billableCount, warnings, overrides })
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
        ValidationPluginDeps.entitlementGate                 GET /api/meter body
        (../validation-plugin/handlers.ts)                 (../http/meterEndpoint.ts)
```

Modules:

| Path | Role |
|---|---|
| `entitlementComposition.ts` | THE composition root: `composeValidationEntitlement(deps)` → `{ gate, projector, reconciliation }`. Zero webhook-type imports (test-pinned). |
| `reconciliation.ts` | Mandatory §7 poll seam: `reconcileNow()` + injectable poll triggers (`onPollTrigger`, `intervalPollTrigger`). Trial→paid conversion fires NO event, so polls are not optional. |
| `projectorCompaction.ts` | Bounded retention/compaction decorator around the plan projector for long-lived serverless processes (Billing audit CYCLE_32792897988 obs 2). |

## 2. Wiring protocol (execute at scaffold time, T-VP0)

1. Build the projector with `createCompactingProjector({ instanceId })` and
   pass it via `composeValidationEntitlement({ createProjector: () => … })`
   (warm processes) or rely on the plain-core default (short-lived invocations).
2. Back `listings` / `billableCount` with paginated `listLocations` /
   services-cross-reference adapters obeying the billing lane's throw-vs-null
   adapter semantics (`src/billing/README.md`).
3. Back `warnings` with a data-collection ledger (upsert-by-code).
4. Configure `overrides` from deploy-time environment — real vendorProductId
   values only; never commit or fabricate identifiers.
5. Register a poll trigger: `composition.reconciliation.onPollTrigger(
   intervalPollTrigger(ms))` on warm hosts, or fire `reconcileNow()` from a
   scheduled event/warm-start hook where processes freeze between requests.
6. Assign `composition.gate` to `ValidationPluginDeps.entitlementGate` AND to
   `getEntitlementMeter({ entitlementGate: composition.gate, … })`.

## 3. Dedup retention/compaction policy (INT-C4-1 item b)

Problem: the accepted core's `seenEventIds` grows for its lifetime — correct
for the pure core, unbounded for a long-lived warm process under sustained
unique-event load (Billing audit CYCLE_32792897988 observation 2).

Eviction semantics (`./projectorCompaction.ts`):

1. **Reconciliation retirement** — each snapshot re-seeds truth (Contract §7
   supremacy), so pre-snapshot event effects are superseded anyway. At every
   reconciliation the live generation retires: ids move into a bounded FIFO
   set (`maxRetiredIds`, default 4096) kept purely for duplicate suppression,
   and the sequence watermark advances to the highest retired numeric
   `entityEventSequence`.
2. **Forced compaction** — if the live generation exceeds
   `maxGenerationEvents` (default 512) between polls, arrivals beyond
   `retentionWindow` (default 256) are dropped, the watermark advances over
   them, and the inner core is REBUILT from (last snapshot + durable
   cancellation marker + retained window). Rebuilding is what actually bounds
   memory: the inner private dedup set restarts bounded too.

Safe re-detection ("no resurrected paid state"): a replayed already-compacted
event whose numeric rank ≤ the watermark is fenced — classified `DUPLICATE`
without reaching the inner core. Wix sequences are monotonic, so anything at
or below the watermark predates everything compacted; replaying an old
purchase after a downgrading reconciliation can never re-apply it.

Tradeoffs (each healed by the mandatory periodic reconciliation):

- A legitimate late delivery ranked ≤ the watermark is suppressed until the
  next poll restores true state. Webhook effects are refinements BETWEEN
  polls only; supremacy makes every poll self-healing.
- Envelopes without a usable numeric sequence cannot be fenced once evicted;
  such a replay may re-apply once as a refinement. Transitions are idempotent
  and the next reconciliation discards refinement layers wholesale.
  Sequence-less delivery is a defensive corner (Contract §6 orders via
  `entityEventSequence`), not the norm.
- Forced mid-generation compaction drops refinement effects of evicted events
  until the next reconciliation; projections are exact again at every
  convergence point (immediately after each snapshot). Proven in
  `tests/platform/projector-compaction.spec.ts`.

Durable marker: `autoRenewCancelled` survives reconciliations inside the
accepted core; rebuilds observe it first and re-seed it with one reserved
synthetic auto-renewal-cancellation envelope when needed (that transition
writes ONLY the marker).

## 4. Scope discipline (audit-facing)

- No rule logic, no pricing/billing policy: this root only CONNECTS accepted
  exports; decisions stay in `src/domain` + `src/billing`.
- Webhook envelope TYPES appear ONLY in `projectorCompaction.ts` (it IS the
  ingestion boundary); the composition root and `../validation-plugin/**`
  import zero webhook types (test-pinned). Transport/signature/retry remain
  in `../webhooks` per Contract §6.
- Purity: no `@wix/` imports anywhere in this directory.
