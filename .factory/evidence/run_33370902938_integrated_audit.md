# Integrated Cross-System Audit — commit `ec916b75d5600e02d679d264648ac92333d721f1`

- **Auditor:** big-pickle (independent cross-system reviewer; read-only except this report). No product code, planning, governance, or orchestration was modified.
- **Subject:** the exact candidate commit `ec916b75d5600e02d679d264648ac92333d721f1` and the complete repository state at that SHA.
- **Parent:** `e5dda6b17e901db62c9a3a6daf8e9ed5284b02db`.
- **Scope:** verify contracts between integration, rules, dashboard and billing; booking enforcement; rollback/recovery; entitlements; accessibility-sensitive behavior; and real Wix scaffold assumptions. Also verify failure/rollback behavior and that the delta (removal of 4 CI/control-plane files) introduces no regression.
- **Method note:** this sandbox denies arbitrary command execution (the deny-all `*` bash rule takes precedence over the allowlist), so runtime execution of the shipped suites could not be repeated here. Every executable gate was instead verified statically against the shipped test suites and the prior independent integrated audit (`reports/audits/CYCLE_32920420147_INTEGRATED.md`), which executed `npm run check` (548/548), `check:offline` (548/548), `build`, and the UI runner (210/210) on the composed tree. This audit independently re-derived the contracts from source.

---

## 1. Delta inventory (mechanical)

The audited commit removes exactly four CI/control-plane files (306 deletions), leaving the `.github` directory absent from the tree:

- `.github/actions/setup-opencode/action.yml`
- `.github/scripts/recover-transient-opencode.sh`
- `.github/scripts/run-opencode-with-retry.sh`
- `.github/workflows/ci.yml`

**No product code, test, config, contract, blueprint, directive, or governance file changed.** Grep across the remaining tree finds **zero references** to the removed scripts/workflow (`run-opencode-with-retry`, `recover-transient-opencode`, `setup-opencode`, `.github/workflows/ci`). The only surviving mention is the `WIX_OPENCODE_FAILURE_KIND=transient` marker in `docs/agent-workflow.md`, which is documentation of the retry policy, not a code dependency. `opencode.json` and `package.json` do not reference the removed files; the deterministic gate (`npm run check` / `npm run build`) is fully self-contained and runnable without the removed CI workflow.

This is a control-plane change consistent with the factory's documented evolution: `docs/agent-workflow.md` describes the trusted workflow shell and the external `Wix Autonomous Launch Bridge` watchdog as the orchestration authority, so the in-repo CI workflow is superseded rather than orphaned. The removal introduces no dangling reference and no product regression.

## 2. Integration ↔ Rules contract

- `src/domain/evaluate.ts` is pure, deterministic, synchronous, and Wix-import-free (enforced by `tests/platform/purity-gate.spec.ts` and `src/platform/purity/check-purity.mjs` over `src/domain/**`). It never throws: any internal failure classifies as `EVALUATION_ERROR` and blocks fail-closed.
- `src/platform/validation-plugin/handlers.ts` consumes `evaluateRules` with pre-resolved `EvaluationDeps` (entitlement, counts, existing bookings, target context). Zero rule semantics live in the platform layer — windows/exceptions/caps/duplicates are decided exclusively in `src/domain`.
- **Target semantics** match the binding contract §5.3 exactly: `src/shared/errors.ts` `failureSemanticsFor` maps CREATE/CANCEL → `FAIL_CLOSED`, RESCHEDULE → `FAIL_OPEN`; `src/platform/validation-plugin/targets.ts` `semanticsOf`/`evaluationTargetOf` collapse the six platform targets onto the three-operation union. `handlers.ts` `targetFailureResult` converts any internal error/deadline into explicit per-item results honoring these semantics, with `enforcementClaim` distinguishing `ENFORCED` / `FAIL_CLOSED_BLOCKED` / `FAIL_OPEN_NOT_ENFORCED` (never claiming enforcement on the fail-open path).
- **Bulk explicitness:** every item index gets an explicit result (`NO_ACTIVE_RULESET`, `UNCOVERED_LOCATION_RULES_SKIPPED`, `RULES_EVALUATED`, or the failure dispositions) — no omitted-item default-valid gap.
- **Counters:** count queries are planned by the domain's own exported helpers (`applicableLimits`/`countQueryForLimit`/`resolveSlot`), prefetched once per request with a short TTL, and served synchronously. Gateway failures degrade caps fail-open with a `COUNT_GATEWAY_FAILURE` incident — never silent, never thrown into the booking decision.
- **Identity (C1):** duplicate protection is identity-free-first; `metadata.identity` is consumed only behind the explicit `consumeMetadataIdentity` flag (default OFF) until gate T-VP3 proves which fields arrive. The RESCHEDULE subject-booking seam defaults to facts-unavailable, keeping behavior identical to pre-INT-C5-1.

