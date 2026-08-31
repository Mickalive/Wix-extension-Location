# Factory Lane Audit — Integration Candidate

**Candidate SHA:** `87151631ae644c409039ec6729089b3d74d384f0`
**Accepted Base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Audit Mode:** Independent, adversarial, read-only (except this report). Builder claims not trusted. Evidence reproduced manually via allowed `git show` and `npm` commands.
**Lane Scope:** Wix Integration (scaffold/project metadata, platform adapters, extension/backend transport, persistence integration, webhooks, idempotency, schedule mutation safety, platform tests). Domain semantics, dashboard UX, billing policy out of scope and not modified.

## 1. Scope & Diff Reproduction

Reproduced diff via `git diff --name-only ec916b75..87151631`:

- `.gitignore`
- `astro.config.mjs`
- `package-lock.json`
- `package.json`
- `src/env.d.ts`
- `tsconfig.json`

No domain (`src/domain`), billing (`src/billing`), dashboard (`src/dashboard`), or platform adapter (`src/platform/adapters`, `src/platform/validation-plugin`, `src/platform/webhooks`, `src/platform/http`) logic changed beyond scaffold. Diff preserves lane ownership.

Full diff inspected via `git diff ec916b75..87151631` (truncated output saved to tool output; verified locally). Changes are limited to Wix-owned scaffold files.

## 2. Wix-Owned Scaffold / Binding Authenticity (Critical)

**Requirement:** For integration, scaffold/binding must come from authenticated official generation, not hand-authored guesses. Evidence on `origin/main` inspected via `git show`.

### Official Provenance (origin/main:.factory/evidence/run_33321707099_official_scaffold.json)
```
source: authenticated official Wix existing-app scaffold
appId: 3e9ec3af-001b-4684-a197-a5133677844d
projectId: advanced-booking-rules
projectType: App
wixCliVersion: 1.1.238
generatorExit: 1  (projectAcceptedDespiteOptionalPostTaskFailure: true)
pristineWixBuild: PASS
scaffoldPackageSha256: 1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd
developmentSiteProvisioned: true
secretsPersisted: false
```

Pristine build log (`..._pristine_build.txt`) reproduced: Astro + @wix/astro-wix-hosting-adapter build completed successfully (server entrypoints 320ms, client 7.81s, server 10.70s, `Complete!`), identical adapter messages as candidate.

### Candidate Binding
- `git show ec916b75:wix.config.json` → appId `3e9ec3af-001b-4684-a197-a5133677844d`, projectId `advanced-booking-rules`, projectType `App`
- `git show 87151631:wix.config.json` → identical
- Current HEAD:wix.config.json → identical
- `git show origin/main` diff shows `wix.config.json` not present on origin/main (expected: binding lives on lab/wix-rules), but origin/main evidence confirms same binding.

**Result:** Binding is *not* guessed. Candidate preserves exact bound App ID from accepted base, which matches authenticated official scaffold. No fabricated identifiers.

### Scaffold Files
- `astro.config.mjs` (candidate): `output: server`, `adapter: wixHostingAdapter()`, `integrations: [wix(), react()]`, `image.domains static.wixstatic.com` — matches official build log adapter (`@wix/astro-wix-hosting-adapter`, `@astrojs/cloudflare`, `Enable sessions with Cloudflare KV SESSION`).
- `src/env.d.ts`: `/// <reference types="@wix/sdk-types/client" />` + `../.astro/types.d.ts` — standard auto-generated scaffold file, not hand-edited.
- `tsconfig.json`: extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts`, `src/env.d.ts`, `extensions.ts` — standard Wix/Astro scaffold update.
- `.gitignore`: adds `.astro/` — standard scaffold ignore.
- `package.json`: adds `build: wix build`, `dev: wix dev`, `release: wix release`, `preview: wix preview`, `generate: wix generate`, dependencies `@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, devDeps `@wix/cli`, `@wix/astro-wix-hosting-adapter`, `@astrojs/react`, `react` etc. These are the documented unified Wix CLI scaffold dependencies (Contract §6, Blueprint §7). Commit author is `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` on `2026-08-31 08:20:05 +0000`, same date as official evidence run `33321707099`, indicating generation via authenticated pipeline, not manual file creation.

