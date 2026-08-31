# Factory Lane Audit — Integration Candidate

**Candidate SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Accepted Base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Lane:** integration
**Audit Mode:** exact integration candidate, read-only, reproduce evidence
**Date (UTC):** 2026-08-31

## Scope and Contract
- Audited only the exact integration candidate named by the workflow (`ec916b75...`), not builder claims.
- Verified Wix-owned scaffold/binding provenance via authenticated official generation evidence on `origin/main`.
- Reproduced tests and gates independently. No fixes applied, no scope widened.
- Report writable only to `reports/factory_lane_audit.md` per instructions.

## Scaffold / Binding Authenticity — Verified via `git show`

Reproduced from `origin/main` (authenticated official scaffold provenance):

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` returned:
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

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows clean Wix build: `[@wix/astro-wix-hosting-adapter] Enabling sessions`, vite client/server built `✓ built in 2.49s` / `✓ built in 7.81s`, `Server built in 10.70s`, `Complete!` with no scaffold failure. `generatorExit:1` is explicitly marked as optional post-task failure but `pristineWixBuild: PASS` and `projectAcceptedDespiteOptionalPostTaskFailure: true`.

- Candidate `wix.config.json` via `git show HEAD:wix.config.json` and `git show refs/tags/factory-candidate/integration/215:wix.config.json`:
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```
Matches official `appId`/`projectId`/`projectType` exactly. No hand-authored guess, no App ID drift. `wix.config.json` preservation rule satisfied: bound existing App ID unchanged.

- Cross-checked `origin/lab/wix-rules:wix.config.json` identical. No secret committed, no fabrication of Wix identifiers.

- Contract binding: `docs/WIX_TECHNICAL_CONTRACT.md` §1 specifies unified Wix CLI scaffold via `npm create @wix/new@latest app` with automatic registration; §16 lists human-owned prerequisites. Evidence above proves the scaffold was produced via authenticated official generation, not manual file creation.

## Candidate vs Base

- `git status` showed detached HEAD at candidate commit; `git show --name-only HEAD` confirms candidate commit `ec916b75` is `product: remove obsolete control-plane workflows and retry scripts` touching only `.github/**`.
- `git diff HEAD` vs `git show refs/tags/factory-candidate/integration/215 --name-only` confirms candidate SHA equals accepted base SHA exactly. This is a null-diff integration candidate (no new integration delta beyond already-accepted base). That is permissible; audit verifies no regression and no binding loss. The integration candidate preserves the accepted product state.
- Working directory dirty changes to `.opencode/agents/**`, `.opencode/job-descriptions/**`, `AGENTS.md` are NOT part of candidate SHA (verified via `git diff --name-only HEAD`); they are ignored for candidate audit per "exact integration candidate" rule.

## Ownership and Scope Compliance

- Integration lane owns `src/platform/**`, `src/extensions/**`, `src/pages/api/**`, data collections, webhooks, idempotency, schedule mutation safety. Candidate introduces no domain/billing/dashboard mutations. No lane-boundary violation.
- No hand-authored scaffold fields, no invented `wix.config.json` keys, no fabricated Wix IDs. Files align with `docs/BUILD_BLUEPRINT.md` §1 layout.
- No governance violation: candidate does not modify `MAIN_PROMPT.md`, `opencode.json`, workflows beyond the allowed control-plane cleanup (deleting obsolete retry scripts — explicitly noted in commit message and does not alter product contracts).

## Reproduction of Deterministic Checks

Executed credential-free gates without pipes/redirects/wrappers:

- `npm ci` — installed 47 packages, succeeded.
- `npm run typecheck` — after install: `tsc --noEmit` passed (0 errors).
- `npm run check:purity` via `node src/platform/purity/check-purity.mjs` — `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- `npm run check` — `typecheck + purity + vitest run --config src/platform/vitest.config.ts` — **49 test files, 548 tests passed** (duration ~7.6s). Includes `purity-gate.spec.ts` which internally exercises the purity gate with fixture violations (expected 4 forbidden imports in temp fixtures) — correctly flagged and did not affect product purity.
- `npm run build` — delegated to `npm run check` — same 548-pass result; credential-free build succeeds.

No `wix build` CLI invoked (requires Wix-managed hosting adapter and network egress not needed for this lane; `pristineWixBuild: PASS` already proven in official evidence). The credential-free deterministic gate required by `docs/BUILD_BLUEPRINT.md` §6 and `docs/WIX_TECHNICAL_CONTRACT.md` §8 is satisfied.

## Platform Tests and Safety

- Verified `src/platform/purity/check-purity.mjs` scans seven protected roots including `src/platform/registration` (added cycle 6 per comments) — defense-in-depth enforced.
- Existing platform tests covering schedule mutation, webhooks chaos, idempotency, composition root, registration surface all passed; no silent destructive rewrites evidenced.
- No external DB, no AI service, no secret leakage detected.

## Findings

No reproducible integration defects found. Scaffold binding is authenticated, App ID preserved, purity intact, deterministic tests green, no binding guesswork.

## Verdict

Integration candidate `ec916b75d5600e02d679d264648ac92333d721f1` preserves authenticated official scaffold provenance, retains correct App binding, introduces no hand-authored Wix configuration guesses, and passes all reproduced credential-free gates.

VERDICT: ACCEPT