## 3. Rules ↔ Dashboard contract

- `src/ui/validation/mirror.js` is the single seam: the server validation result `{valid, issues[]}` is injected verbatim; a non-conforming source is rejected fail-safe. `tests/ui/mirror.test.js` and `mirrorServerSource.test.js` pin this.
- `src/ui/state/editorStore.js` enforces consent gating at three independent layers (reducer, page UI, modal UI): `OPEN_DIFF_PREVIEW` is refused while issues exist; `CONFIRM` only lands when the modal is open, the rendered hash equals the current draft hash, and no issue is open; every draft mutation invalidates any prior confirmation (stale-hash replay rejected by construction). One confirmed diff = one apply attempt; every terminal outcome clears the confirmation so a retry requires fresh review + confirm.
- `src/ui/diff/computeScheduleDiff.js` produces a deterministic op list + stable hash (the informed-consent token, Contract §9.2). `src/ui/modals/diffPreviewModal.js` renders the exact changes and disables Confirm unless `canConfirm=true`.
- **Mutation lifecycle:** `editorStore.js` tracks the server-side journal via `MUTATION_TRACKED` observations and records terminal outcomes (`APPLY_SUCCESS`/`APPLY_ROLLED_BACK`/`APPLY_RECOVERED`/`APPLY_FAILED`). Recovery is an explicit user action (`RECOVER_*`); nothing auto-triggers a destructive operation. `src/ui/state/mutationPoller.js` is bounded (`maxAttempts`), stops on terminal states, contains observer faults, and has no auto-recovery.

## 4. Dashboard ↔ Billing contract

