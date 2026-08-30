# Factory Lane Audit — Integration Candidate b1b4edbb

**Candidate SHA:** `b1b4edbb62320c6e80afb3762e486d32407c2748`
**Accepted base SHA:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Author:** `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>`
**Commit message:** `candidate(integration): generation 36`
**Lane:** Integration
**Auditor:** lane-auditor (not its builder)

---

## 1. Scope of candidate diff

The candidate adds Wix CLI/Astro scaffold infrastructure on top of the existing credential-free product foundation:

| File | Action | Purpose |
|------|--------|---------|
| `.astro/content-assets.mjs` | Added | Empty Astro content assets map (standard boilerplate) |
| `.astro/content-modules.mjs` | Added | Empty Astro content modules map (standard boilerplate) |
| `.astro/content.d.ts` | Added | 199-line auto-generated Astro content collection types |
| `.astro/env.d.ts` | Added | Declares `WIX_CLIENT_ID`, `WIX_CLIENT_INSTANCE_ID`, `WIX_CLIENT_PUBLIC_KEY`, `WIX_CLIENT_SECRET` as astro:env modules |
| `.astro/types.d.ts` | Added | Standard Astro type references |
| `astro.config.mjs` | Added | Configures `@wix/astro`, `@wix/astro-wix-hosting-adapter`, `@astrojs/react`; `output: "server"` |
| `src/env.d.ts` | Added | Auto-generated Wix SDK types reference (`/// <reference types="@wix/sdk-types/client" />`) |
| `package.json` | Modified | Adds Wix deps (`@wix/astro`, `@wix/dashboard`, `@wix/cli`, etc.), Wix CLI scripts (`wix build`, `wix dev`, `wix release`, etc.), React deps |
| `tsconfig.json` | Modified | Extends `astro/tsconfigs/strict`, adds `.astro/types.d.ts` to include |
| `package-lock.json` | Modified | ~15,961 line update (dependency tree expansion) |

**No existing product source files (`src/domain/`, `src/platform/`, `src/billing/`, `extensions.ts`, `wix.config.json`) were modified or deleted.**

---

## 2. Scaffold authenticity assessment

### 2.1 Evidence the scaffold is genuine (consistent with `@wix/astro` CLI output)

1. **`.astro/content.d.ts`** (199 lines): Standard Astro content collection type declarations — auto-generated boilerplate that no human would hand-author. Contains generic `RenderResult`, `CollectionEntry`, `ContentEntryMap`, `DataEntryMap` types that are framework-internal.

2. **`.astro/env.d.ts`**: Correctly declares four Wix-specific astro:env modules (`WIX_CLIENT_ID`, `WIX_CLIENT_INSTANCE_ID`, `WIX_CLIENT_PUBLIC_KEY`, `WIX_CLIENT_SECRET`). This matches the `@wix/astro` integration pattern.

3. **`src/env.d.ts`**: Contains explicit "This file should not be edited. This is an auto-generated file." comment with correct `@wix/sdk-types/client` reference and path to `.astro/types.d.ts`.

4. **`astro.config.mjs`**: Uses the correct Wix SDK packages in the correct combination — `@wix/astro` for the integration, `@wix/astro-wix-hosting-adapter` for deployment, `@astrojs/react` for React support. Configuration includes `output: "server"`, `adapter: wixHostingAdapter()`, `image.domains: ["static.wixstatic.com"]`, `security.checkOrigin: false` — all consistent with genuine Wix Astro scaffold defaults.

5. **`package.json` scripts**: `wix build`, `wix dev`, `wix release`, `wix preview`, `wix generate` — standard Wix CLI commands that a real scaffold adds.

6. **`wix.config.json`** unchanged: The existing `appId` (`3e9ec3af-001b-4684-a197-a5133677844d`) is preserved, consistent with the policy of not regenerating an existing binding.

7. **Git author**: `wix-official-scaffold` is a workflow bot identity, consistent with automated CI scaffold generation.

### 2.2 Scaffold authenticity findings

