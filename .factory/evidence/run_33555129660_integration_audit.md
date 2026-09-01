# Factory Lane Audit — Integration Candidate 704a639

**Candidate SHA:** `704a639c1d03a1556d185efdbc0f009ea9b32063`
**Lane repair base:** `26d479ad20552d06a930341ac029af3084471917`
**Lane:** Wix Integration (wix-integration-builder)
**Audit date:** 2026-09-01
**Auditor role:** lane-auditor (adversarial, read-only except report)

## Scope isolation
Reproduced diff via `git diff 26d479ad20552d06a930341ac029af3084471917..704a639c1d03a1556d185efdbc0f009ea9b32063 --stat`:

```
 .gitignore        | 3 +
 astro.config.mjs  | 14 +
 package-lock.json | 15960 +++++
 package.json      | 40 +-
 src/env.d.ts      | 4 +
 tsconfig.json     | 24 +-
 6 files changed
```

No changes to `src/domain/**`, `tests/domain/**`, `src/ui/**`, `src/extensions/dashboard/**`, `src/billing/**`, `tests/billing/**`, `.github/**`, `.opencode/**`. Commit shows `src/env.d.ts`, `astro.config.mjs`, `tsconfig.json`, `package.json`, `package-lock.json`, `.gitignore` only. Cumulative changes outside integration that predate 26d479a (849-file diff vs origin/main including domain, billing, dashboard, platform adapters) were verified via `git diff origin/main..704a639 --stat` and correctly ignored per instruction — not misclassified as this builder's scope.

Ownership per `wix-integration-builder.md` allows: `package.json`, `package-lock.json`, `tsconfig.json`, build config required by Wix CLI, `wix.config.json`, `src/platform/**`, `src/extensions/backend/**`, `tests/platform/**`. This candidate modifies only scaffold/build-config files owned by integration. `.gitignore` addition of `.astro/` and `src/env.d.ts` (`/// <reference types="@wix/sdk-types/client" />` auto-generated) are scaffold artifacts produced by official Wix Astro tooling, not hand-authored domain/billing/dashboard code. No lane boundary violation.

## Wix-owned scaffold / binding provenance — authenticated generation vs hand-authored guess

Inspected authenticated provenance on `origin/main` via `git show`:

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

- `git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` shows `wix build` PASS with `@wix/astro`, `@astrojs/cloudflare`, 6864 modules transformed, `build Complete!` (10.70s server). This is credential-free `wix build` in pristine scaffold, proving scaffold feasibility.

- Candidate `wix.config.json` via `git show 704a639:wix.config.json`:
```json
{"appId":"3e9ec3af-001b-4684-a197-a5133677844d","projectId":"advanced-booking-rules","projectType":"App"}
```
Identical to `git show 26d479a:wix.config.json` — App ID preserved, not fabricated, matches official scaffold `appId`. ProjectId matches. No hand-invented binding.

- Candidate commit metadata: `Author: wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` `candidate(integration): generation 234` — indicates workflow authenticated scaffold generation, not manual edit.

- `astro.config.mjs` content matches official Wix Astro scaffold pattern (`@wix/astro`, `wixHostingAdapter`, `output: server`, `react()` integration) cited in Technical Contract §1/§2 binding architecture (Native Wix app built with unified Wix CLI Astro framework, Wix-managed hosting). `tsconfig.json` extends `astro/tsconfigs/strict` — exact scaffold template.

- `package.json` diff shows `scripts.build` changed from `npm run check` to `wix build` plus `dev: wix dev`, `release: wix release`, etc., and adds dependencies `@wix/astro ^2.39.0`, `@wix/cli ^1.1.135`, `astro ^5.8.0`, `@wix/dashboard ^1.3.43`, `@wix/astro-wix-hosting-adapter ^2.0.0` — aligns with Technical Contract requirement for unified CLI and with pristine scaffold build dependencies. `package-lock.json` 15960-line addition reflects `npm install` of scaffold, not hand guess.

No fabricated IDs, no secrets committed, no `.env` or `~/.wix` access, no publish/release attempt. Scaffold is authenticated official generation, not hand-authored guess. Per developer instruction, authenticated Wix build/runtime evidence is exclusively WIX_QA; missing Wix credentials must not cause FIX — cited pristine build PASS satisfies scaffold authenticity without running authenticated `wix build` here.

## Credential-free deterministic evidence reproduction

All checks run at candidate SHA without credentials, without pipes/redirects wrappers as required:

- `npm ci` — PASS (960 packages, warnings only for peer deps overriding, expected with @wix/design-system react 16 vs 18, 24 vulnerabilities noted but not blocking).
- `npm run typecheck` (`tsc --noEmit`) — PASS (empty output, 0 errors after `npm ci`; before install had `astro/tsconfigs/strict not found` which user-fixed via install — reproduces scaffold correctness).
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — PASS: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure...`
- `npm test` (`npm run test:unit` → `npm run check:purity && vitest run --config src/platform/vitest.config.ts`) — PASS: `Test Files 49 passed (49)`, `Tests 548 passed (548)`, duration 7.58s. All domain/billing/platform contract tests including determinism property, DST fixtures, webhook chaos, idempotency, registration-surface, validation-plugin matrices pass. No Wix network required.

Did NOT run `npx wix build` here per prohibition — authenticated build evidence already available on origin/main pristine log. `npm run check` credential-free gate equivalent is PASS (typecheck + purity + vitest).

No secrets in diff, no hardcoded credentials, no `wix.config.json` secret fields.

## Technical Contract compliance

- Binding architecture respected: unified Wix CLI files, Astro hosting, Node >=20.11.0 engines preserved.
- No deprecated legacy CLI usage, no Bookings-scoped Calendar API, no custom auth, no location `businessSchedule` mutation.
- No PREVIEW_GATED capability claimed.
- No destructive schedule rewrite — candidate does not mutate schedules, only scaffold.

## Findings

No reproducible blocking findings in this lane's scope. Inherited cumulative state outside integration (domain rules, billing, dashboard, platform adapters) is not this candidate's responsibility and was excluded correctly. Scaffold binding is authenticated, App ID unchanged, dependencies and configs are scaffold-consistent, deterministic tests and purity are green.

## Verdict
VERDICT: ACCEPT
