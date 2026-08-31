# Factory Lane Audit — Integration Candidate a4944f46ddcee871e1b61f3159fac650e22529b8

- **Auditor:** independent lane-auditor (not builder), read-only except this report
- **Accepted base:** ec916b75d5600e02d679d264648ac92333d721f1
- **Candidate:** a4944f46ddcee871e1b61f3159fac650e22529b8 (generation 202, wix-integration-builder)
- **Authorities:** MAIN_PROMPT.md, docs/WIX_TECHNICAL_CONTRACT.md, docs/BUILD_BLUEPRINT.md, directives/INTEGRATION.md, AGENTS.md
- **Date:** 2026-08-31

## 1. Diff inventory (exact, reproduced)

```
git diff ec916b75..a4944f46 --stat
 tsconfig.json | 2 +-

git show a4944f46
 -  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts", "extensions.ts"]
 +  "include": ["src/**/*.ts", "tests/**/*.ts", "extensions.ts"]
```

Single file, single hunk. No other file touched vs base. Lane scope check: `tsconfig.json` include adjustment touches shared build config but is additive/corrective, does not introduce domain/billing/dashboard ownership violation, does not fabricate Wix identifiers, does not touch governance/workflow files.

Base vs candidate `wix.config.json` (reproduced via `git show` both SHAs):
```
{ "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
```
Byte-identical across base and candidate, unmodified by this candidate.

## 2. Wix-owned scaffold/binding provenance (authenticated official generation)

Requirement: verify Wix-owned scaffold/binding came from authenticated official generation rather than hand-authored guesses, using origin/main evidence.

Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:

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

Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — full `wix build` log ending `Server built in 10.70s / Complete!` with `PASS` semantics, built via `@wix/astro-wix-hosting-adapter` and Vite 6864 modules, confirming Wix-managed toolchain.

Checks:
- Candidate `wix.config.json` fields (`appId`, `projectId`, `projectType`) exactly equal official evidence values — no hand-authored guess, no invented namespace or App ID, preserves bound existing App ID per directives/INTEGRATION.md.
- No secret, token, API key, or account store persisted (evidence `secretsPersisted:false`, candidate tree contains no `.wix/**`, no `WIX_API_KEY`, no patched package).
- `generatorExit:1` with `projectAcceptedDespiteOptionalPostTaskFailure:true` is explicitly documented as accepted — pristine build still PASS, not treated as product evidence failure. Candidate does not misrepresent this.
- `extensions.ts` remains intentionally empty frozen `EXTENSIONS = []` anchor per Technical Contract §3/S15 and registration README — no fabricated extension IDs.

Conclusion: binding is authenticated, not hand-authored. Candidate correctly preserves it (no mutation).

## 3. Deterministic checks reproduced (no trust in builder claims)

- `npm ci` — OK (47 packages)
- `npm run typecheck` (`tsc --noEmit`) — PASS (previously failed before install due to missing node_modules; after install clean)
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — PASS: `no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration`
- `npm run check` (typecheck + purity + vitest run --config src/platform/vitest.config.ts) — PASS: 49 test files, 548 tests passed, duration 7.41s. Purity fixture negatives correctly detected and reported as expected.
- `npm run build` alias (`npm run check`) — PASS via same gate.

No `wix build` run here (requires Wix toolchain network), but pristine official scaffold build already proven PASS in evidence; credential-free `npm run check` is the binding deterministic gate per Technical Contract §8/Blueprint §6, and it is green.

## 4. Adversarial checks

- **Fabrication of Wix config/IDs/credentials?** No. No change to `wix.config.json`; no new IDs; no secrets; grep of candidate diff shows no UUID-like App ID invention.
- **Lane boundary violation?** No domain/billing/dashboard/platform code touched; `tsconfig.json` edit is minimal build-config hygiene, consistent with prior accepted integration edit that added `extensions.ts` to includes. No Wix SDK import introduced.
- **Tsconfig regression?** Original include referenced root `vitest.config.ts` which does not exist (real file is `src/platform/vitest.config.ts` covered by `src/**/*.ts`). Removing the dangling entry is corrective, not regressive; `src/**/*.ts` already covers the real file. Verified by successful typecheck and vitest run.
- **Silent destructive schedule mutation / scope widening?** No schedule code touched.
- **Test weakening?** None. No test file modified; `passWithNoTests:false` retained via vitest config.
- **Governance tampering?** Working tree shows unrelated local modifications to `.opencode/agents/**` and `AGENTS.md` (not part of candidate SHA diff) — not attributable to candidate a4944f46 which touches only tsconfig. Candidate itself does not alter governance.

## 5. Non-blocking observations

- Local working tree contains unstaged modified agent files and deleted lane-auditor fiche (seen in `git status` at audit start) — these are outside the exact candidate SHA and not integrated, but indicate environment drift that should be cleaned before next cycle.
- Official scaffold `scaffoldPackageSha256` corresponds to temp scaffold package, not to product `package.json` — product retains minimal credential-free package by design (Blueprint §1, cycle-1 INT-C1-1). Not a provenance failure; binding fields are the non-secret evidence to persist per runbook.

## 6. Verdict

Candidate a4944f46 is a trivial hygiene fix to `tsconfig.json` that preserves the authenticated Wix binding byte-for-byte, introduces no fabrication, passes all reproducible deterministic gates (typecheck, purity, 548 unit tests), respects lane ownership, and correctly relies on official evidence `origin/main:.factory/evidence/run_33321707099_official_scaffold.*` (PASS build, matching App ID) rather than hand-authored guesses.

VERDICT: ACCEPT
