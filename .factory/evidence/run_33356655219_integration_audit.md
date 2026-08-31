# Factory Lane Audit — Integration Candidate

Candidate SHA: 810c8b88be41aa2dba5ca2f251182a93cdb81518
Accepted base SHA: ec916b75d5600e02d679d264648ac92333d721f1
Audit scope: exact integration candidate diff against accepted base; Wix-owned scaffold/binding provenance verified via authenticated official generation.

## 1. Wix Scaffold / Binding — Authenticated Official Provenance

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

Reproduced via `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`:
- Pristine build log shows Wix build PASS (Astro + Cloudflare adapter, Vite 6864 modules, server built in 10.70s, Complete, wix-cli 1.1.238).
- `pristineWixBuild: PASS`, `developmentSiteProvisioned: true`, `secretsPersisted: false`.

Binding verification (reproduced via `git show` for both SHAs):
- Base `ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` -> appId `3e9ec3af-001b-4684-a197-a5133677844d`, projectId `advanced-booking-rules`.
- Candidate `810c8b88be41aa2dba5ca2f251182a93cdb81518:wix.config.json` -> identical appId and projectId, no diff.
- `git diff --name-only` between base and candidate shows zero changes to `wix.config.json`, `package.json`, or any scaffold metadata.
Conclusion: scaffold is authenticated official existing-app generation, not hand-authored guess. App ID preserved, no scaffold drift introduced by candidate.

## 2. Candidate Diff — Reproduction

`git diff --name-only ec916b75d5600e02d679d264648ac92333d721f1 810c8b88be41aa2dba5ca2f251182a93cdb81518` reproduced:
- src/platform/adapters/fakes/confirmedPlanStore.ts (new)
- src/platform/http/confirmDiffEndpoint.ts (new)
- src/platform/http/confirmedPlanStore.ts (new)
- src/platform/http/index.ts (modified)
- src/platform/http/mutationEndpoints.ts (modified)
- tests/platform/confirm-diff-durability.spec.ts (new)
- tests/platform/helpers/httpTestDoubles.ts (modified)
- tests/platform/http-auth.spec.ts (modified)
- tests/platform/http-mutations.spec.ts (modified)

`git diff` stat: 9 files, 805 insertions, 16 deletions.
Diff content reviewed line-by-line (see tool output). No Wix SDK imports introduced; no filesystem/network/process dependencies in domain; no billing/domain semantics touched.

## 3. Lane Ownership Check

Integration lane owns: Wix CLI scaffold/project metadata, platform adapters, extension/backend transport, Wix persistence integration, webhooks, idempotency, schedule mutation safety and platform tests.
Candidate touches only:
- `src/platform/http/*` (HTTP transport, auth-gated mutation endpoints)
- `src/platform/adapters/fakes/confirmedPlanStore.ts` (test fake for durable port)
This is strictly within integration ownership. No changes to `src/domain/*`, `src/billing/*`, dashboard UI code. Does not fork domain semantics, does not alter billing policy, does not modify `wix.config.json` except preserving App ID (no change). Ownership compliant.

## 4. Technical Correctness — Reproduction

### 4.1 Purity & Type Safety
- Reproduced via `npm run typecheck` after `npm ci`: PASS (zero errors).
- Reproduced via `npm run check:purity`: PASS — "Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration."
- New files inspected for banned imports: none contain `import ... from '@wix/'` or `require('@wix'`. Port `confirmedPlanStore.ts` is pure with only `src/shared/types` import.
- Inspected `confirmDiffEndpoint.ts`: contains only PlatformError, shared types, auth, transport, ConfirmedPlanStore port. No Wix SDK.

