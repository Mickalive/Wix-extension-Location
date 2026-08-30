# Integrated Audit — exact SHA `ec916b75d5600e02d679d264648ac92333d721f1`

- **Auditor:** independent integrated auditor (fresh cross-system review; read-only except this report).
- **Subject:** exact commit `ec916b75d5600e02d679d264648ac92333d721f1` ("product: remove obsolete control-plane workflows and retry scripts", 2026-08-28), detached HEAD of the accepted branch.
- **Method:** every product path (`src/`, `tests/`, `package.json`, `package-lock.json`, `wix.config.json`, `extensions.ts`, `docs/`, `reports/`) verified byte-identical between the working tree and the audited SHA (`git diff` empty over those paths); all file reads via `git show <sha>:<path>` against the committed tree. Working-tree governance edits (`.opencode/**`, `AGENTS.md`) are untrusted, out of scope, and not part of this SHA.
- **Executed on the audited tree:** `npm ci`, `npm run check`, `npm run check:offline`, `npm run build`, and the dashboard lane runner (`npm test` in `tests/ui`).

---

## 1. Executable checks (all executed by this auditor)

| Check | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS (47 packages; credential-free) |
| `npm run check` (strict `tsc --noEmit` + purity gate + vitest) | PASS — **548/548 tests, 49 files**, 0 skipped |
| `npm run check:offline` (proxies pinned to dead port) | PASS — **548/548**, zero network egress proven |
| `npm run build` | PASS — 548/548 (equals `check`) |
| Dashboard lane (`node --test` in `tests/ui`) | PASS — **210/210** |
| Purity gate | PASS over all seven protected roots (`src/domain`, `src/billing/pure`, `src/platform/{http,webhooks,validation-plugin,composition,registration}`) |

The mid-run `PURITY GATE FAILED` console lines are the asserted negative-control fixture inside `tests/platform/purity-gate.spec.ts` (4 tests, green); overall exits are 0.

## 2. Cross-lane contract verification

- **Rules ↔ Integration (enforcement):** `src/domain/evaluate.ts` is the single decision function; the validation-plugin handlers call it once per item with `targetContext` mapped by `evaluationTargetOf` (six platform targets → three operations). The per-target matrix (CREATE: all families; CANCEL: classification-only, cancel-frees-capacity; RESCHEDULE: proposed-slot availability + subject-booking exclusion) is enforced by executable properties (`matrixProperties.spec.ts` 9, `targetAware.spec.ts` 31, `validation-plugin-target-aware.spec.ts` 42, `evaluate.spec.ts` 18 incl. determinism sweep). Failure semantics (`failureSemanticsFor`: CREATE/CANCEL FAIL_CLOSED, RESCHEDULE FAIL_OPEN) are single-sourced in `src/shared/errors.ts` and re-derived per target with drift-failing tests.
- **Integration ↔ Billing (entitlement):** `composeValidationEntitlement` wires projector → `projectedSnapshotSource` → `createEntitlementGate` → `ValidationPluginDeps.entitlementGate` with zero webhook-type leakage (test-pinned in `composition-root.spec.ts` 8). The GET /meter DTO is pinned identically on producer (`meterEndpoint.ts`) and consumer (`src/ui/services/bridge.js` + LocationsUsage page) sides; per-half fail-open degradation never 5xxes the dashboard (`meter-endpoint.spec.ts` 10).
- **Dashboard ↔ Rules (validation parity):** `ruleDraftValidators.js` is a documented provisional mirror wired through the single repoint seam `validation/mirror.js`; parity ledger `uiValidatorParity.spec.ts` 30/30 green; server results are injected verbatim, non-conforming sources rejected fail-closed.
- **Billing ↔ Dashboard (meter/restriction):** editor restriction and meter page consume the same `allowedLocationIds()` decision; stable ordering never reordered client-side; over-limit CTA uses the exact contract URL; identifiers never fabricated when missing (UI tests 80–93, 174–197).
- **Frozen contracts:** `src/shared/types.ts`, `src/shared/errors.ts`, `src/domain/ports.ts` (SHA-256 `d46e0743…18802` pinned in-suite) intact; repo-wide tsc proves all consumers compile.

