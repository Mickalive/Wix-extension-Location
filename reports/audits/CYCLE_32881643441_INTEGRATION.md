# Lane Audit — Integration Candidate, Cycle 32881643441 (INT-C4-1)

- **Auditor:** lane-auditor (independent)
- **Candidate:** branch `cycle/wix-build/32881643441/integration`, commit `a1670485d30dc60aec8bca03819a5930eb7e87e3`, worktree `/tmp/wix_integration_candidate`
- **Accepted base:** `adb0b23` ("Wix build 32792897988: director attempt") — current checkout, untouched
- **Assigned task:** INT-C4-1 from `docs/NEXT_CYCLE.json` (cycle 4): enforcement composition root + entitlement meter endpoint + dedup compaction + obs-B hardening
- **Repair priority check:** `repair_lanes` is empty; latest persisted integration audit (`CYCLE_32792897988_INTEGRATION.md`) is ACCEPT. No repair obligation precedes this task.

## 1. Real diff inspection

`git diff adb0b23..a167048` = 14 files, +2120/−4, **exclusively** `src/platform/**` + `tests/platform/**` (verified: `git diff --name-only | grep -vE '^(src/platform/|tests/platform/)'` finds nothing):

| Path | Change |
|---|---|
| `src/platform/composition/entitlementComposition.ts` | new — composition root |
| `src/platform/composition/projectorCompaction.ts` | new — bounded retention wrapper |
| `src/platform/composition/reconciliation.ts` | new — §7 poll seam |
| `src/platform/composition/index.ts`, `README.md` | new — exports + wiring protocol/tradeoffs |
| `src/platform/http/meterEndpoint.ts` (+index/README) | new — GET /meter |
| `src/platform/validation-plugin/handlers.ts` | modified — obs-B `guardedNow` only (+23/−2 net) |
| `tests/platform/{composition-root,meter-endpoint,projector-compaction,validation-plugin-clock-guard}.spec.ts` | new — 34 tests |

No edits to `src/domain/**`, `src/billing/**`, `src/shared/**`, `ports.ts`, governance paths, vitest config glob, purity-gate script/roots, package.json, or tsconfig. Canonical contracts consumed unforked (verified against accepted `snapshotSource.ts`, `entitlementGate.ts`, `projector.ts`, `fold.ts`, `domain/ports.ts`). No `.only/.skip/.todo`. No secrets or fabricated Wix identifiers (all fixtures obviously synthetic).

## 2. Executable checks (run in the candidate worktree)

