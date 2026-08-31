# Factory Integrated Audit — SHA b8ac3832f355adc631fa30db2182515e225a5535

- **Auditor role:** lane-auditor (cross-lane integrated audit of the deterministic preview)
- **Audited SHA:** `b8ac3832f355adc631fa30db2182515e225a5535` (HEAD; parent `ec916b75`, grandparent `e5dda6b1` = "Factory v4 cycle 21: NOT_READY (33072886087)")
- **Candidate:** integration lane, generation 94 — "candidate(integration): INT-C7-REPAIR F1+F2 (confirm-diff endpoint + confirmed-plan store)"
- **Date:** 2026-08-31
- **Method:** read-only inspection of the exact committed tree at the audited SHA; adversarial cross-check of integration/rules/dashboard/billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior, and real Wix scaffold assumptions; deterministic checks run against the SHA tree.

## 1. Scope and integrity

- Working tree product files match the audited SHA. Uncommitted working-tree changes touch only governance/harness files (`.opencode/agents/*`, `AGENTS.md`, `.opencode/job-descriptions/*`) and are not part of the candidate.
- Candidate diff = 7 files, all inside integration-lane scope (`src/platform/**`, `tests/platform/**`):
  - `src/platform/composition/confirmedPlanComposition.ts` (new): composition root sharing one confirmed-plan store between confirm-diff and apply-plan deps.
  - `src/platform/http/mutationEndpoints.ts` (+116): `ConfirmedPlanStore` port, `InMemoryConfirmedPlanStore`, `postConfirmDiff` handler, strict `apply-plan` retained.
  - `src/platform/http/index.ts` (+5) and `src/platform/composition/index.ts` (+5): export additions.
  - `src/platform/http/README.md` (+1): endpoint map entry.
  - `tests/platform/helpers/httpTestDoubles.ts` (+21): store double.
  - `tests/platform/http-mutations.spec.ts` (+387): 31 tests covering confirm-diff, apply-plan, store, error paths, and a documented cross-lane coordination note.
- No governance files, no `MAIN_PROMPT.md`, no fiche, no workflow, no orchestration touched. No secrets, no fabricated Wix identifiers.

## 2. Deterministic checks (all PASS at the audited SHA)

- `npm run check`: typecheck clean; purity gate clean; 566 vitest tests across 49 files pass.
- `npm test` in `tests/ui`: 210 node tests pass, including accessibility assertions (labels, roles, keyboard, live regions) and UI-validator parity (30 tests).

## 3. Verified contracts (unchanged by this candidate — sound)

- **Booking enforcement:** `src/platform/validation-plugin/handlers.ts` fail-closed for CREATE and CANCEL, fail-open for RESCHEDULE, target-aware evaluation; `src/domain/evaluate.ts` matches Contract §5.3 (classification → entitlement → windows/exceptions → caps → duplicates; counters degrade fail-open with visible notice; identity policy OFF; midnight-ending slots normalized to endMinute=1440).
- **Rollback/recovery:** `src/platform/schedule-mutation/orchestrator.ts` snapshot → diff → idempotent writes → revision retry → verify → rollback → audit; crash leaves `APPLY_IN_PROGRESS`; `beginApply`/`applyNextChange`/`completeApply` public for multi-invocation recovery; no silent destructive schedule rewrites.
- **Entitlements:** `src/billing/enforcement/entitlementGate.ts` fail-open on degraded billing signals with warnings ledger; over-limit stable ordering; meter endpoint pinned DTO matches dashboard `isEntitlementMeterDto`; downgrade never deletes customer configuration.
- **Ruleset/meter endpoints:** token-verified, fail-closed on malformed input.
- **Registration honesty:** `src/platform/registration/*` classify MISSING_FILE/UNLINKED/LINKED; `extensions.ts` intentionally empty; `wix.config.example.json` uses a placeholder appId; no fabricated IDs or capabilities.
- **Product gates:** `docs/PRODUCT_GATES.json` all required gates OPEN; `docs/state.json` cycle 21, `last_result` NOT_READY (final auditor unavailable/failed); `docs/NEXT_CYCLE.json` stale (cycle 7, INT-C7-LIVE) — Director should refresh it.

## 4. Findings