## 3. Booking-time enforcement

- Six handlers (`CREATE/CANCEL/RESCHEDULE` + `*_MULTI_SERVICE`) return an explicit result for EVERY bulk index (MAX_BULK_ITEMS=12; omitted-items-default-valid hazard neutralized by construction — `validation-plugin-bulk.spec.ts` 6).
- Payload mapping uses documented fields only; identity consumption gated OFF by default until T-VP3 evidence; `subjectBookingFacts` seam defaults to unavailable (RESCHEDULE self-exclusion inert until proven payload shape).
- Degradations are typed, returned in-band AND pushed to the sink, never silent; entitlement gate failures degrade fail-open (never block); CREATE/CANCEL internal failure blocks with retry hint; RESCHEDULE fails open forever with `FAIL_OPEN_NOT_ENFORCED` — no enforcement claim made or permitted (§5.3/§10/§12; banned-claim scans green).

## 4. Schedule-mutation rollback/recovery

- Orchestrator: snapshot → diff → idempotent (UUIDv5) writes → verify → rollback → audit; crash leaves `APPLY_IN_PROGRESS`; serverless-friendly `beginApply/applyNextChange/completeApply`; `recoverInterruptedApply` heals interrupted applies (`schedule-mutation.spec.ts` 10, `orchestrator-terminal-states.spec.ts` 7, `idempotency.spec.ts` 8).
- HTTP surface: apply-plan accepts ONLY a confirmed diff hash (no inline plans); mutation-status and recover endpoints are token-verified; recovery is click-only in the UI, never automatic; bounded polling (maxAttempts=8) with terminal-state allowlist mirroring the orchestrator (`mutationPoller.js` + 16 UI tests).
- Webhooks: envelope-id dedup, `entityEventSequence` ordering with gap buffering, ≤12 retries, 1250 ms deadline (`webhooks-chaos.spec.ts` 13, `webhooks-pipeline-contract.spec.ts` 5, `webhooks-envelope-validation.spec.ts` 6).
- No silent destructive schedule rewrites: every mutation path requires explicit user consent (3-layer gating), stale-hash rejection, and a rendered diff preview.

## 5. Billing / entitlements

- Tiers match Contract §7 exactly (FREE $0/1, TIER_1 $9.99/1, TIER_2_3 $19.99/3, TIER_4_10 $34.99/10, TIER_11_PLUS $49.99/∞); features identical across paid tiers; only location allowance differs.
- Count: floor 0→1, archived===false liveness, non-hidden services referencing a BUSINESS location, deterministic ascending ids.
- Downgrade: coverage shrinks, configuration never deleted, restore-on-re-upgrade proven end-to-end (`downgradeThroughGate.spec.ts` 2).
- Reconciliation supremacy (trial→paid fires no event → mandatory poll seam); compaction bounds dedup memory with watermark fencing against stale replays (`projector-compaction.spec.ts` 12); clone isolation via instance scope; `billingExpirationDate` advisory-only (never consulted for tier flips).

## 6. Accessibility (dashboard)

- Every control has an accessible name; every clickable element keyboard-operable (Enter/Space proven); issues region `role=alert`, status region `role=status` + `aria-live`; diff modal full dialog semantics with focus move/restore; disabled review button explains WHY; degraded/over-limit/restricted composite states keep named, operable controls (UI tests 1–5, 54–61, 97–98, 196–197).

## 7. Real Wix scaffold assumptions — BLOCKING FINDINGS

### F1 (BLOCKING): `wix.config.json` is committed in direct violation of the committed "never commit" policy

- The committed `.gitignore` states: `wix.config.json` — "Real Wix CLI project binding … Holds account-bound identifiers; **never commit** or hand-fabricate."
- The committed `src/platform/registration/README.md` section "Why there is no committed `wix.config.json`" states the file is "**never committed**, never hand-written."
- The audited commit tree **contains** `wix.config.json`:
  ```json
  { "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
  ```
