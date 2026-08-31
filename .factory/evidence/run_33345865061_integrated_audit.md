# Factory Integrated Audit — exact candidate SHA 84e7907a2755a75ec2680f2beeaca9f0a6e1f402

- **Auditor:** independent cross-system integrated auditor (distinct from all builders and lane auditors). Read-only except this report; no product code, planning, governance or evidence modified; no Wix credentials accessed.
- **Subject:** exact candidate commit `84e7907a2755a75ec2680f2beeaca9f0a6e1f402` (integration lane, generation 74).
- **Scope of candidate:** exactly 3 files — `src/platform/registration/README.md`, `src/platform/registration/scaffoldPrerequisites.ts`, `tests/platform/registration-surface.spec.ts` (+80/−7).
- **Authorities read:** `MAIN_PROMPT.md`, `AGENTS.md`, binding `docs/WIX_TECHNICAL_CONTRACT.md` (§15/§16), `docs/BUILD_BLUEPRINT.md`, `docs/runbooks/T_VP0_SCAFFOLD.md`, `docs/PRODUCT_GATES.json`, `docs/state.json`, `docs/NEXT_CYCLE.md`/`.json`, prior integrated audit `CYCLE_32920420147_INTEGRATED.md`, live evidence `reports/wix-live/BOOTSTRAP_BINDING.md`, the real `wix.config.json`, `.gitignore`, purity gate, and the full candidate diff.

---

## 1. What the candidate does

The candidate makes `externalBlockerStatement()` in the integration lane's registration surface LINKED-aware:

- Adds an optional `linkage?: import('./projectConfig').ProjectLinkage` parameter (backward-compatible; the no-arg call path is unchanged).
- When a `ProjectLinkage` with `status === 'LINKED'` is supplied, it composes a statement that acknowledges the real binding and identifies the remaining empirical gates (T-VP0 evidence, T-VP1–T-VP5 enforcement, dev-site binding/consent, CLI build/release) instead of claiming the scaffold is missing.
- When not LINKED (or no argument), it emits the exact prior non-LINKED statement, byte-unchanged.
- Adds two tests covering the LINKED path and updates the README to document the new behavior.

## 2. Real Wix scaffold assumption — verified against persisted evidence

The candidate's LINKED branch is not speculative: a real binding exists.

- `reports/wix-live/BOOTSTRAP_BINDING.md` records that the privileged CI bootstrap authenticated with the protected Wix API key and bound the product to the existing Wix app **Advanced Booking Rules** (App ID `3e9ec3af-001b-4684-a197-a5133677844d`), generated a real `wix.config.json`, and completed a real `wix build` before persisting.
- The real `wix.config.json` is present in the working tree with `appId: 3e9ec3af-001b-4684-a197-a5133677844d`, `projectId: advanced-booking-rules`, `projectType: App`. It is correctly gitignored (`.gitignore` line 19) and not committed.
- `classifyProjectBinding()` on this real config returns `LINKED` (non-empty, non-placeholder string `appId`; no placeholder token/shape match). The candidate's LINKED statement therefore reflects the true scaffold state.

The statement's remaining-blocker claims are accurate against the contract and gates:
- `docs/PRODUCT_GATES.json` keeps `real_wix_scaffold_registration`, `empirical_wix_validation`, and `real_wix_build_release` all `OPEN`.
- Contract §15 lists T-VP0 and T-VP1–T-VP5 as open empirical gates; §16 lists dev-site consent and release approvals as human-owned.
- `BOOTSTRAP_BINDING.md` itself notes "The subsequent real `wix build` remains mandatory," so listing CLI build/release as a remaining blocker is correct.

The statement does **not** claim readiness: it explicitly states "The truthful live-QA disposition is that empirical gates remain open — not that the scaffold is missing." This is consistent with the governance rule that `READY` is forbidden until real scaffold/empirical/build gates are proven.

