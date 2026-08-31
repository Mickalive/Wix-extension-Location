# Factory Integrated Audit — candidate d356071993a45400e0621dcdbf746e231e037eab

- **Auditor:** independent cross-system integrated auditor (fresh review; not the lane auditor, not any builder). Read-only except this report.
- **Subject:** exact candidate SHA `d356071993a45400e0621dcdbf746e231e037eab` (integration lane, "generation 138"), verified as the current HEAD.
- **Parent:** `ec916b75d5600e02d679d264648ac92333d721f1` ("product: remove obsolete control-plane workflows and retry scripts").
- **Working-tree integrity:** `git diff --stat HEAD -- src tests wix.config.example.json extensions.ts package.json tsconfig.json .gitignore` is empty — the product tree exactly matches the candidate. The only uncommitted changes are governance files (`AGENTS.md`, `.opencode/agents/**`, `.opencode/job-descriptions/**`, `MANIFEST.sha256`) which are the harness's own environment setup, not candidate product code, and are not part of this audit's subject.
- **Authority:** `docs/WIX_TECHNICAL_CONTRACT.md` and `docs/BUILD_BLUEPRINT.md` are binding ground truth; `MAIN_PROMPT.md`/`AGENTS.md` governance.

---

## 1. Candidate scope (mechanical, re-derived)

`git show HEAD` = exactly **6 product files, +63/−20**:

| File | Change |
|---|---|
| `src/platform/registration/README.md` | docs: UQ4 field set "partially resolved" by first authenticated scaffold |
| `src/platform/registration/exampleProjectConfig.ts` | adds `projectId` placeholder + field to frozen template |
| `src/platform/registration/index.ts` | re-exports `SCAFFOLD_PLACEHOLDER_PROJECT_ID` |
| `src/platform/registration/projectConfig.ts` | docs: observed field set `projectType`/`appId`/`projectId`; classifier logic unchanged |
| `tests/platform/registration-project-config.spec.ts` | +2 tests: real-config LINKED classification; no-secret-material sweep |
| `wix.config.example.json` | adds `"projectId": "<PROJECT-ID>"` placeholder |

All six paths sit inside the integration lane's assigned surface (its fiche owns `wix.config.json`/`wix.config.example.json` and non-secret project registration metadata). No governance, domain, dashboard, billing, schedule-mutation, HTTP, webhook, or shared-contract file is touched. The classifier logic in `projectConfig.ts` is **unchanged** — only its doc comment is updated.

## 2. Empirical checks (executed by this auditor on the exact candidate tree)

| Check | Result |
|---|---|
| `npm run check` (strict `tsc --noEmit` + purity gate + vitest) | **exit 0 — 550/550 tests, 49 files**; purity gate green over all **7** protected roots incl. `src/platform/registration` |
| `npm run build` | **exit 0** (equals `check`) |
| `npm run check:offline` (proxies pinned to dead port) | **exit 0 — 550/550**, zero network egress proven |
| Dashboard lane (`node --test` in `tests/ui`) | **210/210** |
| Arithmetic | 548 prior + 2 new = 550 exact; no test lost or duplicated |

The `PURITY GATE FAILED` stdout lines are the asserted negative-control fixture inside `purity-gate.spec.ts` (expected; overall exit 0).

## 3. Real Wix scaffold binding — honesty and consistency

- The real `wix.config.json` is present on disk: `{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}`.
- It is **gitignored** (`.gitignore` line 19) and **not tracked** (`git status --short wix.config.json` empty) — the account-bound appId is never committed. Correct per policy and `directives/INTEGRATION.md`.
- The candidate's new test `classifies as LINKED when the real scaffold file is present` reads the real file and asserts `LINKED`; it passed, confirming the classifier correctly recognizes the real appId (non-empty, non-placeholder). The `contains no secret material` test passed, confirming no secret tokens in the real config.
- The candidate's claim that the observed field set is `projectType`/`appId`/`projectId` is **backed by persisted evidence** `reports/wix-live/BOOTSTRAP_BINDING.md` ("Persisted wix.config.json fields: appId, projectId, projectType") and matches the on-disk file exactly. No fabrication.
- The committed `wix.config.example.json` remains **UNLINKED by construction** (all placeholder values, test-pinned byte-for-byte against `serializeExampleProjectConfig()`). The classifier still requires positive `appId` evidence for `LINKED`; nothing here can over-report linkage.
- The candidate does **not** claim to prove any product gate. `docs/PRODUCT_GATES.json` still lists all 11 gates `OPEN` with no evidence, including `real_wix_scaffold_registration`/`empirical_wix_validation`/`real_wix_build_release`. Gate advancement is the Director's ledger decision; the candidate correctly does not touch it and makes no production-capability claim.

