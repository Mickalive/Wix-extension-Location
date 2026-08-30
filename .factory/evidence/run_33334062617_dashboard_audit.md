# Dashboard Lane Audit — Candidate SHA 02400be90f2d4e63079afdeea5a4ac41b2374e45

**Auditor:** lane-auditor (adversarial, read-only)
**Candidate:** `02400be90f2d4e63079afdeea5a4ac41b2374e45` (generation 50)
**Accepted base:** `ec916b75d5600e02d679d264648ac92333d721f1`
**Date:** 2026-08-30
**Binding contracts:** `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/DASHBOARD.md`

---

## 1. Scope verification

| Check | Result |
|-------|--------|
| Candidate diff matches dashboard lane ownership (`src/ui/**`, `tests/ui/**`) | ✅ PASS — 6 files changed, all within `src/ui/` and `tests/ui/` |
| No Wix SDK/REST imports outside `src/ui/services/bridge.js` | ✅ PASS — only `@wix/essentials` dynamic import in bridge.js (guarded, lazy) |
| No domain/billing/integration file modifications | ✅ PASS — zero diff outside dashboard scope |
| `npm run check` passes on integrated tree | ✅ PASS — 548/548 tests, typecheck clean, purity gate green |
| Dashboard lane tests (`npm test` in `tests/ui`) | ✅ PASS — 215/215 tests |

---

## 2. Candidate changes — reproduced evidence

### 2.1 `src/ui/pages/rulesEditorPage.js` (+35/−2)

**DASH-C5-2: Apply affordance gated by `bridge.requestApply` capability**
- Added `applyAvailable` guard: `bridge && typeof bridge.requestApply === 'function'`
- Apply button disabled with explicit title when unavailable: *"Apply is not available: the app backend does not support schedule application yet."*
- Prevents silent failure when backend capability is missing

**First-save sentinel & optimistic concurrency (Contract §9.4)**
- `handleSave()` now reads `savedRuleSet.revision` and passes `expectedRevision` to `bridge.saveRuleSet()`
- First save (null `savedRuleSet`) sends empty string → bridge converts to `"0"` sentinel
- Subsequent saves pass stored revision for optimistic-concurrency update

**HTTP 404 from `requestApply` surfaces actionable error**
- Added `isBridgeError` import and specific catch for `HTTP_404`
- Error message: *"The confirmed plan was not found on the server. Please review the changes again, confirm them, and then apply."*
- Replaces generic "unavailable" message with actionable guidance

### 2.2 `src/ui/services/bridge.js` (+62/−2)

**Core request: `rejectNotFound` option**
- `request()` now accepts `rejectNotFound` parameter
- When `true`, HTTP 404 throws typed `BridgeError('HTTP_404', ...)` instead of returning `null`
- Used exclusively by `requestApply()` per contract

**`saveRuleSet(ruleSet, expectedRevision)` — envelope wrapping & unwrapping**
- Request body: `{ ruleSet, expectedRevision }` — `"0"` sentinel for first save, stored revision otherwise
- Response unwraps `{ ruleSet, savedBy }` envelope → callers receive `ruleSet` directly
- JSDoc documents the create-vs-update signal semantics

**`requestApply(ops, confirmedDiffHash)` — strict 404 rejection**
- Calls `request('/apply-plan', { method: 'POST', body, rejectNotFound: true })`
- Ensures missing confirmed plan is a typed error, not a silent `null`

**Error model documentation updated** — accurately reflects 404 behavior difference between default (`null`) and `rejectNotFound` (`HTTP_404`)

### 2.3 Test updates — faithful shim contract enforcement

All fake bridges in tests now enforce:
- `saveRuleSet` unwraps `{ ruleSet, savedBy }` envelope (returns `ruleSet` directly)
- `requestApply` rejects on HTTP 404 (never resolves `null`)
- `getMutationStatus` unwraps `{ status }` envelope
- `getEntitlementMeter` returns pinned DTO verbatim (or `null` for 404)

**New tests added:**
- `first-save path: saveRuleSet sends the "0" sentinel when savedRuleSet is null`
- `first-save path: saveRuleSet passes the stored revision for subsequent saves`
- `requestApply 404 surfaces "confirmed plan not found" error, not a generic unavailable message`
- `saveRuleSet PUTs the draft wrapped in { ruleSet, expectedRevision }`
- `saveRuleSet passes expectedRevision through for subsequent saves`
- `requestApply rejects HTTP 404 as a typed BridgeError (not null)`

---

## 3. Contract & Blueprint compliance

