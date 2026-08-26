# Integrated Audit — cycle 7 preview, run 32920420147

- **Auditor:** independent integrated auditor (lane-auditor fiche). Read-only except this report; product code, planning, governance untouched; no Wix credentials accessed.
- **Subject:** `/tmp/wix_integrated_preview` — the exact integrated Wix preview for cycle 7 (run 32920420147), working tree clean.
- **Accepted base:** `aec73b05eefb17a3643043f3d4f7a6bcba92fc0b`.
- **Task audited against:** `docs/NEXT_CYCLE.json` cycle-6 repair queue — sole active lane `integration`, task `INT-C6-R1` (repair of Wix Live finding `reports/wix-live/CYCLE_32915633541.md`: no real scaffold/registration). Rules/Dashboard/Billing queues are `complete`; their candidates are deterministic no-ops.
- **Inputs read:** `MAIN_PROMPT.md`, `AGENTS.md`, `.opencode/job-descriptions/lane-auditor.md`, binding `docs/WIX_TECHNICAL_CONTRACT.md` + `docs/BUILD_BLUEPRINT.md`, all four cycle-7 lane audits, `reports/integration/CYCLE_32920420147_MANIFEST.json`, prior integrated audit, live finding, runbook, Director state/gates.
- **Execution note:** this sandbox denies arbitrary command execution, so runtime hostile-input probes beyond the shipped suites were assessed statically; every executable gate below was nonetheless run by this auditor directly on the integrated tree.

---

## 1. Composition integrity (mechanical, re-derived)

`git diff aec73b0..HEAD --stat` = exactly the integration candidate's **14 product files (+1200/−2)** plus **5 evidence files** (four cycle-7 lane audits + integration manifest, +102):

| Check | Result |
|---|---|
| Candidate commit `e1c83cd` | exactly 14 product files, +1200/−2 — matches its ACCEPT audit verbatim |
| `git diff e1c83cd..HEAD` | ONLY the 5 evidence files; zero product drift after the candidate |
| Manifest `audit_sha` ×4 | all resolve locally; each persisted audit **byte-identical** to its pinned commit (empty diffs for INTEGRATION/RULES/DASHBOARD/BILLING) |
| Rules / Dashboard / Billing lanes | true no-ops (zero product diff) — consistent with their no-op audits and `complete` queue status; no busywork invented |
| Governance/Director paths (`MAIN_PROMPT.md`, workflows, agents, directives, `docs/state.json`, `NEXT_CYCLE.*`, contract/blueprint, gates) | **zero diff** — correct; they advance only after this verdict |

Lane scopes disjoint; no merge-conflict resolution exists (no overlapping hunks); shared-file changes are strictly additive (`.gitignore` +7 rule with rationale; `tsconfig.json` include += `extensions.ts`; purity protected roots += `src/platform/registration` — a strengthening, not a weakening).

## 2. Executable checks (executed by this auditor on the integrated tree)

1. `npm run check` → **exit 0**: strict `tsc --noEmit` (now covering `extensions.ts`), purity gate green over all **seven** protected roots including the new `src/platform/registration`, **548/548 tests in 49 files**. Arithmetic: cycle-6 accepted 518 + 30 new (17 `registration-surface` + 13 `registration-project-config`) = 548 exact — no test lost or duplicated. The `PURITY GATE FAILED` stdout lines are the asserted negative-control fixture inside `purity-gate.spec.ts` (expected).
2. `npm run check:offline` (proxies pinned to dead port) → **exit 0, 548/548** — zero network egress proven on the composed tree.
3. `npm run build` → exit 0 (equals `check`), closing acceptance criterion 1 that the lane audit could not execute in its own sandbox.
4. Dashboard lane runner (`npm test` in `tests/ui`) → **210/210**, identical count to cycle 6 — no UI drift.
5. Hygiene greps: no `.skip/.only/.todo/.fails(` anywhere under `tests/`; banned-claims scan (§12 vocabulary) over every added file: clean.

## 3. Cross-lane semantics, DTO/type compatibility

- **Frozen contracts intact:** zero diff on `src/shared/**`, `src/domain/**`, `src/billing/**`, `src/ui/**`, `src/extensions/**`, `src/platform/{schedule-mutation,webhooks,adapters,http,validation-plugin,composition}/**`. The six→three target mapping (`evaluationTargetOf`/`semanticsOf` → `failureSemanticsFor`) is untouched and still pinned by 42 target-aware + 19 handler-matrix + 9 matrix-properties + 31 domain target-aware tests, all green inside the 548.
- **Single-source-of-truth welding:** `buildBookingsValidationExtensionConfig()` derives `validationTargets` from `VALIDATION_TARGETS` (the implemented handler matrix), so the *registered* surface cannot drift from the *implemented* one; test-enforced equality + length-6 canonical-order pin. This is the correct direction: registration follows enforcement, never the reverse.
- **No new coupling:** nothing outside `src/platform/registration/**` imports the new surface (grep-verified); the module set is purely additive, so DTO/type compatibility with dashboard/billing consumers is structurally unaffected.
- **Contract §3 channel parity (verified entry-by-entry):** DASHBOARD_PAGE/MODAL + EVENT → `UNIFIED_CLI_GENERATE`; SERVICE_PLUGIN (Bookings Validation) → `APP_DASHBOARD_FALLBACK` with the generate-menu uncertainty explicitly recorded pending T-VP0; DATA_COLLECTIONS → `INTERACTIVE_CLI_MENU`; plan webhooks → `APP_DASHBOARD_FALLBACK`; HTTP endpoints → `FILE_BASED_NO_REGISTRATION`. All eight inventory rows match the binding contract; all six `productSourcePath` anchors exist on disk (independently confirmed), so the inventory cannot point at ghosts.

