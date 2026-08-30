# Factory Lane Audit — Integration Candidate ec916b75d5600e02d679d264648ac92333d721f1

**Base:** ec916b75d5600e02d679d264648ac92333d721f1  
**Candidate:** ec916b75d5600e02d679d264648ac92333d721f1  
**Lane:** integration  
**Date:** 2026-08-30  
**Auditor model:** muse-spark-1.2-contributor-free (opencode/muse-spark-1.2-contributor-free)

## 1. Scope and Authority

Audit of exact integration candidate SHA against accepted base, as dispatched. No fix, no scope widening, no approval from builder claims. All evidence reproduced independently via allowed shell commands. Only this report was written.

Candidate equals base (zero delta: `git diff ec916b75... ec916b75 --stat` produced no output, and `git diff ec916b75 HEAD --stat` also empty). Audit therefore verifies that the present accepted state — scaffold, binding, platform layer — remains integrable and was not silently devolved by hand-authored guesses.

Obsolete `lane-auditor.md` contract ignored per instruction; role derives from system developer prompt.

## 2. Wix-Owned Scaffold / Binding Provenance (Critical)

**Requirement:** For integration, scaffold/binding must come from authenticated official generation, not hand-authored guesses. Evidence on `origin/main` at `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` inspected via `git show`.

**Reproduced evidence:**

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
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

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` reproduces Wix Astro build log ending with `Server built in 10.70s Complete!` and no scaffold errors beyond expected Vite warnings. Verified via direct `git show`; content matches official CLI build output (Node ≥20.11.0, Astro adapter).

- `git show HEAD:wix.config.json`:
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

**Assessment:**

- `wix.config.json` fields (`appId`, `projectId`, `projectType`) match official evidence exactly. Same App ID `3e9ec3af-001b-4684-a197-a5133677844d` as authenticated scaffold; projectId `advanced-booking-rules` matches. No fabricated ID, no hand-authored guess.
- `pristineWixBuild: PASS` in official evidence plus local reproduction of passing credential-free checks (see §3) corroborates scaffold authenticity. Generator exit 1 is explicitly marked `projectAcceptedDespiteOptionalPostTaskFailure: true` in official evidence — documented as known auxiliary agent-skills failure that does not invalidate `appId/projectId/projectType` nor the subsequent `wix build` (see `reports/wix-live/BOOTSTRAP_BINDING.md`: "auxiliary Wix agent-skills installation failure in CI; that failure is accepted only after validating the real appId/projectId/projectType").
- `reports/wix-live/BOOTSTRAP_BINDING.md` persisted at accepted state confirms: authenticated via protected Wix API key, bound to existing app **Advanced Booking Rules**, real `wix.config.json` generation, real `wix build` succeeded, `No API key... was persisted`, only three fields retained. Consistent with official evidence.
- `wix.config.json` not present on `origin/main` (`git show origin/main:wix.config.json` → fatal) is expected: initial bootstrap persisted evidence, not the file itself, until Director integration — no contradiction.
- No secret committed: `git diff` shows no credential, no `~/.wix`, no token. Package scripts contain no `WIX_API_KEY` exposure.

**Verdict on scaffold/binding:** PASS — authenticated official generation proven, not hand-authored.

## 3. Independent Reproduction — Checks

All commands run directly (no pipes/redirects/wrappers) in working directory `/home/runner/work/_temp/wix-factory-33336637983/product`.

**a) Candidate identity**

- `git status` showed detached HEAD, working-tree dirty (deleted/modified `.opencode/agents`, `MANIFEST.sha256`, `AGENTS.md`). Verified `git diff ec916b75 HEAD --stat` empty → dirty files are uncommitted workspace noise, not part of candidate SHA. Audit scoped strictly to SHA ec916b75.

**b) Type safety**

- `npm run typecheck` (tsc --noEmit) after `npm ci`: PASS (exit 0). Before `npm ci` it failed on missing `@types/node` — environment setup issue, not code defect, resolved by deterministic install.

**c) Purity gate (Technical Contract §8.1 / Blueprint §2)**

- `npm run check:purity` → `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- Reproduced via `node src/platform/purity/check-purity.mjs` logic: protected roots scanned recursively, comment-stripped, import-pattern matched. All 7 protected roots clean.

**d) Unit tests (credential-free)**

- `npm ci` → added 47 packages, audited.
- `npm test` (→ `npm run test:unit` → `check:purity && vitest run --config src/platform/vitest.config.ts`):
  - Test Files 49 passed (49)
  - Tests 548 passed (548)
  - Duration ~6.7s, environment node only, injected clock/zone, no network.
- `npm run build` (→ `npm run check` → `typecheck + check:purity + vitest`) identical PASS (548 passed). Deterministic gate green.

**e) Platform / integration specifics**

- No mutation of `wix.config.json` App ID; preservation verified.
- Schedule-mutation / idempotency / webhooks / validation-plugin suites all within 548 passing tests (e.g., `schedule-mutation.spec.ts`, `idempotency.spec.ts`, `webhooks-chaos.spec.ts`, `validation-plugin-*`, `registration-*`). No silent destructive rewrite.
- Scope hygiene: no location-mutation scope requested; pure-code tests enforce.

## 4. Findings

No reproducible blocking findings.

- Scaffold/binding authenticated via official evidence; IDs not fabricated.
- Candidate delta zero — no new integration code to falsify; existing integrated state remains sound.
- Purity, typecheck, and full unit suite all reproduce PASS independently.
- Working-tree dirty state is out-of-scope for SHA audit and contains only agent fiche deletions/modifications awaiting Director governance; not attributable to candidate.

Minor observation (non-blocking): `wix.config.json` on disk contains only `appId`, `projectId`, `projectType` — minimal field set, but that set matches official evidence exactly and `BOOTSTRAP_BINDING.md` documents that only `appId, projectId, projectType` were persisted. Full scaffold field capture (E2-E6 per `docs/runbooks/T_VP0_SCAFFOLD.md`) remains evidence-only, not required for build integrity.

## 5. Conclusion

Integration candidate ec916b75d5600e02d679d264648ac92333d721f1 (identical to base) preserves authenticated official scaffold provenance, passes all deterministic gates reproduced independently, and introduces no integration defects.

VERDICT: ACCEPT
