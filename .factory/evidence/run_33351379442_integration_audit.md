# Factory Lane Audit — Integration Candidate d27a70bafbfe9fb9298c5b75c2d5dbf9a0e58267

**Candidate SHA:** `d27a70bafbfe9fb9298c5b75c2d5dbf9a0e58267`
**Accepted base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Author:** `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>`
**Commit message:** `candidate(integration): generation 86`
**Lane:** Integration (Wix-owned scaffold / binding)
**Auditor:** lane-auditor (independent, not builder) — adversarial, read-only, reproduced evidence

---

## 1. Scope of candidate diff (reproduced via `git diff`)

```
git diff ec916b75d5600e02d679d264648ac92333d721f1 d27a70bafbfe9fb9298c5b75c2d5dbf9a0e58267 --stat
 .gitignore        |     3 +
 astro.config.mjs  |    14 +
 package-lock.json | 15962 ++++++++++++++++++++++++++++++++++++++++++++++++----
 package.json      |    40 +-
 src/env.d.ts      |     4 +
 tsconfig.json     |    24 +-
 6 files changed, 15093 insertions(+), 954 deletions(-)
```

- **Modified:** `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`
- **Added:** `astro.config.mjs`, `src/env.d.ts`
- **Unchanged / not deleted:** `wix.config.json`, `src/domain/`, `src/billing/`, `src/platform/`, `extensions.ts`, `src/platform/purity/*`

No existing product source, domain semantics, billing policy, or dashboard code was modified or deleted. Candidate is strictly scaffold/infra within Integration lane ownership.

Detailed diff verified via `git show d27a70bafbfe9fb9298c5b75c2d5dbf9a0e58267:package.json`, `:astro.config.mjs`, `:tsconfig.json`, `:src/env.d.ts`, `:.gitignore`, `:wix.config.json` and `git diff` for each path.

---

## 2. Scaffold authenticity — authenticated official generation vs hand-authored

### 2.1 Authenticated provenance inspected on `origin/main`

```
git show origin/main:.factory/evidence/run_33321707099_official_scaffold.json
git show origin/main:.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt
```

**Provenance JSON (run_33321707099):**
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

**Pristine build log:** `PASS` — full `wix build` output shows `@wix/astro-wix-hosting-adapter` KV binding, Vite transform of 6864 modules, client/server builds, `Server built in 10.70s`, `Complete!` with no scaffold errors. This is the authenticated scaffold's own build, not a builder claim.

Additional evidence listing shows consistent later runs (`run_33351107418_official_scaffold.json` etc.) with identical `appId` `3e9ec3af-001b-4684-a197-a5133677844d`, `projectId` `advanced-booking-rules`, `pristineWixBuild PASS`.

### 2.2 Binding verification

```
git show d27a70bafbfe9fb9298c5b75c2d5dbf9a0e58267:wix.config.json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
git show ec916b75d5600e02d679d264648ac92333d721f1:wix.config.json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
git show origin/lab/wix-rules:wix.config.json — same appId
git show origin/main:wix.config.json — not present (expected, main is not the accepted branch)
```

Candidate preserves the existing binding exactly; it does not regenerate, fabricate, or mutate `appId`/`projectId`. The IDs match the authenticated provenance.

### 2.3 Scaffold artifacts are genuine CLI output, not hand-authored guesses

- **`astro.config.mjs`** (reproduced):
```js
import { defineConfig } from 'astro/config';
import wix from '@wix/astro';
import react from "@astrojs/react";
import wixHostingAdapter from "@wix/astro-wix-hosting-adapter";
export default defineConfig({
  output: "server",
  adapter: wixHostingAdapter(),
  integrations: [wix(), react()],
  image: { domains: ["static.wixstatic.com"] },
  security: { checkOrigin: false },
  devToolbar: { enabled: false }
});
```
Correct Wix package combination (`@wix/astro` + `@wix/astro-wix-hosting-adapter` + `@astrojs/react`), `output: "server"`, `static.wixstatic.com` — matches scaffold defaults.

- **`src/env.d.ts`**: `/// <reference types="@wix/sdk-types/client" />` + `/// <reference path="../.astro/types.d.ts" />` + auto-generated comment. Standard scaffold boilerplate.

