# Audit — Integration Lane, Cycle 32787032785 (build cycle 2, task INT-C2-1)

- **Auditor:** lane-auditor (independent)
- **Candidate:** `/tmp/wix_integration_candidate` @ `3d59276` ("Wix build 32787032785: integration candidate (active)")
- **Accepted base:** `53f51d9` (untouched accepted state; verified parent of the candidate commit — exactly one commit on top)
- **Diff shape:** 25 files, +3481 / −23. Paths: `package.json` (+1 script), `src/platform/**`, `tests/platform/**`. Name-scan of the full diff found **no out-of-scope path**: immutable governance files, `src/domain/ports.ts`, and canonical `src/shared/{types,errors}.ts` are byte-for-byte untouched (not present in the diff). Canonical frozen contracts were consumed, not forked.
- **Verdict basis:** real diff inspected file-by-file; all deterministic checks executed in the candidate worktree; six independent adversarial probes run from an external scratch suite (`/tmp/opencode/probe`, never part of the candidate tree).

## 1. Executable checks actually run (not hand-waved)

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` (candidate worktree, Node v22.13.0) | PASS (47 packages) |
| Full gate | `npm run check` = `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) + purity gate + Vitest | PASS — **112/112 tests, 11 files**, zero skipped |
| Offline/egress proof | `npm run check:offline` (all `HTTP(S)_PROXY` pinned to `127.0.0.1:9`) | PASS — 112/112 |
| Determinism | `npm run check` rerun ×2 after the offline run | identical 112/112 every run |
| Purity grep (manual) | `grep -rn "@wix/"` under `src/platform/http` + `src/platform/webhooks` | hits are comments/README prose only; **zero live imports** |
| Scope scan | `git diff --name-only` filtered against lane allowlist | only `package.json`, `src/platform/**`, `tests/platform/**` |
| Baseline continuity | prior accepted suite was 33 tests / 4 files | new count 112 = 33 + 79 new across 7 new spec files (arithmetic verified per file) |
| Adversarial probes | external Vitest suite, 6 tests (see §4) | 6/6 PASS |

The `PURITY GATE FAILED: 4 forbidden '@wix/' import(s)` stderr visible during the suite run is the expected output of the pre-existing negative-control fixture test (`purity-gate.spec.ts`), captured by assertion — not a real violation.

## 2. Acceptance-criteria verification (INT-C2-1)