### F1 — HIGH, integration-lane ownership, introduced by this candidate: in-memory confirmed-plan store is not durable across serverless invocations

`InMemoryConfirmedPlanStore` is an app-lifetime-scoped in-memory `Map`. The confirm-then-apply flow spans two independent HTTP requests (`POST /confirm-diff`, then `POST /apply-plan`). The candidate's code comment asserts "For single-instance Wix CLI app backends this is sufficient; a durable store is required only if horizontal scaling or crash persistence becomes necessary."

That assumption fails verification against the binding authorities:

- `reports/recon/PLATFORM.md` (official Wix docs, binding): "Wix-managed serverless" and "serverless execution with automatic scaling (HTTP endpoints, service-plugin handlers)".
- The lane's own `src/platform/composition/README.md`: "processes freeze between requests" (serverless cold-start model; "warm hosts" implies multiple hosts).

No session-affinity or single-instance guarantee exists anywhere in the technical contract or recon evidence. On the real Wix scaffold, the two requests will routinely land on different instances (or a recycled one), so `apply-plan` returns 404 NOT_FOUND with the message "confirm the reviewed diff first" — immediately after the user did confirm. The primary mutation flow is unreliable in the common case, and the candidate's own comment ("one instance per serverless invocation") is ambiguous: if the composition root is per-invocation, the flow fails always; if per-process, it fails across instances. The tests share one store instance in-process and therefore cannot expose this. Fix is in integration-lane scope: persist the confirmed plan durably (data collection per Contract persistence model) or redesign the flow so confirmation and apply are one atomic request.

### F2 — HIGH, cross-lane (dashboard), pre-existing but blocks end-to-end apply at this SHA

Dashboard bridge `src/ui/services/bridge.js` `requestApply(ops, confirmedDiffHash)` still POSTs `{ ops, confirmedDiffHash }` to `/apply-plan`, which strictly rejects extra keys → 400 INVALID_QUERY; the bridge has no `confirmDiff` method. The candidate's own test file (`tests/platform/http-mutations.spec.ts` lines 13–15 and 708–716) documents the required dashboard-lane fixes as "NOT part of this integration candidate — separate task". This mismatch pre-exists in the accepted base (parent `ec916b75` and grandparent `e5dda6b1` both carry the strict apply-plan). The integrated product cannot apply a plan end-to-end at this SHA. This is not a defect of this candidate, but the integrated audit must record it: the Director must route the dashboard-lane repair (bridge `confirmDiff` + `requestApply` sending only `{ confirmedDiffHash }`) before the apply flow is functional.

### F3 — MEDIUM: confirm-diff does not verify hash↔plan consistency

`postConfirmDiff` treats `confirmedDiffHash` as a client-supplied lookup key and never recomputes it from the plan content. A buggy or compromised dashboard client could register hash H (the diff the user reviewed) bound to a different plan P', and `apply-plan` would execute P' without the user having reviewed it. Server-side recomputation of the hash from the canonical plan serialization (rejecting mismatches) would close the confirmation-integrity gap.

### F4 — LOW: confirm-diff plan validation is minimal

Only structural shape is checked (planId string, changes array, scope object). Malformed changes (e.g., CREATE_MASTER without weekday/times) pass through to the orchestrator. Defense-in-depth gap; the orchestrator rejects at apply time, but the confirm endpoint should validate earlier.

### F5 — LOW: `confirmedBy` is client-supplied

`apply-plan` correctly derives `requestedBy` from the verified caller token, but `postConfirmDiff` trusts the client's `confirmedBy` string for the audit trail. Derive it from the verified caller for consistency.

## 5. Verdict rationale

The candidate is additive, honest, in-scope, and fully green on deterministic checks; the cross-lane gap (F2) is pre-existing and correctly documented by the candidate for the dashboard lane. However, F1 is a load-bearing reliability defect in the candidate's own new production code: the confirmed-plan store assumes a single-instance serverless backend that the binding recon evidence (automatic scaling) and the lane's own platform model contradict, making the primary confirm→apply mutation flow unreliable on the real Wix scaffold. F1 is within the integration lane's ownership and must be repaired (durable store or atomic flow) before the preview is adopted. F2 must be routed to the dashboard lane regardless. F3–F5 are hardening items for the same repair cycle.

VERDICT: FIX