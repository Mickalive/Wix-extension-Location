# Integrated Audit — target SHA ec916b75 (cross-system, fresh reviewer)

- **Auditor:** independent integrated auditor (fresh cross-system reviewer, model `opencode/big-pickle`). Read-only except this report; no product code, planning, or governance touched; no Wix credentials accessed.
- **Subject:** exact candidate SHA `ec916b75d5600e02d679d264648ac92333d721f1` in the working tree at `/home/runner/work/_temp/wix-factory-33405089836/product`.
- **Accepted base:** `aec73b05eefb17a3643043f3d4f7a6bcba92fc0b` (previously integrated-audited ACCEPT, run CYCLE_32920420147).
- **Task audited against:** `docs/NEXT_CYCLE.json` cycle 7 — sole active lane `integration`, task `INT-C7-LIVE` (consume the real Wix binding). Rules/Dashboard/Billing queues are `complete`.
- **Inputs read:** `MAIN_PROMPT.md`, `AGENTS.md`, binding `docs/WIX_TECHNICAL_CONTRACT.md` + `docs/BUILD_BLUEPRINT.md`, `docs/NEXT_CYCLE.json`, `docs/PRODUCT_GATES.json`, `reports/wix-live/BOOTSTRAP_BINDING.md`, prior integrated audit `CYCLE_32920420147_INTEGRATED.md`, and the complete product source across all four lanes plus integration/registration surface.

---

## 1. Composition integrity (mechanical, re-derived)

The target SHA `ec916b75` is a **pure CI cleanup commit**: `git show ec916b75 --stat` = exactly 4 deleted files, all obsolete control-plane infrastructure:

- `.github/actions/setup-opencode/action.yml`
- `.github/scripts/recover-transient-opencode.sh`
- `.github/scripts/run-opencode-with-retry.sh`
- `.github/workflows/ci.yml`

**No product code changed.** `git diff ec916b75 --stat -- src/ tests/ docs/ extensions.ts package.json tsconfig.json wix.config.json directives/` is **empty** — the product tree is byte-identical to the target SHA.

**Ancestry verified:** walking the parent chain from `ec916b75` reaches the accepted base `aec73b05` through a linear series of CI/governance-only commits (integration candidate, audited manifest, binding persistence, orchestration-on-main moves, recon-workflow removal, retry hardening). The target is a strict descendant of the accepted base; no product commit intervenes.

**Uncommitted working-tree changes** (`git status --short`) are **only** governance files: `.opencode/agents/*`, `.opencode/job-descriptions/*`, `AGENTS.md`. Zero product drift. These are the active-role governance updates described in `AGENTS.md` (retired recon role, active-role-only model) and are outside the product audit scope.

## 2. Executable checks (executed by this auditor on the tree)

1. `npm run check` → **exit 0**: strict `tsc --noEmit` clean; purity gate green over all protected roots (`src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`); **548/548 tests in 49 files**. The `PURITY GATE FAILED` stdout lines are the asserted negative-control fixture inside `purity-gate.spec.ts` (expected — the gate proves it catches injected `@wix/` imports).
2. Test arithmetic: 548 tests across domain (evaluate, targets/matrix, duplicates, windows, exceptions, limits, time, validate, purity, uiValidatorParity), platform (validation-plugin target-aware/handler-matrix/payload/counters/bulk/entitlement/identity/clock-guard, http auth/ruleset/mutations/meter, schedule-mutation, orchestrator-terminal-states, idempotency, webhooks-chaos/envelope/pipeline, composition-root, projector-compaction, registration-surface/project-config, platform-scope, fakes-consumers, purity-gate), billing (entitlement, entitlementGate, coverage, tiers, counter, counterAdapters, projection, projectionFidelity, projectionSnapshotSource, downgradeThroughGate, upgradeUrl, purity). No test lost or duplicated.

## 3. Cross-lane contract verification (all four lanes + integration surface)

I independently read every product source module across all lanes and verified the cross-lane contracts hold:

- **Rules (domain, pure):** `evaluate.ts` is the single decision function; `validate.ts` is the canonical structural validator shared with the dashboard mirror; `ports.ts` carries the additive `EvaluationTargetContext`; target-aware CREATE/CANCEL/RESCHEDULE matrix is enforced by executable properties (determinism sweep, explanation well-formedness, CANCEL-tail drift guard, matrix↔code consistency). DST gap/overlap, midnight-boundary, split-window intersection, CLOSED-beats-OVERRIDE, cap bucket conversion, and identity-free-first duplicate protection are all present and pinned by tests. No `@wix/` import anywhere (purity gate).
- **Billing (pure projection/enforcement/counter):** entitlement/coverage/tiers are pure; the entitlement gate restricts NEW rule configuration for out-of-coverage locations while never trapping existing data (downgradeThroughGate proves no config deletion on downgrade); counter degrades fail-open with a visible notice, never silently; upgrade URL mirrors the dashboard byte-for-byte in behavior. No Wix call from policy code.
- **Platform (integration):** validation-plugin handlers wire the six targets onto the three operations with §5.3 failure semantics (CREATE/CANCEL fail-closed, RESCHEDULE fail-open with `FAIL_OPEN_NOT_ENFORCED` — no enforcement claim); schedule-mutation orchestrator implements snapshot→diff→apply→verify→rollback with idempotency keys and kill-the-power recovery; http handlers all begin with `requireVerifiedCaller` and fail closed before any store/gateway access; registration surface welds the registered targets to the implemented `VALIDATION_TARGETS` matrix (single source of truth). Purity gate green.
- **Dashboard (UI):** editorStore enforces informed consent at three independent layers (reducer, page UI, modal UI) with stale-hash replay rejection; validation mirror is fail-closed (a bad integration can never silently disable validation) and repoints to the canonical domain validator; diff engine is deterministic; mutation poller is bounded; upgrade URL mirrors billing. Accessibility-sensitive behavior (disabled buttons swallow clicks, keyboard Enter/Space activation, focus restore in modals) is implemented and tested. The only lane module allowed to reference Wix runtime is `services/bridge.js` (test-enforced).
- **Extensions:** `rules-editor.page.js`, `locations-usage.page.js`, `diff-confirm.modal.js` are credential-free registration shapes consuming only typed lane interfaces; they never touch Wix runtime modules directly.

