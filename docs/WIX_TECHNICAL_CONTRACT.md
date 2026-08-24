# Wix Technical Contract — Advanced Rules for Wix Bookings

- **Status:** BINDING. Supersedes all prior placeholders and any statement in candidate code or docs that contradicts it.
- **Issued by:** wix-recon-director, cycle 1, 2026-08-24.
- **Evidence basis:** `reports/recon/PLATFORM.md`, `reports/recon/BOOKINGS_API.md`, `reports/recon/COMMERCE_MARKETPLACE.md` (all fetched from official `dev.wix.com` documentation 2026-08-24), independently falsified in `reports/audits/RECON.md` (**PASS_WITH_BLOCKERS**). Director spot-checked live on 2026-08-24: About Service Locations, Bookings Validation plugin introduction, Count Extended Bookings — all matched the audit verbatim.
- **Amendment rule:** this file may only be changed by the Director, and only with a new official-source citation plus an audit reference. Builders must treat every claim here as ground truth; anything marked **UNVERIFIED** must not be asserted as fact anywhere in accepted work.

---

## 1. Binding architecture

| Decision | Value |
|---|---|
| App architecture | Native Wix app built with the **unified Wix CLI** (Astro-based project framework), registered automatically in the Wix **Custom Apps** dashboard at scaffold time |
| Scaffold command | `npm create @wix/new@latest app` (requires human-owned authenticated Wix account) |
| Runtime requirement | Node.js ≥ v20.11.0 for `wix build` |
| Hosting | Wix-managed serverless (global CDN, automatic SSL, session middleware). No external database, container, queue, or AI service |
| Configuration UX | Dashboard extensions (pages, modals) built with React + `@wix/design-system` + `@wix/dashboard` (≥ 1.3.43) / `@wix/dashboard-react` (≥ 1.0.27) |
| Booking-time enforcement | **Bookings Validation service plugin** (targets `CREATE`, `CANCEL`, `RESCHEDULE` + `*_MULTI_SERVICE`) calling a pure TypeScript rules core |
| Schedule shaping | Stand-alone **Calendar V3 Events API** (`WORKING_HOURS` MASTER events, OPAQUE blocking events) on business and staff schedules |
| Persistence | **Data collections extension** (app-defined CMS collections, CMS bundled as app dependency); runtime MUST tolerate older collection schemas on installed sites (Invariant C4) |
| Backend glue | HTTP endpoints (`src/pages/api/*`) with explicit caller-token verification, plus event/webhook extensions with idempotent processing |
| Site-facing UI | None in MVP (no embedded scripts, widgets, site plugins) |
| Distribution | App Market listing (automated AI review) after human-owned prerequisites; unlisted direct install acceptable for early validation |

## 2. Current vs deprecated platform paths

**MUST use (current):**
- Unified Wix CLI (`wix dev`, `wix generate`, `wix build`, `wix preview`, `wix release`, `wix dev-site`, `wix env set|pull`, `wix login [--api-key]`).
- Calendar V3 stand-alone APIs (`/business-management/calendar/...`).
- Time Slots V2, Bookings Writer V2, Bookings Reader V2, Services V2, Locations API, App Management APIs.
- HTTP endpoints (replace legacy HTTP functions/web methods).
- OAuth client credentials for third-party runtime auth.

**MUST NOT use (deprecated/unsupported):**
- Legacy Wix CLI for Apps — officially deprecated ("no longer receives updates or new features"). Its docs links still appear inside the live Bookings Validation pages; treat those links as doc lag (audit M1/N4).
- Bookings-scoped Calendar APIs (all deprecated except External Calendar API) and Velo `queryAvailability`.
- Custom authentication (refresh tokens) for new apps.
- Mutating Location `businessSchedule` and expecting Bookings availability effects — explicitly "Not supported by Wix Bookings".
- API keys for third-party app runtime calls (API keys are CLI/automation/admin tooling only).

## 3. Extension types used

