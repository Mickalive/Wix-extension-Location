# Next Cycle — Build Cycle 3

Current phase: **BUILD**. Planning authority: `reports/director/CYCLE_32787032785.json` (Director pass over Product Factory run 32787032785, 2026-08-25). Machine-readable queue: `docs/NEXT_CYCLE.json`.

## Outcome of cycle 2 (run 32787032785)

| Lane | Task | Audit verdict | Disposition |
|---|---|---|---|
| integration | INT-C2-1 (services layer v1) | `VERDICT: ACCEPT` | **Integrated** — orchestrator terminal-state hardening; five token-verified fail-closed HTTP handlers; webhook dedup/ordering/crash-recovery pipeline with chaos proofs |
| rules | RULES-C2-1-REPAIR | `VERDICT: ACCEPT` | **Integrated** — all cycle-1 blockers (B1–B4) repaired with §4.7-cited fixture corrections and the midnight-boundary false-block fix; 126/126 green; ports.ts byte-identical |
| dashboard | DASH-C2-1-REPAIR | `VERDICT: ACCEPT` | **Integrated** — diff-modal exception fidelity + triple-layered consent gating with negative UI tests; F-N2–F-N7 addressed; 98/98 real tests after the mandatory port-time deletion of `tests/ui/zzscratch.test.js` |
| billing | BILL-C2-1-REPAIR | `VERDICT: ACCEPT` | **Integrated** — F1–F5 repaired with adversarial bug-reintroduction proof; throw-vs-null paging semantics documented; 51/51 green |

No negative verdicts this cycle → **no repair lanes**. All full audit reports preserved under `reports/audits/CYCLE_32787032785_*.md`.

Director actions at integration:
- Executed the staged additive `'UNAUTHORIZED'` error-taxonomy amendment exactly as documented by the accepted candidate (`src/shared/errors.ts`, `auth.ts`, transport status map, helper assertions); full gate re-verified green.
- Deleted `tests/ui/zzscratch.test.js` (mandatory per Dashboard audit N-1) and renamed `tests/platform/zz-debug.spec.ts` → `webhooks-pipeline-contract.spec.ts` (sanctioned by Integration audit obs 2).

Integrated-tree deterministic gates: strict typecheck clean · purity green · **256/256** vitest (112 platform + 93 domain + 51 billing) · offline rerun **256/256** · dashboard lane **98/98**.

Asynchronous simulated-Wix QA: **still not available** (`LATEST.json` absent, no `qa/wix-sim-latest` remote branch). It did not delay this cycle; the next Director pass must mount and disposition it when present.

## Lane assignments for cycle 3

| Lane | Task | Summary | Status |
|---|---|---|---|
| integration | INT-C3-1 | Booking-time enforcement wiring (Blueprint flow 1): pure validation-plugin handler modules consuming canonical `evaluateRules` + billing `EntitlementGate`; explicit per-item bulk results (maxItems 12, omitted-items hazard); fail-closed CREATE/CANCEL vs fail-open RESCHEDULE; identity-free-first (C1); cached counters with degraded-cap surfacing; audit nits N3/N4/N5. | active |
| rules | RULES-C3-1 | Cross-lane validator parity contract test (discharges Director-tracked F-N1 from the domain side): vitest spec importing canonical `validateRuleSet` AND the dashboard's JS provisional validators across a six-family corpus; plus README ownership note for the shared vitest glob (N3). | active |
| dashboard | DASH-C3-1 | Mutation-lifecycle surface (Blueprint flow 3): bridge methods for mutation-status/recover, bounded polling to terminal state, explicit user-initiated recover, server-validation-shaped seam injection prep (F-N1 UI side). | active |
| billing | BILL-C3-1 | Plan-state projection + reconciliation machine (Contract §7 / Blueprint flow 5): webhook-event + snapshot projection with reconciliation supremacy, idempotent out-of-order convergence, dunning/cancelled-until-expiry branches; audit observations 1–2 folded in. | active |

## Cross-lane rules

- Canonical contracts `src/domain/ports.ts`, `src/shared/types.ts`, `src/shared/errors.ts` are accepted; `'UNAUTHORIZED'` is now a canonical `ErrorCode` member (Director amendment, run 32787032785). Consume, never fork; further semantic changes require Rules-lane ACCEPT + Director amendment (ports) or Director amendment only (shared).
- Sequencing satisfied: validation-plugin wiring unblocked by Rules ACCEPT; EntitlementGate consumption unblocked by Billing ACCEPT; validator repoint split cleanly — RULES proves parity, DASH prepares the seam.
- **Vitest glob rule:** all TS suites run through the platform-owned config glob `tests/**/*.spec.ts`; it must never be narrowed (Rules audit N3).
- Forbidden everywhere: production-capability claims before empirical gates pass, PREVIEW_GATED dependencies, UNSUPPORTED mechanisms, fabricated Wix identifiers, committed secrets.

## Pending external prerequisites (tracked, non-blocking)

1. Human Wix account + CLI authorization; owner/co-owner API key stored as CI secret.
2. One-time scaffold/bind producing real appId → executes `docs/runbooks/T_VP0_SCAFFOLD.md` (also resolves UQ1–UQ4 and extends the repo gate to dashboard JS/TS).
3. One interactive dev-site install consent.
4. Later: payout setup, release approvals, marketplace submission (never automated).

Empirical gates T-VP*, T-WH*, T-BK*, T-RB* remain blocked on the above; no production claims exist in accepted code.