| Finding | Severity | Detail |
|---------|----------|--------|
| **F1: Duplicate `typescript` dependency** | Medium | `typescript` appears in BOTH `dependencies` (`^5.8.3`) AND `devDependencies` (`^5.5.4`). A genuine `wix generate` or `npm create @wix/new@latest` scaffold would place `typescript` in `devDependencies` only (or `dependencies` only — but never both). This indicates manual composition or an incorrect layering of the scaffold output on top of the pre-existing `package.json`, rather than a clean scaffold run. While npm resolves this correctly (higher version wins), it violates the expected scaffold artifact shape. |
| **F2: Missing `.factory/evidence/` provenance files** | Medium | The audit task references `.factory/evidence/run_33321707099_official_scaffold.json` and `.factory/evidence/run_33321707099_official_scaffold_pristine_build.txt` on `origin/main`. Neither file exists in the candidate commit nor in `origin/main`. There is no persisted machine-readable evidence of the authenticated scaffold run. The governance chain requires `PROVEN` gates to have concrete persisted evidence; the absence of these files means `real_wix_scaffold_registration` cannot be independently verified from this commit alone. |

### 2.3 Scaffold is NOT hand-authored guesses

Despite findings F1 and F2, the scaffold artifacts are structurally consistent with genuine `@wix/astro` CLI output:
- The 199-line `content.d.ts` is auto-generated framework boilerplate
- The `astro.config.mjs` uses the correct Wix packages with correct configuration
- The `.astro/env.d.ts` declares the expected Wix-specific env vars
- The `src/env.d.ts` is explicitly marked as auto-generated
- The `package.json` scripts are standard Wix CLI commands

This is not a hand-authored fabrication — it is a real scaffold applied with a non-clean merge that duplicated the `typescript` dependency.

---

## 3. Deterministic check results (reproduced by auditor)

| Check | Result |
|-------|--------|
| `npm ci` | PASS (960 packages installed; peer dep warnings are transitive from `@wix/design-system`, not candidate defects) |
| `npm run typecheck` | PASS (`tsc --noEmit` exits cleanly) |
| `npm run check:purity` | PASS (no `@wix/` imports under protected paths) |
| `npm test` | PASS (548 tests across 49 test files, 0 failures) |
| `wix build` | EXPECTED FAILURE — `Missing environment variable WIX_CLIENT_ID`. This is correct behavior: the Wix CLI requires authenticated credentials. The error message correctly instructs `npx wix env pull`. This is not a code defect. |

---

## 4. Non-regression verification

- No existing source files were deleted or modified (only `package.json`, `tsconfig.json`, `package-lock.json`, and new scaffold files).
- All 548 tests pass with zero failures.
- Purity gate still passes.
- Typecheck still passes.
- The `extensions.ts` anchor remains empty by design (consistent with INT-C6-R1).
- `wix.config.json` is unchanged (existing `appId` preserved).

---

## 5. Verdict rationale

**Finding F1** (duplicate `typescript`) is a reproducible structural issue. It does not break tests or typecheck, but it is a real deviation from the expected scaffold artifact shape. A genuine `wix generate` produces a clean `package.json` without duplicating dev dependencies into the `dependencies` section. This finding is FIX-worthy because:
- It creates ambiguity about which TypeScript version is authoritative
- It indicates the scaffold was not applied cleanly
- The pre-existing `typescript@^5.5.4` in devDependencies should be removed or reconciled

**Finding F2** (missing evidence files) is a governance gap that affects gate provability but does not itself indicate the scaffold content is inauthentic.

The scaffold content IS structurally genuine (not hand-authored guesses), but F1 is a reproducible defect in how the scaffold was merged.

---

**VERDICT: FIX**

### Reproducible findings requiring fix:

**F1: Duplicate `typescript` dependency in `package.json`**

The candidate `package.json` contains:
```json
"dependencies": {
    ...
    "typescript": "^5.8.3"
},
"devDependencies": {
    ...
    "typescript": "^5.5.4",
    ...
}
```

**Reproduction steps:**
1. `git show b1b4edbb62320c6e80afb3762e486d32407c2748:package.json`
2. Observe `typescript` in both `dependencies` (line: `"typescript": "^5.8.3"`) and `devDependencies` (line: `"typescript": "^5.5.4"`)

**Expected fix:** Remove `"typescript": "^5.8.3"` from `dependencies` (or consolidate to a single entry in the appropriate section). The official `@wix/astro` scaffold does not produce duplicate `typescript` entries. A clean scaffold application should have `typescript` in exactly one of `dependencies` or `devDependencies`, not both.
