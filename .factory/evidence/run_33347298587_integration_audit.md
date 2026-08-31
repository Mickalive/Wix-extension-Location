# Factory Lane Audit — Integration Candidate ec916b75d5600e02d679d264648ac92333d721f1

## Candidate and Base

- Candidate SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Accepted base SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Verification: `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` and `git diff ec916b75d5600e02d679d264648ac92333d721f1` both reproduce a zero product delta (only unstaged .opencode/agent metadata in the worktree, not in the candidate). Candidate is rooted at the pinned accepted SHA with no drift.

## Wix-Owned Scaffold / Binding — Authenticated Official Generation

**Binding file (`wix.config.json`) in candidate (via `git show`):**
```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

**Authenticated provenance on `origin/main` (via `git show`):**
- `.factory/evidence/run_33321707099_official_scaffold.json`:
  - `source: authenticated official Wix existing-app scaffold`
  - `appId: 3e9ec3af-001b-4684-a197-a5133677844d`
  - `projectId: advanced-booking-rules`
  - `projectType: App`
  - `wixCliVersion: 1.1.238`
  - `pristineWixBuild: PASS`
  - `scaffoldPackageSha256: 1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd`
  - `developmentSiteProvisioned: true`
- `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — full `wix build` (Astro + Vite) log ending `Server built in 10.70s / Complete!` with no scaffold errors.

**Authenticity assessment:**
- App ID in candidate exactly matches the authenticated scaffold evidence; no hand-authored guess, placeholder, or invented identifier.
- `wix.config.example.json` remains a shape template with placeholder `"<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"` and is correctly classified `UNLINKED` by `src/platform/registration/projectConfig.ts`; the real binding is preserved separately per `AGENTS.md` ("preserve the bound existing App ID").
- `extensions.ts` is intentionally empty (`EXTENSIONS = []` frozen) with documented rationale that generated entries arrive only at authenticated scaffold (Technical Contract §15 T-VP0). `src/platform/registration/extensionsManifest.ts` inventories all PLANNED_UNTIL_T_VP0 surfaces without inventing extensionIds. No fabricated extension IDs found.
- `.gitignore` protects the future real binding; `src/platform/registration/scaffoldPrerequisites.ts` enumerates human-owned prerequisites without secret material.
- Classifier `classifyProjectBinding` / `looksLikeScaffoldPlaceholder` enforces MISSING/UNPARSEABLE/UNLINKED vs LINKED distinction, failing closed on placeholders.

Verdict on scaffold: **authenticated official generation, not hand-authored**.

## Lane Ownership and Scope Compliance

Integration lane owns `src/platform/**`, `src/extensions/**` + `extensions.ts`, `src/pages/api/**`, collection schemas, webhook handlers, schedule-mutation safety.

- No domain logic in `src/domain/**` was modified (candidate diff is zero; cross-checked `src/platform/purity/check-purity.mjs` default protected roots).
- No billing policy or dashboard UX changes in this SHA (separate lanes).
- No governance/orchestration edits in candidate (unstaged worktree changes to `.opencode/agents/**` are outside the candidate SHA and are not audited as candidate code; the committed manifest at the SHA matches the trusted base).
- `wix.config.json` edit policy satisfied: existing App ID preserved.

## Deterministic Reproduced Evidence

Commands run directly (no pipes/redirects):

- `git status` — detached HEAD, unstaged metadata only, no staged candidate changes
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json` — reproduced above
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — reproduced above
- `git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json` — reproduced above
- `git diff ec916b75d5600e02d679d264648ac92333d721f1` — product delta empty
- `npm ci` — installed 47 packages
- `npm run check:purity` — PASS: "Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration."
- `npm run typecheck` — PASS (zero errors after `npm ci`)
- `npm test` (`vitest run --config src/platform/vitest.config.ts`) — PASS: 49 test files, 548 tests passed. Includes targeted integration suites:
  - `schedule-mutation.spec.ts` (10), `orchestrator-terminal-states.spec.ts` (7), `idempotency.spec.ts` (8), `webhooks-chaos.spec.ts` (13), `webhooks-pipeline-contract.spec.ts` (5), `http-auth.spec.ts` (27), `http-mutations.spec.ts` (13), `validation-plugin-*` (bulk/counters/identity/clock-guard/entitlement/target-aware/handler-matrix), `registration-surface.spec.ts` (17), `registration-project-config.spec.ts` (13), `purity-gate.spec.ts` (4), `platform-scope.spec.ts` (8)
- `npm run build` (`npm run check` = typecheck + purity + vitest) — PASS, 49 files / 548 tests

No secrets, no Wix CLI/MCP mutation, no publish/release attempted.

## Platform Safety Properties (integration-owned)

- **Idempotency:** `src/platform/schedule-mutation/idempotency.ts` derives deterministic UUIDv5 keys from `(siteId, scopeScheduleId, ruleVersion, weekday/window)` via RFC4122 SHA-1; namespace `7c9e6679-7425-40de-944b-e07fc1f90ae7` frozen. Rollback keys use fresh per-snapshot keys. Orchestrator `withDerivedIdempotencyKeys` ensures every change carries a key.
- **Snapshot before write:** `orchestrator.beginApply` snapshots `ScheduleGateway.snapshotWorkingHours(scope)` and `journal.persistBaseline` before any write (Contract §9.1). Resumes reuse existing baseline.
- **Revision-checked updates:** `applySingleWithRetry` honors `REVISION_CONFLICT` retriable with bounded `maxRevisionRetries=3`, re-reading fresh revision for UPDATE/CANCEL.
- **Verify then mark:** `completeApply` re-reads via `verifyApplied`; on mismatch invokes `failApply` → `rollbackTo` + `ROLLED_BACK` + audit entry.
- **Crash recovery:** `recoverInterruptedApply` restores `snapshot`, window-granularity `windowContentDiffs` verifies, marks `RECOVERED`, records `RECOVERY_COMPLETED`. `NON_TERMINAL_STATES` fail-fast prevents double completion/rollback on terminal states.
- **Webhooks:** `src/platform/webhooks/pipeline.ts` enforces signature verification before store, dedup on `envelope.id` (`ALREADY_COMPLETED` → `DUPLICATE_ACKNOWLEDGED`), ordering via `entityEventSequence` with per-entity scope, gap buffering, `bootstrapOrderingHead` and `drainBuffered` safety valve, at-least-once dispatch with per-handler `deliveryKey` idempotency, in-flight reclaim handling. Verified by chaos tests (dupes + reordering converge).
- **HTTP / validation-plugin purity:** `src/platform/purity/check-purity.mjs` protects `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`; verified PASS. No `@wix/` imports in protected paths. Real SDK calls isolated to thin `src/pages/api` adapters + fakes.
- **Registration honesty:** No invented extensionIds; all statuses `PLANNED_UNTIL_T_VP0` until scaffold.

## Negative Checks

- No PREVIEW_GATED capability promoted to production claim.
- No unsupported mutation of `Location.businessSchedule` or full-object location override.
- No deletion of customer configuration, no silent schedule rewrites without diff/confirm.
- No weakened tests, no stubbed assertions, no skipped checks found.
- No credential capture or exposure.

## Conclusion

Candidate SHA is identical to accepted base, preserving the previously audited credential-free platform foundation. Scaffold provenance is authenticated via origin/main evidence with `pristineWixBuild: PASS` and App ID preservation. All deterministic checks reproduce PASS. No lane-boundary violation, no fabrication, no integration blocker.

VERDICT: ACCEPT