1. **"`npm ci && npm run check` passes with zero credentials and zero network egress (proxy-blocked rerun also green)"** — VERIFIED (table above). Additionally, `platform-scope.spec.ts` adds a structural zero-egress guarantee: a comment-stripped scan proving no network-capable module (`http|https|net|dns|tls|undici|axios|got`) is imported anywhere under `src/` or `tests/`.
2. **completeApply/failApply reject EVERY terminal state; no duplicate audit entry** — VERIFIED. Implementation replaces the narrow `TERMINAL_STATES.has(...)` checks with a `NON_TERMINAL_STATES` allowlist (`SNAPSHOT_PERSISTED`, `APPLY_IN_PROGRESS`) + single `assertNotTerminal` guard invoked by `beginApply`, `applyNextChange`, `completeApply`, AND `failApply` — fail-closed for any future state addition. Guards fire BEFORE gateway verify/rollback, journal writes, and audit appends. `orchestrator-terminal-states.spec.ts` drives plans to each of `ROLLED_BACK` / `RECOVERED` / `APPLY_COMPLETED` and proves both entry points reject with `INVALID_STATE`, zero second audit entry, zero re-verify/re-rollback/re-apply (trace-counted), using an ADVANCING clock so only the guard itself (not the journal's duplicate-audit-id integrity check) can produce the rejection — precisely the adversarial scenario accepted-audit observation N1 described.
3. **Every HTTP handler: valid token ⇒ executes; missing/invalid ⇒ typed fail-closed error + zero store mutation** — VERIFIED. `http-auth.spec.ts` runs the full 5×5 matrix (all five endpoints × valid/missing/invalid/expired/verifier-outage) with call-counting spies asserting ZERO dependency interactions on every rejection. Expired tokens are modelled per the documented port contract (verifier ⇒ null) — correct given the production `auth.getTokenInfo()` adapter is deferred to the authenticated scaffold. Verifier infrastructure failure also fails closed (never authorizes). Whitespace-only token counts as missing.
4. **PUT RuleSet revision conflict without partial writes; apply-plan requires confirmed-diff hash** — VERIFIED. Revision-conflict test surfaces store-thrown `REVISION_CONFLICT` (retriable) and asserts stored state equals exactly the concurrent writer's version. `postApplyPlan` rejects inline plans, extra keys (structured `unexpectedKeys` detail), empty/non-string hashes, and unknown hashes (`NOT_FOUND`) with zero orchestrator executions; a known hash executes the orchestrator on the EXACT confirmed plan (deep assertion on change ids).
5. **Webhook chaos convergence** — VERIFIED. `webhooks-chaos.spec.ts` (13 tests): same envelope id twice ⇒ handler runs once (`invocations === 1`); sequences 3,1,2 converge strictly as `[1,2,3]`; replay after simulated mid-dispatch crash converges to golden-state equality (same envelope ids ⇒ comparable delivery keys); plus crash-after-head-advance, resume-releases-buffered-successor, signature-rejection zero-mutation, malformed-envelope rejection, superseded staleness, lost-predecessor ascending drain, and a mixed-chaos golden-equality test. All deterministic (no randomness/timers).
6. **Purity gate stays green for the two new roots** — VERIFIED. `check-purity.mjs` DEFAULT_PROTECTED_ROOTS extended to include `src/platform/http` and `src/platform/webhooks`; standalone CLI run passes; `platform-scope.spec.ts` pins the default-root list AND scans the real tree through the exported scanner functions.
7. **Grep test proves no rule/pricing logic leaked into src/platform** — VERIFIED. Comment-stripped marker scan (`evaluateRules`, `RuleOutcome`, `customerMessage`, `QUOTA_EXCEEDED`, pricing/tier vocabulary) over ALL `src/platform` TypeScript with a planted-fixture POSITIVE CONTROL proving the scanner detects every category (no rubber stamp). My independent read of every new module agrees: endpoints validate shape + revision only; the orchestrator applies confirmed plans; no availability/pricing/billing logic exists anywhere in the new code.

Task item coverage: (a) orchestrator hardening ✔; (b) five token-verified pure HTTP handlers + wiring-protocol README staging note (mirrors the accepted cycle-1 contracts-staging pattern; `src/pages/api/*` correctly deferred to T-VP0 scaffold — shell reserves the root layout) ✔; (c) webhook pipeline with envelope-id dedup port, `entityEventSequence` ordering buffer, deliveryKey-idempotent at-least-once dispatch, injected signature port (explicitly NO fabricated crypto), and Contract §6 constraints (1250 ms deadline, ≤12 retries, duplicates expected) documented in module docs of `ports.ts`, `pipeline.ts`, `index.ts` ✔. Out-of-scope list respected: no scaffold/release, no validation-plugin wiring, no billing consumption, no UI.

## 3. Design-level falsification attempts (all resolved clean)

- **Guard regression risk:** the new allowlist changes `failApply` behavior for `SNAPSHOT_PERSISTED` records relative to… nothing — cycle-1 `failApply` had no guard at all; composed `applyPlan` can still only reach `failApply` in `APPLY_IN_PROGRESS` state (probe-pinned), empty plans still complete end-to-end (probe-verified), and recovery still covers crashed-before-first-write plans.
- **Ordering-buffer invariants:** buffer holds only UNCLAIMED envelopes (release-before-buffer); redelivery of a buffered envelope re-runs the ordering gate instead of resuming out of order (dedicated test); monotonic head guard in the reference store; bootstrap never regresses; completed-but-stale buffer entries are dropped as `SUPERSEDED_SKIPPED` by `drainBuffered`.
- **Crash windows:** claim→dispatch→advance→complete with reclaimable in-flight claims; defensive `removeBuffered` on the resume path covers the crash-during-drain window; post-advance crash cannot double-apply (deliveryKey idempotency window test).
- **Unsupported Wix assumptions:** none. Token extraction/JWT verification are explicitly deferred behind ports with T-VP0 evidence requirements; no production-capability claims; no fabricated identifiers (`siteId` test-local; UUIDv5 namespace application-defined per cycle-1 precedent).
- **Secrets/identifiers:** none committed; devDeps unchanged (typescript/vitest/@types/node); the only `package.json` change is the additive `check:offline` script (known shared-shell merge surface from cycle-1 observation 4).

## 4. Independent adversarial probes (external scratch suite, 6/6 PASS)

1. `beginApply`/`applyNextChange` reject `ROLLED_BACK` and `RECOVERED` records with `INVALID_STATE` (guards complete beyond the two methods named in N1).
2. `failApply` on `SNAPSHOT_PERSISTED`: pinned actual semantics — allowed by design (non-terminal), performs a no-op restore from snapshot and appends EXACTLY ONE failure audit entry; honest, non-destructive, unchanged cycle-1 behavior.
3. Empty-plan composed flow still completes under the new guards (`APPLIED`, 0 applied).
4. Concurrent duplicate ingests of one envelope id (Promise.allSettled race): exactly-once EFFECT via deliveryKey, head monotonic, envelope completed — consistent with documented at-least-once invocation semantics.
5. Stale resume after a bootstrap head jump past an in-flight envelope: exactly-once effect, head never regresses, completion recorded.
6. Completed-but-buffered stale entry (crash between markCompleted and removeBuffered) cannot double-dispatch via `drainBuffered` (`SUPERSEDED_SKIPPED`, zero handler invocations).

Probe harness note: my first probe draft asserted `failApply`-on-`SNAPSHOT_PERSISTED` should THROW; the run proved the allowlist intentionally permits it. That was a wrong auditor expectation, not a candidate defect; behavior was pinned and is safe (see probe 2).

## 5. Findings

### Blocking findings
None.

### Non-blocking observations (record for the Director / next integration slice; do not gate)
1. **Stale docstring in `src/platform/http/transport.ts` (lines ~47–52):** claims authentication rejections "map to 401 via `httpResponseForError`'s class check". There is NO class check; `UnauthorizedRequestError` carries frozen code `INVALID_QUERY` and maps to **400** (probe-verified: `ACTUAL_UNAUTHORIZED_STATUS=400`). Behavior is correct and fail-closed; `./README.md` §4 states the truth and stages the additive `'UNAUTHORIZED'` Director amendment. Fix the comment (or add the class check together with that amendment) so a future thin-adapter author is not misled about status codes.
2. **`tests/platform/zz-debug.spec.ts` filename** is non-descriptive; the header documents that the candidate shell permits no rename and explicitly requests a mechanical rename (e.g. `webhooks-pipeline-contract.spec.ts`). Content is legitimate production test surface. Director may rename content-neutrally at integration.
3. **`isWebhookEnvelope` duck-typing** lets a caller-supplied "pre-parsed" envelope bypass `parseWebhookEnvelope` structural validation (e.g. a negative or non-integer `entityEventSequence` would pass through that path only). Harmless today (fakes/tests use the validated path); the future thin adapter should pass raw parsed JSON so validation always runs. One-line hardening candidate.
4. **`postRecover` silently drops a non-string `locationId`** instead of rejecting `INVALID_QUERY`. No functional consequence against the reference journal semantics (scope match uses scheduleId/ownerType/ownerId only), but strict-shape consistency with the other fields would be cleaner.
5. **Buffer-residue nit:** an envelope completed inside the markCompleted→removeBuffered crash window can linger in its scope's reorder buffer until a resume-path cleanup or explicit `drainBuffered`. Probe 6 confirms it can never double-dispatch; impact is bounded memory only.

## 6. Verdict

The candidate delivers the entirety of INT-C2-1: the N1 terminal-state hardening with regression tests that defeat the exact adversarial scenario from the accepted audit; a complete, pure, Wix-import-free token-verified HTTP handler layer covering all five mandated endpoints with fail-closed auth proven by a 25-case zero-store-mutation matrix; and a deterministic webhook ingestion pipeline whose dedup/ordering/crash-recovery convergence is proven by a scripted chaos suite plus golden-state equality runs. All seven acceptance criteria are verified by executed checks, scope discipline is exact, canonical contracts are consumed unforked, and no unsupported platform assumption, silent failure, destructive path, or business-logic leak exists. The five residual observations are documentation/hardening nits that cannot corrupt state, mislead users, or block safe integration.

VERDICT: ACCEPT
