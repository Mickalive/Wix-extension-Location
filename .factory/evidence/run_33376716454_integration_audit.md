# Lane Audit Report — Integration Candidate 66d330110c7d4032702b8c4c15ce8277c17546c2

**Audited against accepted base:** ec916b75d5600e02d679d264648ac92333d721f1  
**Candidate SHA:** 66d330110c7d4032702b8c4c15ce8277c17546c2  
**Audit date:** 2026-08-31  
**Auditor:** lane-auditor (adversarial, read-only)

---

## 1. Scope of Candidate Changes

The candidate commit modifies only configuration/meta files — no product source code:

| File | Change Type |
|------|-------------|
| `.gitignore` | Added `.astro/` to ignored patterns |
| `astro.config.mjs` | New file — Astro + Wix integration config |
| `package.json` | Replaced scripts/dependencies with Wix CLI + Astro stack |
| `package-lock.json` | Lockfile regenerated for new dependencies |
| `src/env.d.ts` | New file — Wix SDK type references |
| `tsconfig.json` | Extended from `astro/tsconfigs/strict`, updated includes |

**No changes** to `src/domain`, `src/billing`, `src/platform` (except `src/env.d.ts`), `tests/`, or any business logic.

---

## 2. Scaffold Authenticity Verification

### 2.1 Official Scaffold Evidence (from `origin/main`)

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

### 2.2 Candidate `wix.config.json` Contents

```json
{
  "appId": "3e9ec3af-001b-4684-a197-a5133677844d",
  "projectId": "advanced-booking-rules",
  "projectType": "App"
}
```

### 2.3 Base Commit `wix.config.json` Contents

Identical to candidate — the file exists in **both** base and candidate.

### 2.4 Verdict on Scaffold Authenticity

**PASS** — The `wix.config.json` values match the authenticated official scaffold evidence exactly. The candidate commit author is `wix-official-scaffold <wix-official-scaffold@users.noreply.github.com>`, consistent with the evidence source. The pristine build log from the evidence shows a successful `wix build` (PASS).

---

## 3. Critical Policy Violation: Committed `wix.config.json`

### 3.1 Project's Own Rules (from `src/platform/registration/README.md`)

> | Artifact | State | Why |
> |---|---|---|
> | `wix.config.example.json` (repo root) | **committed** | Shape template; every value is an explicit scaffold-pending placeholder. |
> | `wix.config.json` (repo root) | **gitignored** | Generated at scaffold; holds account-bound identifiers; never committed, never hand-written. |

### 3.2 `.gitignore` in Both Base and Candidate

```
# Real Wix CLI project binding - generated ONLY by the authenticated one-time
# scaffold (npm create @wix/new@latest app; human-owned credentials, gate
# T-VP0). Holds account-bound identifiers; never commit or hand-fabricate.
# Committed shape template: wix.config.example.json. Context:
# src/platform/registration/README.md
wix.config.json
```

### 3.3 Actual Repository State

- `wix.config.json` **IS TRACKED** in both `ec916b75` (base) and `66d3301` (candidate)
- `wix.config.example.json` exists as a template with placeholder values
- The `.gitignore` declares `wix.config.json` ignored, but Git still tracks it because it was committed before the ignore rule (or the ignore is ineffective for already-tracked files)

### 3.4 Impact

- Account-bound identifiers (`appId`, `projectId`) are permanently recorded in Git history
- Violates "never commit or hand-fabricate" directive from `AGENTS.md`, lane fiche, and `directives/INTEGRATION.md`
- Creates credential leakage risk if repository is exposed
- Undermines the scaffold runbook (T-VP0) which expects `wix.config.json` to be generated locally per-developer

---

## 4. Deterministic Checks Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run typecheck` | **PASS** | `tsc --noEmit` clean |
| `npm run check:purity` | **PASS** | No forbidden `@wix/` imports in protected paths |
| `vitest run` (49 test files, 548 tests) | **PASS** | All tests pass including purity gate test |
| `npm run build` | **FAIL (expected)** | Requires `WIX_CLIENT_ID` env var — not available in audit environment. Official evidence shows `pristineWixBuild: PASS` when credentials present. |

---

## 5. Findings Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | `wix.config.json` committed in repository despite `.gitignore` and documented policy forbidding it | **CRITICAL** | Policy violation, credential hygiene |
| 2 | Candidate changes are purely configurational; no product logic modifications | INFO | Scope confirmation |
| 3 | Scaffold authenticity verified against official evidence | PASS | Provenance |
| 4 | All deterministic tests pass | PASS | Quality gate |
| 5 | Build requires Wix credentials (expected) | INFO | Environment limitation |

---

## 6. Verdict and Required Fix

**VERDICT: FIX** — The repository must **remove `wix.config.json` from Git tracking** before this candidate can be accepted. This is a pre-existing violation in the accepted base (`ec916b75`) that the candidate inherits and does not remediate.

**Reproducible remediation steps:**

```bash
# From the accepted base branch (lab/wix-rules)
git rm --cached wix.config.json
git commit -m "chore: stop tracking wix.config.json per policy (gitignore already declares it)"
# Verify: git status shows wix.config.json as untracked (ignored)
# Verify: wix.config.example.json remains committed as the template
```

This fix must be applied to the **accepted base** (`lab/wix-rules`), not the candidate branch. The candidate itself is configurationally sound and its scaffold provenance is authentic. The blocking issue is the repository state that both base and candidate share.

---

## 7. Non-Blocking Observations

- The candidate adds `.astro/` to `.gitignore` — correct for Astro-generated state
- `astro.config.mjs` uses `@wix/astro-wix-hosting-adapter` and `@wix/astro` — aligns with official scaffold
- Package dependencies match the official scaffold's `scaffoldPackageSha256` expectation
- No hand-authored Wix configuration detected; all binding data traces to authenticated scaffold

VERDICT: FIX