| Extension | Role | Registration |
|---|---|---|
| `DASHBOARD_PAGE` | Rules editor, location meter/explanations | Unified CLI generate |
| `DASHBOARD_MODAL` | Confirmations (destructive applies), previews | Unified CLI generate |
| `SERVICE_PLUGIN` (Bookings Validation) | Enforcement hook create/cancel/reschedule | Unified CLI generate menu — **empirically unconfirmed (gate T-VP0)**; documented fallback: create extension in app dashboard (Extensions → Create Extension → Bookings → JSON config `deploymentUri` + `validationTargets`) and implement handlers with `bookingsValidation.provideHandlers()` from `@wix/bookings/service-plugins` |
| Data collections extension | Rule sets, exceptions, counters, audit/explain log | Interactive CLI menu (not in `generate --type` enum) |
| Event/webhook extensions | Booking lifecycle counters, billing plan webhooks | Unified CLI generate (`EVENT`) / dashboard config |
| HTTP endpoints | Dashboard↔backend transport (not registered extensions) | File-based `src/pages/api/*` |

Explicitly out of MVP: `EMBEDDED_SCRIPT`, `CUSTOM_ELEMENT`, `REACT_COMPONENT`, `SITE_PLUGIN`, `DASHBOARD_PLUGIN`/`DASHBOARD_MENU_PLUGIN` (re-evaluate only with new evidence), Bookings availability time slots configuration and booking policy service plugins (catalogued and CLI-supported, but excluded from MVP to minimize risk; revisit post-MVP), App Tools/Aria (forbidden by constitution).

## 4. Bookings data model — binding facts

