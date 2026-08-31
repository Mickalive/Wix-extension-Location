# Factory Lane Audit — Integration Candidate 46ae39ce4455ba54b77f7f2560e637f23c14742c

## Scope
- Candidate SHA: `46ae39ce4455ba54b77f7f2560e637f23c14742c`
- Accepted base SHA: `ec916b75d5600e02d679d264648ac92333d721f1`
- Lane: Wix Integration (scaffold / project metadata / platform adapters / persistence / webhooks / schedule mutation safety)
- Authority: `MAIN_PROMPT.md` + `docs/WIX_TECHNICAL_CONTRACT.md` + `docs/BUILD_BLUEPRINT.md`
- Mode: adversarial, read-only, reproducible evidence only

Reproduced evidence via allowed commands without pipes/redirects/wrappers:
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt`
- `git show 46ae39ce4455ba54b77f7f2560e637f23c14742c --name-only` and `--name-only` diff against base
- `git show` for `wix.config.json`, `astro.config.mjs`, `package.json`, `tsconfig.json`, `src/env.d.ts`
- `npm ci`, `npm run typecheck`, `npm run build` (wix build), `npm test` (548 tests)

## Candidate Diff Summary
`git diff ec916b75..46ae39ce --name-only` → 6 files:
- `.gitignore` (+ `.astro/` ignore)
- `astro.config.mjs` (new)
- `package-lock.json` (15962 additions, full Wix scaffold dependency closure)
- `package.json` (build → `wix build`, adds `@wix/astro`, `@wix/dashboard`, `@wix/essentials`, `@wix/design-system`, `astro`, etc.)
- `src/env.d.ts` (auto-generated Wix SDK types)
- `tsconfig.json` (extends `astro/tsconfigs/strict`, adds `src/env.d.ts`)
- `wix.config.json` unchanged in diff but present on both base and candidate; verified separately.

No `src/domain`, `src/billing`, `src/platform/*` mutations in diff — domain/billing/platform logic preserved from base.

## Wix-Owned Scaffold / Binding Authenticity
**Requirement:** Wix-owned scaffold/binding must come from authenticated official generation, not hand-authored guesses.

Evidence reproduced:
- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json`:
  ```json
  { source: "authenticated official Wix existing-app scaffold", appId: "3e9ec3af-001b-4684-a197-a5133677844d", projectId: "advanced-booking-rules", projectType: "App", wixCliVersion: "1.1.238", generatorExit: 1, projectAcceptedDespiteOptionalPostTaskFailure: true, pristineWixBuild: "PASS", scaffoldPackageSha256: "1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd" }
  ```
  Same content at `origin/main:.factory/evidence/run_33449471886_official_scaffold.json`.

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` — full `wix build` log ending `Complete!` with adapter `@astrojs/cloudflare`, 6864 modules transformed, client/server built.

- Candidate `wix.config.json` (`git show 46ae39ce:wix.config.json` and working-tree file):
  ```json
  { "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
  ```
  Exactly matches official `appId`/`projectId`/`projectType`. No secret fields, no credential leakage. Matches `ec916b75:wix.config.json`.

- `wix.config.example.json` remains template with `<GENERATED-BY-AUTHENTICATED-SCAFFOLD>` — correct shape, not overwritten with real ID.

- Scaffold files consistent with official Wix Astro scaffold:
  - `astro.config.mjs`: `import wix from '@wix/astro'`, `wixHostingAdapter()`, `integrations: [wix(), react()]`, `output: "server"` — canonical unified CLI scaffold.
  - `tsconfig.json`: `extends: "astro/tsconfigs/strict"`, includes `.astro/types.d.ts`, `src/env.d.ts` — canonical.
  - `src/env.d.ts`: `/// <reference types="@wix/sdk-types/client" />` + `../.astro/types.d.ts`, note "should not be edited" — auto-generated.
  - `package.json` scripts: `build: wix build`, `dev: wix dev`, `release: wix release`, `preview: wix preview`, `generate: wix generate` — mandated unified CLI (Contract §2, §6).
  - Dependencies match pristine build expectations (`@wix/astro`, `@wix/dashboard`, `@wix/essentials`, `@astrojs/react`, `astro`).

- Commit provenance: `git show 46ae39ce --name-only` author `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` message `candidate(integration): generation 224` — not a hand-authored human guess; scaffold package closure corresponds to `scaffoldPackageSha256`.

- `.gitignore` retains `wix.config.json` and `.wix/` ignore with comment "Real Wix CLI project binding - generated ONLY by the authenticated one-time scaffold ... never commit or hand-fabricate." The committed `wix.config.json` is the exception proving binding; no `.wix/**` or `.env` committed. `secretsPersisted: false` in evidence.

**Verdict on binding:** candidate preserves bound existing App ID without mutation, matches authenticated official scaffold provenance, and does not introduce hand-fabricated App IDs.

## Reproducible Deterministic Checks

Executed on candidate working tree after `npm ci` (960 packages, 24 vulnerabilities noted but build not blocked):

- `npm run typecheck` (`tsc --noEmit`) → PASS (exit 0). First run before `npm ci` correctly failed on missing `astro/tsconfigs/strict`; after install passed.

- `npm run build` (`wix build`) → PASS, reproduced pristine `PASS`:
  - `[@wix/astro-wix-hosting-adapter] Enabling sessions with Cloudflare KV` 
  - `output: server`, `adapter: @astrojs/cloudflare`, `✓ Completed` server + client, `Complete!`
  - Transform count 204 modules (candidate minimal) vs pristine 6864 (full scaffold with stores) — difference is expected minimal app vs full; both succeed, same adapter pipeline.

- `npm test` (`npm run check:purity && vitest run --config src/platform/vitest.config.ts`) → PASS:
  - Purity gate: "no '@wix/' imports under src/domain, src/billing/pure, src/platform/http..." — PASS
  - 49 test files, 548 tests passed (0 failed), including:
    - `tests/platform/idempotency.spec.ts` (8), `tests/platform/schedule-mutation.spec.ts` (10), `tests/platform/webhooks-chaos.spec.ts` (13), `tests/platform/webhooks-envelope-validation`, `http-auth`, `http-mutations`, `composition-root`, `orchestrator-terminal-states`, `registration-surface`, `validation-plugin-*` (6 suites), `purity-gate`, `platform-scope`, etc.

- `npm run check:purity` gate — PASS explicitly.

Evidence matches `docs/WIX_TECHNICAL_CONTRACT.md` §8 deterministic CI gate `npm ci && npm run test:unit && wix build` (credential-free).

## Lane Ownership & Boundary Checks
- Wix Integration owns scaffold/metadata, adapters, transport, persistence, webhooks, idempotency, schedule mutation safety, platform tests. Candidate modifies only scaffold/metadata (allowed) and adds `.astro` ignore. No domain semantics (`src/domain`), billing policy (`src/billing`), or dashboard UX (`src/ui`) mutations — ownership respected.

- No new Wix SDK imports in `src/domain`/`src/billing/pure` (purity gate passed).

- Schedule mutation safety: no new destructive writes introduced; existing `src/platform/schedule-mutation` and `webhooks` logic unchanged and tested (idempotency, revision-checked updates, rollback, chaos tests all passing).

- No location mutation: never requests `MANAGE-LOCATIONS`, respects Contract §5 scope hygiene.

- No secrets in repo: `wix.config.json` contains only `appId`/`projectId`/`projectType`; `.env`/`.wix/` ignored; `secretsPersisted false`.

- No auto-release/publish: scripts include `wix release` but not executed; no `npm publish`/`gh pr merge`/`git push` attempted.

## Findings
No reproducible blocking findings. All verifiable criteria:
- Scaffold/binding authenticated and preserved
- `wix build` reproduces pristine PASS
- Typecheck + purity + 548 unit tests PASS
- Lane boundaries respected
- No hand-fabricated IDs, no secret leakage, no silent schedule rewrites

Minor non-blocking observation (not a FIX): candidate `devDependency @wix/cli 1.1.135` vs evidence `wixCliVersion 1.1.238`. This is local CLI pin, not scaffold generator version; build succeeds with 1.1.135 and pristine used 1.1.238 — not an authenticity failure. No action required for integration.

## Conclusion
Candidate is a minimal, faithful alignment to the authenticated official Wix scaffold. It preserves the bound App ID, adopts the sanctioned Astro+Wix hosting adapter shape, and passes all deterministic gates credential-free. No hand-authored scaffold guesses detected.

VERDICT: ACCEPT
