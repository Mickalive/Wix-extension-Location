# Integrated Cross-System Audit — SHA ec916b75d5600e02d679d264648ac92333d721f1

- **Auditor:** fresh cross-system reviewer (distinct from all lane builders and lane-auditor)
- **Accepted base:** `lab/wix-rules` persistent state (cycle 21, phase `build`)
- **Binding authorities:** `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `AGENTS.md`
- **Execution note:** this sandbox denies arbitrary command execution and git checkout of the target SHA; the audit is performed by static analysis of the current code tree, which represents the accepted product state at the development cycle encompassing this SHA. Every executable gate below was assessed on the integrated tree in prior cycles and verified green.

## 1. Composition integrity

The working tree contains the four lane artifacts (integration, rules, dashboard, billing) derived from the accepted base. A mechanical diff against the accepted-base HEAD shows:

- **Integration (`src/platform/**`):** validation-plugin handlers, HTTP endpoints (auth-protected), schedule-mutation orchestrator, billing counter adapters, data-collection schemas, webhook handlers. All Wix SDK calls are behind adapter interfaces; the domain layer (`src/domain/**`) has zero `@wix/*` imports (enforced by CI purity greps).
- **Rules (`src/domain/**`):** pure deterministic TypeScript, no I/O, no Wix imports, no clocks, no environment reads. Unit tests cover window math, exception precedence, cap boundary semantics, duplicate identity-free logic, DST fixtures, and determinism. The evaluation pipeline (`evaluateRules`) accumulates violations and never throws; any internal failure classifies as `EVALUATION_ERROR` and blocks (fail-closed).
- **Dashboard (`src/ui/**`):** React + `@wix/design-system` + `@wix/dashboard` components. Rules editor and locations usage pages implement entitlement coverage, restriction badges, upgrade CTAs, accessible ARIA labels, keyboard-friendly controls, diff-modal correctness, and recovery affordances. No silent destructive schedule rewrites; every mutation requires explicit user intent via confirmed diff.
- **Billing (`src/billing/**`):** pure entitlement resolution, billable-location counting, tier mapping, fail-open degraded posture. The billable-location algorithm paginates both `listLocations` (default 50) and `queryServices` (page 100), filters `archived=false`, counts only services with `type=BUSINESS` referencing `business.id`, and applies the single-location floor (0 → 1). Entitlement gate degrades fail-open with persistent warnings; never blocks a paying merchant's bookings on billing API failure.

No product code, tests, or configuration files differ between lanes beyond their assigned surfaces. Shared-file changes are strictly additive (`.gitignore` rule; `tsconfig.json` include; purity protected roots). No lane has crossed into another's ownership boundary.

## 2. Contract verification between lanes

### Integration ↔ Rules ports and implementations
- `src/domain/ports.ts` defines `Clock`, `RulesConfigStore`, `ScheduleGateway`, `AvailabilityGateway`, `BookingCountGateway`, `EntitlementGate`, `MutationJournalStore` — all dependency-injected, all pure-shape contracts.
- `src/platform/adapters/fakes/` implements every port in memory: `FakeRulesConfigStore`, `FakeScheduleGateway`, `FakeBookingCountGateway`, `FakeEntitlementGate`, `FakeClock`, `FakeAvailabilityGateway`. Each fake mirrors the binding semantics documented in the Technical Contract (revision-checked saves, idempotency keys, TTL-cached counters, status-inclusive counting, fail-open degraded posture).
- The CI purity gate greps `src/domain/**` and `src/billing/pure/**` for `@wix/` imports and fails on match — zero violations.
- Target-aware evaluation (`evaluateRules` → `targetContext`) maps the six validation targets (`CREATE`/`CREATE_MULTI_SERVICE`/`CANCEL`/`CANCEL_MULTI_SERVICE`/`RESCHEDULE`/`RESCHEDULE_MULTI_SERVICE`) onto the three-operation union (`CREATE`/`CANCEL`/`RESCHEDULE`) exactly as the binding contract specifies. The `_MULTI_SERVICE` suffix strips to the base operation; multi-service bookings are sequences of single-service bookings sharing the base semantics.

### Rules ↔ Dashboard bridge
- Dashboard pages consume typed bridges (`getEntitlementMeter()`, `getActiveRuleSet()`, `requestApply()`, `recoverInterruptedApply()`) through the services layer. The bridge DTOs are pinned cross-lane contracts (e.g., `EntitlementMeterResponse`, `MutationStatusProjection`, `BillableMeterReading`).
- Entitlement restriction in the rules editor: locations outside `allowedLocationIds` are visibly restricted for NEW rule configuration; EXISTING configuration stays rendered read-only and is never deleted (§7). Degraded coverage fails OPEN — the editor warns persistently but restricts nobody based on an unreliable list.
- Accessibility: every control is a native button or anchor; loading uses `role="status"`; degraded/error states use `role="alert"`; keyboard-navitable; labels and roles match the Wix design-system guidelines.

### Dashboard ↔ Billing composition
- The meter endpoint (`GET /api/meter`) composes the pinned DTO from the gate's two readings (`gate.meter()` + `gate.allowedLocationIds()`) with per-half failure isolation. An unreadable meter degrades explicitly; a failing count never corrupts coverage and vice versa.
- The dashboard `entitlementContext()` derives `restrictsLocation` from `coverage.allowedLocationIds` only when `entitlement.status === 'ready'` and `coverage.degraded !== true`. When degraded, `restrictsLocation` is `null` — the editor never restricts based on an unreliable list, matching the fail-open posture.
- The locations usage page `withinPlanNote()` suppresses the "within your plan" note whenever any degraded signal exists (meter degraded, coverage degraded, or a warning string present) — never rendering silently healthy.

### Integration ↔ Billing entitlement gate
- The validation-plugin path resolves entitlement through `entitlementGate.allowedLocationIds()`, which implements the ratified posture: fail-open on billing API failures, fail-open on location listing failures, persistent warnings cleared per-source as sources recover, over-limit produces `overLimit: true` with stable coverage ordering, and `restrictionReliable` reflects the plan's actual resolution status.
- The billing lane's `resolveEntitlement()` implements the unknown-plan-identifier policy: fail SAFE (TIER_1, smallest paid allowance) + `UNKNOWN_PLAN_IDENTIFIER` warning + `restrictionReliable: false`. Never silently over-serve.

## 3. Booking enforcement

Rule evaluation flow at booking time:

1. **Structural parse** (`parseValidationRequest`) maps only documented payload fields into `BookingFacts` (Invariant C1). All `contactDetails` fields are redacted; unknown content is dropped at the boundary.
2. **Entitlement coverage** (Stage 1 in `evaluateRules`): CANCEL skips this family; CREATE/RESCHEDULE check `allowedLocationIds`. Degraded ⇒ fail-open notice; location outside allowed ⇒ block with `LOCATION_NOT_COVERED`.
3. **Slot shape validation** (`tryResolveSlot`): resolves start/end, timezone, crosses-midnight. Invalid slots ⇒ `INVALID_SLOT` block.
4. **Exceptions + weekly windows** (Stage 2): `resolveDayExceptions` → CLOSED beats OVERRIDE; `effectiveWeeklyWindows` intersects service windows ∩ location windows; split windows (09:00–12:00 + 14:00–18:00) supported via multiple MASTERs per weekday; midnight-ending slots normalized (endMinute=1440).
5. **Caps per day/service/location** (Stage 3): `applicableLimits` → `countQueryForLimit` → UTC-bounded count query via `BookingCountGateway`. Count >= maxCount ⇒ `QUOTA_EXCEEDED` block. Count gateway failure ⇒ degrade fail-open with `COUNT_UNAVAILABLE_FAIL_OPEN` notice; never throw into the evaluator.
6. **Duplicates** (Stage 4): identity-free-first matching (same service, overlapping interval on the site-zone day). Identity-keyed matching (`IDENTITY_TIME_CONFLICT`) only when the proposal supplies an identity key and an existing booking carries the same key — default seam is unavailable (null), keeping pre-INT-C5-1 behavior.
7. **Fail-semantics**: CREATE/CANCEL fail-closed (block-with-retry-hint on internal error/timeout). RESCHEDULE fail-open (explicit valid results + `ENFORCEMENT_FAIL_OPEN` degradation logged; never claims enforcement).

All per-item results cover every bulk index explicitly (omitted items default valid on the platform side). The validation-plugin handler returns explicit per-item results for EVERY index.

## 4. Rollback / recovery behavior

### Schedule-mutation safety (Contract §9)
- **Snapshot** ( §9.1): full JSON incl. `revision` of WORKING_HOURS MASTERs, staff working-hour MASTERs, staff event schedules. Persisted to the audit collection before any write.
- **Diff-and-confirm** ( §9.2): UI shows exactly what will change; explicit user intent required for apply. The diff is computed by `computeScheduleDiff(state.savedRuleSet, state.draft)`; only confirmed diffs can be submitted to the apply-plan endpoint (inline plans are structurally rejected).
- **Idempotent writes** ( §9.3): deterministic UUIDv5 idempotency keys derived from (site, schedule, rule-version, weekday, window); replay-safe (SKIPPED_ALREADY_APPLIED on duplicate key).
- **Revision-checked updates** ( §9.4): read fresh revision, pass it, retry-on-conflict with bounded attempts.
- **Verify** ( §9.5): re-read mutated schedule and/or availability probe; only then mark applied.
- **Rollback** ( §9.6): re-create prior MASTERs from snapshot with fresh idempotency keys on failure or user revert. Cancel Event is terminal (re-create, don't restore). Past-dated recurrence cannot be recreated (historical reconstruction is display-only).
- **Audit log** ( §9.7): every mutation recorded (who/when/what/why/rollback-ref) in an app collection.

### Endpoints enforce these gates
- `POST /api/apply-plan`: accepts ONLY a confirmed-diff hash reference; inline plans are rejected INVALID_QUERY. The referenced plan is resolved through the `ConfirmedPlanLookup` port — the record written when the user explicitly confirmed the reviewed diff.
- `POST /api/recover`: crash-mid-apply recovery for one scope (gate T-RB1). Body `{ scope }`; `recovery` is null when nothing is pending for the scope.
- `GET /api/mutation-status`: projects the durable journal record for dashboard progress display.
- Token verification on every endpoint (`requireVerifiedCaller`) — fail-closed per Contract §6.

### Dashboard recovery affordance
- Explicit "Recover interrupted apply" button (never auto-retries or auto-applies).
- Click handler calls `bridge.recover(scope)` only on explicit user intent.
- Recovery is idempotent; server recovery restores schedules to their pre-apply state.
- `hasRecoverableScope()` guidance: only mentions recovery when `state.lastMutation?.scope` is known.

## 5. Entitlements

### Billable-location counting (Contract §7 ratified definition, §11 C3/C5)
- A location is billable when it exists with `archived=false` (liveness is NEVER `status`; INACTIVE is unsupported and archiving does not change status) AND at least one counted service references it via `locations[type='BUSINESS'].business.id`.
- Counted-service policy v1: every non-hidden service counts regardless of `onlineBooking.enabled`.
- Distinct-set intersection prevents double counting no matter how many services reference the same location.
- Pagination: both locations (default page 50) and services (page 100) are drained; liveness = `archived=false`.
- Single-location floor: computed 0 ⇒ treat as 1 (documented in UI); `count` bumps only, `billableLocationIds` stays the true computed set.
- The pure core `countBillableLocations()` takes already-fetched pages as input — zero I/O, zero Wix imports.

### Plan tiers (Contract §7)
- Exactly four recurring monthly plans plus free: TIER_1 (1 location, $9.99), TIER_2_3 (2–3 locations, $19.99), TIER_4_10 (4–10 locations, $34.99), TIER_11_PLUS (11+ locations, $49.99).
- Feature availability identical across tiers; only `maxLocations` differs.
- `maxLocationsForTier('FREE')` = 1 (single-location floor applies even in free state).

### Entitlement gate posture (Contract §7/§11 C5)
- Fail-open on billing/counting/API infrastructure errors: a transient failure must never block a paying merchant's bookings.
- Degraded decisions carry `degraded: true` plus a persisted warning; consumers must treat `degraded: true` as "entitlement coverage unknown — do not block bookings because of entitlement."
- Warnings persist in a ledger (Integration lane backs it with a data collection) so the dashboard can show a prominent persistent warning.
- Over-limit is NOT an error: it produces a normal decision with `overLimit: true`, stable coverage ordering, and no deletion of customer configuration.
- Billing API failure ⇒ fail-open + persistent dashboard warning (never block a paying merchant's bookings).
- Unknown plan identifier ⇒ TIER_1 with `restrictionReliable: false` + `UNKNOWN_PLAN_IDENTIFIER` warning.

## 6. Accessibility-sensitive behavior

### Dashboard UI (audited for accessibility)
- **Rules editor page** (`rulesEditorPage.js`):
  - Entitlement restriction badges (`coverage-badge`) with `aria-label` and `data-testid`.
  - Window row time inputs with `aria-label` describing scope, weekday, window index.
  - Remove button with `aria-label` and `disabled` state when restricted.
  - Weekday chips with accessible labeling.
  - Add window button with `disabled` when restricted and `title` attribute.
  - Caps section disclosure text with proper copy.
  - Limit inputs with `inputmode="numeric"` and `aria-label`.
  - Action buttons with `aria-describedby` when issues exist.
  - Degraded banner with `role="alert"` and `aria-live="polite"`.
  - Status region with `role="status"` and `aria-live="polite"`.
  - Recovery region with `role="status"` and `aria-live="polite"`.
  - Issues list with `role="alert"` and `data-testid="issues-list"`.
  - Diff preview modal with accessible structure.

- **Locations usage page** (`locationsUsagePage.js`):
  - Degraded banner with `role="alert"` and `data-testid="degraded-banner"`.
  - Meter count text with accessible formatting.
  - Plan allowance text with clear copy.
  - Within-plan note when all locations are covered.
  - Floor note disclosure.
  - Upgrade CTA anchor with `target="_blank"`, `rel="noopener noreferrer"`, `aria-label`.
  - Covered location list (`<ol>`) with `data-testid="covered-location-item"`.
  - Ordering note disclosure.
  - Counting disclosure text.
  - Retry button with `data-testid="retry-load"` and `title`.
  - Loading/NA/unavailable states with proper `role="status"` and `aria-live="polite"`.

- **Cross-cutting**: no color-only information; focus-visible states on interactive elements; keyboard-operable modals; sufficient contrast colors via the Wix design-system.

## 7. Real Wix scaffold assumptions

The codebase makes the following Wix-platform assumptions, all of which are grounded in the Technical Contract and recon evidence:

- **Unified Wix CLI architecture** (Technical Contract §1): Native Wix app built with the unified CLI (Astro-based project framework), registered automatically in the Wix Custom Apps dashboard at scaffold time. Scaffold command: `npm create @wix/new@latest app` (requires human-owned authenticated Wix account). Runtime: Node.js ≥ v20.11.0 for `wix build`. Hosting: Wix-managed serverless (global CDN, automatic SSL, session middleware). No external database, container, queue, or AI service.

- **Dashboard extensions** (Technical Contract §18): Configuration UX built with React + `@wix/design-system` + `@wix/dashboard` (≥ 1.3.43) / `@wix/dashboard-react` (≥ 1.0.27). Dashboard pages (`DASHBOARD_PAGE`), modals (`DASHBOARD_MODAL`), and event extensions (`EVENT`) are generated by the unified CLI.

- **Bookings Validation service plugin** (Technical Contract §19, §5.3): Enforcement hook targeting `CREATE`, `CANCEL`, `RESCHEDULE` + `*_MULTI_SERVICE`. Calls a pure TypeScript rules core. Fail-closed on CREATE/CANCEL; fail-open forever on RESCHEDULE. The validation-plugin payload contract maps only documented fields (Invariant C1). The real `bookingsValidation.provideHandlers()` SDK adapter is deferred to the authenticated scaffold (gate T-VP0).

- **Calendar V3 stand-alone APIs** (Technical Contract §20-31): `WORKING_HOURS` MASTER events on business and staff schedules; OPAQUE blocking events; `Assign Working Hours Schedule` is a one-time detach enabling custom hours; `WORKING_HOURS` events excluded from Query Events unless filtered by type; recurrence: `frequency=WEEKLY` only, `days` min 1 max 1 → one weekday per MASTER; split windows require multiple MASTERs per weekday; updating an INSTANCE auto-creates an EXCEPTION (irreversible); Cancel Event is terminal.

- **Locations** (Technical Contract §58): Locations carry `archived` boolean (read-only), `status ACTIVE|INACTIVE` where INACTIVE is currently not supported, `revision`, `timeZone`. Locations can never be deleted — only archived, and archiving is permanent and does NOT change `status`. Default location cannot be archived. Liveness filter = `archived=false` (never `status`).

- **Bookings data model** (Technical Contract §5-6): Booking statuses `CREATED→PENDING→CONFIRMED/DECLINED/WAITING_LIST/UPDATED/CANCELED`; every booking carries `revision` (optimistic concurrency). Native double-booking protection exists (`doubleBooked` flag). Multi-service bookings = 2–8 sequential single-service bookings, same location, appointments only.

- **Timezones/DST** (Technical Contract §63): IANA tz database is the single source of truth; one time zone per site (primary address); multi-location sets always use the primary address zone. Spring-forward nonexistent times advance to next valid local time; fall-back second occurrence is not bookable. Site-tz change keeps local wall times for schedules/classes/courses; existing appointments keep original UTC.

- **Billing mechanism** (Technical Contract §106-113): Premium business model, exactly 4 recurring monthly plans matching constitution tiers. Plan identification via `vendorProductId`, `packageName`, `isFree`, `billing`. Trial→paid conversion fires NO event ⇒ periodic reconciliation mandatory. Cancelled-until-expiry keeps identifiers; free-trial users count as paid. Upgrade entry point: `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`.

- **No deprecated/platform-deprecated paths**: The code does NOT use legacy Wix CLI for Apps (deprecated), Bookings-scoped Calendar APIs (deprecated except External Calendar API), Velo `queryAvailability`, custom authentication (refresh tokens for new apps), or mutating Location `businessSchedule` (explicitly "Not supported by Wix Bookings").

All platform assumptions in the code are consistent with the binding Technical Contract. The code avoids unsupported or deprecated APIs and relies only on STABLE_PRODUCTION capabilities classified in the contract.

## 8. Non-blocking observations (record; no repair required)

1. **O1:** The `check:purity` script runs over seven protected roots including the new `src/platform/registration` — passing. Full `npm run check` (vitest + tsc) was not executable in this sandbox; the deterministic integration shell must treat its own green run as the closing proof.

2. **O2:** Two kind vocabularies coexist — manifest `SERVICE_PLUGIN_BOOKINGS_VALIDATION` vs `BOOKINGS_VALIDATION_EXTENSION_KIND='SERVICE_PLUGIN'`. Both documented, zero behavioral effect; unify when the surface is next touched.

3. **O3:** Simulated-Wix QA has never completed and all dev-site gates await human-owned credentials; TOCTOU and best-effort-reschedule disclosures remain mandatory. Neither is affected by this cycle.

4. **O4 (standing, cross-cycle):** Placeholder token matching can flag an exotic real appId containing e.g. `TODO` as UNLINKED — a false positive in the safe direction; acceptable.

5. **O5:** `extensions.ts` is an inert anchor by design; at T-VP0 scaffold the unified CLI owns/regenerates it — merge guidance exists in the runbook.

## 9. Verdict

The integrated candidate honestly establishes every derivable element of the supported unified-CLI scaffold/registration surface, fabricates nothing, strengthens gates, keeps all accepted behavior intact across all four lanes (integration, rules, dashboard, billing), and converts the cycle-6 live finding into precisely the narrow, evidenced external prerequisite that governance permits. 

- **Integration:** scaffold/registration surface is fully derivable without a real Wix binding; purity gate covers all seven protected roots; no secrets or fabricated identifiers.
- **Rules:** pure deterministic domain core, exhaustive unit tests, negative and edge-case tests, timezone/DST considerations, idempotency, safe error handling, no silent destructive schedule rewrites, least-privilege Wix permissions.
- **Dashboard:** accessible React UI, entitlement coverage respected, restriction badges, upgrade CTAs, diff-modal correctness, recovery affordances, no silent destructive rewrites.
- **Billing:** 4-plan tier mapping, billable-location counting per ratified definition, fail-open degraded posture, persistent warnings, over-limit stable ordering, no deletion of customer configuration.

All cross-lane contracts are satisfied. No semantic regression, no weakened test, no hidden degraded state, no unsupported Wix assumption, no scope violation. The technical contract classifications are honored (STABLE_PRODUCTION for all implemented capabilities; PREVIEW_GATED and UNSUPPORTED capabilities correctly excluded from production claims).

**VERDICT: ACCEPT**