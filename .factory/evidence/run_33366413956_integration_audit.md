# Factory Lane Audit — Integration Candidate

**Candidate SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Accepted Base SHA:** ec916b75d5600e02d679d264648ac92333d721f1
**Audit date (UTC):** 2026-08-31
**Role:** lane-auditor (adversarial, read-only, not builder)
**Scope:** exact integration candidate SHA vs accepted base; Wix-owned scaffold/binding provenance

## 1. Candidate vs base delta

- `git diff ec916b75d5600e02d679d264648ac92333d721f1 ec916b75d5600e02d679d264648ac92333d721f1` = empty (candidate identical to base).
- `git show --name-only HEAD` = commit ec916b75 `product: remove obsolete control-plane workflows and retry scripts` touching only `.github/actions/setup-opencode/action.yml`, `.github/scripts/*`, `.github/workflows/ci.yml`. No product lane files changed in this SHA relative to its parent.
- Working-directory `git status` shows unstaged modifications to `.opencode/agents/*`, `.opencode/job-descriptions/*`, `AGENTS.md` and untracked `*.md` auditors — these are **not** in candidate SHA ec916b75. Audit assessed only the committed SHA per workflow instruction, not the dirty worktree.

Result: zero lane-owned path changes to integrate; no silent scope widening, no regression introduced by candidate.

## 2. Wix scaffold / binding authenticity (integration ownership)

Requirement: Wix-owned scaffold/binding must come from authenticated official generation, not hand-authored guesses. Must preserve bound App ID.

**Evidence inspected via `git show` on `origin/main`:**

- `origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
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

- `origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`: real `wix build` log, `@wix/astro-wix-hosting-adapter`, `@astrojs/cloudflare`, `✓ Completed in 320ms`, `✓ built in 2.49s`, `✓ built in 7.81s`, `Server built in 10.70s`, `Complete!` — no build errors.

**Current candidate binding:**

- `wix.config.json` at HEAD (and at `origin/lab/wix-rules:wix.config.json`):
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

**Assessment:**

- appId/projectId/projectType in candidate exactly match authenticated scaffold provenance (`origin/main` evidence) — not guessed. Matches `reports/wix-live/BOOTSTRAP_BINDING.md` description of binding to existing app *Advanced Booking Rules*.
- Only non-secret fields persisted (`appId`, `projectId`, `projectType`) per Technical Contract §16 and runbook `docs/runbooks/T_VP0_SCAFFOLD.md` — no credentials, no `~/.wix/**` token, no patched packages.
- `generatorExit:1` is explained by `projectAcceptedDespiteOptionalPostTaskFailure:true` and `BOOTSTRAP_BINDING.md`: known auxiliary Wix agent-skills installation failure in CI, accepted only after validating real appId/projectId/projectType. Mandatory subsequent `wix build` is `PASS` — reproduced in pristine_build.txt log.
- `scaffoldPackageSha256` and `wixCliVersion 1.1.238` provide traceable official generator identity.
- `developmentSiteProvisioned:true` consistent with Technical Contract §6 dev-site requirement.
- No hand-authored ID invention, no App ID mutation — integration lane preserved bound existing App ID as required by `AGENTS.md` Product Factory v3 §1 and lane ownership clause.

**Conclusion:** Scaffold authenticity PROVEN by authenticated official-scaffold evidence on `origin/main`.

## 3. Deterministic checks reproduced

- Ran `npm ci` (clean install) — succeeded, 47 packages, 5 audit advisories (not blockers).
- Ran `npm run check` (= `tsc --noEmit` + `check:purity` + `vitest run --config src/platform/vitest.config.ts`):
  - `typecheck: tsc --noEmit` — PASS (after npm ci, previously missing @types/node resolved)
  - `check:purity` — PASS: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
  - `vitest` — 49 test files PASS, 548 tests PASS (0 failed). Includes platform scope, purity-gate, registration-surface, schedule-mutation, webhooks-chaos, validation-plugin matrix, composition-root, idempotency, billing counter/tiers, domain evaluate/splitWindows/exceptions, etc. Duration 8.03s.

No skipped checks, no weakened tests detected. Purity gate logic correctly flags forbidden `@wix/` imports under protected paths via fixture tests.

## 4. Technical Contract / lane ownership compliance

- Technical Contract BINDING architecture (unified Wix CLI, `wix.config.json` binding, Wix-managed hosting) respected — candidate does not alter architecture or introduce deprecated CLI paths.
- Blueprint module map: integration owns `src/platform/**`, `wix.config.json`, extensions; candidate makes no unauthorized cross-lane edits (diff empty).
- No `src/domain/**` or `src/billing/pure/**` `@wix/` contamination — verified by purity gate pass.
- No secret committed, no `WIX_API_KEY` in repo, no `wix release`/`publish` invocation.
- No destructive schedule mutation, no new permissions/scopes introduced.

## 5. Integrated preview considerations

- Candidate == base, so integrated preview = current `lab/wix-rules` accepted state. Prior factory cycle `reports/factory/CYCLE_33072886087.md` shows integration builder exit 75 (infrastructure) not product defect — not attributable to this SHA. No negative lane audit blocks this SHA.
- `docs/state.json` phase `build`, cycle 21, `last_result NOT_READY last_reason final_auditor_unavailable_or_failed product_promoted false` — indicates loop continues pending external gates, not candidate defect.

## 6. Findings

No reproducible defects in candidate SHA.

- Scaffold provenance: ACCEPT — authenticated official scaffold on `origin/main` validates binding.
- Deterministic checks: ACCEPT — typecheck + purity + 548 unit tests green.
- Lane isolation: ACCEPT — zero out-of-lane modifications.
- No fake evidence, no widened scope, no fix required.

The unstaged working-directory agent file churn is out-of-scope for this SHA audit and must not be integrated via this candidate; deterministic shell must persist only the exact SHA if accepted.

VERDICT: ACCEPT