## 4. Target-aware CREATE/CANCEL/RESCHEDULE behavior

Unchanged by design and proven live: the enforcement wiring, bulk per-item explicitness, subject-facts seam, and §5.3 semantics (CREATE/CANCEL fail-closed block-with-retry-hint; RESCHEDULE fail-open with `FAIL_OPEN_NOT_ENFORCED`, never claiming enforcement) carry zero diff this cycle while their full suites remain green. The new registration surface documents exactly these semantics and registers exactly the six implemented targets — no semantic fork between what is registered and what is enforced.

## 5. Dashboard/platform parity & billing/enforcement composition

Untouched this cycle; parity and composition re-proven by execution: meter endpoint ↔ editor restriction off the same `allowedLocationIds()` decision (meter-endpoint 10, UI entitlement/restriction suites inside 210), billing fail-open degraded posture (entitlementGate 11, downgradeThroughGate 2, composition-root 8), validator parity ledger (uiValidatorParity 30). No forked semantics, no bypassed bridge, no weakened validation.

## 6. Rollback, destructive-write safety, failure posture

§9 snapshot→diff→apply→verify→rollback machinery, idempotency keys, webhook dedup/ordering, and kill-the-power recovery are byte-untouched (schedule-mutation 10, orchestrator-terminal-states 7, idempotency 8, webhooks-chaos 13, webhooks-envelope 6 — all green). The candidate introduces no mutation path at all: it is declaration/classification-only, so destructive-write risk is nil by construction.

## 7. Anti-fabrication, honesty, scope

- **No `wix.config.json` committed** — gitignored with rationale; the committed `wix.config.example.json` carries only explicit placeholders and is test-pinned UNLINKED by the same classifier used for real configs (byte-equality against the serializer, both directions).
- **Classifier cannot over-report linkage:** `LINKED` demands a non-empty, non-placeholder string `appId`; empty/non-string/template-shaped/token-bearing values are UNLINKED with explicit problems; non-object JSON is UNPARSEABLE. Unknown fields tolerated (UQ4/C4 discipline) instead of asserting an unobserved field set. Failure direction is safe: it can only under-report linkage, never fabricate it.
- **No identifiers/secrets:** anti-fabrication specs sweep the whole surface for UUID-like/hex shapes and SDK-import strings (passing); I independently read every new file — only RFC-2606 `.invalid`/`.example` hosts and clearly-named test fixtures appear. `DEFAULT_VALIDATION_DEPLOYMENT_URI='/api/bookings-validation'` is a project-internal route per the documented `pages/api` mapping, not an identifier.
- **Status honesty:** every inventory row is `PLANNED_UNTIL_T_VP0`; README §4 makes no registration/live-behavior claims; `externalBlockerStatement()` composes the narrow, identifier-free BLOCKED_EXTERNAL wording grounded in Contract §16/T-VP0/runbook — precisely what criterion 3's second branch requires, without pre-empting or faking the live job's own disposition. Committing an invented binding to force branch (a) would have been fake evidence; the candidate correctly refuses.
- **Scope:** every changed path sits in the integration lane's assigned surface (its fiche explicitly owns `wix.config.json`/`wix.config.example.json` and non-secret project registration metadata; `.gitignore`/`tsconfig.json`/`extensions.ts` are scaffold-surface files). No feature creep, no unrelated refactors, no PREVIEW_GATED dependencies, no production claims; empirical gates T-VP*/T-WH*/T-BK*/T-RB* remain open and unbypassed; `docs/PRODUCT_GATES.json` honestly keeps `real_wix_scaffold_registration` OPEN.

## 8. Non-blocking observations (record; no repair required)

1. **O1 (inherited):** `registration-surface.spec.ts` matches `/wix\.config\.example\.json/m` against `.gitignore`, which hits a comment line rather than an active rule. Harmless (the example file is meant to be committable; the load-bearing `^wix\.config\.json$` anchor is correct). Tighten opportunistically.
2. **O2:** `validateDeploymentUri` rejects literal `..` but not percent-encoded traversal (e.g. `/api/%2e%2e/x`). The value is self-authored at scaffold time, not attacker input, so exposure is minimal; consider decoding before the traversal check when next touched.
3. **O3:** two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect; unify when the surface is next touched.
4. **O4 (standing, cross-cycle):** simulated-Wix QA has never completed and all dev-site gates await human-owned credentials; TOCTOU and best-effort-reschedule disclosures remain mandatory. Neither is affected by this cycle.
5. **O5:** placeholder token matching can flag an exotic real appId containing e.g. `TODO` as UNLINKED — a false positive in the safe direction; acceptable.

## 9. Verdict rationale

The preview is mechanically exactly the sum of the accepted base and the one independently ACCEPT-audited repair candidate plus its evidence files — proven by diff, not assumed. The repair does precisely what the live finding demanded and nothing more: it establishes every legitimately derivable element of the unified-CLI scaffold/registration surface (binding classifier, shape template, extension inventory with contract-exact channels, validation-plugin config welded to the implemented target matrix, machine-readable human-prerequisite record), fabricates nothing, strengthens the purity gate, and leaves all accepted domain/platform/dashboard/billing behavior byte-intact. I reproduced every headline claim myself: 548/548 offline, 210/210 UI, seven-root purity, build green, arithmetic exact, all four audit SHAs byte-verified, ghost-path anchors present, channel parity checked row-by-row against the binding contract. Adversarial review found no semantic regression, no weakened test, no hidden degraded state, no unsupported Wix assumption, and no scope violation; the five observations above are cosmetic or standing and none blocks integration.

VERDICT: ACCEPT
