# Next Cycle — Build Cycle 1

Current phase: **BUILD** (advanced from `recon` on 2026-08-24 by wix-recon-director; decision record: `reports/director/RECON_DECISION.json`).

## Why build is authorized

The independent recon audit returned **PASS_WITH_BLOCKERS**: every load-bearing architectural claim survived falsification against current official Wix documentation, no deprecated path is in the chosen stack, and no Developer Preview capability is required for the MVP. All seven audit blockers (B1–B7) were contract-writing tasks and are now resolved as binding invariants in `docs/WIX_TECHNICAL_CONTRACT.md` (see decision record, `blocker_resolution`). The director additionally spot-checked three load-bearing pages live on 2026-08-24 — including a new verified fact: booking-count reads require one of three elevated scopes (`READ-CALENDAR-WITH-PARTICIPANTS` selected as least-privilege), now fixed in the contract's scope table.

Remaining unknowns are empirical dev-site gates (T-VP0–T-VP5, T-WH1–6, T-BK1–4, T-RB1–2). Per the audit they block **production claims**, not build start. Until human-owned credentials exist (Wix account, scaffold/bind, dev-site consent, CI API key), all lanes do credential-free work. No lane is blocked.

## Lane assignments (machine-readable source: `docs/NEXT_CYCLE.json`)

| Lane | Task | Summary | Status |
|---|---|---|---|
| integration | INT-C1-1 | Credential-free platform foundation: project tooling + purity gate, finalize `src/domain/ports.ts` + shared DTOs, fake adapters for every port, snapshot→diff→apply→verify→rollback schedule-mutation orchestrator with UUIDv5 idempotency keys / revision retries / crash recovery / audit log, and the T-VP0 scaffold runbook with documented fallback. | active |
| rules | RULES-C1-1 | Pure availability-rules core v1: per-location/per-service weekly windows incl. split hours, dated exceptions with precedence, day/service/location caps with declared status policy, identity-free-first duplicate protection, site-IANA-zone DST-safe time math via injected Clock, explainable RuleOutcome everywhere; exhaustive Vitest incl. negative/edge/DST fixtures. | active |
| dashboard | DASH-C1-1 | Rules editor shell on @wix/design-system patterns: windows/split-hours/exceptions/caps forms validated by importing the pure domain validators, diff-preview modal gating any apply behind explicit confirm, ExplainPanel rendering domain outcomes, single typed services bridge, accessibility assertions, headless tests. | active |
| billing | BILL-C1-1 | Billable-location counter (ratified algorithm: paginated locations ∩ paginated non-hidden services' BUSINESS ids, archived=false liveness, 0→1 floor) + entitlement state machine (free/trial/paid/dunning/expiry/clone) honoring advisory-only expiration, fail-open-with-warning posture, stable over-limit ordering, upgrade URL builder; pure core fully unit-tested. | active |

## Cross-lane rules

- Ports and shared DTOs are finalized by INT-C1-1 in the shapes pre-declared in Blueprint §3; directory ownership is disjoint (Blueprint §2), so the four tasks merge without conflict.
- Repair priority: if a lane's latest persisted audit is `FIX_BEFORE_INTEGRATION` or `REJECT`, repairing those findings precedes the scheduled task.
- Forbidden everywhere: production-capability claims before empirical gates pass, PREVIEW_GATED dependencies, UNSUPPORTED mechanisms, fabricated Wix identifiers, committed secrets.

## Pending external prerequisites (tracked, non-blocking)

1. Human Wix account + CLI authorization; owner/co-owner API key stored as CI secret.
2. One-time scaffold/bind producing real appId, namespace, code identifier → executes T-VP0 runbook.
3. One interactive dev-site install consent.
4. Later: payout setup, release approvals, marketplace submission (never automated).
