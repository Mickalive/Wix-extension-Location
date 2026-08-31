# Integrated Cross-System Audit — Wix Bookings Advanced Rules

- **Auditor role:** integrated-auditor (fresh cross-system reviewer; independent of all lane builders and lane auditors)
- **Audit target:** exact candidate SHA `46ae39ce4455ba54b77f7f2560e637f23c14742c` (working-tree product code audited as the candidate; see §Scope note)
- **Date:** 2026-08-31
- **Mode:** read-only. No source was modified. No fixes applied.

---

## 1. Scope and method

This audit independently re-verified the contracts *between* the four product lanes
(integration, rules, dashboard, billing) and the failure/rollback behavior, rather than
re-auditing any single lane. It inspected the actual source of the shared types, domain
ports, platform wiring, billing exports, dashboard bridge, webhooks, and the
schedule-mutation orchestrator, and ran the deterministic checks.

### Scope note on the target SHA

The requested SHA `46ae39ce4455ba54b77f7f2560e637f23c14742c` does not appear anywhere in
the repository and could not be independently confirmed via git (hash-verification
commands are denied by the tooling rule engine). The audit therefore treats the current
working-tree product code as the candidate. `git status` confirms the working tree has
**no uncommitted product-code changes** — only governance files (`AGENTS.md`,
`.opencode/agents/*`, `.opencode/job-descriptions/*`) differ from HEAD, and those are not
product code and are out of scope for this audit. The product source tree is clean, so the
findings below apply to the candidate as presented.

---

## 2. Deterministic checks (all green)

| Check | Command | Result |
|---|---|---|
| Typecheck + purity gate + full suite | `npm run check` | PASS — 548/548 tests in 49 files |
| Offline (zero network egress) | `npm run check:offline` | PASS — 548/548, HTTP_PROXY 127.0.0.1:9 |
| Real Wix CLI build | `npm run build` (= `wix build`) | PASS — build completed (+196ms); only minor vite externalization WARNs for `node:assert` |
| Dashboard UI suite | `npm test` (in `tests/ui`) | PASS — 210/210 (TAP) |

The determinism property claimed by the contract (§8.1) is evidenced by the green
credential-free offline run.

---

## 3. Cross-lane contract verification

### 3.1 Shared types / errors (integration ↔ rules ↔ dashboard ↔ billing)

- `src/shared/types.ts` is the canonical DTO source; `DEFAULT_COUNT_INCLUDED_STATUSES =
  ['PENDING','CONFIRMED']` is consumed consistently by the domain counters and the
  platform count planning.
- `src/shared/errors.ts` `failureSemanticsFor` maps CREATE/CANCEL → FAIL_CLOSED and
  RESCHEDULE → FAIL_OPEN. This is the single source of truth for enforcement posture.

### 3.2 Booking enforcement (integration ↔ rules)

`src/platform/validation-plugin/handlers.ts` wires the pure `evaluateRules` domain with
pre-resolved deps. Verified against Contract §5.3:

- **CREATE / CANCEL (+ `_MULTI_SERVICE`): FAIL CLOSED.** Any internal error or deadline
  expiry ⇒ every item gets an explicit block-with-retry-hint
  (`FAIL_CLOSED_CODE = 'VALIDATION_UNAVAILABLE'`), `enforcementClaim:
  'FAIL_CLOSED_BLOCKED'`. ✓
- **RESCHEDULE (+ `_MULTI_SERVICE`): FAIL OPEN forever.** Any internal error ⇒ every item
  explicitly valid with `enforcementClaim: 'FAIL_OPEN_NOT_ENFORCED'` — the result never
  claims enforcement. ✓
- **Coverage gate:** healthy decision + location outside `allowedLocationIds` ⇒ rule
  evaluation skipped (`UNCOVERED_LOCATION_RULES_SKIPPED`, native Wix applies); degraded
  decisions never skip (fail-open coverage). ✓
- **Entitlement gate failure** ⇒ synthetic degraded decision; a billing failure never
  blocks a paying merchant's booking. ✓
- **Counters:** count queries planned by the domain's own helpers, prefetched once per
  request, gateway failures degrade caps fail-open with `COUNT_GATEWAY_FAILURE` incidents
  — never thrown into the booking decision. ✓
- **Identity discipline (Invariant C1):** `metadata.identity` consumed only behind the
  explicit `consumeMetadataIdentity` flag (default OFF) until gate T-VP3 proves payload
  fields. Subject-booking-facts seam defaults to unavailable; RESCHEDULE self-exclusion
  stays inert until evidence-backed. ✓

