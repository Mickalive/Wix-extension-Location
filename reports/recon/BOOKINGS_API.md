# Wix Bookings API Reconnaissance — BOOKINGS_API.md

- **Lane:** wix-bookings-researcher (Stage 1, cycle 1)
- **Date of research:** 2026-08-24
- **Method:** All findings below were read directly from current official Wix developer documentation (`dev.wix.com/docs/...`) on 2026-08-24 unless explicitly marked otherwise. The docs portal serves a markdown mirror of every page by appending `.md` to the URL; that mirror was used for exact quoting. Where a page carried a visible publish/index date it is noted. No capability claim in this report is inferred from marketing copy.
- **Scope:** Bookings data model (services, business locations, staff/resources, calendar schedules/events, `WORKING_HOURS`), service availability and time slots, native double-booking behavior, create/cancel/reschedule operations and validation hooks, timezone/DST behavior, mutation safety, idempotency/race/destructive-write risks, and per-capability maturity classification for the 10 product capabilities in `MAIN_PROMPT.md`.

---

## 1. Current API landscape (what is current vs deprecated)

| Area | Current API | Status evidence |
|---|---|---|
| Booking writes | **Bookings Writer V2** | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/introduction.md — "create single-service bookings or multi-service bookings… manage bookings' life cycles" |
| Booking reads | **Bookings Reader V2** (Query/Count Extended Bookings) | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/introduction.md |
| Availability | **Time Slots V2** (`ListAvailabilityTimeSlots`, `ListEventTimeSlots`) | https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/introduction.md |
| Schedules & events | **Calendar V3 APIs** (stand-alone Business Management) | https://dev.wix.com/docs/api-reference/business-management/calendar/introduction.md |
| Services | **Services V2** | https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/service-object.md |
| Staff | **Staff Members API** (+ V2 read methods) | https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction.md |
| Non-staff resources | **Resources V2 / Resource Types V2** | https://dev.wix.com/docs/rest/business-solutions/bookings/resources/resources-v2/introduction.md |
| Locations | **Locations API** (Business Management) | https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md |
| Booking-time custom rules | **Bookings Validation service plugin** | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md |

**Deprecation hazard (verified):** the Bookings-scoped Calendar APIs are deprecated. From https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar/introduction.md: *"Wix has deprecated all Calendar-related APIs under Bookings, except for the External Calendar API. Use the stand-alone Calendar APIs instead."* The old Velo `queryAvailability` is likewise labeled "(Deprecated)" at https://dev.wix.com/docs/velo/apis/wix-bookings-v2/availability-calendar/query-availability. Any build must target **Calendar V3 + Time Slots V2 only**.

---

## 2. Data model as documented

### 2.1 Entities