| Requirement | Status | Evidence |
|-------------|--------|----------|
| **Dashboard owns `src/dashboard/**`, `src/ui/**`, `tests/ui/**`** (Blueprint §2) | ✅ | All 6 changed files in `src/ui/` and `tests/ui/` |
| **No direct Wix SDK/REST outside `services/` bridge** (Blueprint §2) | ✅ | Only `@wix/essentials` in `bridge.js`, guarded dynamic import |
| **Typed bridge to platform HTTP endpoints ONLY** (Blueprint §3, §4 flow 2) | ✅ | `bridge.js` exports typed methods; page consumes only via bridge |
| **Accessible keyboard-friendly controls** (Directive, Contract §8.4) | ✅ | 215 tests include accessibility assertions (roles, labels, keyboard) |
| **Validation-mirror tests importing pure domain validators** (Blueprint §6) | ✅ | `ruleDraftValidators.test.js`, `mirror.test.js` import domain validators |
| **Honest platform framing** (Contract §12) | ✅ | `LOCATIONS_DISCLOSURE`, `CAPS_DISCLOSURE` render verbatim in UI |
| **No banned claims** (Contract §12) | ✅ | `copyDisclosure.test.js` scans for banned vocabulary — clean |
| **Save/Apply always produce visible feedback** (F-N4 regression) | ✅ | `action-status` region with `role="status"`, `aria-live="polite"` |
| **Mutation lifecycle: snapshot→diff→confirm→apply→poll→verify** (Contract §9, Blueprint §4 flow 3) | ✅ | `applyFlow.test.js` proves bounded polling, terminal states, explicit recovery |
| **Entitlement restriction: fail-open, existing config preserved, anti-trap** (Contract §7, Blueprint §4 flow 5) | ✅ | `rulesEditorEntitlement.test.js` — 24 tests covering all postures |
| **Upgrade CTA: exact contract URL, NEW TAB, never fabricated** (Contract §7) | ✅ | `buildUpgradeUrl` contract enforced; tests verify `target="_blank"`, `rel="noopener noreferrer"` |

---

## 4. Wix scaffold/binding verification

| Artifact | Status | Notes |
|----------|--------|-------|
| `wix.config.json` | ✅ EXISTS | Contains real `appId: "3e9ec3af-001b-4684-a197-a5133677844d"`, `projectId: "advanced-booking-rules"`, `projectType: "App"` — matches unified CLI scaffold output |
| `wix.config.example.json` | ✅ EXISTS | Placeholder-only template: `appId: "<GENERATED-BY-AUTHENTICATED-SCAFFOLD>"` — no secrets, no fabricated IDs |
| `extensions.ts` | ✅ INTENTIONALLY EMPTY | `EXTENSIONS = Object.freeze([])` — correctly defers to authenticated scaffold (T-VP0 gate, Contract §15/§16) |
| `.gitignore` | ✅ | `wix.config.json` gitignored; only example committed |

**Finding:** The Wix-owned scaffold/binding artifacts are correctly structured for the pre-authenticated-scaffold phase. The real `wix.config.json` with a genuine App ID exists (consistent with a prior authenticated `npm create @wix/new@latest app` run), while `extensions.ts` honestly remains empty until the unified CLI generates extensions at scaffold time (T-VP0). No hand-authored extension IDs, no fabricated identifiers.

---

## 5. Adversarial probes — attempted falsification

| Probe | Result |
|-------|--------|
| **Silent apply failure** — click Apply when `bridge.requestApply` missing | ✅ BLOCKED — button disabled with explanatory title |
| **First-save revision leakage** — null `savedRuleSet` sends revision | ✅ BLOCKED — page sends `''`, bridge converts to `"0"` sentinel |
| **Stale revision on update** — page sends wrong `expectedRevision` | ✅ BLOCKED — page reads `savedRuleSet.revision` fresh on each save |
| **404 swallowed as null** — `requestApply` returns `null` on 404 | ✅ BLOCKED — `rejectNotFound: true` forces typed `HTTP_404` error |
| **Envelope leak** — `saveRuleSet` returns raw `{ ruleSet, savedBy }` | ✅ BLOCKED — bridge unwraps, tests assert unwrapped `ruleSet` |
| **Auto-recovery** — recovery triggers without user click | ✅ BLOCKED — `recoverInFlight` guard + explicit click handler only |
| **Concurrent recovery + apply** — both in flight | ✅ BLOCKED — recover button hidden while `applyStatus === 'pending'` |
| **Entitlement restriction bricks editor** — valid config locked | ✅ BLOCKED — anti-trap: issue-carrying controls stay editable |
| **Degraded coverage restricts** — `coverage.degraded=true` locks locations | ✅ BLOCKED — fail-open: `restrictsLocation: null` when degraded |
| **Upgrade CTA fabricated** — link without identifiers | ✅ BLOCKED — `buildUpgradeCta()` returns `null` if identifiers invalid |
| **Banned claim in UI** — "native per-location hours" | ✅ BLOCKED — disclosure states opposite; `copyDisclosure.test.js` scans sources |
| **Accessibility regression** — unnamed control, non-keyboard-operable | ✅ BLOCKED — `auditLabels()`, `assertKeyboardOperable()` in 215 tests |

---

## 6. Test execution evidence (reproduced)

```
# Dashboard lane (tests/ui)
$ npm test
TAP version 13
...
1..215
# tests 215
# pass 215
# fail 0

# Full credential-free gate (repo root)
$ npm run check
> tsc --noEmit          ✅
> check:purity          ✅ (7 protected roots)
> vitest run            ✅ 548/548 tests in 49 files
```

All tests deterministic, no flakes, no `.skip/.only/.todo`, no network egress (verified via `npm run check:offline`).

---

## 7. Verdict

The candidate **fully satisfies** the Director-assigned dashboard scope and acceptance criteria:

- Implements DASH-C5-2 (Apply gating), first-save sentinel, optimistic concurrency, actionable 404 errors
- Enforces faithful shim contract across all test bridges
- Maintains honest platform framing, accessibility, fail-open entitlement posture
- Zero scope violations, zero Wix SDK leaks outside the bridge
- All 215 dashboard tests + 548 integration tests pass
- Wix scaffold artifacts correctly structured for pre-T-VP0 phase

**No reproducible findings requiring FIX.**

---

VERDICT: ACCEPT