- Consequences: (a) the committed documentation is now false in this tree; (b) the `.gitignore` rule is ineffective for a tracked file; (c) an account-bound identifier is committed against explicit policy; (d) the prior integrated audit's verified positive property ("No `wix.config.json` committed", `CYCLE_32920420147_INTEGRATED.md` §7) is regressed.
- The only in-tree justification is the self-claimed `reports/wix-live/BOOTSTRAP_BINDING.md`. That claim is **not corroborated by the product's own ledger**: `docs/PRODUCT_GATES.json` keeps `real_wix_scaffold_registration` **OPEN with empty evidence**; `docs/state.json` reports `NOT_READY` (`final_auditor_unavailable_or_failed`); and all 14 factory runs after the bootstrap (`CYCLE_33069918456` … `CYCLE_33072886087`) record integration builder failure (exit 75), `wix_live: NOT_RUN`, `pre_wix_gate: CLOSED`. The `INT-C7-LIVE` acceptance criteria in `docs/NEXT_CYCLE.json` (fresh independent Integration audit ACCEPT; Wix Live build/dev-site evidence) are **not met**.
- The appId cannot be verified as real from the repository alone; regardless of its provenance, the committed state presents an unproven binding as committed state while its own policy and ledger say otherwise.
- **Repair direction (owning lane: integration):** remove `wix.config.json` from the committed tree (keep it as a local, gitignored file per the committed policy), reconcile `src/platform/registration/README.md` with the actual tree, and persist scaffold evidence only after a fresh independent audit plus real Wix Live evidence, with the gates ledger updated accordingly. Do not weaken the classifier or the anti-fabrication posture.

### F2 (BLOCKING): real-Wix evidence posture is internally inconsistent

- `BOOTSTRAP_BINDING.md` claims an authenticated binding to the existing app "Advanced Booking Rules" (App ID `3e9ec3af-001b-4684-a197-a5133677844d`) and a successful real `wix build`, yet: the gates ledger records no evidence for `real_wix_scaffold_registration`/`empirical_wix_validation`/`real_wix_build_release` (all OPEN, `evidence: []`); `state.json` is `NOT_READY`; the factory loop has not produced a single ACCEPT since the claim; and the wix-live reports `CYCLE_32915633541.md`/`CYCLE_32920420147.md` predate the claim with `FIX_BEFORE_INTEGRATION`. The claim is therefore unbacked by any accepted audit or ledger entry.
- **Repair direction (owning lane: integration, with Director ledger update):** either complete the evidence chain (fresh independent audit of the real binding + Wix Live build/dev-site evidence + gates update) or retract the claim; never let a self-claimed report substitute for ledger-recorded, independently audited evidence.

## 8. Non-blocking observations

- **O1:** the audited commit itself removes the control-plane workflows/scripts (`.github/workflows/ci.yml`, `.github/actions/setup-opencode/action.yml`, `.github/scripts/*`). Governance says agents never alter orchestration; the trusted workflow shell performs persistence. Flag for Director confirmation that this removal was a deliberate, authorized control-plane migration (factory runs continue to be recorded, so orchestration still functions).
- **O2 (inherited):** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal; placeholder-token matching can false-positive on exotic real appIds (safe direction); two kind vocabularies coexist (`SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `SERVICE_PLUGIN`). Cosmetic; no behavioral effect.
- **O3:** working-tree governance edits (`.opencode/**`, `AGENTS.md`) are untrusted and excluded from this audit; product paths are byte-identical to the SHA.

## 9. Verdict rationale

The four lanes' contracts, booking-time enforcement semantics, schedule-mutation rollback/recovery machinery, entitlement/billing policy, and dashboard accessibility are verified coherent and fully green (548/548 + 210/210 + tsc + seven-root purity + offline + build). The product code is honest, pure, and well-tested.

However, the audited tree commits `wix.config.json` — an account-bound identifier — in direct, verifiable violation of its own committed `.gitignore` and registration README ("never commit"), and the binding it encodes is unproven by the product's own gates ledger, state file, and factory loop (all `NOT_READY`/OPEN; task `INT-C7-LIVE` incomplete). The committed documentation is contradicted by the committed tree. This must be repaired by the integration lane before the state is adoptable; the evidence chain for the real-Wix binding must be completed or retracted, never self-claimed.

VERDICT: FIX