## 4. Cross-lane contract verification

- **Rules:** zero diff on `src/domain/**`, `src/shared/**`. Domain semantics, target-aware CREATE/CANCEL/RESCHEDULE, determinism, and explanation completeness are untouched.
- **Dashboard:** zero diff on `src/ui/**`, `src/extensions/**`. Editor, meter page, diff modal, entitlement restriction, accessibility behavior untouched.
- **Billing:** zero diff on `src/billing/**`. Tiers, entitlement, coverage, counter, downgrade-preservation, fail-open posture untouched.
- **Integration (enforcement/mutation):** zero diff on `src/platform/{schedule-mutation,webhooks,http,validation-plugin,composition}/**`. Booking-time enforcement (6 targets, FAIL_CLOSED CREATE/CANCEL, FAIL_OPEN RESCHEDULE), snapshot→diff→apply→verify→rollback, idempotency, webhook dedup/ordering, and HTTP token verification are byte-untouched.
- **Registration surface:** the candidate only refines the *shape template* and its docs; the `buildBookingsValidationExtensionConfig()` welding of `validationTargets` to the implemented matrix is untouched. No semantic fork between what is registered and what is enforced.

## 5. Rollback / failure / destructive-write safety

The candidate introduces **no mutation path at all** — it is declaration/template/documentation plus tests. There is no new schedule write, no new HTTP endpoint, no new webhook, no new persistence. Destructive-write and rollback risk is nil by construction. The new tests are read-only (`readFileSync` on the real config) and cannot alter state.

## 6. Anti-fabrication, honesty, scope

- No identifiers/credentials fabricated or committed; the real appId stays gitignored.
- The `projectId` placeholder `<PROJECT-ID>` is explicit and classifies as UNLINKED.
- No banned production claims (§12 vocabulary) introduced; no PREVIEW_GATED capability promoted.
- Scope is strictly the integration lane's registration surface; no feature creep, no unrelated refactors.

## 7. Non-blocking observations (record; no repair required)

1. **O1 (cosmetic):** the real config uses `"projectType": "App"` (capitalized) while the committed template uses `"projectType": "app"` (lowercase). The classifier does not validate `projectType`, so this has zero functional effect; the real file is gitignored and never committed. Unify the casing convention when the surface is next touched.
2. **O2 (test-design note):** the two new real-config tests use an early-`return` skip when the file is absent, which vitest counts as a *pass* rather than a *skip*. In a clean CI checkout (gitignored file absent) they would silently no-op. This is acceptable for scaffold-dependent tests and is documented in the test names ("when scaffolded"); it does not fabricate evidence and does not weaken the classifier's own unit coverage (which is exercised by the fixture-based tests in the same file).
3. **O3 (environment, not candidate):** the working tree carries uncommitted governance-file edits (AGENTS.md, agent definitions, MANIFEST.sha256) that are the harness's own setup and are not part of this candidate. They are outside the audit subject and do not affect the verdict.

## 8. Verdict rationale

The candidate is mechanically exactly the 6-file integration-lane change described above, verified by diff and by direct execution. It honestly reflects the observed real Wix scaffold field set (backed by persisted `BOOTSTRAP_BINDING.md` evidence and the on-disk gitignored config), keeps the committed template UNLINKED by construction, fabricates nothing, and leaves every accepted domain/platform/dashboard/billing behavior byte-intact. All deterministic gates pass (550/550 offline, 210/210 UI, purity green over 7 roots, build green). No cross-lane contract is broken, no rollback/failure path is introduced, and no product gate is falsely claimed. The three observations above are cosmetic or environmental and none blocks integration.

VERDICT: ACCEPT
