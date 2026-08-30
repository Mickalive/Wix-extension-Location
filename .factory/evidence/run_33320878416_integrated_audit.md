# Factory Integrated Audit — Wix Bookings Advanced Rules

- **Audit type:** Independent cross-lane integrated audit (fresh reviewer, adversarial, read-only)
- **Candidate SHA (exact):** `ec916b75d5600e02d679d264648ac92333d721f1`
- **Candidate subject:** `product: remove obsolete control-plane workflows and retry scripts`
- **Date:** 2026-08-30
- **Authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, lane fiches, `AGENTS.md`

---

## 1. Scope and method

This audit attacks the exact integrated preview at the pinned SHA above, not any
candidate branch. It verifies the contracts *between* the four lanes
(integration, rules, dashboard, billing) plus failure/rollback behavior, and
actively tries to falsify correctness.

Method:

- Verified the exact HEAD SHA and reviewed the recent accepted diff history.
- Read the full source of the domain core, shared DTOs/error taxonomy, every
  platform layer (validation plugin, schedule mutation, webhooks, HTTP,
  registration, composition), the entire billing layer, all fakes, and the
  entire dashboard/UI lane (bridge, store, poller, diff, mirror, validators,
  modals, explain, dom kit, upgrade URL, dashboard pages).
- Ran the deterministic gates (see §7).
- No product code was modified. This report is the only deliverable.

---

## 2. Rules lane — domain core

**Verdict: sound.** The domain core is pure and deterministic; the purity gate
scans `src/domain`, `src/billing/pure`, and the platform directories and finds
no `@wix/` imports, no network, no filesystem, no process access.

- **Target-aware evaluation (RULES-C4-1):** `evaluateRules` receives
  `deps.targetContext`; the six `ValidationTarget`s (CREATE / CANCEL /
  RESCHEDULE plus `_MULTI_SERVICE` variants) are honored. CANCEL evaluates
  classification families only; RESCHEDULE evaluates availability against the
  proposed slot. This is a real semantic distinction, not a stub.
- **Failure semantics (`failureSemanticsFor`):** CREATE and CANCEL are
  FAIL_CLOSED; RESCHEDULE is FAIL_OPEN *forever* — there is no silent flip to
  fail-closed later, and the enforcement claim is explicitly labeled
  `FAIL_OPEN_NOT_ENFORCED`. The product never overstates enforcement.
- **Error taxonomy:** stable codes including `VERIFY_FAILED`,
  `ROLLBACK_INCOMPLETE`, `REVISION_CONFLICT`, `IDEMPOTENCY_REPLAY_CONFLICT` —
  each maps to a distinct, testable failure mode.
- **Capabilities:** weekly windows per location/service, split daily windows,
  date exceptions (CLOSED / OVERRIDE), per-day/per-service/per-location limits,
  duplicate-booking protection, timezone/DST handling via wall-clock + intl-zone
  logic. All deterministic and unit-tested with negative and edge cases.

No contract breach found in the domain core.

---

## 3. Integration lane — platform, mutation safety, rollback

**Verdict: sound.** The platform layer is the strongest part of the preview.

- **Schedule mutation (Contract §9.1/§9.2):** the orchestrator snapshots the
  current schedule, plans the change as a *diff*, applies idempotent writes
  (UUIDv5 keys under namespace `7c9e6679-7425-40de-944b-e07fc1f90ae7`),
  revision-checks every update, verifies the result, and rolls back on any
  failure — emitting a single audit entry. There is no silent destructive
  rewrite path.
- **Crash safety:** an interrupted apply leaves the journal in
  `APPLY_IN_PROGRESS`; `recoverInterruptedApply` resumes deterministically. The
  public `begin`/`next`/`complete` API is serverless-friendly. The
  `SimulatedProcessCrash` fake is intentionally uncaught — the recovery path is
  exercised by tests, not by swallowing the crash.
- **Idempotency:** replay of the same plan id is detected
  (`IDEMPOTENCY_REPLAY_CONFLICT`), so a retried webhook cannot double-apply.
- **Webhooks:** envelope-validated pipeline with injected ports; no hidden
  scraping or browser automation anywhere.
- **HTTP layer:** token verification, transport, mutation/rule-set/meter
  endpoints all isolate Wix API access behind ports.
- **Scaffold honesty:** `wix.config.json` preserves the real bound App ID
  (`3e9ec3af-001b-4684-a197-a5133677844d`, `projectType: App`); the committed
  `wix.config.example.json` is an explicit placeholder. Registration is frozen:
  `extensions.ts` is empty and the manifest marks every extension
  `PLANNED_UNTIL_T_VP0`. No fabricated production capability is claimed.

No contract breach found in the integration lane.

---

## 4. Dashboard lane — UI, consent, accessibility

**Verdict: sound.** The UI consumes typed contracts and never forks domain
semantics.

- **Informed consent (Contract §9.2):** `computeScheduleDiff` produces a
  deterministic, ordered operation list and an FNV-1a hash; apply is permitted
  only while the hash still describes the current draft. The review modal
  renders the exact before→after state for every operation, including exception
  kind/hours/notes. Unknown weekdays are surfaced (`UNKNOWN_WEEKDAY`), never
  silently dropped (F-N7).
- **Mutation polling (DASH-C3-1):** `mutationPoller` mirrors the orchestrator's
  terminal-state allowlist verbatim (`{SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS}`
  non-terminal); it is bounded (default 8 probes), stops permanently on the
  first terminal state or error, contains observer faults, and **never**
  auto-recovers — recovery is a separate click-only affordance, honoring the
  explicit-intent rule.