### 3.3 Entitlement / billing (billing ↔ integration ↔ dashboard)

`src/billing/enforcement/entitlementGate.ts` implements the canonical domain port
`EntitlementGate` and feeds both the validation path and the dashboard meter. Verified
against Contract §7/§11 C5:

- **Fail-open on billing/counting/listing errors** — degraded decisions carry
  `degraded: true`; consumers must not block bookings on entitlement. ✓
- **Over-limit is NOT an error** — normal decision with `overLimit: true`, stable coverage
  ordering, no deletion of customer configuration. ✓
- **Warning ledger** persists warnings; transient codes clear per-source on recovery;
  `UNKNOWN_PLAN_IDENTIFIER` persists until operator maps it. ✓
- **`FAIL_OPEN_RESOLUTION`** serves unlimited coverage with explicit `tier: null` (no
  fabricated plan identification). ✓

`src/platform/composition/entitlementComposition.ts` composes projector →
projectedSnapshotSource → `createEntitlementGate` → `ValidationPluginDeps.entitlementGate`
+ GET /meter. The billing projector implements reconciliation supremacy with dedup-memory
survival and foreign-instance isolation. ✓

### 3.4 Dashboard ↔ platform HTTP contracts

Verified the pinned DTOs match verbatim between `src/platform/http/*` and
`src/ui/services/bridge.js`:

- **GET /meter** — `meterEndpoint.ts` `EntitlementMeterResponse` =
  `{meter:{count,degraded}, coverage:{allowedLocationIds,overLimit,degraded,warning}}`;
  bridge `getEntitlementMeter()` pins the identical shape with strict validation. ✓
- **GET /mutation-status** — `mutationEndpoints.ts` returns `{status:
  MutationStatusProjection}`; bridge `getMutationStatus` expects the `status` envelope. ✓
- **POST /recover** — `mutationEndpoints.ts` returns `{recovery: RecoverySummary|null}`;
  bridge `recover` expects the `recovery` envelope. ✓
- **401 fail-closed / authenticated always-200** on the meter; per-half failure isolation
  (a failing meter never corrupts coverage and vice versa). ✓

### 3.5 Schedule mutation / rollback / recovery (integration)

`src/platform/schedule-mutation/orchestrator.ts` implements Contract §9:
snapshot → diff → idempotent apply → verify → rollback → audit.

- **Idempotency:** deterministic UUIDv5 keys per change; replay yields
  SKIPPED_ALREADY_APPLIED. ✓
- **Crash semantics (T-RB1):** unexpected exceptions leave the journal record
  `APPLY_IN_PROGRESS`; no in-process rollback on a dying process; next run resumes via
  `applyNextChange` or `recoverInterruptedApply` restores the exact pre-apply snapshot. ✓
- **Terminal-state hardening:** every state outside the non-terminal allowlist
  (`SNAPSHOT_PERSISTED`, `APPLY_IN_PROGRESS`) is treated as terminal; `completeApply` /
  `failApply` reject terminal states with `INVALID_STATE` before touching the gateway or
  appending a second audit entry. ✓
- **Serverless-friendly:** `beginApply` / `applyNextChange` / `completeApply` are public so
  a long apply spans invocations on the durable journal. ✓
- **Recovery verification:** restores the exact pre-apply state and verifies at
  working-hours-window granularity, reporting drift honestly (never prettified). ✓

### 3.6 Dashboard entitlement restriction (DASH-C5-1) and accessibility

`src/ui/pages/rulesEditorPage.js` implements the management-side restriction:
- Locations outside `coverage.allowedLocationIds` are badged + disabled for NEW rule
  configuration; EXISTING configuration stays rendered read-only and is never deleted. ✓
- **Anti-trap rule:** any control whose current value contributes a validation issue stays
  correctable, so restriction can never trap the editor in a permanently invalid draft. ✓
- **Degraded coverage fails OPEN** exactly like enforcement — persistent warning, nobody
  restricted off an unreliable list. ✓
- **Over-limit** surfaces the Contract §7 upgrade CTA (new tab) with host-injected
  identifiers, never fabricated. ✓
- **Accessibility:** `tests/ui/accessibility.test.js` covers labels, keyboard operability,
  dialog semantics, live regions, and focus management; the diff-confirm modal is the
  §9.2 informed-consent gate. ✓

### 3.7 Real Wix scaffold assumptions (integration)

- `wix.config.json` binds the real App ID `3e9ec3af-001b-4684-a197-a5133677844d`
  (projectId `advanced-booking-rules`, projectType App); no secret material persisted.
- `reports/wix-live/BOOTSTRAP_BINDING.md` records an authenticated binding to the real Wix
  app "Advanced Booking Rules" and a successful real `wix build`.
