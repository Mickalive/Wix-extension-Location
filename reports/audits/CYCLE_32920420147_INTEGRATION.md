# Integration Lane Audit — Cycle 32920420147 (cycle-6 repair INT-C6-R1)

- **Auditor:** lane-auditor (independent, read-only except this report)
- **Accepted base (current checkout):** `aec73b05eefb17a3643043f3d4f7a6bcba92fc0b` — "Wix build 32915633541: recover audited v2 state and route real scaffold", working tree clean
- **Candidate (mounted worktree):** `/tmp/wix_integration_candidate` @ `e1c83cd0cae0255305ee1918cb3c06e40d98e1e4` — "Wix build 32920420147: integration candidate (active)", working tree clean
- **Task:** `docs/NEXT_CYCLE.json` → lanes.integration, task `INT-C6-R1` (repair of Wix Live finding `reports/wix-live/CYCLE_32915633541.md`)
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/INTEGRATION.md`, `AGENTS.md`

## 1. Diff inventory (exact, 14 files, +1200/−2)

| File | Change | Lane scope |
|---|---|---|
| `.gitignore` | +7: ignores real `wix.config.json` with rationale comment | integration allowlist (workflow line 185/360) ✔ |
| `wix.config.example.json` | +4: shape template, placeholder `appId` | integration allowlist ✔ |
| `extensions.ts` | +33: new, intentionally empty generated-extension anchor | integration-owned (`extensions.ts`) ✔ |
| `tsconfig.json` | include += `extensions.ts` (1 line replaced) | integration allowlist ✔ |
| `src/platform/purity/check-purity.mjs` | adds protected root `src/platform/registration` + comments (additive) | `src/platform/**` ✔ |
| `src/platform/registration/{index,projectConfig,exampleProjectConfig,validationExtension,extensionsManifest,scaffoldPrerequisites}.ts` | new pure modules | `src/platform/**` ✔ |
| `src/platform/registration/README.md` | new documentation | `src/platform/**` ✔ |
| `tests/platform/registration-{surface,project-config}.spec.ts` | new tests (+382) | `tests/platform/**` ✔ |

No governance, workflow, directive, contract, domain, dashboard, or billing file touched. No deletions of existing behavior anywhere in the diff.

## 2. Acceptance criteria — findings

**C1 — `npm ci … && npm run check && npm run build` pass.**
Audit-sandbox limitation, disclosed: no `node_modules` exists in either tree and the auditor permission contract denies dependency installation, so vitest/tsc could not be executed here. Executed instead: `npm run check:purity` in the candidate worktree → **passes over all seven protected roots including the new `src/platform/registration`**. Compensating static verification: (a) `package.json`/`package-lock.json` are byte-unchanged from the accepted base whose deterministic gates passed in cycle 6; (b) every import in the new modules resolves against verified existing exports (`VALIDATION_TARGETS`/`ValidationTarget` in `targets.ts`; `PlatformError` with `'INVALID_STATE'` in `shared/errors.ts`); all 20 re-exports in `registration/index.ts` match real declarations; (c) both spec files were traced assertion-by-assertion against implementations — placeholder shapes/tokens, URI rejection matrix (9 cases incl. traversal/query/no-host), byte-equality of `wix.config.example.json` vs `serializeExampleProjectConfig()`, ghost-path existence checks (all six `productSourcePath` targets confirmed present), channel/kind/status pins — no mismatch found; (d) the `.mjs` import pattern has prior art in accepted tests (`tests/platform/purity-gate.spec.ts`, `platform-scope.spec.ts`, `tests/billing/purity.spec.ts`) under `allowJs:true`. Residual execution risk is low and is definitively closed by the deterministic shell gate that runs before any persistence.

**C2 — no secrets, no fabricated Wix/account/site identifiers. VERIFIED POSITIVE.**
No real `wix.config.json` is committed; it is gitignored by policy (matching recon S4 "Don't edit this file" and runbook ground rule 1). The committed template carries only explicit placeholders (`<GENERATED-BY-AUTHENTICATED-SCAFFOLD>`), is pinned UNLINKED by the same classifier used for real configs, and anti-fabrication tests sweep the whole surface for UUID-like/hex identifier shapes and SDK-import strings (none present — independently confirmed by reading every new file). `DEFAULT_VALIDATION_DEPLOYMENT_URI = '/api/bookings-validation'` is a project-internal route derived from the documented `pages/api` mapping (recon S9), not an identifier. No secrets anywhere in the diff.

**C3 — live job past missing-scaffold OR narrowly evidenced BLOCKED_EXTERNAL.**
Branch (a) is achievable only after the human-owned scaffold produces a real binding (Contract §16 items 1–3; UQ4/V10 quarantine); committing an invented `wix.config.json` to force it would violate `directives/INTEGRATION.md` ("Never fabricate `wix.config.json`") and constitute fake evidence. The candidate therefore delivers the maximal legitimate content: truthful linkage classification (`MISSING_FILE`/`UNPARSEABLE`/`UNLINKED`/`LINKED` demanding positive `appId` evidence), a machine-readable prerequisites record (5 entries, each with owner=`HUMAN_ACCOUNT_OWNER`, why-not-derivable-in-CI, gate, existing-runbook anchor), and `externalBlockerStatement()` composing exactly the narrow, identifier-free BLOCKED_EXTERNAL wording grounded in Contract §16/T-VP0/runbook. Nothing obstructs or pre-fakes the live job's own disposition; the platform-shape claims made (`projectType:'app'`, load-bearing `appId`) are exactly the documented ones (recon PLATFORM.md L65/L72/L247) with unknown fields tolerated per C4 discipline.

**C4 — previously accepted behavior remains green.**
Changes to shared files are strictly additive (gitignore rule; tsconfig include; one new purity root — a strengthening, not a weakening). No accepted module, test, port, or DTO semantics modified. Purity gate re-run over domain/billing/http/webhooks/validation-plugin/composition/registration passes in the candidate tree.

**C5 — fresh independent Integration audit ACCEPT:** this report.

## 3. Adversarial questions

- **Semantic regression / hidden degraded states?** None found. Classifier states are explicit, never silent; `buildBookingsValidationExtensionConfig` throws `PlatformError('INVALID_STATE')` rather than coercing malformed URIs.
- **Weakened tests / skipped checks?** None. Gate coverage expanded; `passWithNoTests:false` retained; new tests are falsifiable property pins (byte-equality, ghost-path existence, placeholder taxonomy, rejection matrix, live purity-script execution), not implementation mirrors.
- **Unsupported Wix assumptions / banned claims?** None. Generate-menu uncertainty for the validation plugin is explicitly recorded ("empirically unconfirmed until T-VP0"); README §4 makes no registration/live-behavior claims; reschedule best-effort posture untouched; channels match Contract §3 exactly (generate enum / dashboard fallback / interactive menu / file-based).
- **Cross-lane compatibility?** Additive only; nothing else imports the new surface yet; `shared/errors` taxonomy reused correctly; validation targets derive from the implemented handler matrix (single source of truth), preventing drift.

## 4. Non-blocking observations

- **O1:** spec asserts `/wix\.config\.example\.json/m` against `.gitignore`, which matches a comment line rather than an active rule. Harmless (the example file is *meant* to be committable; the load-bearing `^wix\.config\.json$` rule is properly anchored). May be tightened opportunistically.
- **O2:** full vitest/tsc execution was not possible inside this audit sandbox (see C1); the deterministic integration shell must treat its own green run as the closing proof of criterion 1 before persistence.
- **O3:** `extensions.ts` is an inert anchor by design; at T-VP0 scaffold the unified CLI owns/regenerates it — merge guidance exists in the runbook.

## 5. Verdict

The candidate honestly establishes every derivable element of the supported unified-CLI scaffold/registration surface, fabricates nothing, strengthens gates, keeps all accepted behavior intact, and converts the cycle-6 live finding into precisely the narrow, evidenced external prerequisite that governance permits. Minimum follow-up for the Director/lane: none required for integration; the human-owned scaffold steps (Contract §16) remain the sole path to resolving criterion 3's first branch empirically.

VERDICT: ACCEPT
