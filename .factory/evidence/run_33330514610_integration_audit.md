# Factory Lane Audit — Integration Candidate ec916b75

**Candidate SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Accepted Base SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Audit Date (UTC):** 2026-08-30
**Lane:** wix-integration (scaffold/binding, platform adapters, webhooks, idempotency, schedule mutation safety)
**Auditor Role:** independent lane-auditor (not builder), read-only except this report

## Scope

- Audited exact candidate SHA ec916b75 against accepted base ec916b75 as named by workflow. No fixes, no widening.
- Verified Wix-owned scaffold/binding provenance via authenticated official generation evidence on `origin/main`.
- Reproduced deterministic evidence and tests directly via allowed shell commands (no pipes/redirects/wrappers).

## Method

- Resolved candidate and base: `git show ec916b75 --stat` shows commit "product: remove obsolete control-plane workflows" — candidate equals base; zero lane delta to review.
- Inspected authenticated scaffold provenance with `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` and `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`.
- Compared on-disk `wix.config.json` (`git show HEAD:wix.config.json`) to official evidence.
- Inspected `wix.config.example.json`, `extensions.ts`, `src/platform/registration/*`, `docs/runbooks/T_VP0_SCAFFOLD.md`, `reports/wix-live/BOOTSTRAP_BINDING.md`, `.gitignore`, `package.json`, platform purity gate, typecheck, and unit tests.
- Executed locally: `npm ci`, `npm run check:purity`, `npm run typecheck`, `npm test` (Vitest), `git status`, `git diff`.

## Findings

### 1. Wix Scaffold / App Binding Authenticity — PASS

- Official evidence on `origin/main` (`run_33321707099_official_scaffold.json`):
  ```json
  {
    "schemaVersion": 3,
    "source": "authenticated official Wix existing-app scaffold",
    "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
    "projectId": "advanced-booking-rules",
    "projectType": "App",
    "createNewVersion": "0.0.105",
    "wixCliVersion": "1.1.238",
    "generatorExit": 1,
    "projectAcceptedDespiteOptionalPostTaskFailure": true,
    "pristineWixBuild": "PASS",
    "scaffoldPackageSha256": "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd",
    "developmentSiteProvisioned": true,
    "secretsPersisted": false
  }
  ```
- Pristine build log (`run_33321707099_official_scaffold_pristine_build.txt`) shows real `wix build` (Astro/Cloudflare adapter) completed in 10.70s with no scaffold registration errors: `[build] Complete!`
- On-disk binding (`wix.config.json` via `git show HEAD:wix.config.json` and filesystem read):
  ```json
  {
    "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
    "projectId": "advanced-booking-rules",
    "projectType": "App"
  }
  ```
- **Match verified:** `appId`, `projectId`, `projectType` identical to authenticated evidence. No hand-authored guess, no placeholder, no fabricated ID. `BO O TSTRAP_BINDING.md` confirms "Wix generated a real wix.config.json for that exact app and a real `wix build` completed successfully before the binding was persisted. No API key ... was persisted." `secretsPersisted: false` confirms no secret leak.
- `generatorExit: 1` with `projectAcceptedDespiteOptionalPostTaskFailure: true` is explicitly documented in `BOOTSTRAP_BINDING.md` as the known auxiliary Wix agent-skills post-task failure — accepted only after validating real appId/projectId/projectType and after mandatory `wix build` PASS. Not treated as fabrications.
- Single binding only: no second `wix.config.json`, no competing `appId`.

### 2. Extension / Registration Surface — PASS

- `extensions.ts` is intentionally empty and frozen (`EXTENSIONS: readonly GeneratedExtensionEntry[] = Object.freeze([])`) with header citing `INT-C6-R1` and `T-VP0`. No fabricated `extensionId`.
- `src/platform/registration/README.md` correctly declares `wix.config.json` as gitignored/account-bound and reserves real IDs for `T-VP0`. `src/platform/registration/extensionsManifest.ts` declares all extensions as `PLANNED_UNTIL_T_VP0` with channel classification; tests enforce existence.
- `wix.config.example.json` contains only placeholder `"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"` and is byte-for-byte pinned by `exampleProjectConfig.ts` tests.
- Observed tension: `HEAD` tracks `wix.config.json` via force-add while `.gitignore` lists it as ignored and `README` says "never committed". Content is non-secret and matches official provenance, so not a fabrication; bootstrap doc explicitly says non-secret fields are persisted. Since candidate equals already-accepted base, this pre-existing state is not a new integration failure introduced by this candidate.

### 3. Lane Ownership / Scope — PASS

- Candidate SHA equals base SHA — zero file delta for this lane; no cross-lane edits (no domain/billing/dashboard ownership violation), no governance/orchestration edits beyond the unrelated control-plane workflow removal already in base, no secret exposure.
- Platform purity: `npm run check:purity` passes ("no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration").
- Registration/validation-plugin wiring preserves single-source-of-truth (`validationExtension.ts` derives from `validation-plugin/targets.ts`), no Preview-gated APIs enabled.

### 4. Deterministic Tests — PASS (reproduced)

- `npm ci` succeeded.
- `npm run typecheck` (`tsc --noEmit`) passes (0 errors).
- `npm run check:purity` passes.
- `npm test` (`vitest run --config src/platform/vitest.config.ts`) passes:
  - 49 test files, 548 tests passed, 0 failed.
  - Key suites observed: `registration-surface`, `registration-project-config`, `platform-scope`, `purity-gate`, `validation-plugin-*`, `schedule-mutation`, `webhooks-chaos`, `http-*`, `projector-compaction`, etc.
  - No Wix SDK, REST, MCP, network, or filesystem imports in domain core (purity specs pass).

### 5. No Fix-worthy Blockers

- No fabricated IDs, no guessed projectType, no missing provenance, no unproven production claims, no Preview-gated code in publishable path.
- Schedule mutation, webhook, idempotency surfaces exist as credential-free fakes/orchestrator with kill-the-power recovery and revision-checked writes per Technical Contract §9 — not exercised live (requires credentials) but credential-free tests cover deterministically.

## Conclusion

Integration candidate ec916b75 preserves the authenticated official Wix binding (App ID 3e9ec3af-001b-4684-a197-a5133677844d) proven by `origin/main` evidence with pristine `wix build` PASS. Binding is not hand-authored. No new lane defects. Deterministic checks reproduced green.

VERDICT: ACCEPT