From the terminology page (https://dev.wix.com/docs/api-reference/business-solutions/bookings/terminology.md):

- **Service** — APPOINTMENT, CLASS, or COURSE. Each service has its own calendar schedule.
- **Staff member** — has *two* schedules: a **working hours schedule** (when available to work) and an **event schedule** (blocks such as vacation). "By default, staff members work during the business hours."
- **Resource (non-staff)** — rooms/equipment; "Each resource has an event schedule"; availability of non-staff resources "depends solely on their location's business hours" (Resources V2 intro).
- **Schedule** — collection of events tied to an entity (service, staff resource); sets default values (time zone, default location, capacity) for events.
- **Event** — calendar entry; `type` ∈ {`DEFAULT`, `WORKING_HOURS`} plus Bookings types {`APPOINTMENT`, `CLASS`, `COURSE`}; `recurrenceType` ∈ {`NONE`, `MASTER`, `INSTANCE`, `EXCEPTION`}; `transparency` ∈ {`OPAQUE` (blocks), `TRANSPARENT`}.
- **Booking** — customer reservation; statuses `CREATED`, `PENDING`, `CONFIRMED`, `DECLINED`, `WAITING_LIST`, `UPDATED`, `CANCELED`; carries `revision` for optimistic concurrency.

### 2.2 Working hours are events, not fields

`WORKING_HOURS` is an **event type** on a schedule (Events V3 object: https://dev.wix.com/docs/rest/business-management/calendar/events-v3/event-object.md). Two decisive facts:

1. *"By default, `WORKING_HOURS` events aren't returned in Query Events"* — you must filter `"type": "WORKING_HOURS"` explicitly.
2. Recurrence is **weekly-only, one weekday per MASTER event**: `recurrenceRule.days` has `Min: 1 day Max: 1 day`, `frequency` supports only `WEEKLY`, `interval` 1–4 (Create Event schema). Multiple windows on the same weekday therefore require **multiple MASTER events** (e.g., Mon 09:00–12:00 and Mon 14:00–18:00 as two MASTERs).

### 2.3 The business schedule

From https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar-integration.md (search-indexed publish date 2026-04-29; accessed 2026-08-24):

> "Each business has a main schedule that defines its operating hours, identified by the external ID `4e0579a5-491e-4e70-a872-d097eed6e520`. By default, each business has 5 recurring `WORKING_HOURS` events, one for each weekday (Monday through Friday) from 10 AM to 6 PM."

Documented mutation procedures on this schedule:
- **Adjust hours:** Update Event on the MASTER event ID.
- **Add working hours:** Create Event with `"type": "WORKING_HOURS"`, `"recurrenceType": "MASTER"`, a `recurrenceRule`, `scheduleId` = business schedule ID.
- **Remove a working day:** Cancel Event on the MASTER ID.
- **Block time off:** cancel the INSTANCE (single day) or update it to shorten hours; for longer periods create a one-off blocking event on the business schedule; recurring blocks via a `DEFAULT`-type MASTER whose instances block availability.

Discovery recipe (documented): Query Events over ≥1 week with filter `externalScheduleId = 4e0579a5-491e-4e70-a872-d097eed6e520`, `type = WORKING_HOURS`; each INSTANCE exposes `recurringEventId` (its MASTER) and the shared business `scheduleId`.

### 2.4 Staff working-hours mechanics (official step-by-step)

From Staff Members sample flows (https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/sample-flows.md):

1. `Get Staff Member` with `RESOURCE_DETAILS` → save `id`, `resourceId`, `resource.eventsSchedule.id`.
2. `Assign Working Hours Schedule to Staff Member` with `staffMemberId` + `scheduleId = resource.eventsSchedule.id` — *"This one-time call detaches the staff member from the default business schedule and enables custom working hours."*
3. Query Events filtered by `externalScheduleId = resourceId`, type `WORKING_HOURS`, `recurrenceType = MASTER`.
4. Cancel Event for each existing MASTER to clear old hours.
5. Create Event per weekday: `scheduleId = eventsSchedule.id`, `type = WORKING_HOURS`, `recurrenceRule.frequency = WEEKLY`, single `days` value, `start/end.localDate` on that weekday.

Vacation/time-off blocking: create an `OPAQUE` event on the staff member's **event schedule** ("Wix Bookings treats OPAQUE events on a staff member's event schedule as unavailable time"). The example passes an `idempotencyKey` UUID.

### 2.5 Business locations

Locations API (https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md and `location-object.md`):

- Locations carry `name`, `address`, `timeZone`, `status`, `revision`, `archived`, and a rich `businessSchedule` object (weekly `periods` + `specialHourPeriod` exceptions with `isClosed`) — **but the Location object states verbatim: "Not supported by Wix Bookings."** The Locations intro repeats: *"The Wix Bookings API doesn't support the `businessSchedule` object."*
- **Update Location completely overrides the existing location** ("Currently, you can't partially update a location") — full-object destructive write; `revision` required.
- Archiving is permanent; the default location can't be archived.

Service↔location relationship (https://dev.wix.com/docs/rest/business-solutions/bookings/services/services-v2/about-service-locations.md):

- Services list locations via `service.locations[]` (types BUSINESS / CUSTOM / CUSTOMER).
- **"Currently, all business locations must have the same opening hours."**
- **"When a business has multiple business locations, each staff member is set to work at all business locations by default. You can limit staff member availability by creating different `WORKING_HOURS` events for each location with the Events API."**
- `Set Service Locations` **replaces the entire location list** and offers options for handling events scheduled at removed locations (do not use Update Service for this).

Calendar Events V3 support a `location` object with `type: BUSINESS` + a business-location GUID, so a `WORKING_HOURS` event can be tagged to a specific business location (Event object + Create Event schema).

---

## 3. How availability is actually computed

From Time Slots V2 intro (https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/introduction.md):

> Availability is based on: **service configurations** (duration, buffer), **operating hours** ("Business opening hours by default. However, if the service requires exactly one resource and that resource is a staff member, availability extends to that staff member's working hours, even if they work outside regular business hours"), **resource availability**, and **booking policies**.

The List Availability Time Slots reference adds the precise **business-hours exception**: business opening hours are disregarded when (1) ≥1 staff member needed, (2) no other resource type needed, (3) no duration-based variants, (4) no add-ons — then staff working hours drive availability.

Also from the Calendar integration article: confirmed appointment bookings create calendar events on the service schedule **and** on assigned staff/resource schedules, which is what prevents double-booking; non-staff resources' availability depends on their location's business hours.

**Consequence for this product:** the practical lever for *any* hours rule (per location, per service, split windows, holidays) is the set of `WORKING_HOURS` / blocking events on the **business schedule**, **staff working-hour schedules**, and **staff event schedules** — not any "location hours" field.

---

## 4. Time slots & availability queries

`ListAvailabilityTimeSlots` — POST `https://www.wixapis.com/_api/service-availability/v2/time-slots` (https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md):

- Filters: `serviceId` (appointments only; classes via `ListEventTimeSlots`; courses manual per end-to-end flow), `fromLocalDate`/`toLocalDate` (local, paired with `timeZone`), **`locations[]` (max 5, business-location GUIDs)**, `resourceTypes[]`, `bookable`, `bookingPolicyViolations` (`tooEarlyToBook`, `tooLateToBook`, `bookOnlineDisabled`), `customerChoices`, `timeSlotsPerDay`, cursor paging (limit ≤1000).
- Response per slot: `localStartDate/localEndDate`, `bookable`, `location`, `totalCapacity`, `remainingCapacity`, `bookableCapacity`, `bookingPolicyViolations`, `nonBookableReasons` (`noRemainingCapacity`, `violatesBookingPolicy`, `reservedForWaitingList`, `eventCancelled`), `availableResources`, `scheduleId`.
- Permission scope shown on the method: **`SCOPE.DC-BOOKINGS.READ-CALENDAR`** ("Read Bookings Calendar Availability").
- Notable error codes: `MULTIPLE_IMPLEMENTERS_FOUND` ("Multiple availability providers are installed. Only 1 provider can be active at a time.") and `NO_IMPLEMENTERS_FOUND` — evidence that an availability-provider extension point exists and provider exclusivity is enforced. Our app must not assume it can coexist with another availability provider.

---

## 5. Booking operations and native double-booking behavior

Bookings Writer V2 (https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/introduction.md):

- **Native double-booking behavior:** *"Wix Bookings prevents double bookings by default, but conflicts can occasionally occur. When they do, the system sets a booking's `doubleBooked` flag to `true` and requires the business to manually resolve the conflict."* Detection is via events; resolution options are standard (reschedule/cancel conflicted bookings) or force confirm/decline. The booking-status description adds: a booking is *"automatically declined if there is a double booking and the customer hasn't paid or is eligible for an automatic refund."*
- Docs mandate: *"Always call the Time Slots V2 API before creating bookings to ensure the requested time slot is available."*
- Lifecycle: `CREATED → PENDING → CONFIRMED / DECLINED / CANCELED`; eCommerce order sync drives automatic confirmation; `Confirm Or Decline Booking` for custom checkout.
- Multi-service bookings: 2–8 sequential single-service bookings, same location, appointments only, managed only via multi-service methods.
- Anonymous booking actions exist (token-based view/cancel/reschedule) gated by policy flags `cancellationPolicy.allowAnonymous` / `reschedulePolicy.allowAnonymous`; anonymous reschedule requires a published site.
- Every booking carries `revision`; updates/reschedules/cancels must pass the current revision (optimistic concurrency).

Webhooks (https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/booking-created.md; https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/about-webhooks.md):
- `onBookingCreated` etc. exist; webhook scopes listed include `SCOPE.DC-BOOKINGS.READ-BOOKINGS-SENSITIVE` and `SCOPE.DC-BOOKINGS.READ-CALENDAR-WITH-PARTICIPANTS`.
- Delivery contract: **1250 ms** response deadline, up to **12 retries** on failure, duplicates and out-of-order delivery are expected; envelope has unique `id` (dedup key) and `entityEventSequence` (ordering). Handlers must be idempotent.

---

## 6. Bookings Validation service plugin — production readiness

Pages read 2026-08-24:

- Introduction: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md
- Method refs: `.../validate-before-create.md`, `.../validate-before-cancel.md`, `.../validate-before-reschedule.md`
- Extension config: `.../extension-config.md`; Sample flows: `.../sample-flows.md`

**What it does:** Wix calls your HTTPS endpoint (JWT-signed payload) before persisting create/cancel/reschedule operations; you return per-item `valid` results; rejection messages (`InvalidReason.message`, `FieldViolation.description`) are displayed to the customer. Targets: `CREATE`, `CANCEL`, `RESCHEDULE`, plus `*_MULTI_SERVICE` variants. Frameworks: Wix CLI (hosted) or self-hosted SDK/REST.

**Error/timeout semantics (verbatim table from the introduction):**

| Method | On error or timeout |
|---|---|
| Validate Before Create | blocked (**fail-closed**) |
| Validate Before Cancel | blocked (**fail-closed**) |
| Validate Before Reschedule | **continues (fail-open)** |
| Validate Before Create Multi Service | blocked (fail-closed) |
| Validate Before Cancel Multi Service | blocked (fail-closed) |
| Validate Before Reschedule Multi Service | **continues (fail-open)** |

Other documented behaviors:
- Multiple providers may register for the same target; all are called concurrently; any rejection/error blocks.
- **PII redaction:** all `contactDetails` fields (firstName, lastName, email, phone, fullAddress) are redacted in the payload; resource `name`/`email` also redacted. `contactDetails.contactId` remains available — duplicate detection must key on IDs, not emails.
- Bulk create validates per item; **an omitted result is treated as valid** (our handler must always return explicit results for every item index).
- Payload includes `bookedEntity.slot.{serviceId, scheduleId, eventId, startDate, endDate, timezone, resource.id, location.id, location.locationType}` — sufficient to evaluate location/service/day-window/count rules. Example `FieldViolation.code` values include `QUOTA_EXCEEDED`, `RESCHEDULE_WINDOW_EXPIRED`.

**Maturity assessment (important, evidence-based):**
- As fetched 2026-08-24, none of the plugin pages carries a Developer Preview banner; they document full extension creation for CLI and self-hosted apps in imperative "Get started" form.
- The plugin is nonetheless **very new**: Wix's Dev Partner News announced it ~2026-04-30 (forum post https://forum.wixstudio.com/t/dev-partner-news-wix-ai-tools-data-collection-extension-booking-service-plugins-and-more/77915), and a search-engine cache of `validate-before-create` still showed Developer-Preview boilerplate ("Bug fixes and new features will be released based on developer feedback throughout the preview period"), indicating the docs were recently migrated/promoted.
- **Classification used here: STABLE_PRODUCTION per current official documentation, with a mandatory pre-release verification gate** (integration tests T-VP1..T-VP5 below must pass on a development site before any production claim ships). If the recon auditor finds a preview banner on any page, this must be downgraded to PREVIEW_GATED.

---

## 7. Timezone & DST behavior (documented)

Source: https://dev.wix.com/docs/api-reference/business-solutions/bookings/about-time-zones.md (accessed 2026-08-24).

- IANA tz database is "the single source of truth for all time zone calculations, including daylight saving time transitions."
- **One time zone per site** (site properties `timezone`). For multi-timezone location sets, "Wix Bookings always uses the primary address time zone."
- Site time-zone change: business schedules and future class/course sessions and staff working hours keep their local wall time (UTC recomputed, customers notified for class/course moves); existing appointment times keep original UTC.
- DST: recurring sessions and working hours retain local time; spring-forward nonexistent local times advance to the next valid local time; fall-back duplicated local times resolve to the first occurrence and the second occurrence is **not** bookable.
- Filtering asymmetry: Time Slots V2 takes **local dates + timeZone**; Query Extended Bookings date filters require **UTC**.
- Slot responses can be returned in a customer's time zone by passing `timeZone`; a booking permanently remembers the timezone it was booked in (`bookedEntity.slot.timezone`).

Product implication: all rule evaluation must normalize to UTC instants computed against the site IANA zone (with a TZ library), never fixed offsets; day-boundary counts ("per day") must define which zone's midnight applies (site zone is the only defensible choice).

---

## 8. Capability classification (the 10 product capabilities)

Legend: STABLE_PRODUCTION / PREVIEW_GATED / UNSUPPORTED / UNKNOWN, per MAIN_PROMPT definitions.

| # | Capability | Classification | Basis (official docs) |
|---|---|---|---|
| 1 | Different booking/opening hours **by location** | **STABLE_PRODUCTION** (mechanism documented; semantics need dev-site proof) | Native per-location opening hours do **not** exist for Bookings: Location `businessSchedule` is "Not supported by Wix Bookings", and "all business locations must have the same opening hours." The sanctioned mechanism is per-location `WORKING_HOURS` events: "You can limit staff member availability by creating different `WORKING_HOURS` events for each location with the Events API" (about-service-locations). Events accept `location.type=BUSINESS` + location GUID. This mutates staff schedules → destructive-write controls required (§10). |
| 2 | Different booking hours **by service** | **STABLE_PRODUCTION** | Classes/courses: session times are CLASS/COURSE events on the service schedule (Create Event documents `type: CLASS` with resources/location). Appointments: hours derive from staff working hours + policies; per-service windows enforceable via dedicated staff assignment, service booking policies (`limitEarlyBookingPolicy`, `limitLateBookingPolicy`, `bookAfterStartPolicy`), and/or validation-plugin window checks keyed on `slot.serviceId`. |
| 3 | Split daily windows (09–12, 14–18) | **STABLE_PRODUCTION** | Recurrence allows one weekday per MASTER event but does not limit the number of MASTER events per weekday; "Add working hours" via Create Event is documented generally. Two MASTERs per weekday (morning/afternoon) is the natural encoding. Edge case T-WH3 below must prove Wix honors multiple same-day WORKING_HOURS MASTERs. |
| 4 | Date-specific exceptions, closures, holidays, temporary overrides | **STABLE_PRODUCTION** | Explicitly documented: cancel an INSTANCE for a single-day closure; update an INSTANCE (becomes EXCEPTION) to shift/shorten; create one-off OPAQUE blocking events for longer periods; recurring DEFAULT MASTERs for recurring blocks; staff vacation via OPAQUE event on event schedule. |
| 5 | Duplicate-booking protection beyond native | **STABLE_PRODUCTION** (with §9 caveats) | Native layer already prevents resource double-booking (`doubleBooked` flag, auto-decline when unpaid). Additional rules (same contact/service/day) implementable in `validateBeforeCreate` using `contactDetails.contactId` + Count/Query Extended Bookings. Note PII redaction forbids email-keyed logic inside the plugin. |
| 6 | Max booking counts per day | **STABLE_PRODUCTION** (with race-condition caveat §11) | `validateBeforeCreate` (fail-closed) + Count Extended Bookings (UTC filters). Residual TOCTOU risk under concurrent checkouts cannot be fully eliminated platform-side; document and monitor. |
| 7 | Max booking counts per service | **STABLE_PRODUCTION** | Same mechanism keyed on `slot.serviceId`. |
| 8 | Max booking counts per location | **STABLE_PRODUCTION** | Same mechanism keyed on `slot.location.id` (present for `OWNER_BUSINESS` locations). Counts must state status inclusion (PENDING/CONFIRMED) explicitly. |
| 9 | Advanced cancellation/rescheduling rules | **STABLE_PRODUCTION for native policies; best-effort for plugin-enforced reschedule rules** | Native stable fields: `cancellationPolicy.limitLatestCancellation/latestCancellationInMinutes`, `reschedulePolicy.limitLatestReschedule/latestRescheduleInMinutes`, `cancellationFeePolicy` windows. Plugin targets CANCEL (fail-closed) and RESCHEDULE exist, **but reschedule validation is fail-open on error/timeout** — a hard guarantee is impossible under degraded conditions. Product copy must never promise unconditional reschedule enforcement. |
| 10 | Clear preview/explanation of which rule allowed/blocked | **STABLE_PRODUCTION** | Dashboard explanation UI is our own dashboard page (platform lane). Customer-facing reasons are supported: `InvalidReason.message` / `FieldViolation.description` "are displayed to the customer when validation fails"; structured `FieldViolation.code` is for programmatic use. |

**Explicitly NOT viable (do not build):**
- Mutating Location `businessSchedule` and expecting Bookings to honor it — unsupported by Wix Bookings (would silently do nothing for availability).
- A true "different business-hours-per-location" object anywhere in Bookings — does not exist today; our capability #1 is implemented through staff-level per-location `WORKING_HOURS` events and must be described honestly in UI copy.
- Hard, unconditional reschedule gating — impossible due to documented fail-open behavior.

**UNKNOWN items requiring dev-site verification (blockers for final classification confidence):**
- U1: Exact availability semantics of per-location `WORKING_HOURS` events (does a staff member need events for every location, or do untagged/default events apply everywhere? interaction with `Assign Working Hours Schedule`?).
- U2: Whether third-party-app tokens with `SCOPE.DC-CALENDAR.MANAGE` can mutate `WORKING_HOURS` MASTERs on the Wix-Bookings-owned business schedule and staff schedules (docs instruct these flows for integrators, implying yes; ownership/appId filtering behavior unproven).
- U3: Multiple same-day WORKING_HOURS MASTER events honored as split windows (T-WH3).
- U4: Validation-plugin invocation coverage across all real surfaces (site widgets, mobile, dashboard manual bookings, API-created bookings) — docs describe customer-initiated flows; dashboard/API paths need testing.
- U5: Whether an availability-provider plugin already installed on a target site blocks installation (`MULTIPLE_IMPLEMENTERS_FOUND` semantics).

---

## 9. Idempotency, rollback, permissions, races, destructive writes

### Idempotency
- `Create Event` accepts `idempotencyKey` (UUID): "guaranteeing that you don't create the same event more than once." Use deterministic UUIDv5 keys derived from (site, schedule, rule-version, weekday, window) so retries never duplicate working-hours events.
- Webhooks: dedup on envelope `id`; order via `entityEventSequence`; expect ≥12 retries and duplicates.
- Optimistic concurrency everywhere relevant: events, services, locations, bookings all expose `revision` that must be passed on update.

### Rollback / reversibility
- Before any mutation, snapshot the affected objects (full JSON incl. `revision`): business-schedule WORKING_HOURS MASTERs, staff working-hour MASTERs, service location lists.
- Irreversible/permanent operations identified: Cancel Event (status `CANCELLED` is terminal for schedules; cancelled events are not restorable via API — re-create instead), Archive Location (permanent), updating an INSTANCE (converts to EXCEPTION irreversibly), `Assign Working Hours Schedule` (one-time detach from default business schedule).
- Full-overwrite operations: Update Location (whole object), Set Service Locations (whole list). Never call them without diff-and-confirm UX.
- Rollback strategy: re-create prior MASTER events from snapshot with new idempotency keys; document that recurrence start dates cannot be in the past (Create Event: MASTER `start.localDate` can't be a past date), so historical reconstruction is display-only.

### Permissions / scopes observed
- Read availability: `SCOPE.DC-BOOKINGS.READ-CALENDAR`.
- Calendar writes: `SCOPE.DC-CALENDAR.MANAGE` (Create Event).
- Webhooks with participants: `SCOPE.DC-BOOKINGS.READ-BOOKINGS-SENSITIVE`, `SCOPE.DC-BOOKINGS.READ-CALENDAR-WITH-PARTICIPANTS`.
- Minimization plan: prefer non-sensitive reads where possible; request sensitive-participant scopes only if webhook payloads without them are insufficient for counting.

### Race conditions
- TOCTOU between count-query and booking confirmation (two concurrent checkouts can both pass `validateBeforeCreate`). Fail-closed on error helps availability, not atomicity. Mitigations: short-TTL cached counters refreshed by webhooks, conservative margins, post-create reconciliation via webhooks with owner-visible alerts. Residual risk must be stated in-product.
- Concurrent schedule mutations by merchant and app: mitigate with `revision` checks and narrow write windows.
- Multiple validation providers run concurrently; our latency budget affects checkout UX (respond fast; timeout ⇒ blocked create).

### Destructive-write risks (ranked)
1. Clearing staff working hours (Cancel Event on MASTERs) during rule application — must snapshot + restore.
2. Update Location full override — never partial-write; always send complete object from fresh read.
3. Set Service Locations full replacement — use only with explicit user intent and event-handling choice.
4. Cancelling business-schedule MASTERs to "remove a working day" — permanent; prefer EXCEPTION/shortening where reversible behavior matters.
5. Silent global effects: changing site timezone rewrites local times business-wide (out of scope for us, but must be detected and warned about if changed externally between config and apply).

---

## 10. Integration tests that would prove the behavior on a Wix development site

Setup: Wix dev site with Bookings installed, ≥2 business locations, ≥2 staff, 1 appointment service (multi-staff), 1 class service, 1 course; app installed with minimal scopes; seeded bookings.

Working hours / location rules
- **T-WH1** Snapshot→mutate→verify: change business-schedule Monday MASTER to 09:00–12:00; assert `ListAvailabilityTimeSlots` returns no bookable slots 12:00+ that Monday; restore from snapshot; assert original slots return.
- **T-WH2** Per-location hours: tag staff WORKING_HOURS MASTERs per location per docs; query availability with `locations=[A]` and `[B]`; assert different slot sets per location (validates U1).
- **T-WH3** Split windows: two MASTERs for Wednesday (09–12, 14–18); assert gap 12:00–14:00 has zero slots (validates U3).
- **T-WH4** Holiday closure: cancel next-month INSTANCE on business schedule; assert that date yields no slots; verify staff-level OPAQUE vacation event also blocks; restore.
- **T-WH5** DST probe: around the next DST transition, assert working-hours local times retained and spring-forward/fall-back slot behavior matches About Time Zones.
- **T-WH6** Idempotent replay: replay Create Event with identical `idempotencyKey`; assert exactly one event exists.

Validation plugin
- **T-VP1** Register plugin (CLI dev site); attempt out-of-hours booking; assert block + customer-visible message rendered.
- **T-VP2** Per-day cap: seed N bookings; assert N+1th blocked with `QUOTA_EXCEEDED` code path; assert cancellation frees capacity.
- **T-VP3** Duplicate: same `contactId` books same service twice same day; second blocked.
- **T-VP4** Timeout/failure injection: force handler 500/timeout on create (expect block) and on reschedule (expect pass-through — proves fail-open and bounds our guarantee claims).
- **T-VP5** Surface coverage: repeat T-VP1 from site widget, dashboard manual booking, and direct API create; record which surfaces invoke the plugin (validates U4).

Operations & concurrency
- **T-BK1** Parallel double-book attempt on last slot: exactly one confirms; other gets `doubleBooked`/decline path.
- **T-BK2** Revision conflict: stale-revision Update Event rejected; retry-with-fresh-revision succeeds.
- **T-BK3** Webhook chaos: duplicate + out-of-order `onBookingCreated/Updated/Canceled`; counters converge after dedup by `id` + `entityEventSequence`.
- **T-BK4** Count correctness: Count Extended Bookings with UTC-bounded day filter matches webhook-maintained counter within tolerance.

Migration/rollback
- **T-RB1** Kill-the-power test: terminate mid-apply of a multi-event schedule change; assert reconciler restores snapshot state exactly.
- **T-RB2** Uninstall/disable simulation: with rules disabled, site availability equals pre-install baseline (no orphan mutations).

---

## 11. Source list (all accessed 2026-08-24)

1. Terminology — https://dev.wix.com/docs/api-reference/business-solutions/bookings/terminology.md
2. About Wix Bookings — https://dev.wix.com/docs/rest/business-solutions/bookings/about-wix-bookings
3. Bookings Writer V2 intro — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/introduction.md
4. Bookings Reader V2 intro — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/introduction.md
5. Calendar APIs intro — https://dev.wix.com/docs/api-reference/business-management/calendar/introduction.md
6. Schedules V3 intro — https://dev.wix.com/docs/rest/business-management/calendar/schedules-v3/introduction.md
7. Events V3 intro — https://dev.wix.com/docs/rest/business-management/calendar/events-v3/introduction.md
8. Event V3 object — https://dev.wix.com/docs/rest/business-management/calendar/events-v3/event-object.md
9. Create Event (scopes, idempotencyKey) — https://dev.wix.com/docs/rest/business-management/calendar/events-v3/create-event.md
10. How Wix Bookings uses the Calendar APIs — https://dev.wix.com/docs/rest/business-management/calendar/wix-bookings-integration.md
11. Work with Calendar APIs to Schedule and Manage Bookings (business schedule externalId; deprecation notice; search-indexed 2026-04-29) — https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar-integration.md
12. Deprecated Bookings calendar APIs notice — https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar/introduction
13. Locations API intro — https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md
14. Location object (`businessSchedule` unsupported note) — https://dev.wix.com/docs/rest/business-management/locations/location-object.md
15. About Service Locations ("same opening hours"; per-location WORKING_HOURS) — https://dev.wix.com/docs/rest/business-solutions/bookings/services/services-v2/about-service-locations.md
16. Service V2 object (policies, availabilityConstraints, revision) — https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/service-object.md
17. Time Slots V2 intro — https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/introduction.md
18. List Availability Time Slots (locations filter, scope, errors) — https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
19. Staff Members API intro — https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction.md
20. Staff Members sample flows (working-hours procedure; vacation block) — https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/sample-flows.md
21. Resources V2 intro — https://dev.wix.com/docs/rest/business-solutions/bookings/resources/resources-v2/introduction.md
22. About Time Zones — https://dev.wix.com/docs/api-reference/business-solutions/bookings/about-time-zones.md
23. Bookings Validation service plugin introduction — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md
24. Validate Before Create — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-create.md
25. Validation plugin extension config — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/extension-config.md
26. Validation plugin sample flows — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/sample-flows.md
27. About Service Plugin Extensions — https://dev.wix.com/docs/build-apps/develop-your-app/extensions/backend-extensions/service-plugins/about-service-plugin-extensions.md
28. Booking Created webhook — https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/booking-created.md
29. About Webhooks (retry/duplication contract) — https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/about-webhooks.md
30. Dev Partner News (~2026-04-30, plugin announcement context) — https://forum.wixstudio.com/t/dev-partner-news-wix-ai-tools-data-collection-extension-booking-service-plugins-and-more/77915
31. Deprecated Velo queryAvailability label — https://dev.wix.com/docs/velo/apis/wix-bookings-v2/availability-calendar/query-availability

---

## 12. Bottom line for the Technical Contract

- The product is feasible on current, non-deprecated APIs. The center of gravity is **Calendar V3 events (`WORKING_HOURS` + OPAQUE blockers) on the business schedule and staff schedules**, plus the **Bookings Validation service plugin** for booking-time enforcement, plus **Time Slots V2** for previews and **webhooks + Count Extended Bookings** for counters.
- Capability #1 ("different hours by location") is real but is implemented through staff-level per-location `WORKING_HOURS` events — there is no native per-location hours object for Bookings, and Location `businessSchedule` must not be touched. All UI copy and sales claims must reflect this mechanism honestly.
- The validation plugin is documented without preview banners as of 2026-08-24 but shipped only months ago; treat STABLE_PRODUCTION as conditional on tests T-VP1–T-VP5 passing on a dev site, and keep a disabled-by-default feature flag around it.
- Reschedule-rule guarantees are inherently best-effort (fail-open). Native service policies remain the primary mechanism for cancellation/reschedule windows.
- Every schedule mutation path needs: snapshot → idempotency-keyed writes → revision-checked updates → verified rollback. The five destructive-write risks in §9 must become explicit gates in the build blueprint.