### 4.2 Deterministic Tests — Full Suite Reproduction
Reproduced via `npm run check` (typecheck + purity + vitest):
- 50 test files passed, 570 tests passed, 0 failed (duration 8.15s).
- Purity gate fixture check correctly failed on intentional violation fixtures (expected), but overall purity gate logic validated.
- Candidate-specific suite `tests/platform/confirm-diff-durability.spec.ts` (22 tests) all passed independently within full run:
  - F3 hash computation: deterministic, 8-char hex, stableStringify sorting, FNV-1a empty hash `811c9dc5`, cross-process determinism, different plans different hashes.
  - POST /confirm-diff: persists record, returns hash matching server compute, F5 confirmedBy derived from token, rejects missing body, extra keys, invalid shape, auth failures with zero store touches.
  - Cross-invocation durability: shared Map backing simulates two serverless instances; record saved by instance A visible to instance B; apply-plan retrieves via same store; empty store correctly yields NOT_FOUND.
  - F3 hardening on apply-plan: corrupted diffHash vs recomputed hash -> INVALID_STATE; tampered plan -> INVALID_STATE; valid record -> 200 success.
  - Token verification matrix: valid token passes, missing/invalid/verifier outage fails closed UNAUTHORIZED with zero saves.

### 4.3 Updated Existing Tests
- `tests/platform/http-auth.spec.ts` updated to compute valid hash via `computePlanHash` instead of hardcoded `hash-abc`; 27 tests passed.
- `tests/platform/http-mutations.spec.ts` updated to use `validHash()` computed from plan; 13 tests passed, including strict body schema rejection and INVALID_STATE surfacing.
- No regression in other 48 suites (domain, billing, platform).

### 4.4 Security Invariants
- F3 verified: hash recomputed server-side via `canonicalPlanSerialization` + `fnv1aHex`; no client-supplied hash trusted. MutationEndpoints re-verifies on apply (`computePlanHash(confirmed.plan) !== diffHash` => INVALID_STATE with details).
- F5 verified: `confirmedBy = caller.subject` from `requireVerifiedCaller`; never from body. Tests prove even if body contained different value, stored record uses token subject.
- Strict body schema: exactly `{ plan }` key, extra keys rejected INVALID_QUERY.
- Auth fails closed: all endpoints use `requireVerifiedCaller`; missing/invalid/outage => UNAUTHORIZED, zero store/orchestrator interactions.

### 4.5 Durability Semantics (F1 FIX)
- Original in-memory Map assumption replaced with `ConfirmedPlanStore` port (interface with save/findByDiffHash). Fake `createInMemoryConfirmedPlanStore(backing?)` allows sharing Map to simulate durable collection. Production adapter placeholder documented as future Wix data collection; no premature Wix SDK coupling in pure layer.
- `postConfirmDiff` saves immutable record keyed by content hash; `postApplyPlan` resolves via port and re-validates integrity before orchestrator execution.
- Tests prove cold-start survival and tamper detection.

### 4.6 Scope Discipline
- Endpoint validates shape and computes hash, adds zero rule logic; plan persisted exactly as submitted.
- No hidden side effects, no schedule rewrites, no external network calls.

## 5. Build & Marketplace Readiness Risks
- Candidate does not alter scaffold, does not introduce new Wix permissions, does not publish/release, does not handle secrets.
- `pristineWixBuild: PASS` from official scaffold remains valid; candidate preserves buildability (typecheck + vitest passed, no scaffold files touched).
- `package.json` unchanged; no new dependencies introduced.
- No secrets committed; no WIX_API_KEY exposure; no `~/.wix/**` access.

## 6. Findings

No reproducible defects identified.
- Scaffold provenance is authenticated official existing-app scaffold, not hand-authored.
- Binding preserved exactly (App ID `3e9ec3af-001b-4684-a197-a5133677844d`).
- Deterministic checks pass, type safety passes, purity passes.
- Negative and edge cases covered by 22 new + updated existing tests.
- Security invariants F1/F3/F5 proven via reproduced execution.

No FIX_BEFORE_INTEGRATION items; no REJECT items.

VERDICT: ACCEPT