## 3. Anti-fabrication / identifier handling

- The test uses the **real** App ID `3e9ec3af-001b-4684-a197-a5133677844d` as a fixture. This is not fabrication — it is the persisted, real binding value already recorded in the committed `BOOTSTRAP_BINDING.md` and present in the real `wix.config.json`. It is a public app identifier, not a credential/secret.
- The candidate's product code (`scaffoldPrerequisites.ts`) contains no identifier-shaped strings; the LINKED statement is identifier-free (test-enforced via `UUID_LIKE`).
- The anti-fabrication sweep (`registration-surface.spec.ts` §3) covers registration source files, `extensions.ts`, and `wix.config.example.json` — none of which the candidate polluted with identifiers. The test file is not in that sweep, and correctly so: it carries the real, non-secret App ID as a fixture.
- No `wix.config.json` is committed; the gitignore rule protecting the real binding is intact.

## 4. Cross-lane contract verification (integration / rules / dashboard / billing)

- The candidate touches only the integration lane's assigned registration surface. Zero diff on `src/domain/**`, `src/billing/**`, `src/ui/**`, `src/shared/**`, `src/platform/{schedule-mutation,webhooks,adapters,http,validation-plugin,composition}/**`.
- `externalBlockerStatement` is consumed only via the `index.ts` re-export and tests; the signature change (optional param) is backward-compatible, so no consumer breaks.
- No new coupling: nothing outside `src/platform/registration/**` imports the changed module.
- Rules/Dashboard/Billing lanes are unaffected; their contracts and behavior are byte-intact.

## 5. Booking enforcement, rollback/recovery, entitlements, accessibility

- **Booking enforcement:** untouched. The candidate is declaration/classification-only; no enforcement path changes.
- **Rollback/recovery:** untouched. No mutation path is introduced; destructive-write risk is nil by construction.
- **Entitlements:** untouched. No billing/entitlement code changes.
- **Accessibility-sensitive behavior:** untouched. No dashboard UI changes.

## 6. Purity / type / test integrity (static verification)

- The purity gate protects `src/platform/registration/**`. The candidate adds only a relative inline type import `import('./projectConfig').ProjectLinkage` — not a `@wix/` specifier — so the gate remains green.
- The new tests are genuine and would pass: the LINKED branch contains `LINKED`, `T-VP0`, `T-VP1`, `empirical gates`, `wix.config.example.json`, and omits `No linked Wix CLI project exists` and `authenticated one-time scaffold`; the classifier returns `LINKED` for the real App ID and the resulting statement is identifier-free.
- The existing no-arg test (non-LINKED branch) is unchanged and still passes.
- TypeScript validity: `ProjectLinkage` is exported from `projectConfig.ts`; the inline type import and test imports resolve correctly.

## 7. Non-blocking observations (no repair required)

1. **O1:** the test fixture uses `projectType: 'app'` (lowercase) while the real `wix.config.json` uses `projectType: 'App'` (capitalized). The classifier keys only on `appId`, so this is cosmetic and does not affect the verdict.
2. **O2:** the working tree carries uncommitted governance-file changes (agent fiches, `AGENTS.md`, manifest) that are **not** part of this candidate commit. They are outside the audited subject and are flagged only for completeness; they do not affect the candidate's integrability.

## 8. Verdict rationale

The candidate is a small, focused, in-scope integration-lane change that makes the registration surface truthfully acknowledge the now-real Wix binding while keeping all empirical gates honestly open. It fabricates nothing (the App ID used is the real, persisted, non-secret binding value), is backward-compatible, purity- and type-clean, test-covered for both LINKED and non-LINKED paths, and leaves all accepted domain/platform/dashboard/billing behavior byte-intact. No cross-lane contract, enforcement, rollback, entitlement, or accessibility regression was found. The two observations above are cosmetic or out-of-scope and none blocks integration.

VERDICT: ACCEPT
