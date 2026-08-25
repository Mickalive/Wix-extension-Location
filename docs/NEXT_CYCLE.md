# Next Cycle — Build Cycle 4

Current phase: **BUILD**. Planning authority: `reports/director/CYCLE_32792897988.json` (Director pass over Product Factory run 32792897988, 2026-08-25). Machine-readable queue: `docs/NEXT_CYCLE.json`.

## Outcome of cycle 3 (run 32792897988)

| Lane | Task | Audit verdict | Disposition |
|---|---|---|---|
| integration | INT-C3-1 (booking-time enforcement wiring) | `VERDICT: ACCEPT` | **Integrated** — pure validation-plugin handlers consuming canonical `evaluateRules`; explicit per-item bulk results (maxItems 12, omitted-items hazard); fail-closed CREATE/CANCEL vs fail-open RESCHEDULE; identity-free-first (C1); cached counters; N3/N4/N5 repairs with regressions |
| rules | RULES-C3-1 (validator parity contract) | `VERDICT: ACCEPT` | **Integrated** — dual-validator parity spec across six corpus families; four honest divergences (R1–R4) pinned and mutation-proven non-vacuous; ports.ts byte-identical |
| dashboard | DASH-C3-1 (mutation-lifecycle surface) | `VERDICT: ACCEPT` | **Integrated** — bounded permanent-stopping polling, click-gated recovery, one-consent-one-apply, server-shaped mirror seam; DTO fidelity verified against accepted platform code |
| billing | BILL-C3-1 (projection/reconciliation machine) | `VERDICT: ACCEPT` | **Integrated** — snapshot-beats-stale-events supremacy, 300-run chaos convergence proof, full §7 lifecycle both ways, per-source warning liveness, null-tier fail-open sentinel, `projectedSnapshotSource` handoff port |

No negative verdicts → **no repair lanes**. All audits preserved under `reports/audits/CYCLE_32792897988_*.md`.

Integrated-tree deterministic gates: strict typecheck clean · purity green · **392/392** vitest (181 platform + 123 domain + 88 billing) · offline rerun **392/392** · dashboard lane **143/143**.

Asynchronous simulated-Wix QA: **still not available** (`LATEST.json` absent, no `qa/wix-sim-latest` remote branch). It did not delay this cycle; the next Director pass must mount and disposition it when present.

## Key finding dispositions

- **Integration Observation A (escalated to Rules):** uniform rule evaluation blocks cancelling the only booking on an at-capacity day and flags self-overlapping reschedules as `DUPLICATE_BOOKING`. Root cause is canonical domain design → **RULES-C4-1**. CANCEL/RESCHEDULE enforcement stays production-disabled until it lands and T-VP gates confirm.
- **Rules R1–R4:** Director decisions of record for the future mirror repoint (canonical floor ≥1 wins; overlap check stays UI-advisory; duplicate-date check stays UI simplification; catalog checks move to the seam). Recorded in the director JSON.
- **Dashboard N-A/N-C** folded into DASH-C4-1; **N-B** optional. **Billing obs 1/3/4** folded into BILL-C4-1; **obs 2** (dedup retention) routed by the auditor to Integration → INT-C4-1(b).

## Lane assignments for cycle 4

| Lane | Task | Summary | Status |
|---|---|---|---|
| integration | INT-C4-1 | Enforcement composition root on billing's `projectedSnapshotSource` (+ periodic-reconciliation seam), bounded dedup retention/compaction for serverless lifetimes, token-verified **GET /meter** endpoint (pinned DTO), obs-B clock guard. | active |
| rules | RULES-C4-1 | Target-aware evaluation semantics: additive target context so CANCEL frees capacity and RESCHEDULE ignores the booker's own booking; both audit probes become regressions; strictly additive ports.ts evolution owned by this lane. | active |
| dashboard | DASH-C4-1 | Blueprint's **LocationsUsage meter page** (count vs allowance, over-limit + upgrade CTA new-tab, degraded-warning banner, single-location floor note) on the pinned GET /meter DTO; N-A guidance honesty; N-C poller exception wrap. | active |
| billing | BILL-C4-1 | Downgrade-through-gate end-to-end regression (coverage shrink, stable ordering, preserved configuration, restore-on-re-upgrade); projection fidelity folds obs 1/3/4. | active |

## Cross-lane rules

- Canonical contracts `src/domain/ports.ts`, `src/shared/types.ts`, `src/shared/errors.ts` are accepted (`ports.ts` SHA-256 `af68e698…fbc`). **Only RULES-C4-1 may evolve `ports.ts` this cycle, strictly additively** (optional field, safe default preserving CREATE behavior); anything non-additive returns to Director coordination. `shared/**` remains Director-amendment-only.
- **GET /meter DTO is pinned identically in INT-C4-1 and DASH-C4-1** (see NEXT_CYCLE.json `cross_lane_compatibility.pinned_dto_get_meter`); the dashboard fixture-tests it until the platform lane lands; the Director resolves drift at integration.
- **Parity ledger rule:** `tests/domain/uiValidatorParity.spec.ts` fails loudly on validator drift; no lane weakens either side; `ruleDraftValidators.js` stays byte-for-byte unchanged this cycle; R1–R4 apply only at the future repoint, which must consciously update the ledger (Rules audit N1).
- **Vitest glob rule:** all TS suites run through the platform-owned config glob `tests/**/*.spec.ts`; never narrowed.
- Forbidden everywhere: production-capability claims before empirical gates pass; enabling CANCEL/RESCHEDULE enforcement claims before RULES-C4-1 lands; PREVIEW_GATED dependencies; UNSUPPORTED mechanisms; fabricated Wix identifiers; committed secrets.

## Pending external prerequisites (tracked, non-blocking)

1. Human Wix account + CLI authorization; owner/co-owner API key stored as CI secret.
2. One-time scaffold/bind producing real appId → executes `docs/runbooks/T_VP0_SCAFFOLD.md` (also resolves UQ1–UQ4 and extends the repo gate to dashboard JS/TS).
3. One interactive dev-site install consent.
4. Later: payout setup, release approvals, marketplace submission (never automated).

Empirical gates T-VP*, T-WH*, T-BK*, T-RB* remain blocked on the above; no production claims exist in accepted code.