- `npm ci` — clean install, succeeds.
- `npm run check` (tsc --noEmit strict + purity gate + vitest) — **green**: typecheck exit 0; purity gate passed with **unchanged roots** (`src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`); **42 files / 426 tests passed**, including the 34 new ones. (The mid-output "PURITY GATE FAILED" text is the gate's own negative self-test writing intentional violations under `/tmp/purity-gate-fixture-*`; the real gate run prints PASS.)
- `npm run check:offline` (proxies pinned to a dead port) — **green**, same 426/426. Credential-free and offline as required.
- Independent greps: zero `@wix/` imports under `src/platform/composition/**` and `meterEndpoint.ts`; zero webhook-type references (`billing/projection/types`, `BillingEventEnvelope`, `EventIngestStatus`, payload types) in `entitlementComposition.ts`, `reconciliation.ts`, `meterEndpoint.ts`, and all of `src/platform/validation-plugin/**`.

## 3. Acceptance-criteria verification

1. **npm ci && npm run check offline, purity roots unchanged/green** — SATISFIED (§2).
2. **Composition-root end-to-end + zero webhook-type imports in consumer modules** — SATISFIED. `composeValidationEntitlement` wires `projectedSnapshotSource(projector)` → `createEntitlementGate({instance,…})` → a gate satisfying the canonical `EntitlementGate` port, assigned straight into `ValidationPluginDeps.entitlementGate`. Tests drive REAL handlers: FREE baseline ⇒ `UNCOVERED_LOCATION_RULES_SKIPPED`; purchase webhook ingested between polls ⇒ immediate `RULES_EVALUATED` + `OUTSIDE_BOOKING_HOURS` block (gate re-reads projection per call); trial→paid (no event exists, Contract §7) discovered ONLY via `reconcileNow()`; confirming downgrade snapshot re-shrinks coverage with stored ruleset untouched. Import ban is both grep-verified and test-pinned (7 marker regexes over the composition root + every validation-plugin module; seam isolation test proves `projectorCompaction.ts` is the ONLY composition module speaking envelope semantics — it IS the ingestion boundary, matching the task's consumer-module wording).
3. **Compaction: bounded memory + post-compaction replay convergence** — SATISFIED. Two-tier policy: (i) reconciliation retirement (ids → bounded FIFO `maxRetiredIds`, watermark → highest retired numeric `entityEventSequence`); (ii) forced compaction past `maxGenerationEvents` drops beyond `retentionWindow`, advances the watermark, and REBUILDS the inner core from (last snapshot + durable `autoRenewCancelled` marker + retained window), which bounds even the core's private dedup set. Tests assert the `stats().retainedIds` bound at EVERY ingest step across 30 flood/reconcile rounds; replayed already-compacted events are fenced `'DUPLICATE'` (id set or ≤watermark rank) with `isPaid` staying false and `generationEventCount` 0 — no resurrected paid state, no duplicate dispatch. Tradeoffs are documented in the module docstring and README §3 (late deliveries ranked ≤ watermark suppressed until the next poll; sequence-less envelopes unfenceable once evicted but idempotent + healed by the MANDATORY reconciliation; mid-generation refinement loss exact at every convergence point). Constructor rejects nonsensical bounds.
4. **GET /meter: pinned DTO verbatim, 401s, fail-open degraded body, 200 healthy** — SATISFIED. DTO matches the `NEXT_CYCLE.json` cross-lane pin EXACTLY (`meter{count:number|null,degraded:boolean}`, `coverage{allowedLocationIds:string[],overLimit:boolean,degraded:boolean,warning:string|null}`), enforced by a recursive exact-key-set/type guard. Missing/empty/whitespace token, forged token, and verifier-infrastructure failure each reject typed `TOKEN_*` → mapped 401 `UNAUTHORIZED` with ZERO gate calls (call counters). Post-auth gate failures degrade IN-BODY per half with isolation (failing meter keeps healthy coverage and vice versa), always status 200 — never a 5xx blocking the dashboard (Contract §7/C5). Includes an integration test through the REAL composed gate with a failing billable-count port.
5. **obs-B regression: throwing injected clock still yields guarded per-item results on every target** — SATISFIED. `guardedNow` wraps the only two `clock.now()` calls inside `targetFailureResult`, degrading to the documented fixed `CLOCK_FAILURE_FALLBACK_INSTANT` (observability metadata only, never a rule input). Regression covers ALL SIX targets on both escape routes (direct internal failure with an always-throwing clock; deadline expiry where the clock dies after its first read — the original obs-B path), asserting complete per-index results honoring §5.3 semantics (fail-closed blocks with retry hint / fail-open explicit valids, honest `enforcementClaim`s, sink persistence with fallback instant), plus a healthy-clock control proving the fallback fires ONLY on clock failure. Note: the opening unguarded `clock.now()` in `executeRequest` is also safe — its throw lands in `handleTarget`'s catch → `targetFailureResult` → `guardedNow`.
6. **Scope discipline** — SATISFIED (§1). Out-of-scope items respected: no dashboard UI, no real Wix transport/scaffold, no billing-projection semantic changes, no `ports.ts` edits (RULES-C4-1 exclusively holds that evolution this cycle). No production-capability claims: READMEs carry explicit T-VP0 staging disclaimers.

## 4. Independent adversarial probes (auditor-written, run green, then removed; worktree restored pristine)

- **P1** Equal-rank different-id replay after a downgrading reconciliation → fenced `DUPLICATE`, no paid resurrection.
- **P2** Cancel event dropped by forced compaction → durable marker survives the rebuild exactly once; reconciled paid state keeps identifiers; retired cancel replay stays `DUPLICATE`.
- **P3** Repeated identical snapshots → idempotent, zero retention growth.
- **P4** `retentionWindow=0` degeneration → safe single rebuild, full retirement, replays suppressed.
- **P5** After heavy compaction, genuinely newer events above the watermark still apply.
- **P6** DEFAULT (plain-core, non-compacting) composition path honors `overrides` on webhook refinement through the public gate API (coverage expands default-first ordering preserved).
- **P7** Foreign-instance envelopes bypass retention entirely even under flood (`stats()` unchanged).

All 7 probes passed on the first run — no blocker reproduced.

## 5. Non-blocking observations (for the Director / future cycles; do not gate)

- **O1.** `createDefaultProjector` forwards `instanceId` but not `overrides` to the plain projector. Functionally harmless — the GATE receives `overrides` and performs resolution (`currentSnapshot()` carries raw fields only), proven end-to-end by probe P6 — but inconsistent with the compacting path. Consider forwarding for symmetry next time this file is touched.
- **O2.** Purity-gate roots do not include `src/platform/composition/**`. This is CORRECT per the acceptance criterion ("purity gate roots unchanged"), and the new code is `@wix/`-import-free regardless (grep-verified). The Director may add the root in a future cycle for defense-in-depth.
- **O3.** The watermark fence also suppresses distinct-id events whose rank EQUALS the watermark between polls. Documented tradeoff, self-healing at the mandatory reconciliation, consistent with Contract §6 ordering semantics.

## 6. Cross-lane compatibility

- Pinned GET /meter DTO is byte-equivalent to the DASH-C4-1 fixture contract in `NEXT_CYCLE.json` — no drift for the Director to resolve.
- Accepted platform handlers compile and behave unchanged under the rules lane's authorized additive `ports.ts` evolution constraint (this candidate adds no domain deps usage and touches no domain files).
- `vitest` config glob untouched; parity ledger untouched; `ruleDraftValidators.js` untouched.

## 7. Verdict rationale

The candidate delivers the entirety of INT-C4-1: a pure, Wix-import-free composition root consuming accepted billing exports unforked with zero webhook-type leakage into enforcement consumers; a mandatory, injectable §7 reconciliation seam whose failures are visible and state-preserving; a bounded-retention projector decorator with provable memory bounds, fenced replay convergence, preserved durable cancellation marker, and honestly documented tradeoffs healed by reconciliation supremacy; a token-verified GET /meter endpoint with the exact cross-lane pinned DTO, fail-closed auth before any gate interaction, and per-half fail-open degradation that can never 5xx the dashboard; and the obs-B clock-guard hardening with exhaustive regression coverage. All deterministic checks pass offline and credential-free; scope is exactly `src/platform/**` + `tests/platform/**`; no unsupported platform assumption, fabricated identifier, or production-capability claim exists. Adversarial probing reproduced no defect.

VERDICT: ACCEPT