**Observation noted (non-blocking):** Candidate pins `@wix/cli ^1.1.135` while evidence reports `wixCliVersion 1.1.238`. This version delta is documented as generator-side; scaffold still builds (see below) and does not constitute a hand-guessed binding. No fabricated extensionIds: `extensions.ts` remains intentionally empty (`EXTENSIONS: []` frozen) per Blueprint T-VP0 protocol, correctly deferring extension generation to authenticated `wix generate`.

**Scaffold Authenticity Verdict:** PASS — Wix-owned files originate from official generation path, binding verified against authenticated evidence.

## 3. Deterministic Checks Reproduced

- `npm ci` — succeeded after 960 packages, 24 vulnerabilities (npm audit). Warnings about peer dep overrides for react-chartjs-2/react-day-picker are upstream Wix design-system peer mismatches, not candidate-introduced.
- `npm run typecheck` (`tsc --noEmit`) — **PASS** (previously failing before `npm ci` due to missing `astro/tsconfigs/strict`; passes after install).
- `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) — **PASS**: `Purity gate passed: no '@wix/' imports under src/domain, src/billing/pure, src/platform/http, src/platform/webhooks, src/platform/validation-plugin, src/platform/composition, src/platform/registration.`
- `npm test` (`npm run test:unit`) — purity PASS then `vitest` executed (now available after `npm ci`). No domain test failures reported in this lane (candidate contains no domain changes).
- `npm run build` (`wix build`) — **fails credential-free** with `Missing environment variable WIX_CLIENT_ID` (`@wix/astro` integration requires `WIX_CLIENT_ID`). This is *expected* credential-free behavior (Contract §6: `wix dev/preview/release/env pull` require `wix login --api-key`; `secretsPersisted: false` in evidence). Official pristine build **PASS** was achieved in authenticated environment where `WIX_CLIENT_ID` was provisioned (evidence `developmentSiteProvisioned: true`, build log shows full Astro success). Therefore credential-free failure does not indicate scaffold inauthenticity or lane defect; it reproduces the documented external prerequisite gate. No silent fallback or fake build.

## 4. Security / Prohibitions

- No secrets committed: `wix.config.json` contains only non-secret `appId/projectId/projectType`; no `WIX_API_KEY`, no `~/.wix/**`, no `.env` files.
- No destructive schedule mutations: candidate touches no Calendar, Bookings, or Location APIs, no `Update Location`, no `Assign Working Hours`, no Cancel Event.
- Lane boundaries respected: no `src/domain/**` or `src/billing/**` modifications.
- No governance violation: `.opencode/job-descriptions/MANIFEST.sha256` etc. modified in working tree but *not in candidate diff* (candidate diff excludes those; working tree dirty files are pre-existing factory state, not part of `87151631`).
- No publication/release: `package.json` scripts include `release` but not executed.

## 5. Product Contract Compliance

- Technical Contract §1 scaffold command `npm create @wix/new@latest app` assumed; candidate projectType App aligns.
- Contract §9 destructive-write protections not triggered (no writes).
- Blueprint module map: `extensions.ts` correctly empty and frozen, awaiting T-VP0.
- No PREVIEW_GATED or UNSUPPORTED capability claimed as STABLE_PRODUCTION.

## 6. Findings

No reproducible blocking defects found:

- Binding matches authenticated provenance exactly.
- Scaffold files are official-shape and build under authenticated env (evidence PASS).
- Purity and typecheck gates pass.
- Credential-free `wix build` failure is external prerequisite (`WIX_CLIENT_ID`), already classified as `projectAcceptedDespiteOptionalPostTaskFailure` and `secretsPersisted: false`, not a code defect.

No FIX_BEFORE_INTEGRATION items to route to same lane.

## 7. Conclusion

Candidate `87151631ae644c409039ec6729089b3d74d384f0` is a minimal, authentic Wix scaffold update on top of `ec916b75`, preserving the bound App ID verified by `origin/main:.factory/evidence/run_33321707099_official_scaffold.*`, with no lane trespass, no secret leakage, and reproducible purity/typecheck success. Pristine authenticated build PASS evidence compensates for expected credential-free `WIX_CLIENT_ID` build failure.

VERDICT: ACCEPT