- **Validation seam (F-N1):** `validation/mirror.js` is the single repoint seam.
  It accepts either a function or a structurally conforming server
  `ValidationResult` (snapshotted at injection); any non-conforming source is
  rejected and the previous source stays active — a bad integration can never
  silently disable validation. The bundled `ruleDraftValidators` are explicitly
  flagged provisional with the Director-tracked repoint obligation.
- **Provisional validators:** time format, leap-year-aware calendar dates,
  window overlap, limit integer/negativity, exception kind/window/duplicate-date
  checks — all deterministic, all negative-tested.
- **Accessibility:** modal focus management, keyboard handling, and the dom kit
  were reviewed; no weakening of validation or a11y to make tests pass.
- **UI suite:** 210/210 tests GREEN (see §7).

No contract breach found in the dashboard lane.

---

## 5. Billing lane — entitlements, reconciliation, downgrade safety

**Verdict: sound.** Paid tiers differ only by location allowance, exactly as
the constitution requires.

- **Tiers:** FREE (1 location), TIER_1 $9.99 (1), TIER_2_3 $19.99 (3),
  TIER_4_10 $34.99 (10), TIER_11_PLUS $49.99 (unlimited).
- **Entitlement decision table:** null plan ⇒ FREE; `isFree` ⇒ FREE; empty
  `vendorProductId` ⇒ FREE; known plan ⇒ its tier; unknown plan ⇒ TIER_1 with an
  `UNKNOWN_PLAN_IDENTIFIER` warning and `restrictionReliable: false`. The
  product never invents an entitlement mechanism.
- **C2 honored:** `billingExpirationDate` is never read anywhere in the
  codebase.
- **Downgrade safety:** over-limit locations are ordered stably (default first,
  then byte-wise id) and *management is disabled, never deleted* — customer
  configuration is preserved on downgrade.
- **Counter:** floor 0→1; counts only relevant active Bookings locations.
- **Projector/reconciliation:** reconciliation supremacy — a snapshot re-seeds
  the event layer, clears the generation, and dedup survives; convergence is via
  `(entityEventSequence, id)` fold; same-instance events are isolated
  (`FOREIGN_INSTANCE`). Trial→paid fires no event, so periodic reconciliation is
  mandatory and is wired in composition. Compaction bounds `seenEventIds`
  (retirement FIFO + forced rebuild).
- **Degraded posture:** fail-open is persisted via a warning ledger, so the
  dashboard can show honest degraded state instead of pretending enforcement.
- **Meter:** pinned DTO `{meter, coverage}`; authenticated requests always get
  200 with halves isolated; upgrade URL is
  `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`.

No contract breach found in the billing lane.

---

## 6. Cross-lane contract verification

- **Enforcement chain:** validation-plugin handlers → domain `evaluateRules`
  (target-aware) → `failureSemanticsFor` → `enforcementClaim`. The chain is
  coherent end-to-end and the FAIL_OPEN case is explicitly labeled
  not-enforced rather than silently claimed as enforced.
- **Mutation chain:** UI diff/hash consent → orchestrator snapshot→diff→apply →
  verify → rollback → audit → poller terminal states. The UI's terminal-state
  semantics mirror the orchestrator's allowlist verbatim, so a future state
  addition can never leave the poller running forever.
- **Entitlement chain:** composition → reconciliation → projector → counter →
  gate → meter/upgrade URL. Halves are isolated; degraded posture is persisted
  and visible.
- **Registration honesty:** all 11 product gates in `docs/PRODUCT_GATES.json`
  are `OPEN` with empty evidence; no `READY` claim exists anywhere. The preview
  is honest about being pre-live-QA.
- **Governance boundary:** the working tree contains uncommitted churn in
  `.opencode/agents/*` and `AGENTS.md` (v2→v3) — harness/governance context, not
  candidate product code. No candidate code touches governance files.

---

## 7. Deterministic results

| Check | Command | Result |
|---|---|---|
| Root gate (typecheck + purity + vitest) | `npm run check` | **GREEN** (exit 0) |
| UI suite (node --test) | `npm test` in `tests/ui` | **GREEN** — 210/210 |

Observations (non-blocking, Director-tracked):

1. The UI suite (210 tests) is **not wired into the root `npm run check` gate**;
   it runs standalone via `tests/ui`. This is a CI/process wiring matter, not a
   candidate-code defect — the tests exist and pass.
2. Documentation metadata drift: `docs/state.json` reports cycle 21 /
   `NOT_READY`, `docs/NEXT_CYCLE.json` reports cycle 7, `docs/LOOP_HEALTH.json`
   reports last cycle 6. Cosmetic; no product impact.
3. All gates `OPEN` with empty evidence is correct and honest for a preview that
   has not yet faced Wix Live QA.

---

## 8. Conclusion

The integrated preview at `ec916b75d5600e02d679d264648ac92333d721f1` is
internally coherent across all four lanes. The enforcement chain is
target-aware and honest about fail-open; schedule mutations are diff-based,
idempotent, revision-checked, verified, rollback-safe, and crash-recoverable;
entitlements are conservative and downgrade-safe; the dashboard honors explicit
consent and never auto-recovers; and registration/scaffold state makes no
fabricated production claims. All deterministic checks pass. No material
contract breach was found.

VERDICT: ACCEPT