- **`tsconfig.json`**: `extends: "astro/tsconfigs/strict"`, includes `.astro/types.d.ts`, `src/env.d.ts`, excludes `dist` — scaffold shape.

- **`package.json`**: adds Wix deps (`@wix/astro ^2.39.0`, `@wix/dashboard ^1.3.43`, `@wix/design-system ^1.154.0`, `@wix/essentials ^0.1.23`, `astro ^5.8.0`, `@wix/cli ^1.1.135`, `@wix/astro-wix-hosting-adapter ^2.0.0`) and Wix scripts (`wix build`, `wix dev`, `wix release`, `wix preview`, `wix generate`). No hand-fabricated IDs or non-standard packages. `typescript` now correctly appears once (`^5.8.3` in `dependencies`) after prior duplicate was reconciled — dependency tree expands as expected (`package-lock.json` +15962 lines).

- **`.gitignore`**: adds `.astro/` (generated state) while preserving `wix.config.json` ignore comment referencing `T-VP0` and `src/platform/registration/README.md` — consistent with scaffold guidance. `.astro/` is correctly *not* committed (candidate does not commit `.astro/content.d.ts` etc., unlike earlier generation 36 which incorrectly committed generated state).

- **Git author:** `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>` — workflow bot identity for authenticated generation.

Conclusion: scaffold/binding is from authenticated official generation, not hand-authored guesses.

---

## 3. Deterministic checks reproduced by auditor (current worktree after `npm ci` on scaffold shape)

| Check | Command | Result |
|-------|---------|--------|
| `npm ci` | `npm ci` | PASS — 960 packages, 267 funding, peer warnings only transitive from `@wix/design-system` (`react-chartjs-2`, `react-day-picker` expecting React 17), not candidate defects |
| `typecheck` | `npm run typecheck` (`tsc --noEmit`) | PASS — no errors (after `npm ci`, `astro/tsconfigs/strict` resolves) |
| `purity` | `npm run check:purity` (`node src/platform/purity/check-purity.mjs`) | PASS — no `@wix/` imports under `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration` |
| `unit tests` | `npm test` (`vitest run --config src/platform/vitest.config.ts`) | PASS — 49 test files, 548 tests, 0 failures (7.67s). Includes `purity-gate.spec.ts`, `domain/purity.spec.ts`, `billing/purity.spec.ts` |
| `wix build` | `npm run build` (`wix build`) | EXPECTED FAILURE — `Missing environment variable WIX_CLIENT_ID` / `WIX_CLIENT_ID not found`. Correct behavior without authenticated env; error instructs `npx wix env pull`. Official pristine evidence already proves `pristineWixBuild PASS` in authenticated scaffold environment. Not a code defect. |

All checks were re-run by auditor, not taken from builder claims.

---

## 4. Lane ownership & non-regression

- Integration lane may repair `wix.config.json` only while preserving bound App ID — candidate preserves it.
- No domain semantics, dashboard UX, or billing policy modified.
- No secrets committed: `.env`, `.env.*`, `.wix/` remain ignored; no `WIX_API_KEY` in repo.
- No destructive schedule rewrites; no new Wix SDK imports in protected paths.
- No cross-lane copying; only scaffold files touched.

---

## 5. Prior FIX finding disposition

Previous generation 36 audit issued `FIX` for duplicate `typescript` in both `dependencies` and `devDependencies` and for missing evidence. Candidate generation 86 resolves both: `typescript` appears once (`^5.8.3` in `dependencies`, removed from `devDependencies`), and `origin/main` now contains persisted provenance (`run_33321707099_official_scaffold.json` + `pristine_build.txt` and later runs) with matching `appId` and `PASS` build.

---

## 6. Verdict rationale

- Scaffold is provably from authenticated official Wix existing-app generation (`origin/main` evidence inspected via `git show`, `appId`/`projectId` preserved, `pristineWixBuild PASS`).
- Scaffold artifacts match genuine `@wix/astro` CLI output (correct adapter, integrations, env refs, scripts); not hand-authored.
- Deterministic checks reproduced: typecheck PASS, purity PASS, 548 tests PASS, `wix build` failure is expected credential absence (official pristine build PASS).
- No lane-boundary violations, no regressions, no secrets.

No reproducible findings requiring `FIX_BEFORE_INTEGRATION`.

VERDICT: ACCEPT
