# Factory Integrated Audit — exact SHA be6c0fb267d4042d065bbde7472c60457ea28953

- **Auditor:** big-pickle (fresh independent cross-system reviewer; distinct from all builders and lane auditors)
- **Date:** 2026-08-31
- **Candidate:** `be6c0fb267d4042d065bbde7472c60457ea28953` — `candidate(integration): generation 110`
- **Scope:** integration/rules/dashboard/billing contracts, booking enforcement, rollback/recovery, entitlements, accessibility-sensitive behavior, real Wix scaffold assumptions, failure/rollback behavior.
- **Method:** static cross-system review of the exact candidate diff against the binding authorities (`docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `MAIN_PROMPT.md`, `AGENTS.md`), plus the surrounding accepted codebase. Deterministic checks could not be executed in this environment (bash execution restricted); findings below are from direct source inspection.

---

## 1. Candidate scope

The candidate diff is exactly three files:

1. `src/platform/registration/binding.ts` (new) — runtime loader for the real `wix.config.json` (task INT-C7-LIVE / INT-C8-R1).
2. `src/platform/registration/index.ts` (modified) — adds exports for the binding module.
3. `tests/platform/registration-binding.spec.ts` (new) — tests for the binding loader.

The candidate is additive: it does not modify any existing production code other than adding exports to `index.ts`. It does not touch the rules domain, dashboard UI, or billing policy code.

---

## 2. Cross-lane contract verification

### 2.1 Integration ↔ Rules (booking enforcement)
The candidate does not alter the enforcement path. The accepted `src/platform/validation-plugin/handlers.ts` correctly consumes the pure `evaluateRules` from `src/domain` with pre-resolved `EvaluationDeps`, maps the six platform targets onto the canonical three-operation union, and honors the binding failure semantics (CREATE/CANCEL fail-closed; RESCHEDULE fail-open forever). The candidate's binding module is not wired into this path, so enforcement behavior is unchanged. **No regression.**

### 2.2 Integration ↔ Rules (schedule mutation / rollback-recovery)
The accepted `src/platform/schedule-mutation/orchestrator.ts` implements the Contract §9 sequence (snapshot → diff → idempotent apply → revision-checked retry → verify → rollback → audit) with crash-mid-apply recovery (T-RB1). The candidate does not touch this. **No regression.**

### 2.3 Billing ↔ Integration (entitlements)
The accepted `src/billing/enforcement/entitlementGate.ts` implements the ratified fail-open posture (billing/listing/counting failures never block bookings; degraded decisions carry `degraded: true`; over-limit is not an error). The candidate does not touch this. **No regression.**

### 2.4 Dashboard (accessibility-sensitive behavior)
The candidate does not touch `src/ui/**` or `src/extensions/dashboard/**`. Accessibility behavior is from prior accepted cycles and is unaffected by this candidate. **No regression.**

### 2.5 Purity gate
`binding.ts` imports only `node:fs`, `node:path`, `node:url`, and `./projectConfig`. It contains no `@wix/*` import shapes in live code. The purity gate (`src/platform/purity/check-purity.mjs`) protects `src/platform/registration/**` and would pass for this file. **OK.**

### 2.6 Anti-fabrication
`binding.ts` never fabricates identifiers: missing/unparseable/unlinked states return explicit classifications, never a fake binding. The `registration-surface.spec.ts` anti-fabrication sweep scans `src/platform/registration/**` for UUID-like shapes; `binding.ts` contains none. **OK.**

---

## 3. Real Wix scaffold assumptions

The real `wix.config.json` (present in the working tree, gitignored) contains:
```json
{ "appId": "3e9ec3af-001b-4684-a197-a5133677844d", "projectId": "advanced-booking-rules", "projectType": "App" }
```
The `classifyProjectBinding` classifier correctly treats the real appId as LINKED (non-placeholder, non-empty string) and tolerates the unknown `projectId`/`projectType` fields per UQ4 drift tolerance. The binding loader's classification logic is consistent with the Technical Contract §13 UQ4 and §16. **Assumption sound.**

---

## 4. Findings

### FINDING 1 — HIGH / BLOCKING: `repoRootFromImportMeta()` resolves the wrong directory

`src/platform/registration/binding.ts` defines:

```ts
function repoRootFromImportMeta(): string {
  try {
    return resolve(fileURLToPath(new URL('../..', import.meta.url)));
  } catch {
    return process.cwd();
  }
}
```

`binding.ts` lives at `src/platform/registration/binding.ts` — **three** directory levels below the repo root. `new URL('../..', import.meta.url)` resolves **two** levels up from `src/platform/registration/`, landing on `src/`, **not** the repo root. Therefore `repoRootFromImportMeta()` returns `<repo>/src`, and:

- `loadProjectBinding()` (no explicit `repoRoot`) reads `<repo>/src/wix.config.json` → nonexistent → returns `MISSING_FILE`.
- `requireLinkedBinding()` (no explicit `repoRoot`) throws `BindingNotLinkedError` even when the real binding exists at the repo root.

The tests mask this defect because every test passes an explicit `repoRoot` (computed correctly from `tests/platform/`, which is only two levels deep). No test exercises the default path, so the bug is uncaught. This is a genuine production defect in the module's primary purpose (runtime binding discovery). It will surface the moment any platform adapter calls `loadProjectBinding()`/`requireLinkedBinding()` without an explicit root.

### FINDING 2 — HIGH / BLOCKING: test suite hard-depends on the gitignored `wix.config.json`

`tests/platform/registration-binding.spec.ts` contains tests that require the real, gitignored `wix.config.json` to be present on disk:

- `it('exists on disk (gitignored but present in the working tree)')` asserts `existsSync(realConfigPath)` is `true`.
- `it('contains valid JSON with a real appId')`, `it('classifies as LINKED through loadProjectBinding')`, `it('classifies as LINKED through requireLinkedBinding')`, and the `requireLinkedBinding(repoRoot)` cases all read the real file.

`wix.config.json` is gitignored (`.gitignore` line 19) and is generated only by the authenticated bootstrap (gate T-VP0). On a fresh checkout without the bootstrap, `npm run check` (which runs `vitest run` over all specs) would fail these tests. This breaks the `credential_free_build_and_tests` gate (PRODUCT_GATES.json) and the "credential-free build and tests" requirement (Contract §8.6, §16). The tests should be robust to the file being absent (e.g., skip the real-file assertions when the file is missing, or gate them behind an explicit environment marker).

### FINDING 3 — MEDIUM: test hardcodes an account-specific appId

`tests/platform/registration-binding.spec.ts` hardcodes the real appId `3e9ec3af-001b-4684-a197-a5133677844d` in multiple assertions. While this is not fabrication (it asserts the real value), it commits an account-specific identifier to the repository and creates a brittle coupling: if the product is ever bound to a different app, these tests fail. It also sits outside the anti-fabrication sweep (which only scans `src/platform/registration/**`), so the identifier is not caught by the existing guard. Prefer asserting structural properties (non-empty, non-placeholder, matches the loaded file) over a hardcoded literal.

### FINDING 4 — LOW: no-op anti-fabrication test

`tests/platform/registration-binding.spec.ts` contains:

```ts
it('the binding module source contains no UUID-like identifier shapes', () => {
  const bindingSource = readFileSync(...binding.ts...);
  const codeLines = bindingSource.split('\n').filter((line) => !line.includes('//') && !line.includes('*'));
  const codeWithoutComments = codeLines.join('\n');
  // ... no expect() calls ...
});
```

This test has **no assertions** — it reads the file, filters comment lines, and does nothing. It always passes regardless of content, giving a false sense of anti-fabrication coverage. Either add a real assertion or remove the test.

---

## 5. Failure / rollback behavior

The candidate does not introduce any schedule-mutation or write path, so it adds no new failure/rollback surface. The accepted orchestrator's crash-recovery and rollback behavior is unchanged. The binding loader's failure modes (missing/unparseable/unlinked) are classified explicitly and never fabricate identifiers — consistent with the anti-fabrication mandate. **No new rollback risk introduced**, aside from the path-resolution defect in FINDING 1.

---

## 6. Verdict

The candidate is additive and does not regress the accepted cross-lane contracts (enforcement, rollback/recovery, entitlements, accessibility, purity, anti-fabrication). However, it introduces two blocking defects:

- **FINDING 1:** `repoRootFromImportMeta()` resolves `src/` instead of the repo root, breaking default-path binding discovery — a genuine production defect in the module's core purpose.
- **FINDING 2:** the new test suite hard-depends on the gitignored `wix.config.json`, breaking the credential-free build/test gate on fresh checkouts.

Plus two non-blocking concerns (FINDING 3 hardcoded appId, FINDING 4 no-op test).

These must be repaired before integration.

VERDICT: FIX
