# Webhook ingestion pipeline — module docs

> **STAGING NOTE (integration lane, INT-C2-1 item c).** The event/webhook
> extension registration itself is scaffold-gated (unified CLI `EVENT`
> generation / dashboard config; gate T-VP0). This directory already contains
> the COMPLETE ingestion logic as pure, Wix-import-free modules; the future
> thin adapter only (1) verifies the signature through the injected port,
> (2) parses the delivery body, (3) calls `pipeline.ingest(...)`, (4) acks.

## Binding Technical Contract §6 constraints

| Constraint | Where honored |
|---|---|
| Deliveries are **JWT-signed with the app public key** | `WebhookSignatureVerifier` is an injected port; no crypto is fabricated in this layer. The production adapter implements the current official verification at scaffold time. `false` ⇒ `SIGNATURE_REJECTED`, zero store mutation. |
| **1250 ms response deadline** | Ingest performs no network I/O beyond injected ports. Duplicate (`DUPLICATE_ACKNOWLEDGED`) and gap-held (`BUFFERED`) paths are O(store) fast acks. Handlers must stay quick; heavy work belongs behind the handler's own durability strategy. |
| **Up to 12 retries** | Redelivery is the recovery driver: a dispatch that crashes leaves the envelope claimed-but-incomplete, so the next redelivery re-claims (`RECLAIM_IN_FLIGHT`) and re-dispatches. Gap-held envelopes are durably buffered AND acked, so Wix does not need to spend retries on them. |
| **Duplicates expected** | Dedup on envelope `id`. `ALREADY_COMPLETED` ⇒ fast ack with zero handler invocations. |
| **Out-of-order delivery expected** | Order restored per ordering scope via `entityEventSequence`: contiguous arrivals dispatch immediately and auto-drain successors; gaps buffer durably; stale replays are superseded-skipped. Baseline bootstrap + lost-predecessor drain are explicit, deterministic operations (see pipeline.ts header). |
| **Handlers idempotent** | Dispatch is at-least-once with stable `deliveryKey = <envelope id>::<handlerId>`; registered handlers MUST make effects idempotent per key so replays converge to exactly-once EFFECTIVE processing. |

## Deterministic guarantees proven by tests

`tests/platform/webhooks-chaos.spec.ts` proves, without any randomness:

1. same envelope id delivered twice ⇒ handler runs exactly once;
2. out-of-order sequences (3,1,2) ⇒ ordered convergence [1,2,3];
3. replay after a simulated mid-dispatch crash ⇒ exactly-once effective
   processing (state identical to a clean single-pass run);
4. crash AFTER effect-apply but BEFORE completion ⇒ replay cannot double-apply;
5. signature rejection ⇒ zero store mutation, zero handler runs;
6. mixed chaos (duplicates + reorder + crash interleaved) converges to the
   golden sequential result.

## Bounded buffer-residue window (audit CYCLE_32787032785 observation 5)

An envelope that completes inside the `markCompleted` → `removeBuffered` crash
window can linger in its scope's reorder buffer until a resume-path cleanup or
an explicit `drainBuffered` removes it. This residue is BOUNDED and harmless by
construction:

- it can NEVER double-dispatch — completion is already recorded, so any later
  encounter takes the `ALREADY_COMPLETED` fast path and the entry is dropped
  (`SUPERSEDED_SKIPPED`), proven deterministically by the chaos suite;
- memory impact is bounded to buffered-but-completed entries for one scope
  until the next resume/drain pass, both of which run during normal
  redelivery handling.

No operator action is required; this note documents the window rather than
hiding it.

## Scope discipline

No counter policy, no booking semantics, no billing logic lives here: handlers
own their domain effects; the pipeline owns dedup, ordering, at-least-once
dispatch and crash tolerance only.