- `extensions.ts` is intentionally empty (`Object.freeze([])`); the registration surface
  (`extensionsManifest.ts`, `projectConfig.ts`, `validationExtension.ts`) is honestly
  marked `PLANNED_UNTIL_T_VP0` — no capability is overclaimed. ✓
- The dashboard extension registration shapes (`src/extensions/dashboard/*`) are
  credential-free and consume only typed lane interfaces. ✓

---

## 4. FAILURE / ROLLBACK BEHAVIOR — verified

- **Booking enforcement:** fail-closed on CREATE/CANCEL, fail-open on RESCHEDULE, with
  explicit `enforcementClaim` so a fail-open result is never presented as enforcement. ✓
- **Entitlement:** fail-open on all billing/counting/listing errors; over-limit is not an
  error; no customer configuration deleted on downgrade. ✓
- **Schedule mutation:** snapshot-before-write, idempotent writes, verify-before-commit,
  rollback-on-failure, crash leaves `APPLY_IN_PROGRESS` for exact recovery, terminal-state
  guards prevent double-apply/double-rollback/double-audit. ✓
- **Dashboard:** apply is never silent; bounded polling to a terminal state; recovery is
  explicit user-initiated only (never auto-retried). ✓

---

## 5. CRITICAL FINDING — cross-lane apply-plan contract mismatch (FIX)

**Severity: High (blocks the core schedule-apply feature end-to-end).**

The dashboard bridge and the platform apply-plan endpoint disagree on the request body
contract, and each side's isolated test asserts its own (incompatible) shape. Neither test
catches the mismatch because they never exercise the two sides together.

**Dashboard side** — `src/ui/services/bridge.js` `requestApply` (lines 298–303):

```js
requestApply(ops, confirmedDiffHash) {
  return request('/apply-plan', {
    method: 'POST',
    body: { ops, confirmedDiffHash },
  });
},
```

Confirmed by `tests/ui/bridge.test.js` (line 125):
`assert.deepEqual(seen[0].body.ops, [{ kind: 'ADD_WINDOW', start: '09:00' }]);`

The dashboard apply flow (`rulesEditorPage.js` line 924) calls
`bridge.requestApply(ops, state.confirmedHash)`, so the wire body is
`{ ops, confirmedDiffHash }`.

**Platform side** — `src/platform/http/mutationEndpoints.ts` `postApplyPlan` (lines 90–98)
rejects any body with a key other than `confirmedDiffHash`:

```js
const keys = Object.keys(request.body);
const unexpected = keys.filter((k) => k !== 'confirmedDiffHash');
if (unexpected.length > 0 || typeof request.body.confirmedDiffHash !== 'string') {
  throw new PlatformError('INVALID_QUERY', ...);
}
```

Confirmed by `tests/platform/http-mutations.spec.ts` (lines 107–119): a body
`{ confirmedDiffHash, planId }` is rejected with `INVALID_QUERY` and
`unexpectedKeys: ['planId']`. There is no special-casing of `ops`.

**Consequence:** every `requestApply` from the dashboard sends `ops` as an unexpected key,
so the endpoint rejects it with `INVALID_QUERY` (HTTP 400). The bridge converts that to
`BridgeError('HTTP_400', ...)`, and `handleApply` dispatches `APPLY_UNAVAILABLE`. The
schedule-apply feature therefore cannot complete end-to-end. The `ops` field is also
redundant — the endpoint resolves the plan solely via
`confirmedPlanLookup.findByDiffHash(confirmedDiffHash)` and never reads `ops`.

This is a genuine cross-lane contract violation between the dashboard lane (bridge) and the
integration lane (apply-plan endpoint). It is exactly the class of defect this integrated
audit exists to catch, and it is not caught by any single-lane test.

---

## 6. Other observations (non-blocking)

- The meter, mutation-status, and recover contracts are correctly pinned and match across
  lanes (verified in §3.4). The apply-plan contract is the sole mismatch found.
- The governance working-tree changes (AGENTS.md v2→v3, auditor agent additions/removals)
  are out of scope for this product audit and were not treated as product code.

---

## 7. Verdict

The candidate is architecturally sound and the deterministic checks are green, but the
cross-lane apply-plan contract mismatch in §5 breaks the core schedule-apply flow
end-to-end. This is a real, reproducible defect that must be repaired (dashboard bridge
should send only `{ confirmedDiffHash }`, or the endpoint should tolerate/ignore `ops` —
with a regression test exercising both sides together) before the candidate is integrable.

VERDICT: FIX
