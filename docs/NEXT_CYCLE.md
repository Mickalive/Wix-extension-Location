# Next Cycle — Build Cycle 5

Current phase: **BUILD**. Planning authority: `reports/director/CYCLE_32881643441.json` (Director pass over Product Factory run 32881643441, 2026-08-25). Machine-readable queue: `docs/NEXT_CYCLE.json`.

## Outcome of cycle 4 (run 32881643441)

| Lane | Task | Audit verdict | Disposition |
|---|---|---|---|
| integration | INT-C4-1 (composition root + GET /meter + compaction + obs-B guard) | `VERDICT: ACCEPT` | **Integrated** — billing→enforcement composition with zero webhook-type leakage; §7 reconciliation seam; bounded dedup retention with proven replay convergence; token-verified meter endpoint (pinned DTO, fail-open degradation) |
| rules | RULES-C4-1 (target-aware evaluation) | `VERDICT: ACCEPT` | **Integrated** — additive `targetContext` (safe CREATE default); CANCEL frees capacity; RESCHEDULE excludes the mover's own booking; both Observation-A probes pinned as regressions; auditor re-proved bit-for-bit CREATE preservation |
| dashboard | DASH-C4-1 (LocationsUsage meter page + N-A/N-B/N-C) | `VERDICT: ACCEPT` | **Integrated** — meter page on pinned DTO (allowance state, over-limit CTA new-tab, degraded banner, floor note); recovery-guidance honesty; poller observer containment |
| billing | BILL-C4-1 (downgrade-through-gate + fidelity folds) | `VERDICT: ACCEPT` | **Integrated** — end-to-end downgrade regression through the public gate API; observations 1/3/4 folded with behavioral proof |

No negative verdicts → **no repair lanes**. All audits preserved under `reports/audits/CYCLE_32881643441_*.md`.

Integrated-tree deterministic gates: strict typecheck clean · purity green (**six roots** — Director added `src/platform/composition` per audit obs O2) · **465/465** vitest · offline rerun exit 0 · dashboard lane **186/186**. Arithmetic: 392 base + 34 INT + 31 RULES + 8 BILL = 465 ✓.

Asynchronous simulated-Wix QA: **still not available** (`LATEST.json` absent, no `qa/wix-sim-latest` remote branch). It did not delay this cycle. Noted escalation: the simulation has never completed for any run — release-readiness must treat QA recency as an open gate.

## Key dispositions

- **All prior-cycle findings are now closed by integrated code:** Observation A/B (integration), N-A/N-B/N-C (dashboard), Billing obs 1–4.
- **Cycle-4 audit observations dispositioned:** O2 applied as Director purity-root amendment; Rules obs A → RULES-C5-1(c) drift guard, obs B → INT-C5-1(d); Dashboard N-1 consciously deferred (not contract-mandated), N-2 no-action, N-3 ledgered for T-VP0; Integration O1/O3 recorded.
- **Canonical contracts:** `ports.ts` accepted at new SHA `d46e0743…18802` after the authorized additive RULES-C4-1 evolution; **frozen in cycle 5**. `shared/**`, `ruleDraftValidators.js` byte-identical.

## Lane assignments for cycle 5

| Lane | Task | Summary | Status |
|---|---|---|---|
| integration | INT-C5-1 | **Activate target-aware enforcement**: supply `targetContext` on every handler `evaluateRules` call (six targets → three operations), injectable subject-booking-facts seam (conservative default = today's behavior), platform-level Observation-A regressions through real handlers, self-count disposition. The cycle-4 domain fix is currently **dormant at runtime** — this closes it. | active |
| rules | RULES-C5-1 | Target-matrix property hardening: determinism + explanation-completeness sweeps across CREATE/CANCEL/RESCHEDULE, CANCEL-tail drift guard (obs A), README-matrix-vs-code consistency pins. ports.ts frozen. | active |
| dashboard | DASH-C5-1 | **§7 management-side entitlement restriction** in the RulesEditor using the shipped `getEntitlementMeter()`: restrict NEW rules on uncovered locations (stable-ordering note), never delete existing configuration, degraded warnings, upgrade CTA, graceful 404/null degradation. | active |
| billing | — | Every §7 requirement implemented, tested, adversarially audited (cycles 2–4). No evidence-backed pre-scaffold task remains; marked **complete** with evidence in NEXT_CYCLE.json. | complete |

## Cross-lane rules

- **ports.ts FROZEN** at SHA `d46e0743…18802`; INT-C5-1 consumes the optional `targetContext` exactly as accepted; any further evolution needs fresh Director coordination + fresh Rules ACCEPT.
- **GET /meter DTO stays pinned v1** — no reshaping this cycle; N-1 allowance display deferred.
- Parity ledger rule unchanged (`ruleDraftValidators.js` byte-for-byte; R1–R4 + N-3 repoint obligations apply only at T-VP0).
- Vitest glob rule unchanged; dashboard lane runs `node --test` from `tests/ui`.
- Forbidden everywhere: production-capability claims before empirical gates; reschedule-enforcement promises beyond best-effort; fabricated payload fields (C1 discipline binds INT-C5-1's subject seam doubly); PREVIEW_GATED/UNSUPPORTED mechanisms; secrets.

## Pending external prerequisites (tracked, non-blocking)

1. Human Wix account + CLI authorization; owner/co-owner API key stored as CI secret.
2. One-time scaffold/bind producing real appId → executes `docs/runbooks/T_VP0_SCAFFOLD.md` (resolves UQ1–UQ4; extends repo gate to dashboard JS/TS; enables the parity-ledger/mirror repoints).
3. One interactive dev-site install consent.
4. Later: payout setup, release approvals, marketplace submission (never automated).

Empirical gates T-VP*, T-WH*, T-BK*, T-RB* remain blocked on the above; no production claims exist in accepted code.