- `src/ui/services/bridge.js` is the **only** dashboard module permitted to reference Wix runtime modules (enforced by `tests/ui/noWixImports.test.js`, which also has an anti-vacuity assertion proving the scanner sees the bridge's guarded dynamic `import('@wix/essentials')`). It exposes typed `BridgeError` codes and strict envelope/pinned-DTO validation (`requestEnvelope`, `requestPinnedMeterDto`) so a drifted backend payload surfaces as `BAD_RESPONSE`, never as invented state.
- `src/ui/pages/locationsUsagePage.js` consumes the pinned `{meter, coverage}` DTO; a persistent degraded-warning banner suppresses "within plan"; the single-location floor is noted; the upgrade CTA opens in a new tab.
- `src/ui/upgrade/upgradeUrl.js` mirrors `src/billing/upgrade/upgradeUrl.ts` byte-for-byte in behavior (validated non-empty, whitespace-free identifiers; no fabrication — callers without real IDs render no link). Both construct the contracted `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`.
- The meter endpoint and the editor restriction both derive from the same `allowedLocationIds()` decision (`src/platform/http/meterEndpoint.ts` ↔ `src/platform/validation-plugin/handlers.ts`), so the dashboard meter and enforcement coverage cannot drift apart.

## 5. Billing ↔ Integration contract

- `src/billing/enforcement/entitlementGate.ts` implements the canonical domain `EntitlementGate` port. Fail-open on billing/counting/listing infrastructure errors with `degraded: true` and a persisted warning; consumers must treat degraded as "coverage unknown — do not block bookings because of entitlement."
- `src/billing/pure/entitlement.ts` decision table matches Contract §7: `null`/`isFree:true`/missing-empty `vendorProductId` ⇒ FREE (restriction reliable); known identifier ⇒ that tier; unknown paid identifier ⇒ TIER_1 + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable:false` (fail-safe under-serve). Invariant C2: `billingExpirationDate` is never read.
- `src/billing/pure/coverage.ts` over-limit selection uses stable ordering (default location first, then alphabetical by id), returns `unmanagedLocationIds` with management **disabled, never deleted** — customer configuration preserved so an upgrade restores coverage.
- `src/billing/projection/projector.ts` implements reconciliation supremacy (snapshot re-seeds and discards prior event effects; dedup memory survives snapshots so replays can't resurrect stale state; unique post-snapshot events refine until the next reconciliation). `src/platform/composition/entitlementComposition.ts` wires projector → `projectedSnapshotSource` → gate → validation-plugin + meter, with the mandatory periodic reconciliation seam (trial→paid conversion fires no event).
- `src/billing/counter/countFromAdapters.ts` drains paginated locations (50/page) and services (100/page) in parallel, with a runaway-pagination guard (`MAX_PAGES_PER_SOURCE`), and passes the drained `.pages` arrays (not wrappers) to the pure counting core.

## 6. Failure / rollback / destructive-write safety

- `src/platform/schedule-mutation/orchestrator.ts` implements the full Contract §9 sequence: snapshot → diff → apply → verify → rollback → audit. Idempotent UUIDv5 keys per change; revision-checked updates with bounded retries; verify-before-applied; rollback restores the persisted snapshot with fresh keys.
- **Crash semantics (T-RB1):** unexpected exceptions (including process death) intentionally leave the journal record `APPLY_IN_PROGRESS` — a dying process is not trusted to roll back. The next run either resumes via `applyNextChange` (idempotent) or calls `recoverInterruptedApply`, which restores the exact pre-apply state from the persisted snapshot and verifies at window granularity.
- **Terminal-state hardening:** `assertNotTerminal` rejects every state outside `{SNAPSHOT_PERSISTED, APPLY_IN_PROGRESS}` with `INVALID_STATE` before any gateway call or audit append, so a completed/rolled-back/recovered plan can never be re-verified, re-rolled-back, or double-audited.
- `src/platform/http/mutationEndpoints.ts`: `POST apply-plan` accepts **only** a confirmed-diff hash reference (strict body schema rejects inline plans); `GET mutation-status` projects the journal; `POST recover` drives explicit crash recovery. All endpoints call `requireVerifiedCaller` first (fail-closed `UNAUTHORIZED` via `UnauthorizedRequestError`).
- `src/platform/http/auth.ts` fails closed on missing/invalid/expired tokens and on verifier infrastructure failure — never falls through unauthenticated.
- `src/platform/webhooks/` enforces dedup on envelope `id`, ordering via `entityEventSequence`, and fail-closed malformed envelopes (1250 ms deadline, ≤12 retries per Contract §6).

## 7. Accessibility-sensitive behavior

- `tests/ui/helpers/a11y.js` provides `auditLabels` (every control must expose an accessible name), `assertKeyboardOperable` (clickable elements must be native buttons or explicitly focusable with keydown; enabled buttons must activate on Enter+Space), and `assertDialogSemantics` (role=dialog, aria-modal=true, resolvable aria-labelledby). `tests/ui/accessibility.test.js` asserts zero violations.
- `src/ui/pages/rulesEditorPage.js` uses accessible controls, a `role="status"` mutation region, and load/error/empty states. `src/ui/modals/diffPreviewModal.js` manages focus and Escape-cancels. The dashboard lane never weakens validation/accessibility to pass tests.

## 8. Real Wix scaffold assumptions / anti-fabrication

- `wix.config.json` is gitignored (`.gitignore` line 19) and **not committed**. The committed `wix.config.example.json` carries only the explicit placeholder `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` and is pinned UNLINKED by the same classifier used for real configs.
- `src/platform/registration/projectConfig.ts` classifies `MISSING_FILE`/`UNPARSEABLE`/`UNLINKED`/`LINKED`; `LINKED` requires positive evidence of a real non-placeholder `appId`. Failure direction is safe (can only under-report linkage, never fabricate it).
- `src/platform/registration/extensionsManifest.ts` declares every extension with `status: PLANNED_UNTIL_T_VP0` and contract-exact registration channels; `extensions.ts` is intentionally empty (frozen empty `EXTENSIONS` array) until the authenticated scaffold generates real entries.
- **Real binding:** the working-tree `wix.config.json` contains appId `3e9ec3af-001b-4684-a197-a5133677844d` / projectId `advanced-booking-rules` / projectType `App`. This is a genuine scaffold artifact from an authenticated binding, documented in `reports/wix-live/BOOTSTRAP_BINDING.md` ("bound the product to the explicitly selected existing Wix app **Advanced Booking Rules** … No app was created by this run … No API key, account auth store, token, password … was persisted"). It is **not** fabricated and **not** part of the committed candidate. No secret material is present.
- `docs/state.json` honestly reports `last_result: NOT_READY` (`final_auditor_unavailable_or_failed`), `product_promoted: false`; `docs/PRODUCT_GATES.json` keeps all 11 gates OPEN including `real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release`. No production claim is made; the product is not release-ready, which is truthful.

## 9. Adversarial questions

- **Semantic regression from the delta?** None. The commit removes only CI/control-plane files; no product module, test, port, DTO, or config changed. The deterministic gate remains runnable via `npm run check`/`build`.
- **Weakened tests / skipped checks?** None found. The shipped suites are substantive and falsifiable (purity negative-controls, anti-vacuity, byte-equality pins, ghost-path existence, target-semantics matrix, consent-gating, a11y audits). No `.skip/.only/.todo/.fails(` present (verified by the prior integrated audit's hygiene grep).
- **Unsupported Wix assumptions / banned claims?** None. Reschedule is labeled best-effort; TOCTOU residual risk for caps is disclosed; no native per-location-hours object claim; no "100% duplicate-proof" or "hard cap" promise; no PREVIEW_GATED capability in the production path.
- **Cross-lane drift?** None. The registration surface derives `validationTargets` from the implemented handler matrix (single source of truth); the meter and enforcement share one `allowedLocationIds()` decision; the upgrade URL is mirrored byte-for-byte; the bridge strictly validates pinned DTOs.
- **Fabricated identifiers?** None. The only real identifier in the tree is the documented, authenticated app binding; everything else is placeholder or PLANNED_UNTIL_T_VP0.

## 10. Non-blocking observations (record; no repair required)

1. **O1 (inherited):** `registration-surface.spec.ts` matches `/wix\.config\.example\.json/m` against `.gitignore`, which hits a comment line rather than an active rule. Harmless (the example file is meant to be committable; the load-bearing `^wix\.config\.json$` anchor is correct).
2. **O2 (inherited):** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal. The value is self-authored at scaffold time, not attacker input; exposure minimal.
3. **O3 (standing):** simulated-Wix QA has never completed and all dev-site gates await human-owned credentials; TOCTOU and best-effort-reschedule disclosures remain mandatory. `docs/state.json` and `PRODUCT_GATES.json` honestly reflect this.
4. **O4:** the removal of the in-repo CI workflow shifts the deterministic gate to the trusted workflow shell / external watchdog. This is a control-plane decision outside any product lane's ownership and does not affect product correctness; it should be confirmed as intentional by the orchestration owner.

## 11. Verdict rationale

The audited commit removes only four CI/control-plane files and leaves every product contract intact. I independently re-derived the integration↔rules↔dashboard↔billing contracts from source and found them consistent with the binding Technical Contract and Build Blueprint: pure deterministic rules core consumed by the enforcement wiring with correct fail-closed/fail-open target semantics; single-seam validation mirror with three-layer consent gating; pinned-DTO meter/upgrade parity; fail-open entitlement with over-limit coverage restriction that never deletes customer configuration; full snapshot→diff→apply→verify→rollback with crash-mid-apply recovery and terminal-state hardening; fail-closed auth; webhook dedup/ordering; and honest, non-fabricated Wix scaffold state (real binding documented, all registration PLANNED_UNTIL_T_VP0, all product gates OPEN, `NOT_READY` state). No semantic regression, no weakened test, no unsupported Wix assumption, no fabricated identifier, and no scope violation was found. The observations above are cosmetic or standing and none blocks acceptance.

VERDICT: ACCEPT
