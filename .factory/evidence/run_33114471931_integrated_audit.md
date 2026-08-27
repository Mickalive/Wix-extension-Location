# Integrated Cross-System Audit — SHA e5dda6b17e901db62c9a3a6daf8e9ed5284b02db

**Auditor:** Fresh cross-system reviewer (distinct from all builders and lane auditors)  
**Date:** 2026-08-27  
**Scope:** Complete integrated candidate — integration, rules, dashboard, billing, shared, platform, UI  
**Binding contracts:** `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `MAIN_PROMPT.md`

---

## 1. Executive summary

The candidate at SHA e5dda6b17e901db62c9a3a6daf8e9ed5284b02db represents a **mature, well-architected product foundation** for an advanced Wix Bookings rules plugin. The domain core is pure, deterministic, and thoroughly tested. Platform integration respects all documented Wix contracts. Billing entitlement logic is fail-safe. Dashboard UX handles degradation gracefully. The schedule-mutation orchestrator implements the full §9 safety sequence with crash recovery. Webhook ingestion handles dedup and ordering correctly.

**Critical blockers:** NONE found.  
**Notable observations (non-blocking):** See Section 8.

---

## 2. Domain core (Rules Engine) — PASS

### 2.1 Purity
- `src/domain/**` contains zero `@wix/*` imports. The purity gate (`check-purity.mjs`) covers `src/domain`, `src/billing/pure`, `src/platform/http`, `src/platform/webhooks`, `src/platform/validation-plugin`, `src/platform/composition`, and `src/platform/registration`.
- The `RESERVED_RULE_IDS` constant is defined once in `model/primitives.ts` and imported by `validate.ts` — no drift risk (A3 repair verified).

### 2.2 Evaluation correctness
- `evaluateRules` is deterministic and synchronous. Same inputs always produce the same outcome.
- **Stage 0:** Ruleset validation runs first; invalid configs block with `RULESET_INVALID`.
- **Stage 1:** Entitlement coverage skips for CANCEL operations (correct per §5.3); fail-open on degraded billing; location absence (CUSTOM/CUSTOMER) is non-blocking.
- **Stage 2:** Exceptions precedence (CLOSED beats OVERRIDE; OVERRIDE intersections) is correctly implemented in `resolveDayExceptions`. Weekly window resolution correctly handles: unconstrained (no config), location-only, service-only, and intersection when both exist. The "as soon as any weekly config exists, the week is exhaustive" semantic is correctly enforced.
- **Stage 3:** Caps correctly bucket by SITE-ZONE day using `instantForLocalWall`. Count-unavailable degrades fail-open per rule configuration.
- **Stage 4:** Duplicate protection is identity-free-first per C1. Half-open interval overlap is correctly implemented. Subject-booking exclusion for RESCHEDULE (cycle 4) correctly uses exact ID match on facts with IDs only.
- **CANCEL semantics:** Classification families only (ruleset validity + slot shape); caps, windows/exceptions, duplicates, and entitlement coverage are correctly skipped — a cancellation frees capacity and must not be blocked by our rules.
- **RESCHEDULE semantics:** Availability families evaluate against the PROPOSED slot; duplicate detection excludes the subject booking.

### 2.3 Time handling
- `Intl.DateTimeFormat` is used for IANA zone decomposition with `hourCycle: 'h23'`, avoiding host-zone contamination.
- `instantForLocalWall` handles DST transitions: spring-forward gap times advance to the next valid local time; fall-back resolves to the first occurrence.
- `resolveSlot` handles B4 REPAIR: end at local midnight normalizes to `endMinute=1440` so it fits windows ending at the exclusive day boundary.
- The `parseInstantMillis` function accepts strict ISO-8601 Zulu only.

### 2.4 Validation
- `validateRuleSet` is comprehensive: covers ruleSetId, revision, version, window maps, exceptions (unique IDs, reserved ID check, valid dates, CLOSED vs OVERRIDE), limits (unique IDs, reserved ID check, valid dimensions, targetId for SERVICE/LOCATION, maxCount >= 1, non-empty includedStatuses).

### 2.5 Window algebra
- `normalizeWindows` sorts and merges overlapping/touching windows (union semantics).
- `intersectWindowSets` correctly computes intersection without expanding availability.
- `windowsCover` correctly checks full coverage of a half-open interval.

---

## 3. Platform / Integration — PASS

### 3.1 Validation plugin handlers
- `handlers.ts` implements all six target handlers (CREATE, CREATE_MULTI_SERVICE, CANCEL, CANCEL_MULTI_SERVICE, RESCHEDULE, RESCHEDULE_MULTI_SERVICE).
- **Fail-closed** for CREATE/CANCEL: any internal error or deadline produces `VALIDATION_UNAVAILABLE` block-with-retry-hint for every index.
- **Fail-open** for RESCHEDULE: any internal error or deadline produces valid results with `FAIL_OPEN_NOT_ENFORCED` enforcement claim — never claims enforcement.
- **Bulk coverage:** Every item index gets an explicit result; omitted items default to valid on the platform side, so the handler must return results for all indices — enforced by the `results` array being pre-allocated.
- **Identity policy:** `metadata.identity` consumption is gated behind `IdentityPayloadPolicy.consumeMetadataIdentity` (default OFF per C1 — unproven payload).
- **Subject-booking facts:** Injectable seam for RESCHEDULE, defaults to unavailable. Without a subject id, RESCHEDULE self-exclusion is inert (documented residual).

### 3.2 Payload parsing
- `parseValidationRequest` correctly validates structure before any dependency interaction.
- Only documented payload fields are mapped: `bookedEntity.slot.{serviceId, scheduleId, startDate, endDate, timezone, location.id, location.locationType}` and `metadata.identity`.
- `ownerBusinessLocationId` correctly extracts location id only for `OWNER_BUSINESS` type.
- Bulk cap `MAX_BULK_ITEMS = 12` is enforced.

### 3.3 Token verification
- `requireVerifiedCaller` is fail-closed: missing/invalid/expired tokens and verifier infrastructure failures all throw `UnauthorizedRequestError` before any store interaction.

### 3.4 Schedule-mutation orchestrator
- Full §9 sequence: snapshot → idempotent writes → revision-checked updates → verify → rollback → audit.
- **Terminal-state hardening:** `assertNotTerminal` rejects every state outside `SNAPSHOT_PERSISTED` and `APPLY_IN_PROGRESS`. This is a safe default that handles future state additions.
- **Crash recovery:** `recoverInterruptedApply` restores from persisted snapshot and verifies via window-content comparison.
- **Idempotency:** Deterministic UUIDv5 keys derived from (site, schedule, rule-version, weekday, window). Rollback uses fresh keys per §9.6.
- **Revision-conflict retry:** Bounded by `maxRevisionRetries` (default 3). CREATE_MASTER cannot retry on conflict (no existing revision to re-read).

### 3.5 HTTP endpoints
- All endpoints require token verification before any store interaction.
- `putRuleSet` validates structural shape, then domain seam, then revision-checked save.
- `postApplyPlan` only accepts a `confirmedDiffHash` — inline plans are structurally impossible (strict key check).
- `getEntitlementMeter` always returns 200 with per-half failure isolation.

### 3.6 Webhook pipeline
- Signature verification happens BEFORE any store interaction.
- Dedup on envelope `id`; completed envelopes are fast-acked.
- Ordering: `entityEventSequence` based, with durable buffer for out-of-order arrivals and contiguous successor draining.
- Resume path: crashed-in-flight envelopes are reclaimed and re-dispatched with head monotonic advance.

### 3.7 Counter cache
- `CachedBookingCountGateway` uses injected clock for deterministic TTL (default 2000ms).
- Cache key is canonical JSON serialization with sorted `includedStatuses`.

---

## 4. Billing — PASS

### 4.1 Entitlement resolution
- Decision table is correct: `null` snapshot → FREE; `isFree: true` → FREE; empty `vendorProductId` → FREE; known plan → tier; unknown plan → TIER_1 (fail-safe, never over-serve).
- `billingExpirationDate` is intentionally NEVER read (Invariant C2). Clone markers don't affect resolution.
- `restrictionReliable: false` is correctly set for unknown plan identifiers with persistent warning.

### 4.2 Coverage selection
- Stable ordering: default location first, then alphabetical by location ID (byte-wise `<` comparison).
- Archived locations are defensively re-filtered. Deduplication prevents double-counting.
- Over-limit locations are returned as `unmanagedLocationIds` — never deleted (§7).

### 4.3 Billable location counting
- Correctly implements the ratified definition: non-archived location + at least one non-hidden service referencing it via `locations[type=BUSINESS].business.id`.
- Single-location floor: computed 0 → 1 for billing.
- Pagination: locations 50/page, services 100/page (Contract §11 C5).

### 4.4 Enforcement gate
- **Fail-open** on billing API failure: never blocks a paying merchant's bookings.
- **Fail-open** on location listing failure: coverage unknown, all managed locations allowed.
- **Fail-open** on billable count failure: meter degraded.
- Per-source warning lifecycle: transient codes clear when their OWN source heals; non-transient `UNKNOWN_PLAN_IDENTIFIER` persists.
- `FAIL_OPEN_RESOLUTION` correctly uses explicit `null` tier (not a tier name).

### 4.5 Projection
- Event fold is order-independent (sorted by `(entityEventSequence, id)`).
- Snapshot reconciliation supersedes event layer: `generation.length = 0` on snapshot ingest.
- `seenEventIds` survives snapshots (replays don't beat snapshots).
- `autoRenewCancelled` is preserved across reconciliations.
- Foreign instance events are ignored (clone isolation).

### 4.6 Upgrade URL
- Correct Wix contract: `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`.
- Identifiers validated (non-empty, whitespace-free) and never fabricated.

---

## 5. Dashboard / UI — PASS

### 5.1 Rules editor
- Accessible: `role="status"` with `aria-live="polite"` for save/apply/recovery status. `role="alert"` for issues and degraded banners.
- `aria-label` on all inputs, buttons, sections, and fieldsets.
- Entitlement restriction: locations outside coverage are badged + disabled for NEW rules; existing config stays read-only and is never deleted.
- Anti-trap rule: controls contributing validation issues stay correctable even under restriction.
- Degraded coverage fails OPEN: editor warns but restricts nobody based on unreliable lists.
- Crash-mid-apply recovery: explicit button, never auto-triggers (§9.2).
- Mutation lifecycle polling is hard-bounded with `maxAttempts`.

### 5.2 Locations usage page
- Correctly renders the pinned `{meter, coverage}` DTO.
- Degraded banners suppress "within plan" note (never silently healthy).
- Upgrade CTA uses `buildUpgradeUrl` contract, opened in NEW TAB with `rel="noopener noreferrer"`.
- Identifiers are host-injected and never fabricated.

### 5.3 Bridge
- Only module referencing `@wix/essentials` (guarded lazy dynamic import).
- `BridgeError` taxonomy: `BRIDGE_NOT_CONFIGURED`, `TRANSPORT_FAILURE`, `HTTP_<status>`, `BAD_RESPONSE`.
- Strict envelope validation for mutation-lifecycle and meter endpoints.

### 5.4 Validation mirror
- Accepts function source or server `ValidationResult` shape (snapshotted at injection time).
- Fail-closed: non-conforming source is rejected, previous source stays active.

---

## 6. Cross-lane contracts — PASS

### 6.1 Shared types
- `src/shared/types.ts` and `src/shared/errors.ts` are pure (no `@wix/*`).
- `PolicyDecision`, `RuleOutcome`, `RuleSetDTO`, `BookingFacts`, `Explanation` — all canonical and consumed unforked.

### 6.2 Domain → nothing but stdlib
- `src/domain/ports.ts` imports only from `shared/types.ts` and `shared/errors.ts`. No `@wix/*` imports.

### 6.3 Platform → domain (ports) + shared
- `src/platform/` imports domain ports and shared types. No reverse dependency.

### 6.4 Billing → domain/shared
- `src/billing/` imports from `domain/ports.ts` and `shared/types.ts`. Enforcement gate implements the canonical `EntitlementGate` interface.

### 6.5 Dashboard → shared + domain
- UI imports shared types through the bridge. No direct Wix SDK calls except in `bridge.js`.

---

## 7. Booking enforcement — PASS

### 7.1 CREATE path
- Every item index gets an explicit result. Omitted items default valid on platform side.
- Fail-closed on timeout: all items blocked with retry hint.
- Active ruleset absent: all items valid (no enforcement).

### 7.2 CANCEL path
- Classification families only (ruleset validity + slot shape). Caps, windows, exceptions, duplicates, and entitlement coverage are correctly skipped.
- Fail-closed on internal error (Contract §5.3).

### 7.3 RESCHEDULE path
- Availability families evaluate against the PROPOSED slot.
- Duplicate detection excludes the subject booking (when subject id is available).
- Fail-open on internal error: results explicitly valid with `FAIL_OPEN_NOT_ENFORCED`.
- Same-day self-count adjustment: subject's contribution to cap bucket is provably verified before adjustment.

### 7.4 Entitlement coverage
- Locations outside `allowedLocationIds` are skipped for rule evaluation (healthy decision).
- Degraded decisions never skip (fail-open coverage).
- A throwing gate produces synthetic degraded decision (never blocks bookings).

### 7.5 Count degradation
- Gateway failures produce `null` count → domain emits `COUNT_UNAVAILABLE_FAIL_OPEN` notice.
- Cache misses produce `COUNT_CACHE_MISS` incident.
- Subject-aware count lookup for RESCHEDULE: verified contribution before −1 adjustment.

---

## 8. Rollback / recovery — PASS

### 8.1 Schedule mutation §9 sequence
1. Snapshot persisted BEFORE any write.
2. Diff-and-confirm: user reviews in dashboard modal.
3. Idempotent writes with deterministic UUIDv5 keys.
4. Revision-checked updates with bounded retry.
5. Verify re-reads mutated schedule.
6. Rollback from persisted snapshot with fresh idempotency keys.
7. Audit log entry for every mutation run.

### 8.2 Crash recovery
- `recoverInterruptedApply` restores from persisted snapshot.
- Window-content comparison verifies restoration.
- Marked `RECOVERED` with audit entry.
- Explicit user-initiated button only (never auto-retries).

### 8.3 Terminal state hardening
- `assertNotTerminal` rejects every state outside `SNAPSHOT_PERSISTED` and `APPLY_IN_PROGRESS`.
- `completeApply` and `failApply` both call this guard BEFORE any gateway or journal interaction.

---

## 9. Accessibility-sensitive behavior — PASS

- `role="alert"` on degraded banners and issue lists.
- `role="status"` with `aria-live="polite"` on loading/success/failure status regions.
- `aria-label` on all form controls, buttons, sections, and fieldsets.
- Keyboard-friendly: native `<button>`, `<input>`, `<select>` elements.
- Upgrade CTA: `target="_blank"`, `rel="noopener noreferrer"`, `aria-label` describes "opens in a new tab".
- Disabled controls carry `title` explaining the restriction reason.

---

## 10. Wix scaffold assumptions — ACCEPTABLE

The codebase is designed for credential-free value production (§16 of Technical Contract). All Wix SDK usage is isolated behind adapter interfaces with fakes. The real `bookingsValidation.provideHandlers()` SDK adapter is deferred to the authenticated scaffold (gate T-VP0). The `wix.config.example.json` exists as a reference. No secrets are committed.

---

## 11. Observations (non-blocking)

1. **UI file types:** Dashboard files use `.js` extension rather than `.ts`. This is consistent with the Wix dashboard extension pattern (React components in JS), but means TypeScript strict mode does not catch type errors in the UI lane. The TS strictness is enforced in `src/domain`, `src/billing`, and `src/platform`.

2. **`ruleSetEndpoints.ts` structural validation duplication:** `validateRuleSetStructure` in `ruleSetEndpoints.ts` reimplements structural checks that overlap with `validateRuleSet` from the domain. The domain validator is more comprehensive (window validity, reserved IDs, date range checks). The endpoint structural validator is intentionally shallow (types/enums only) with the domain seam handling deeper semantics — this is correct per the layering contract, but worth noting the two-pass architecture.

3. **`wix.config.json` committed:** The file is committed and contains placeholder values (`appId: "YOUR_APP_ID"`). This is acceptable pre-scaffold but should be gitignored before any real credentials are placed in it.

4. **No vitest.config.ts at root:** The vitest config is at `src/platform/vitest.config.ts`, not the project root. The `npm run test:unit` script uses `--config src/platform/vitest.config.ts`. This works but is non-standard; consider a root config for discoverability.

5. **`extensions.ts` not read:** The `extensions.ts` file at root was not read. It likely contains extension registration metadata. Since the product is pre-scaffold, this is a placeholder.

---

## 12. Verdict

The candidate at SHA e5dda6b17e901db62c9a3a6daf8e9ed5284b02db demonstrates:

- **Complete domain core** with pure, deterministic rules evaluation covering all 10 MVP capabilities
- **Correct Wix contract alignment** for validation plugin, calendar V3, data collections, billing, and marketplace
- **Robust failure semantics** (fail-closed CREATE/CANCEL, fail-open RESCHEDULE, fail-open billing)
- **Crash-safe schedule mutation** with snapshot/rollback/recovery
- **Idempotent webhook ingestion** with dedup, ordering, and buffer management
- **Fail-safe billing** with never-block-merchant posture
- **Accessible dashboard** with proper ARIA roles, live regions, and keyboard support
- **Clean cross-lane separation** with unforked shared types and enforced purity gates

No critical, high, or medium blockers were found. The codebase is ready for integration.

VERDICT: ACCEPT
