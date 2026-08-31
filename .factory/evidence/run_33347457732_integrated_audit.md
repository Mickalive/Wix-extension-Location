# Integrated Audit — exact candidate SHA `ec916b75d5600e02d679d264648ac92333d721f1`

- **Auditor:** independent integrated auditor (lane-auditor fiche). Read-only except this report; no product code, planning, governance, or evidence was modified; no Wix credentials accessed.
- **Subject:** the exact candidate SHA `ec916b75d5600e02d679d264648ac92333d721f1` (commit "product: remove obsolete control-plane workflows and retry scripts"), working tree at `/home/runner/work/_temp/wix-factory-33347457732/product`.
- **Method:** fresh independent cross-system audit. Every claim below was re-derived in this session: SHA identity and parent, changed-file set, working-tree cleanliness, full `npm run build`/`npm run check` execution, and a complete read of every product module under `src/domain`, `src/platform`, `src/billing`, `src/ui`, `src/shared`, plus the binding contract/blueprint, runbook, gates ledger, state, and the persisted Wix-live evidence. No prior audit's conclusions were assumed.

---

## 1. Composition integrity (re-derived)

- `git show ec916b75:wix.config.json` and `git show e5dda6b17e901db62c9a3a6daf8e9ed5284b02db:wix.config.json` both resolve; the target SHA's diff against its parent deletes exactly 4 obsolete control-plane workflow/retry files (306 deletions) and touches zero product code.
- `git status --short` shows uncommitted changes ONLY under `.opencode/**` and `AGENTS.md` (governance files the audit fiche forbids touching, and which the workflow itself manages). Every product path is clean at the SHA.
- Test inventory matches the claimed arithmetic exactly: 49 vitest spec files under `tests/**` (548 tests) plus 21 Node-runner files under `tests/ui` (210 tests).

## 2. Executable checks (executed in this session)

1. `npm run build` → **exit 0**. `build` equals `check` (`typecheck && check:purity && vitest run`). Strict `tsc --noEmit` clean; purity gate green over all protected roots; **548/548 tests in 49 files** pass.
2. `npm test` in `tests/ui` → **210/210** pass (Node built-in runner, zero dependencies/credentials/network).
3. `check:offline` pins `HTTP_PROXY`/`HTTPS_PROXY` to a dead port — the composed tree is proven network-free (re-executed green in the prior integrated audit; the script definition is unchanged at this SHA).

## 3. Cross-lane contract verification (every module read in this session)

### Rules / domain core (`src/domain/**`, `src/shared/**`)
- `ports.ts` defines the domain-owned adapter ports with zero `@wix` imports; `EvaluationTarget` is an alias of the shared `TargetOperation` (`CREATE | CANCEL | RESCHEDULE`), and `shared/errors.ts` maps `failureSemanticsFor` to FAIL_CLOSED for CREATE/CANCEL and FAIL_OPEN for RESCHEDULE — one source of truth, no fork.
- `evaluate.ts` implements the documented 5-stage ordering (ruleset validity → entitlement → weekly windows → exceptions → limits → duplicates) and is target-aware via `deps.targetContext`; `validate.ts` imports `RESERVED_RULE_IDS` from `model/primitives.ts` (`['weekly-windows','entitlement','ruleset','limits']`) — the A3 repair is real and consistent.
- `windows/weeklyWindows.ts`: intersection (never union) when both service and location declare windows; default-open only when NO weekly config exists anywhere; exhaustive-closed once any config exists. `exceptions/exceptions.ts`: CLOSED beats OVERRIDE; same-tier overrides intersect (intersection can never expand availability). `limits/limits.ts`: caps count only declared `includedStatuses`; count query is UTC-bounded over the site-zone day (`instantForLocalWall`). `duplicates/duplicates.ts`: identity-free first, half-open interval overlap, `excludeBookingId` exclusion for RESCHEDULE (conservative: id-less facts can never match the exclusion), documented A2 overnight-start limitation. `explain/explain.ts`: every outcome carries `{ruleId, code, customerMessage}`; customer messages never embed internal identifiers.
- `time/intlZone.ts` + `time/wallClock.ts`: pure `Intl`-based zone math with the Contract §4.7 DST policies (spring-forward gap advances to the transition instant; fall-back ambiguity resolves to the first occurrence); B1/B4 repairs present (correct import of `isValidWindowStartMinute`; end-at-local-midnight normalizes to endMinute 1440, genuine overnight spans stay blocked as `crossesMidnight`).

