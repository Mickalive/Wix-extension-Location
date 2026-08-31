# Lane Audit Report — Integration Candidate 7a0c11f0ef1a09547d9f05b0cc9ef2f935bb9391

## Scope
Audited integration candidate SHA `7a0c11f0ef1a09547d9f05b0cc9ef2f935bb9391` against accepted base `ec916b75d5600e02d679d264648ac92333d721f1`.

## Candidate Provenance
- **Commit author**: `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>`
- **Commit message**: `candidate(integration): generation 126`
- **Parent commit**: `ec916b75d5600e02d679d264648ac92333d721f1` (accepted base)
- **Relationship**: Direct child — no intermediate commits

## Official Scaffold Evidence (from `origin/main/.factory/evidence/`)
- **Source**: `authenticated official Wix existing-app scaffold`
- **App ID**: `3e9ec3af-001b-4684-a197-a5133677844d`
- **Project ID**: `advanced-booking-rules`
- **Wix CLI version**: `1.1.238`
- **Pristine Wix build**: `PASS`
- **Scaffold package SHA256**: `1768e7a61f8e81751712fe4d3abd985aeee9df012cc98b35c2d5dcaad97c98cd`
- **Development site provisioned**: `true`
- **Generator exit**: `1` (project accepted despite optional post-task failure)

The scaffold evidence confirms authenticated official generation — not hand-authored guesses.

## Files Changed (6 files)
| File | Change Type | Notes |
|------|-------------|-------|
| `.gitignore` | Modified | Added `.astro/` entry for generated state |
| `astro.config.mjs` | Added | Wix Astro integration config (`@wix/astro`, `@wix/astro-wix-hosting-adapter`, React) |
| `package.json` | Modified | Added Wix dependencies (`@wix/astro`, `@wix/dashboard`, `@wix/design-system`, `@wix/essentials`, `astro`, `typescript`) and Wix CLI scripts (`build`, `dev`, `release`, `preview`, `generate`) |
| `package-lock.json` | Modified | Lockfile updated for new dependencies |
| `src/env.d.ts` | Added | References `@wix/sdk-types/client` and `.astro/types.d.ts` (auto-generated marker) |
| `tsconfig.json` | Modified | Extends `astro/tsconfigs/strict`; includes generated types |

All changes are consistent with an official Wix Astro scaffold for an existing-app project.

## Deterministic Checks (Reproduced)
```
npm run check
```
- **TypeScript typecheck**: `PASS` (`tsc --noEmit`)
- **Purity gate**: `PASS` — no `@wix/` imports under protected paths (`src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, `src/platform/registration`)
- **Unit tests**: `548 tests passed` across `49 test files`

## Build Verification
```
npm run build  →  wix build
```
- **Result**: Requires `WIX_CLIENT_ID` environment variable (expected — build runs in authenticated Wix environment)
- **Official scaffold evidence**: `pristineWixBuild: PASS` — confirms the scaffold builds successfully with proper credentials
- **Failure reason**: Missing `WIX_CLIENT_ID` in this unauthenticated CI environment — not a code defect

## Findings
1. **Scaffold authenticity verified**: Commit author, official evidence, and file contents all confirm authenticated official Wix scaffold generation.
2. **No hand-authored guesses**: Every added file matches official Wix Astro scaffold patterns; no speculative or invented configuration.
3. **Protected paths remain pure**: Purity gate passes — zero `@wix/` imports in domain, billing-pure, or platform-protected directories.
4. **All deterministic tests pass**: 548 tests including purity, domain rules, billing projection, validation plugin, HTTP handlers, webhooks, registration surface, and composition root.
5. **Build configuration correct**: Astro config uses `@wix/astro-wix-hosting-adapter` with server output, Wix integration, and React — exactly as official scaffold produces.
6. **No wix.config.json in candidate**: Correctly gitignored per contract; binding is generated only by authenticated one-time scaffold (gate T-VP0).

## Verdict
The integration candidate is a genuine official Wix scaffold applied to the accepted base. All deterministic gates pass. The build requires authenticated Wix credentials (expected per platform contract). No blocking defects found.

VERDICT: ACCEPT