**Contract parity confirmed:** domain ports ↔ validation-plugin handlers ↔ billing entitlement gate ↔ http endpoints ↔ schedule-mutation orchestrator ↔ UI bridge all align. No forked semantics, no bypassed bridge, no weakened validation.

## 4. Rollback, destructive-write safety, failure posture

The schedule-mutation machinery (snapshot→diff→apply→verify→rollback, idempotency keys, webhook dedup/ordering, kill-the-power recovery) is byte-untouched by this target (pure CI cleanup). The editorStore consumes one confirmed consent per apply attempt; every terminal outcome clears the confirmation so a retry always requires fresh review + confirm; recovery is an explicit user action, never auto-triggered. No silent destructive schedule rewrite exists. The target SHA introduces no mutation path at all — destructive-write risk is nil by construction.

## 5. Real Wix binding (INT-C7-LIVE progress)

`reports/wix-live/BOOTSTRAP_BINDING.md` documents a **real authenticated Wix app binding** to the explicitly selected existing app **Advanced Booking Rules** (App ID `3e9ec3af-001b-4684-a197-a5133677844d`). No app was created; a real `wix build` completed before the binding was persisted. The real `wix.config.json` exists on disk (`{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`) and is **gitignored** (`.gitignore` lines 12, 19: `.wix/` and `wix.config.json`) — confirmed by `git status --short -- wix.config.json` returning empty. No credentials are present in the config or the report. The committed `wix.config.example.json` carries only explicit placeholders.

This is genuine progress on the `real_wix_scaffold_registration` gate, but the gate itself remains honestly `OPEN` in `docs/PRODUCT_GATES.json` (all 11 gates `OPEN`), because the full scaffold/dev-site/MCP evidence chain (T-VP0 onward) has not yet completed. No fabrication, no premature `READY`.

## 6. Anti-fabrication, honesty, scope

- No `wix.config.json` committed — gitignored with rationale; the committed example carries only placeholders.
- No identifiers/secrets in product code; only RFC-2606 `.invalid`/`.example` hosts and clearly-named test fixtures.
- All empirical gates (T-VP*, T-WH*, T-BK*, T-RB*) remain open and unbypassed; `PRODUCT_GATES.json` honestly keeps them `OPEN`.
- The target SHA is a pure CI cleanup — it removes obsolete control-plane workflows/retry scripts that are superseded by the current retry/watchdog orchestration described in `AGENTS.md`/`agent-workflow.md`. This is consistent with the governance model (the watchdog and retry policy are now owned by the trusted workflow shell, not by committed scripts). No product behavior is affected.

## 7. Non-blocking observations (record; no repair required)

1. **O1 (inherited):** the real `wix.config.json` binding is present on disk but not yet consumed by the integration surface for the full scaffold (INT-C7-LIVE is still active). This is expected — the task is in progress, not complete.
2. **O2 (inherited):** all 11 product gates remain `OPEN`; the product is not yet `release_candidate`. This is correct and honest — no `READY` claim is made.
3. **O3:** the target SHA deletes `.github/workflows/ci.yml` and the retry scripts; the current orchestration relies on the trusted workflow shell + watchdog. This is a governance/orchestration change outside product scope and consistent with the active-role model.

## 8. Verdict rationale

The target SHA `ec916b75` is a pure CI cleanup commit that deletes 4 obsolete control-plane files and changes **zero product code**. I verified this mechanically: `git diff ec916b75 --stat -- src/ tests/ docs/ extensions.ts package.json tsconfig.json wix.config.json directives/` is empty, and the working-tree changes are only governance files. `npm run check` passes (typecheck clean, purity gate green, 548/548 tests in 49 files). I independently read every product source module across all four lanes and confirmed the cross-lane contracts (domain ports, validation-plugin handlers, billing entitlement gate, http endpoints, schedule-mutation orchestrator, UI bridge) all align with no forked semantics, no bypassed bridge, no weakened validation, and no silent destructive writes. The real Wix binding now exists (BOOTSTRAP_BINDING.md, App ID `3e9ec3af-001b-4684-a197-a5133677844d`, gitignored `wix.config.json`, no credentials) — genuine progress on the scaffold gate while all gates remain honestly `OPEN`. Adversarial review found no semantic regression, no weakened test, no hidden degraded state, no unsupported Wix assumption, and no scope violation. The observations above are cosmetic or standing and none blocks integration.

VERDICT: ACCEPT