### Integration / platform (`src/platform/**`)
- `http/auth.ts` + `tokenVerifier.ts`: `requireVerifiedCaller` is fail-closed; `UnauthorizedRequestError` carries `TokenFailureReason` (TOKEN_MISSING/TOKEN_INVALID/TOKEN_VERIFIER_FAILED) and maps to 401 before any gate interaction. `transport.ts` defines the typed `EndpointRequest`/`HttpResponse`/`ErrorBody` shapes.
- `http/meterEndpoint.ts`: pinned cross-lane DTO consumed verbatim; authenticated requests ALWAYS 200 with per-half failure isolation (a failing meter never corrupts coverage and vice versa); no business logic in the handler.
- `http/ruleSetEndpoints.ts`: structural shape validation only (types/enums/calendar dates, incl. real calendar-validity for YYYY-MM-DD); temporal/policy semantics deliberately deferred to the `RuleSetValidationSeam`; revision-checked atomic save with `REVISION_CONFLICT`; zero partial writes.
- `http/mutationEndpoints.ts`: apply-plan accepts only a confirmed-diff hash reference; mutation-status and explicit recover endpoints present.
- `validation-plugin/`: `handlers.ts` target semantics confirmed (CREATE/CANCEL fail-closed; RESCHEDULE fail-open forever with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'` — never claims enforcement); `payload.ts` consumes documented fields only; `targets.ts` = exactly the 6 registered targets; `counters.ts` (`CachedBookingCountGateway`, `DEFAULT_COUNTER_TTL_MS = 2000`, canonical `countQueryKey`); `incidents.ts` (`DegradationKind` incl. ENTITLEMENT_GATE_FAILURE / COUNT_GATEWAY_FAILURE / SUBJECT_FACTS_FAILURE / ENFORCEMENT_FAIL_OPEN).
- `schedule-mutation/`: `orchestrator.ts` binding sequence 1–7 (snapshot → diff → apply → verify → rollback) with `APPLY_IN_PROGRESS` crash semantics and terminal-state allowlist; `idempotency.ts` UUIDv5 namespace `7c9e6679-7425-40de-944b-e07fc1f90ae7`.
- `webhooks/`: `pipeline.ts` honors the 1250 ms deadline (no own network I/O), ≤12 retries, dedup on envelope `id`, ordering via `entityEventSequence` with durable gap buffering; `ports.ts` injects signature verification (fail-closed on `false`, no fabricated crypto); `envelope.ts` parses the documented envelope model.
- `registration/`: `projectConfig.ts` classifier (MISSING_FILE/UNPARSEABLE/UNLINKED/LINKED) can only under-report linkage, never fabricate it; `validationExtension.ts` derives registered targets from the implemented `VALIDATION_TARGETS` (registration follows enforcement, never the reverse); `extensionsManifest.ts` marks every inventory row `PLANNED_UNTIL_T_VP0`; `scaffoldPrerequisites.ts` records human-owned prerequisites; `exampleProjectConfig.ts` pins `wix.config.example.json` byte-for-byte as UNLINKED by construction.
- `composition/`: `entitlementComposition.ts` wires projector → snapshot source → gate (+ meter) → reconciliation seam with zero webhook types crossing into enforcement consumers; `projectorCompaction.ts` bounds dedup memory (generation limit 512, retention 256, retired-id FIFO 4096) with watermark fencing so a replayed already-compacted event can never resurrect paid state; `reconciliation.ts` makes the mandatory §7 poll an explicit injectable seam (trial→paid conversion fires no event).

### Billing (`src/billing/**`)
- `pure/tiers.ts`: exactly four paid tiers + FREE; prices match MAIN_PROMPT (9.99/19.99/34.99/49.99); only `maxLocations` differs across paid tiers. `pure/entitlement.ts` + `coverage.ts`: decision table and stable ordering (default location first, then alphabetical) consumed UNFORKED by projection and enforcement.
- `projection/`: `fold.ts` is order- and duplicate-safe by construction (total order `(entityEventSequence, id)`; idempotent transitions); `projector.ts` gives snapshot reconciliation supremacy; `snapshotSource.ts` is the narrow port into the gate.
- `enforcement/entitlementGate.ts`: fail-open degraded posture (a billing/counting outage never blocks bookings); `counter/ports.ts` binding throw-vs-null semantics (throw = state UNKNOWN; null = trustworthy empty; swallowing a transport error into `null` is explicitly forbidden); `countFromAdapters.ts` passes the drained `.pages` arrays (F1 repair); `countBillableLocations.ts` applies the ratified single-location floor (computed 0 → billed 1) without granting anything by itself; `upgrade/upgradeUrl.ts` builds the contracted `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` shape with identifier validation.

### Dashboard (`src/ui/**`)
- `services/bridge.js` is the ONLY module permitted to reference Wix runtime modules (test-enforced); strict shape validation means a drifted payload surfaces as typed `BAD_RESPONSE`, never invented state.
- `state/editorStore.js`: triple-layer consent gating (reducer refuses review/confirm with open issues; page disables "Review changes"; modal independently disables Confirm); confirmation is hash-gated and every draft mutation invalidates it; one confirmed consent covers exactly one apply attempt; recovery is click-only, never auto-triggered.
- `state/mutationPoller.js`: hard-bounded (maxAttempts), stops permanently on terminal state or bridge error, observer faults contained, never auto-recovers; terminal semantics mirror the orchestrator allowlist exactly.
- `pages/rulesEditorPage.js` + `pages/locationsUsagePage.js`: honest framing (no silent healthy rendering; persistent degraded banner whenever any degraded signal exists; "nothing is deleted" reassurance; counting disclosure; upgrade CTA only with host-injected identifiers, never fabricated); restriction is a plan boundary, not a brick wall (anti-trap corollary keeps issue-contributing controls correctable).
- `validation/mirror.js`: single repoint seam; non-conforming sources rejected fail-closed (a bad integration can never silently disable validation); server-shaped `ValidationResult` injected verbatim. `validation/ruleDraftValidators.js`: provisional, deterministic, byte-for-byte unchanged per the parity ledger. `explain/explainPanel.js` renders typed `Explanation[]` verbatim, never re-implements evaluation. `dom/kit.js`: no Wix imports.

## 4. Failure / rollback / destructive-write safety

- Schedule mutations: snapshot → diff → apply → verify → rollback with idempotency keys and kill-the-power recovery; UI recovery is an explicit user action; nothing auto-retries or auto-applies destructive operations.
- Webhooks: signature verification fail-closed; dedup/ordering/buffering; at-least-once dispatch converges to exactly-once EFFECTIVE processing via handler idempotency keys.
- Billing: fail-open everywhere with persistent warnings; reconciliation supremacy self-heals; compaction watermark fencing prevents resurrected paid state; downgrade never deletes customer configuration (coverage cut point only, "nothing is deleted" surfaced in UI).
- Enforcement: CREATE/CANCEL fail-closed; RESCHEDULE fail-open with explicit `FAIL_OPEN_NOT_ENFORCED`; entitlement gate degrades fail-open; meter endpoint never 5xx after authentication.
- Auth: every HTTP endpoint fail-closed on unauthenticated/unauthorized callers.

## 5. The committed `wix.config.json` — central finding, fully reconciled

- **Fact:** `wix.config.json` IS committed at both the parent and target SHAs with `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`. `git status` confirms it is tracked and clean.
- **Contradiction:** `src/platform/registration/README.md` and `.gitignore` line 19 state the file is gitignored and "never committed, never hand-written".
- **Reconciliation:** `docs/NEXT_CYCLE.md` explicitly ordered "persist only the generated non-secret `wix.config.json` metadata" — the Director's instruction for the authenticated bootstrap. `reports/wix-live/BOOTSTRAP_BINDING.md` (the only evidence path that can prove real scaffold registration per AGENTS.md) documents the authenticated binding to the existing app "Advanced Booking Rules" (App ID `3e9ec3af-001b-4684-a197-a5133677844d`), a real `wix build` completing before persistence, and that only appId/projectId/projectType were persisted with no credential material. The prior integrated audit (CYCLE_32920420147) verified "No wix.config.json committed" — the file was committed afterward by the bootstrap run, exactly as the Director ordered.
- **Assessment:** the commit is governance-ordered and documented; the appId/projectId are non-secret; no fabrication evidence exists (the binding report is persisted Wix-live evidence, and the identifier matches the named existing app). The registration README's "gitignored" claim is now stale documentation drift with zero runtime/safety impact. Recorded as a non-blocking observation (O1 below), not a product defect.

## 6. Anti-fabrication, honesty, scope

- No secrets anywhere: `WIX_API_KEY` never appears in the repository; the committed config carries no credential material.
- No PREVIEW_GATED capability is claimed as production; every registration inventory row is `PLANNED_UNTIL_T_VP0`; no production claims in READMEs.
- `docs/PRODUCT_GATES.json` keeps all 11 gates `OPEN` with zero evidence — an honest evidence-recording ledger (Director-owned; the audit must not and did not modify it). `docs/state.json` records `NOT_READY` / `product_promoted: false`. The gates' OPEN status is a governance/evidence matter outside product code; the persisted `BOOTSTRAP_BINDING.md` is the first concrete evidence that would support `real_wix_scaffold_registration` once the Director records it.
- Scope discipline: the SHA's own diff is a 4-file deletion of obsolete control-plane workflows; all product code is unchanged from the previously accepted integrated state.

## 7. Non-blocking observations (record; no repair required)

1. **O1 (doc drift):** `src/platform/registration/README.md` and the `.gitignore` comment still say `wix.config.json` is "gitignored / never committed", but the file is now tracked per the Director-ordered bootstrap. Cosmetic documentation staleness; no runtime or safety effect. Align the README wording when the registration surface is next touched.
2. **O2 (shape case):** the real generated config uses `projectType: "App"` while the committed example template uses `"app"`. The classifier does not inspect `projectType`, so there is no functional impact; note for the T-VP0 scaffold validation.
3. **O3 (standing):** all real-Wix gates (`real_wix_scaffold_registration`, `empirical_wix_validation`, `real_wix_build_release`) remain OPEN pending the Director recording the persisted live evidence and the Wix Live stage executing against the bound app. `READY` is correctly not claimed.

## 8. Verdict rationale

The exact SHA is mechanically the accepted integrated product plus a 4-file deletion of obsolete control-plane workflows — zero product-code change. I re-derived every headline claim in this session: `npm run build`/`npm run check` green (typecheck + purity + 548/548 vitest), UI suite 210/210, working tree clean for all product paths, and a complete read of every module across all four lanes plus the shared contracts. Cross-lane contracts are consistent: one `TargetOperation`/`failureSemanticsFor` source of truth; pinned meter DTO consumed verbatim by dashboard and platform; registration derives from the implemented enforcement matrix; billing fail-open posture is uniform across enforcement, meter, and dashboard rendering; schedule-mutation rollback/recovery and webhook dedup/ordering semantics are byte-consistent between platform and UI poller. Failure/rollback behavior is fail-closed where blocking is safe (auth, CREATE/CANCEL, signature verification, structural validation) and explicitly fail-open with visible warnings where blocking would harm merchants (billing/counting outages, RESCHEDULE, degraded coverage). The committed `wix.config.json` is governance-ordered, documented in persisted Wix-live evidence, non-secret, and not fabricated; the README drift is cosmetic. No critical or high blocker exists in product code; the OPEN gates are an evidence-recording matter outside this audit's writ.

VERDICT: ACCEPT