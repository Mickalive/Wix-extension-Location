# Next Cycle — Build Cycle 2

Current phase: **BUILD**. Planning authority: `reports/director/CYCLE_32692407760.json` (Director pass over Product Factory run 32692407760, 2026-08-24). Machine-readable queue: `docs/NEXT_CYCLE.json`.

## Outcome of cycle 1 (run 32692407760)

| Lane | Audit verdict | Disposition |
|---|---|---|
| integration | `VERDICT: ACCEPT` | **Integrated** into accepted `lab/wix-rules` (tooling + purity gate, canonical ports/DTOs, fakes for all seven ports, Contract §9 mutation orchestrator with crash recovery, T-VP0 runbook). Deterministic gate green: strict typecheck, purity, 33/33 tests incl. offline rerun. |
| rules | `VERDICT: FIX_BEFORE_INTEGRATION` | **Repair lane** — blockers B1–B4 routed back to rules-engine-builder (`RULES-C2-1-REPAIR`). |
| dashboard | `VERDICT: FIX_BEFORE_INTEGRATION` | **Repair lane** — blockers F-B1/F-B2 routed back to dashboard-builder (`DASH-C2-1-REPAIR`). |
| billing | `VERDICT: FIX_BEFORE_INTEGRATION` | **Repair lane** — blockers F1–F5 routed back to billing-builder (`BILL-C2-1-REPAIR`). |

All four full audit reports are preserved verbatim under `reports/audits/CYCLE_32692407760_*.md`. Per the mandatory repair feedback loop, no negatively audited candidate was integrated; each repair requires a fresh independent audit ending in `VERDICT: ACCEPT`.

Asynchronous simulated-Wix QA: **not yet available** (no `qa/wix-sim-latest`, no `LATEST.json`). Per policy it did not delay this cycle; the next Director pass must consume it when present.

## Lane assignments for cycle 2

| Lane | Task | Summary | Status |
|---|---|---|---|
| integration | INT-C2-1 | Platform services layer v1: orchestrator terminal-state hardening (audit obs. N1); token-verified HTTP endpoint handlers as pure modules (RuleSet get/put with revision-checked save, apply-plan requiring confirmed-diff hash, mutation status/recover) with injected TokenVerifier port and fail-closed semantics; webhook ingestion pipeline with envelope-id dedup, entityEventSequence ordering, idempotent exactly-once dispatch plus chaos tests. | active |
| rules | RULES-C2-1-REPAIR | Repair brief B1–B4: wrong import specifier breaking the build; two unloadable test suites; five provably wrong test fixtures/expectations (wall-time/UTC confusion ×2, EST-vs-EDT, spring-forward 02:30→03:00 not 03:30, Lord Howe 02:05→02:30) plus missing genuine IDENTITY_TIME_CONFLICT coverage; real midnight-boundary false-block defect (end-at-00:00 must fit a [0,1440) window) with regressions. Ports file frozen; self-verify before submission; fresh audit required. | active (repair) |
| dashboard | DASH-C2-1-REPAIR | Repair brief F-B1/F-B2: diff modal must render exception before→after detail and removal detail (§9.2); confirm flow must be unreachable while the draft is invalid (with negative UI test). Plus F-N2…F-N7 hardening. Validator repoint stays Director-tracked until Rules ACCEPT. Fresh audit required. | active (repair) |
| billing | BILL-C2-1-REPAIR | Repair brief F1–F5: paging driver passes `.pages` (crash + TS2345); fixture asserts 130 vs provable 123; runaway fixture never counts calls; missing type import; invalid cast. Regression proof: 51/51 vitest + strict tsc clean. Align to canonical shared shapes; document throw-vs-null adapter semantics. Fresh audit required. | active (repair) |

## Cross-lane rules

- Canonical contracts `src/domain/ports.ts`, `src/shared/types.ts`, `src/shared/errors.ts` are accepted and frozen; semantic changes require Rules-lane ACCEPT + Director amendment.
- Sequencing: validation-plugin wiring waits for Rules ACCEPT; billing enforcement consumption waits for Billing ACCEPT; dashboard validator repoint waits for Rules ACCEPT.
- Forbidden everywhere: production-capability claims before empirical gates pass, PREVIEW_GATED dependencies, UNSUPPORTED mechanisms, fabricated Wix identifiers, committed secrets.

## Pending external prerequisites (tracked, non-blocking)

1. Human Wix account + CLI authorization; owner/co-owner API key stored as CI secret.
2. One-time scaffold/bind producing real appId → executes `docs/runbooks/T_VP0_SCAFFOLD.md`.
3. One interactive dev-site install consent.
4. Later: payout setup, release approvals, marketplace submission (never automated).