1. **Services**: `APPOINTMENT | CLASS | COURSE`; each service has its own calendar schedule; `service.locations[]` (≤500) with types `BUSINESS | CUSTOM | CUSTOMER`; courses are single-location; customer locations appointments-only and unvalidated.
2. **Locations**: carry `archived` boolean (read-only), `status ACTIVE|INACTIVE` where **INACTIVE is currently not supported**, `revision`, `timeZone`. Locations can never be deleted — only archived, and archiving is permanent and does NOT change `status`. Default location cannot be archived. Liveness filter = `archived=false` (never `status`). `ListLocations` defaults `includeArchived:false`; SDK paging default limit 50 (max 1000). Update Location is a **full-object override** requiring `revision`. Our product never mutates locations.
3. **No native per-location opening hours exist for Bookings.** Verbatim: "Currently, all business locations must have the same opening hours." Location `businessSchedule` is "Not supported by Wix Bookings". The sanctioned mechanism for per-location hours is staff-level `WORKING_HOURS` events tagged per location: "You can limit staff member availability by creating different `WORKING_HOURS` events for each location with the Events API."
4. **Schedules/events**: business main schedule has external ID `4e0579a5-491e-4e70-a872-d097eed6e520`, defaulting to 5 recurring Mon–Fri 10:00–18:00 `WORKING_HOURS` MASTERs. Staff members have a working-hours schedule and an event schedule; `Assign Working Hours Schedule` is a **one-time detach** enabling custom hours. `WORKING_HOURS` events are excluded from Query Events unless filtered by type. Recurrence: `frequency=WEEKLY` only, `days` min 1 max 1 → **one weekday per MASTER; split windows require multiple MASTERs per weekday**. Updating an INSTANCE auto-creates an EXCEPTION (irreversible). Cancel Event is terminal (re-create, don't restore). MASTER `start.localDate` cannot be a past date. Create Event accepts a UUID `idempotencyKey`. Events support `location.type=BUSINESS` + business-location GUID and carry the owning `appId` (Wix Bookings = `13d21c63-b5ec-5912-8397-c3a5ddb27a97`).
5. **Bookings**: statuses `CREATED→PENDING→CONFIRMED/DECLINED/WAITING_LIST/UPDATED/CANCELED`; every booking carries `revision` (optimistic concurrency). Native double-booking protection exists (`doubleBooked` flag, manual resolution, auto-decline when unpaid) — we add rules only beyond native behavior. Multi-service bookings = 2–8 sequential single-service bookings, same location, appointments only.
6. **Availability computation**: based on service configurations, operating hours, resource availability, booking policies. Exception: staff-only appointment services derive availability from staff working hours even outside business hours. Confirmed bookings create calendar events on service + staff/resource schedules (native overlap prevention).
7. **Timezones/DST**: IANA tz database is the single source of truth; **one time zone per site** (primary address); multi-location sets always use the primary address zone. Site-tz change keeps local wall times for schedules/classes/courses; existing appointments keep original UTC. Spring-forward nonexistent times advance to next valid local time; fall-back second occurrence is not bookable. Time Slots V2 filters take **local dates + timeZone**; Query/Count Extended Bookings date filters take **UTC**. A booking remembers its booking timezone (`bookedEntity.slot.timezone`). All product day-boundary math uses the site IANA zone via a TZ library — never fixed offsets.

## 5. API surface and permission scopes

### 5.1 Reads
| API | Use | Scope (verbatim from method page) |
|---|---|---|
| Time Slots V2 `ListAvailabilityTimeSlots` / `ListEventTimeSlots` | Previews, verification | `SCOPE.DC-BOOKINGS.READ-CALENDAR` |
| Calendar V3 Query Events | Read WORKING_HOURS/blockers for snapshots & drift detection | `SCOPE.DC-CALENDAR.MANAGE` (per Create Event page family; confirm read-path scope at scaffold — see §14 Q1) |
| Services V2 `queryServices` (≤100/page) | Service/location cross-reference | `SCOPE.DC-BOOKINGS.READ-BOOKINGS-PUBLIC` |
| Locations `listLocations` (paginate; default 50, max 1000) | Billable-location set | `SCOPE.DC-MULTILOCATION.READ-LOCATIONS` |
| Bookings Reader V2 `countExtendedBookings` | Cap counters (UTC-bounded filters) | One of: `SCOPE.DC-BOOKINGS.READ-CALENDAR-WITH-PARTICIPANTS` \| `SCOPE.DC-BOOKINGS.MANAGE-BOOKINGS` \| `SCOPE.DC-BOOKINGS.READ-BOOKINGS-SENSITIVE` — **verified live 2026-08-24: no public-read option exists.** Binding choice: `SCOPE.DC-BOOKINGS.READ-CALENDAR-WITH-PARTICIPANTS` (read-only, narrowest surface of the three); `MANAGE-BOOKINGS` is a write scope and must not be requested merely for counting |
| App Management `GET /apps/v1/instance` | Plan state | `SCOPE.DC.MANAGE-YOUR-APP` |

### 5.2 Writes
| API | Use | Scope |
|---|---|---|
| Calendar V3 Create/Update/Cancel Event | Apply working-hours rules, exceptions, blockers | `SCOPE.DC-CALENDAR.MANAGE` |
| Bookings Validation service plugin | Enforcement (inbound call, no extra scope) | n/a |
| App Management webhooks (Paid Plan Purchased, Paid Plan Auto Renewal Cancelled, App Installation Updated/Created) | Billing state machine | `SCOPE.DC.MANAGE-YOUR-APP` |

**Scope hygiene rules:** never request `SCOPE.DC-MULTILOCATION.MANAGE-LOCATIONS` (we never mutate locations); never request write scopes for read-only paths; adding permissions later forces a **major** version (user action required) — freeze the scope set before first release; webhook subscription auto-adds its required scope.

### 5.3 Validation-plugin payload contract (binding for rules design)
- Called before operation persists; handler returns per-item `valid` + `InvalidReason`/`FieldViolation`; rejection text (`InvalidReason.message`, `FieldViolation.description`) is displayed to the customer; `FieldViolation.code` is programmatic only.
- Fail-closed on error/timeout: CREATE, CANCEL (+multi-service). **Fail-open: RESCHEDULE (+multi-service)** — reschedule guarantees are best-effort forever.
- Multiple providers run concurrently; any rejection/error blocks. Bulk create validates per item, cap `maxItems 12`; **omitted items default to valid** — handlers must return explicit results for every index.
- PII redaction: ALL `contactDetails` fields (firstName, lastName, email, phone, fullAddress) and resource name/email are redacted. Whether `contactDetails.contactId` survives sanitization is **UNPROVEN** (Invariant C1). Payload carries `bookedEntity.slot.{serviceId, scheduleId, eventId, startDate, endDate, timezone, resource.id, location.id (OWNER_BUSINESS only), location.locationType}` and `metadata.identity` (one-of `anonymousVisitorId`/`memberId`/`wixUserId`/`appId`).
- Respond as fast as possible (timeout ⇒ blocked create); design for cached counters and minimal reads.

## 6. Authentication & CI requirements

- **Dashboard context:** import `{ dashboard }` from `@wix/dashboard`; host manages tokens. Effective permissions = intersection(app permissions, current user role).
- **CLI apps:** token management handled by the platform; no manual Wix Client setup needed for SDK calls.
- **Elevated permissions:** backend-only elevation pattern exists (frontend → own HTTP endpoint → elevated SDK call); reserve for proven need, not MVP default.
- **HTTP endpoints have NO built-in permissions model** — "reachable by anyone who knows its URL". Every endpoint must verify the caller token (`auth.getTokenInfo()` from `@wix/essentials`; frontend calls via `httpClient.fetchWithAuth()`).
- **Webhooks:** JWT-signed with app public key; 1250 ms response deadline; up to 12 retries; duplicates and out-of-order delivery expected; dedup on envelope `id`, order via `entityEventSequence`; handlers idempotent.
- **CI:** `npm install` + unit tests + `wix build` run credential-free (official pattern). Authenticated commands (`wix dev`, `preview`, `release`, `env pull`) accept `wix login --api-key <token>`; network egress must allow `manage.wix.com` and `www.wixapis.com`. API keys are created only by account owner/co-owner in the API Keys Manager and stored as CI secrets — never committed.
- **Dev sites:** up to 5 premium dev sites; non-interactive shells must run `wix dev-site` before `wix dev`; first install consent is interactive (human-in-the-loop).
- **Release semantics:** `wix preview` does NOT register all extensions; `wix release` registers extensions and creates an app version. Minor releases auto-propagate (incl. extension changes, removing permissions); major releases (adding permissions, embedded scripts) require user update. **Service-plugin changes take effect only after release.** Pricing changes need App Market resubmission, not a version release.

## 7. Billing mechanism (binding)

- **Model:** Premium business model, exactly **4 recurring monthly plans** matching constitution tiers (USD 9.99 / 19.99 / 34.99 / 49.99). Plan names ≤23 chars ("1 Location", "2–3 Locations", "4–10 Locations", "11+ Locations" all fit); ≤4 benefits each; listing and Wix-hosted pricing page each display ≤4 plans — our four fit exactly. Feature availability identical across tiers; only managed active Bookings location count differs.
- **Plan identification:** `vendorProductId` (signed instance param + webhooks; missing/empty ⇒ free), `packageName`/`isFree`/`billing` via Get App Instance. Cancelled-until-expiry keeps identifiers; free-trial users count as paid (`isFree:false` + `freeTrialInfo.status=IN_PROGRESS`); expired-date-but-`isFree:false` ⇒ treat as PAID (dunning window). `originInstanceId`/`copiedFromTemplate` detect clones.
- **Lifecycle:** trial signup fires Paid Plan Purchased; **trial→paid conversion fires NO event** ⇒ periodic reconciliation mandatory. Auto-renewal cancellation fires immediately; user stays paid until period end. No mid-cycle downgrade path exists.
- **Upgrade entry point:** `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` opened in a new tab. Developer-side restriction is mandatory per Wix ("it's your responsibility as the developer to code behavior that limits features for certain plans") and review-tested.
- **Billable location (ratified definition):** a business location L such that (1) L exists with `archived=false` (paginated `listLocations`), and (2) at least one counted service references L in `locations[type=BUSINESS].business.id` (paginated `queryServices`). **Counted-service policy v1:** every non-hidden service counts regardless of `onlineBooking.enabled`. **Single-location floor:** computed 0 ⇒ treat as 1 (documented in UI). Distinct-set intersection prevents double counting.
- **Entitlement error posture (ratified):** fail-open on billing/counting API errors for enforcement continuity, with prominent persistent dashboard warning; never block a paying merchant's bookings due to a transient billing-API failure.
- **Over-limit behavior:** restrict rule management/enforcement coverage to the plan allowance using stable ordering (default location first, then alphabetical by location id); never delete user data; show upgrade CTA.
- **Commerce facts:** revenue share 80/20 after first 12 months at 100%, minus 2.5% transaction fee and taxes; monthly payouts, $200 minimum month; 45-day dunning; price changes affect new subscriptions only; payout account setup required before publishing a paid app; submission = Submit & Publish → automated AI review → fix blockers → repeat.

## 8. Test strategy

1. **Pure domain core:** deterministic Vitest unit tests with zero Wix imports (enforced by CI grep/lint gate). Injected clock/zone; fixed IANA fixtures including DST transitions; negative and edge cases for every rule; explainable outcomes asserted.
2. **Adapters:** in-memory fakes implementing domain ports; contract tests asserting fake↔Wix-adapter behavioral parity where feasible.
3. **Platform layer:** unit tests for token verification logic, webhook dedup/ordering/idempotency, snapshot→apply→verify→rollback orchestrator (including kill-the-power recovery), schema-drift-tolerant persistence.
4. **Dashboard:** component tests (`@testing-library/react@12` hint — pin UNVERIFIED until first scaffold), accessibility checks, validation-mirror tests importing pure domain validators.
5. **Billing:** algorithm tests covering pagination (>50 locations, >100 services), intersection dedup, archived exclusion, CUSTOM-only floor, entitlement decision table, fail-open warning signal.
6. **Deterministic CI gate:** `npm ci && npm run test:unit && wix build` (credential-free) on every cycle.
7. **Empirical dev-site gates** (§15) block production claims, not build start; they require human-owned credentials.

## 9. Destructive-write protections (mandatory gates)

Every schedule mutation path MUST implement, in order:
1. **Snapshot** affected objects (full JSON incl. `revision`): business-schedule WORKING_HOURS MASTERs, staff working-hour MASTERs, staff event schedules. Persist snapshot to the audit collection before any write.
2. **Diff-and-confirm:** UI shows exactly what will change; explicit user intent required for apply.
3. **Idempotent writes:** deterministic UUIDv5 idempotency keys derived from (site, schedule, rule-version, weekday, window); replay-safe.
4. **Revision-checked updates:** read fresh revision, pass it, retry-on-conflict with bounded attempts.
5. **Verify:** re-read mutated schedule and/or availability probe; only then mark applied.
6. **Rollback:** re-create prior MASTERs from snapshot with fresh idempotency keys on failure or user revert; document that Cancel Event is terminal and past-dated recurrence cannot be recreated (historical reconstruction is display-only).
7. **Audit log:** every mutation recorded (who/when/what/why/rollback-ref) in an app collection.
8. **Banned operations without explicit user intent + diff UX:** Update Location (full-object override), Set Service Locations (full-list replacement), Assign Working Hours Schedule (one-time detach), Cancel Event on MASTERs. MVP position: we never mutate locations at all; Set Service Locations is out of MVP scope.
9. **Disable/uninstall baseline:** with rules disabled, site availability equals pre-install baseline (gate T-RB2); no orphan mutations.

## 10. Feature classification table (final for MVP)

| # | Capability | Classification | Confidence / conditions |
|---|---|---|---|
| 1 | Different booking/opening hours by location | **STABLE_PRODUCTION** | High (docs) / Medium (semantics pending gates T-WH2, U1). Mechanism: per-location staff `WORKING_HOURS` events — mutating, so §9 gates mandatory. No native per-location hours object exists. |
| 2 | Different booking hours by service | **STABLE_PRODUCTION** | Medium-High. Native service policies (`limitEarlyBookingPolicy`, `limitLateBookingPolicy`, `bookAfterStartPolicy`) + validation-plugin windows keyed on `slot.serviceId`; classes/courses via CLASS/COURSE events. |
| 3 | Split daily windows (09–12, 14–18) | **STABLE_PRODUCTION** | Medium-High pending T-WH3 (multiple same-day MASTERs honored). |
| 4 | Date-specific exceptions, closures, holidays, overrides | **STABLE_PRODUCTION** | High. INSTANCE cancel/update→EXCEPTION, one-off/recurring OPAQUE blockers, staff vacation events. |
| 5 | Duplicate-booking protection beyond native | **STABLE_PRODUCTION (conditional)** | Medium (C1). Identity-free-first design mandatory; `contactId` unproven; T-VP3 payload probe (incl. `metadata.identity`) required before identity-keyed claims. |
| 6 | Max booking counts per day | **STABLE_PRODUCTION** | High mechanism; inherent TOCTOU under concurrent checkouts disclosed in-product (C6). |
| 7 | Max booking counts per service | **STABLE_PRODUCTION** | High. Keyed on `slot.serviceId`. |
| 8 | Max booking counts per location | **STABLE_PRODUCTION** | Medium-High. Keyed on `slot.location.id` (present for OWNER_BUSINESS locations); counts must declare included statuses (PENDING/CONFIRMED). |
| 9 | Advanced cancellation/rescheduling rules | **STABLE_PRODUCTION** for native policies; **best-effort only** for plugin-enforced reschedule | High confidence in the limitation: RESCHEDULE validation is documented fail-open. Never promise unconditional reschedule enforcement. |
| 10 | Clear preview/explanation of allowed/blocked rule | **STABLE_PRODUCTION** | High. Own dashboard UI + customer-facing rejection text. |

Supporting classifications: unified CLI architecture, dashboard extensions, data collections, HTTP endpoints, webhooks/events, Wix-managed hosting — **STABLE_PRODUCTION** (High). Bookings Validation service plugin — **STABLE_PRODUCTION per current official docs** (no Developer Preview banner found by auditor or director on 2026-08-24) with mandatory pre-release dev-site gates T-VP0–T-VP5 (Medium-High). Recurring 4-plan monetization, plan identification, upgrade URL, trials, revenue share, AI-review submission, billable-location inputs — **STABLE_PRODUCTION** (High).

**UNSUPPORTED — must not be built or advertised:** native per-location hours objects for Wix Bookings; unconditional reschedule enforcement; per-location `businessSchedule` mutation effects; hard TOCTOU-free daily caps.

**PREVIEW_GATED:** none required for the MVP. Optional shaping plugins (availability time slots configuration, booking policy) are catalogued production mechanisms but excluded from MVP scope by Director decision; if ever adopted they get feature flags. Any future Developer Preview dependency must remain flag-disabled until this contract reclassifies it with cited evidence.

## 11. Contract invariants (ratified contradiction resolutions)

- **C1 (identity):** `contactDetails.contactId` availability in validation payloads is UNPROVEN. Duplicate protection is designed identity-free-first (slot/service/location/day counting); identity keying activates only after T-VP3 proves which fields (incl. `metadata.identity`) actually arrive.
- **C2 (billing signals):** `billing.expirationDate` / webhook `expiresOn` are advisory-only (triple-sourced conflict). Primary signals: webhooks + `isFree` + `vendorProductId`/`packageName` + periodic reconciliation.
- **C3 (location connectivity):** never use `queryLocations.exists` for per-location counting (aggregate-only per schema); compute connectivity via services cross-reference.
- **C4 (schema drift):** collection-schema changes may reach installed sites only through version updates (possibly major-only per data-collections doc). Runtime must tolerate older schemas (missing fields/indexes) and reconcile lazily; never assume all sites share the latest shape.
- **C5 (counting):** paginate BOTH locations (default page 50) and services (page 100); liveness = `archived=false`; counted-service policy v1 = non-hidden services; single-location floor 0→1; fail-open entitlement errors with dashboard warning.
- **C6 (honesty):** TOCTOU residual risk for count caps disclosed in-product; reschedule enforcement labeled best-effort; capability #1 described as staff-working-hours mechanism, never as a native per-location hours object.

## 12. Product-copy constraints (banned claims)

1. No claim that Wix Bookings has (or that we provide) a native per-location business-hours object.
2. No unconditional reschedule-enforcement promises ("guaranteed reschedule blocking" is false).
3. No "100% duplicate-proof" or "hard cap" promises for counts; disclose concurrent-checkout residual risk.
4. Listing copy must describe exactly how billable locations are counted (listing/behavior mismatch is a documented rejection reason).
5. Never advertise unimplemented capabilities; declare Wix Bookings as required product in listing audience settings.

## 13. Quarantined UNVERIFIED items (must not be asserted as facts)

Resolved only at first authenticated scaffold/CI run or later cited fetch:
- UQ1 `.wix/app.config.json` dev-site selection storage; "`WIX_SITE_ID` in `.env.local` only".
- UQ2 Fully unattended `wix release --api-key` (flags exist; wording suggests prompts).
- UQ3 React 16 pin inferred from `@testing-library/react@12`.
- UQ4 Exact `wix.config.json` field set for app projects.
- UQ5 Free-trial numeric specifics (30-day cap, one trial per account) — lifecycle mechanics verified, numbers not re-fetched.
- UQ6 App Installations API details (status persistence across reinstall; `planInfo` in Updated payloads).
- UQ7 Tipalti payout onboarding mechanics (requirement itself is verified).
- UQ8 Common-rejection-reasons catalog details.
- UQ9 Whether Calendar V3 *read* methods require a scope distinct from `SCOPE.DC-CALENDAR.MANAGE` (director addition 2026-08-24; resolve at permission configuration before first release).

## 14. Open platform questions (tracked, non-blocking for build)

- Q1 Calendar V3 read-path scope (see UQ9).
- Q2 Per-location WORKING_HOURS semantics: do untagged/default staff events apply at all locations? Interaction with Assign Working Hours Schedule? (U1)
- Q3 Third-party write access to Bookings-owned schedules with `SCOPE.DC-CALENDAR.MANAGE` (documented integrator flows imply yes; ownership filtering unproven). (U2)
- Q4 Validation-plugin invocation coverage across surfaces: site widget, dashboard manual booking, direct API. (U4)
- Q5 Availability-provider exclusivity on install (`MULTIPLE_IMPLEMENTERS_FOUND`). (U5)
- Q6 Serverless execution quotas for CLI app backends; validation-plugin timeout budget (design fast: cached counters, minimal reads). (V9)
- Q7 Composition/UX when another validation provider is installed concurrently.

## 15. Empirical verification gates (dev-site; block production claims, not build)

- **T-VP0** First authenticated scaffold: record whether Bookings Validation appears in unified `wix generate` service-plugin menu; capture generated files, real `wix.config.json` fields, actual React/testing deps (resolves UQ1–UQ4). Fallback if absent: dashboard-created extension config (documented on plugin page).
- **T-VP1–T-VP5** Plugin behavior: block+message on out-of-hours create; per-day cap incl. cancel-frees-capacity; **payload-field probe first** (which `contactDetails` fields, esp. `contactId`, and which `metadata.identity` variants arrive) before duplicate-protection assertions; timeout/failure injection proving fail-closed create vs fail-open reschedule; surface coverage across widget/dashboard/API.
- **T-WH1–T-WH6** Snapshot→mutate→verify→restore on business schedule; per-location hours (U1/Q2); split-window gap; holiday closure; DST probe; idempotent replay.
- **T-BK1–T-BK4** Parallel double-book on last slot; revision-conflict retry; webhook chaos (dupes + reordering converge); count correctness vs webhook-maintained counters.
- **T-RB1–T-RB2** Kill-the-power mid-apply recovery; disable baseline equals pre-install availability.

## 16. Human-owned prerequisites (never automatable by agents)

1. Wix account authorizing the CLI; owner/co-owner for API Keys Manager.
2. One-time scaffold/bind (`npm create @wix/new@latest app`) choosing immutable namespace + code identifier → real appId.
3. One interactive dev-site install consent; dev-site pinning for automation.
4. API key created in API Keys Manager, stored as CI secret (never committed).
5. Payout account setup before publishing a paid app; Partner Program membership.
6. `wix release` approvals, pricing/listing content entry, App Market Submit & Publish, demo-account maintenance, privacy policy + ToU URLs, support email.

Until (1)–(3) occur, builders produce credential-free value: pure domain core, adapter interfaces + fakes, orchestrators, dashboard components, billing engines, and all their tests. Real extension IDs, `wix dev`, releases, and empirical gates wait for credentials.

## 17. Primary source index

Full citation lists live in the three recon reports and the audit. Load-bearing anchors (all fetched 2026-08-24):
- Unified CLI overview / quick start / project structure / generate enum / build-and-deploy / versioning / dev-site / login --api-key / cd-workflows (dev.wix.com/docs/wix-cli/**, dev.wix.com/docs/build-apps/**)
- How apps extend Wix (extension catalog incl. Bookings service plugins)
- Bookings Validation service plugin introduction + validate-before-create + extension-config + sample-flows
- Calendar integration article (business schedule `4e0579a5-…`), Events V3 object/Create Event, deprecated Bookings-calendar notice
- Staff Members sample flows (working-hours procedure), Resources V2, Services V2 object/query/about-service-locations/query-locations
- Time Slots V2 intro + ListAvailabilityTimeSlots; Bookings Writer/Reader V2 intros; Count Extended Bookings (scope triple verified live)
- Locations intro/object/list/update; About Time Zones; Webhooks about-page
- Monetization set: about-monetizing-your-app (2026-06-30), premium business model (2025-11-27), identify-and-manage-app-users, purchase lifecycle, Get App Instance, Paid Plan Purchased / Auto Renewal Cancelled, App Installations, free trials, change-app-pricing, payments FAQs, payout account
- Distribution set: submit-your-first-app-version, common rejection reasons, app market guidelines, market listings, permissions pages (2024-08-15 / 2026-07-05)

— End of contract. This document is the single source of platform truth for all lanes until formally amended.
