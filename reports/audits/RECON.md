# RECON AUDIT — Stage 1 Wix Platform Reconnaissance

- **Auditor:** wix-recon-auditor (independent; this report replaced an earlier untrusted draft found in this path and is the only authoritative audit output of run 32686475370)
- **GitHub run:** 32686475370
- **Audit date:** 2026-08-24
- **Evidence under audit (untrusted):**
  - `/tmp/recon_platform/reports/recon/PLATFORM.md` (platform lane)
  - `/tmp/recon_bookings/reports/recon/BOOKINGS_API.md` (bookings lane)
  - `/tmp/recon_commerce/reports/recon/COMMERCE_MARKETPLACE.md` (commerce lane)
- **Accepted state audited against:** `lab/wix-rules` checkout; `docs/state.json` phase `recon`; `docs/WIX_TECHNICAL_CONTRACT.md` still placeholder (correct — nothing may be trusted before this audit).
- **Method:** Every material claim listed as VERIFIED below was re-checked directly against live official Wix documentation on 2026-08-24 by fetching the canonical pages myself (the portal's `.md` markdown mirror, whose existence each fetched page confirms in its banner). Claims are marked **VERIFIED** (I retrieved the official page and it matches), **VERIFIED WITH CORRECTION** (matches but incomplete/misleading in a way that matters), or **NOT INDEPENDENTLY VERIFIED** (not re-fetched; provisional; must not enter the contract as fact). Where official pages conflict, all conflicting URLs are listed and the resolution is stated.

---

## 1. Verdict summary of the three researcher reports

| Lane | Accuracy | Material defects found |
|---|---|---|
| Platform | High | 1 confirmed live doc-lag hazard (legacy-CLI links inside current Bookings Validation docs); 4 operational details accepted provisionally and correctly self-flagged |
| Bookings | High | 1 materially overstated claim (`contactDetails.contactId` availability) that the docs contradict or leave unresolved; otherwise faithful, including honest disclosure of the validation plugin's recency |
| Commerce | High | 2 gaps in the counting algorithm (locations not paginated; `queryLocations.exists` unusable per-location); both contradictions it flagged are real and its conservative resolutions are ratified |

No fabricated sources were found: every URL I sampled resolved to a real official page whose content matched the citation. No Developer Preview banner appears on any load-bearing page I fetched (validation plugin introduction and method refs, extension catalog, Calendar V3 Create Event, Time Slots V2, Locations, App Management, billing pages). No deprecated CLI path is recommended by any lane; the only legacy references are Wix's own stale links inside the validation-plugin page, flagged below.

---

## 2. Platform lane — verification results

### 2.1 VERIFIED (material claims)

| Claim | Official source (fetched by auditor 2026-08-24) |
|---|---|
| Legacy Wix CLI for Apps deprecated: "no longer receives updates or new features. New projects should use the unified Wix CLI" | https://dev.wix.com/docs/wix-cli/legacy-clis/legacy-wix-cli-for-apps/about-the-legacy-wix-cli-for-apps.md ; restated at https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md |
| Unified CLI is current: apps + Wix-managed headless; Astro-based; token management handled for CLI apps; serverless hosting (global CDN, automatic SSL, session middleware); up to 5 development sites (premium sites) | https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md |
| Scaffold `npm create @wix/new@latest app`; Node.js ≥ v20.11.0; app registered in Custom Apps dashboard at creation; namespace (`@prefix/suffix`) and code identifier immutable ("Once set, you can't change…"); non-interactive shells must run `wix dev-site` before `wix dev` | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/get-started/quick-start-a-wix-cli-app.md |
| Unified `wix generate --type` (apps) supports exactly: `DASHBOARD_PAGE`, `DASHBOARD_MODAL`, `DASHBOARD_PLUGIN`, `DASHBOARD_MENU_PLUGIN`, `DASHBOARD_EXTERNAL_PAGE`, `EMBEDDED_SCRIPT`, `CUSTOM_ELEMENT`, `REACT_COMPONENT`, `SITE_PLUGIN`, `EVENT`, `SERVICE_PLUGIN` (no data-collections type — that uses the interactive menu) | https://dev.wix.com/docs/wix-cli/command-reference/project-commands/generate.md |
| Extension catalog lists **Bookings validation**, **Bookings availability time slots configuration**, **Bookings booking policy** service plugins, each "CLI or self-managed"; Bookings pricing integration is "REST: Self-managed" only; Booking and Booking-Service schema plugins exist (dashboard-config); Vibe/headless sites can install only apps with exclusively dashboard extensions | https://dev.wix.com/docs/build-apps/get-started/overview/how-apps-extend-wix.md |
| Current unified-CLI service-plugin guide exists (generate menu → "Service Plugin" → pick from list); "New service plugins or changes to existing service plugins won't take affect until you've built and released your project" [sic] | https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/service-plugins/add-service-plugin-extensions.md (canonical link on page: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/service-plugins/add-service-plugin-extensions-with-the-wix-cli.md) |
| `wix preview` uploads code but does not register all extensions (embedded scripts, site widgets, site plugins unrecognized); `wix release` registers extensions and creates an app version; Node ≥ v20.11.0; release page says "follow the prompts" / "The CLI guides you through the process" | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/build-and-deploy.md |
| Versioning: minor releases auto-propagate and include adding/changing/removing extensions, webhook/event-extension changes, and removing permissions; major releases (user "Update") include adding permissions and embedded scripts; pricing changes need App Market review but no version release | https://dev.wix.com/docs/build-apps/manage-your-app/versioning/about-app-versioning.md |
| Data collections extension: created on install/update via CMS; site must have CMS (bundleable as app dependency); changes propagate up to ~5 min; **"Collection changes only affect users who update to the new major version"** | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/data-collections/add-a-data-collections-extension-with-the-wix-cli.md |
| HTTP endpoints: file-based `src/pages/api/*` → `/api/<name>`; replace legacy HTTP functions/web methods; not registered extensions; **"HTTP endpoints don't have a built-in permissions model. An endpoint is reachable by anyone who knows its URL, so enforcing access control is your responsibility."**; `httpClient.fetchWithAuth()` + Get Token Info pattern confirmed | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/http-endpoints/about-http-endpoints.md |
| `wix login --api-key <token>` "for automations and CI environments"; network egress must allow `manage.wix.com` and `www.wixapis.com` even with API key | https://dev.wix.com/docs/wix-cli/command-reference/global-commands/login.md |
| Official CI example runs `npm install` + `npm run test:unit` with no Wix credentials; `wix build` suggested as compile check | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/cd-workflows.md |
| Dashboard SDK minimum-version warning: `@wix/dashboard >= 1.3.43`, `@wix/dashboard-react >= 1.0.27`; effective permissions = intersection of app permissions and current user permissions | https://dev.wix.com/docs/sdk/host-modules/dashboard/introduction.md |

### 2.2 CONFIRMED HAZARD (platform lane was right)

**Stale legacy-CLI links inside the live Bookings Validation plugin docs.** The introduction's SDK tab links "implement a service plugin with the CLI and the SDK" to the **legacy** CLI path (`https://dev.wix.com/docs/wix-cli/legacy-clis/legacy-wix-cli-for-apps/supported-extensions/backend-extensions/service-plugins/add-service-plugin-extensions-with-the-cli.md`) and repeats that legacy link under "See also" (source: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md). Meanwhile `SERVICE_PLUGIN` is in the unified `generate --type` enum and a current unified-CLI how-to exists (§2.1). **Audit resolution:** unified-CLI support is documented; residual empirical check is whether *Bookings Validation* specifically appears in the generate menu at first scaffold (**T-VP0**). If it does not, the documented fallback is on the same plugin page's REST tab: create the extension in the app dashboard (Extensions → Create Extension → filter Bookings → JSON config with `deploymentUri` + `validationTargets`) and implement handlers via the SDK — fully supported.

### 2.3 NOT INDEPENDENTLY VERIFIED (provisional; must not enter the contract as fact)

- Dev-site selection storage (`.wix/app.config.json`, gitignored) and "`WIX_SITE_ID` in `.env.local` only" (platform §3/§7, citing the `dev-site` command reference). Plausible but not re-fetched; confirm at first CI run and do not hard-depend on the `.env.local`-only claim.
- Fully unattended `wix release --api-key`: flags exist, but build-and-deploy says "follow the prompts"/"guides you through," suggesting interactivity. Plan for human-triggered release or prove the flag path in CI.
- React 16 pin inferred from `@testing-library/react@12` in the unit-testing guide: confirm from a real scaffold's `package.json`.
- Exact `wix.config.json` field set for app projects: confirm from a real scaffold; never hand-edit regardless.

---

## 3. Bookings lane — verification results

### 3.1 VERIFIED (material claims)

| Claim | Official source (fetched by auditor 2026-08-24) |
|---|---|
| Deprecation notice verbatim: "Wix has deprecated all Calendar-related APIs under Bookings, except for the External Calendar API. Use the stand-alone Calendar APIs instead."; migration guidance includes app-ID filter `13d21c63-b5ec-5912-8397-c3a5ddb27a97` and business schedule `externalId` `4e0579a5-491e-4e70-a872-d097eed6e520` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar/introduction.md |
| Business schedule: default 5 recurring `WORKING_HOURS` MASTER events Mon–Fri 10:00–18:00; documented mutations (Update Event on MASTER; Create Event `type: WORKING_HOURS`, `recurrenceType: MASTER`, business scheduleId; Cancel Event on MASTER removes a working day; INSTANCE cancel/update or one-off/DEFAULT blocking events for time off); discovery recipe via Query Events with `externalScheduleId` + `type: WORKING_HOURS` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar-integration.md |
| "Currently, all business locations must have the same opening hours." (Business location type) and "You can limit staff member availability by creating different `WORKING_HOURS` events for each location with the Events API"; Set Service Locations replaces the entire list and offers options for events at removed locations; courses single-location; customer locations appointments-only and unvalidated | https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-locations.md |
| Location object: `businessSchedule` "**Not supported by Wix Bookings**"; archiving doesn't change `status`; `INACTIVE` currently not supported; default location can't be archived | https://dev.wix.com/docs/rest/business-management/locations/location-object.md |
| Update Location: "Overrides an existing location… Currently, it isn't possible to partially update a location. Therefore, you'll need to pass the full location object"; `revision` required; write scope `SCOPE.DC-MULTILOCATION.MANAGE-LOCATIONS` | https://dev.wix.com/docs/rest/business-management/locations/update-location.md |
| Staff working-hours flow verbatim: Get Staff Member (`RESOURCE_DETAILS`) → Assign Working Hours Schedule ("This one-time call detaches the staff member from the default business schedule and enables custom working hours") → Query Events (`externalScheduleId` = resourceId, WORKING_HOURS, MASTER) → Cancel Event each MASTER → Create Event per weekday (WEEKLY, single day); vacation = OPAQUE event on event schedule with UUID `idempotencyKey` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/sample-flows.md |
| Create Event: `idempotencyKey` must be valid UUID/GUID; recurrence `frequency` supports WEEKLY only and `days` Min 1 / Max 1 ("Currently, only a single day is supported"); MASTER `start.localDate` cannot be a past date; EXCEPTION auto-created when updating an INSTANCE; `transparency` OPAQUE default; WORKING_HOURS excluded from Query Events unless filtered; scope `SCOPE.DC-CALENDAR.MANAGE`; event `location.type=BUSINESS` + GUID supported; event `appId` identifies owning app (Bookings = `13d21c63-…`) | https://dev.wix.com/docs/rest/business-management/calendar/events-v3/create-event.md |
| ListAvailabilityTimeSlots: POST `https://www.wixapis.com/_api/service-availability/v2/time-slots`; `locations[]` filter maxItems **5**; scope `SCOPE.DC-BOOKINGS.READ-CALENDAR`; appointments only (classes via ListEventTimeSlots, courses via end-to-end flow); cursor limit ≤1000; business-hours exception verbatim (staff-only services use staff working hours); error codes `MULTIPLE_IMPLEMENTERS_FOUND` ("Multiple availability providers are installed. Only 1 provider can be active at a time.") and `NO_IMPLEMENTERS_FOUND` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md |
| Bookings Writer V2: "Wix Bookings prevents double bookings by default… sets a booking's `doubleBooked` flag to `true` and requires the business to manually resolve the conflict."; "Always call the Time Slots V2 API before creating bookings"; multi-service = 2–8 sequential single-service bookings, same location, appointments only, managed only via multi-service methods; anonymous cancel/reschedule gated by `cancellationPolicy.allowAnonymous` / `reschedulePolicy.allowAnonymous`; anonymous reschedule requires a published site | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/introduction.md |
| Validation plugin semantics: called before create/cancel/reschedule; fail-closed create/cancel (+multi-service), **fail-open reschedule (+multi-service)** (exact table verified); multiple providers concurrent, any rejection/error blocks; bulk create validates per item and omitted items default to valid; `FieldViolation.description` / `InvalidReason.message` displayed to customer; sanitization sentence verbatim: "All fields in `contactDetails` (including `firstName`, `lastName`, `email`, `phone`, and `fullAddress`) are redacted" plus resource `name`/`email` redacted; no Developer Preview banner on the page as fetched | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md |
| Validation payload schema: `bookedEntity.slot.{serviceId, scheduleId, eventId, startDate, endDate, timezone, resource.id, location.id, location.locationType}` present; `location.id` "Available only … `OWNER_BUSINESS`"; bulk items cap `maxItems 12`; example `FieldViolation.code` values include `QUOTA_EXCEEDED`, `RESCHEDULE_WINDOW_EXPIRED`; **`metadata.identity` one-of `anonymousVisitorId`/`memberId`/`wixUserId`/`appId` present** | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-create.md |
| Time zones/DST: IANA tz database single source of truth; one tz per site (primary address); site-tz-change behavior (business schedules update; class/course retain local time with notification; appointments keep original UTC); spring-forward advances to next valid local time; fall-back keeps first occurrence, second not bookable; Query Extended Bookings date filters are UTC while Time Slots V2 takes local dates + timeZone | https://dev.wix.com/docs/api-reference/business-solutions/bookings/about-time-zones.md |
| Webhook delivery: 1250 ms response deadline; up to 12 retries on a fixed schedule; duplicates and out-of-order delivery expected; dedup by storing processed event IDs; JWT signed with app public key; CLI apps consume webhooks via event extensions | https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/about-webhooks.md |
| Service booking-policy fields used by capabilities #2/#9 exist as documented: `limitEarlyBookingPolicy`, `limitLateBookingPolicy`, `bookAfterStartPolicy`, `cancellationPolicy` (incl. `latestCancellationInMinutes`, `allowAnonymous`), `reschedulePolicy` (incl. `latestRescheduleInMinutes`, `allowAnonymous`), `cancellationFeePolicy.cancellationWindows` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md (Service object schema) |

### 3.2 VERIFIED WITH CORRECTION — material

**Validation-payload identity fields (bookings §6: "`contactDetails.contactId` remains available").**
The introduction's exact wording is: *"Booking data sent to your validation method is sanitized before transmission. **All fields in `contactDetails`** (including `firstName`, `lastName`, `email`, `phone`, and `fullAddress`) **are redacted**."* The `validate-before-create` schema does define `contactDetails.contactId` ("Contact GUID"), but no page states that its value survives sanitization. "All fields … are redacted" read strictly contradicts the researcher's assertion; the parenthetical suggests an illustrative list. The docs are genuinely ambiguous. **Correction:** duplicate-booking protection keyed on `contactDetails.contactId` is **UNPROVEN**. The rules engine must support an identity-free fallback (slot/service/location/day counting), and the first dev-site test must probe which fields actually arrive — including `metadata.identity` (see §6, N1), which neither researcher reported. Do not write product copy or tests that assume `contactId`.

### 3.3 Correctly reported platform facts that constrain the product

- There is **no native per-location opening-hours object** for Wix Bookings (`businessSchedule` unsupported; "all business locations must have the same opening hours"). Capability #1 is real only through per-location staff `WORKING_HOURS` events — a **mutating** mechanism with destructive-write risk. The bookings lane's snapshot/idempotency/rollback requirements are justified by verified API semantics (Cancel Event terminality, full-object overrides, one-time schedule detach).
- Reschedule enforcement can never be unconditional (documented fail-open, verified verbatim). Any copy implying a hard reschedule guarantee is false.
- Availability-provider exclusivity (`MULTIPLE_IMPLEMENTERS_FOUND`) means coexistence with another availability provider is not guaranteed — correctly flagged (U5).

---

## 4. Commerce lane — verification results

### 4.1 VERIFIED (material claims)

| Claim | Official source (fetched by auditor 2026-08-24) |
|---|---|
| Revenue share 80/20 after first 12 months at 100%; calculated after 2.5% transaction fee and applicable sales tax; applies to users who start at Wix; monthly payouts, $200 minimum revenue-share month; details mid-following-month, funds beginning of next; refunds by Owner collaborators; 45-day dunning with retry/email every 3 days then cancellation; chargeback handling; USD primary price, exchange-rate drops passed through, never increases existing prices; Wix handles indirect taxes for Wix-billed apps | https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/payments-and-billing-faqs.md ; https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-monetizing-your-app.md |
| Developer-side plan restriction is mandatory, verbatim: "While Wix handles the billing and payment processing, it's your responsibility as the developer to code behavior that limits features for certain plans…" | https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-monetizing-your-app.md (Important block) |
| Premium model: ≥1 single/recurring paid plan; multiple plans allowed; plan name max 23 chars; up to 4 benefits; marketplace listing displays up to 4 plans (Visible toggles); Wix-hosted pricing page displays up to 4 recurring plans; usage-based/custom models require opening a ticket | https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-premium-business-model.md |
| Plan identification: `vendorProductId` (instance query param + webhooks; missing/empty ⇒ free), `packageName` (REST/SDK), `isFree`; cancelled plans keep returning identifiers until expiry; free-trial users count as paid (`isFree:false`); `originInstanceId` clone detection; upgrade entry point `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` opened in a new tab; failure to implement restriction lets unpaid users access paid features | https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users.md |
| Get App Instance: `GET https://www.wixapis.com/apps/v1/instance`, scope `SCOPE.DC.MANAGE-YOUR-APP`; `billing` only when `isFree:false` with `packageName`, `billingCycle` enum, `timeStamp`, `expirationDate` ("Available only for yearly and multi-yearly plans"), `autoRenewing`, `invoiceId`, `source`, `freeTrialInfo{status: IN_PROGRESS\|ENDED\|NOT_AVAILABLE, endDate}`; `freeTrialAvailable`; `permissions[]`; `originInstanceId`; `copiedFromTemplate`; `site.siteId`, `site.paymentCurrency` | https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance.md |
| Lifecycle: Paid Plan Purchased fires on trial signup AND on paid purchase; **"No event is triggered to indicate that a user has completed their free trial and been charged."**; Paid Plan Auto Renewal Cancelled fires immediately while user stays paid until expiry; expired-date-but-`isFree:false` ⇒ treat as paid; "You can't downgrade the user until their subscription ends" | https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/the-app-purchase-lifecycle-in-wix.md |
| App Market submission: Submit & Publish → automated AI review → dashboard blockers → fix → repeat; AI-generated blockers clear only on resubmission; appeal via support ticket; payout account setup required before publishing a paid app | https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/submit-your-first-app-version.md |
| Locations API reads for counting: `GET https://www.wixapis.com/locations/v1/locations`, scope `SCOPE.DC-MULTILOCATION.READ-LOCATIONS`, SDK `@wix/business-tools` → `locations`; `includeArchived` default **false**; SDK paging defaults `offset:0, limit:50 (Max:1000)`; `status` ACTIVE\|INACTIVE with "INACTIVE status is currently not supported"; archiving doesn't affect `status`; default can't be archived; `archived` boolean read-only | https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md |
| Services reads for counting: `POST https://www.wixapis.com/_api/bookings/v2/services/query`, scope `SCOPE.DC-BOOKINGS.READ-BOOKINGS-PUBLIC`, up to 100/page; filterable fields include `hidden`, `onlineBooking.enabled`, `type`, and **`locations.business.id`**; `service.locations[]` maxItems 500 with BUSINESS/CUSTOM/CUSTOMER types and `business.id` GUID | https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md |

### 4.2 VERIFIED WITH CORRECTION — material

**Billable-location counting algorithm (commerce §9.2) — right shape, two gaps.**
The definition (live business location with `archived=false` ∩ distinct `locations[type=BUSINESS].business.id` of counted services) uses only verified inputs. Corrections:
1. **Pagination:** the algorithm paginates services but not locations. `listLocations` SDK paging defaults to `limit: 50` (max 1000) — locations must be paginated too (https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md).
2. **Do not use `queryLocations` for per-location connectivity.** Its prose says "whether each location is connected to at least one of the site's services," but the typed response carries a single aggregate `exists` per list ("Whether at least one service matching the filter is connected to **any** of the retrieved business locations"). The commerce lane flagged this itself (§11.1); this audit confirms the contradiction is real and its resolution (compute connectivity via services cross-reference) is mandatory. https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md
3. Note the `businessLocationIds` request filter caps at 100 GUIDs (same page) — irrelevant for intersection counting, relevant if ever used as a filter.

### 4.3 Commercial validity of location-tiered pricing

Confirmed valid and, importantly, **this is the documented expected pattern, not a workaround**: Wix provides no native per-location metering or entitlement API; fixed recurring plans + developer-computed meter + developer-enforced restriction + upgrade CTAs is exactly what the official monetization docs instruct and what review tests. Four tiers fit precisely within the 4-plan display caps of both the listing and the Wix-hosted pricing page; all four target names ("1 Location", "2–3 Locations", "4–10 Locations", "11+ Locations") fit the 23-char limit. Classification: **STABLE_PRODUCTION** (High confidence).

### 4.4 NOT INDEPENDENTLY VERIFIED (provisional)

- Free-trial specifics: 30-day cap, one trial per app per Wix account, trial go-live requiring submit→approve→publish (commerce §5, citing set-up-and-manage-free-trials.md). The lifecycle mechanics I did verify (card collected at trial start, auto-charge, silent conversion) are consistent with it, but the cap/enforceability numbers were not re-fetched. Confirm before configuring trials.
- App Installations API details (`status` INSTALLED↔UNINSTALLED persistence across reinstall; `planInfo` in Updated events): plausible and useful, not re-fetched; treat as provisional until integration testing.
- Payout onboarding specifics (Tipalti flow, Manage Earnings permission): the *requirement* is verified on the submission page; the Tipalti mechanics are provisional.
- Common-rejection-reasons catalog: consistent with the verified submission page but not independently re-fetched.

---

## 5. Source conflicts and their resolution

| Conflict | Sources | Resolution (preferred) |
|---|---|---|
| `billing.expirationDate` semantics: schema says "Available only for yearly and multi-yearly plans"; identify-and-manage-app-users repeats "(yearly/multi-yearly plans only)" for both `expirationDate` and webhook `expiresOn`; the lifecycle article says monthly cycles update it to charge+30 days | https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance.md and https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users.md vs https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/the-app-purchase-lifecycle-in-wix.md | Real conflict, now triple-sourced (two pages vs one). Contract rule: rely on webhooks + `isFree`/`vendorProductId`/`packageName` as primary signals; treat `expirationDate`/`expiresOn` as advisory only. |
| `queryLocations` per-location connectivity: prose implies per-location flags; schema defines aggregate `exists` per list | https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md (prose vs schema on the same page) | Never use `exists` for per-location counts; compute via services cross-reference (§4.2). |
| Validation-plugin CLI implementation: plugin page links legacy CLI; general service-plugin docs link unified CLI; `generate --type` includes `SERVICE_PLUGIN` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md vs https://dev.wix.com/docs/wix-cli/guides/extensions/backend-extensions/service-plugins/add-service-plugin-extensions.md + https://dev.wix.com/docs/wix-cli/command-reference/project-commands/generate.md | Prefer the newer unified-CLI path; treat the legacy link as doc lag. Confirm the plugin appears in the unified generate menu at first scaffold (T-VP0); fallback is the dashboard-created extension config documented on the plugin page itself. |
| Collection-schema rollout: versioning table classifies adding/changing/removing extensions as minor (auto-propagated); data-collections how-to says "Collection changes only affect users who update to the new major version" | https://dev.wix.com/docs/build-apps/manage-your-app/versioning/about-app-versioning.md vs https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/data-collections/add-a-data-collections-extension-with-the-wix-cli.md | Assume collection-schema changes reach installed sites only through version updates and possibly only on major updates; **runtime must tolerate older collection schemas** (missing fields/indexes) and reconcile lazily. Not captured by any researcher — new audit finding (§6, M3/N6). |

---

## 6. Consolidated audit findings (mistakes & required corrections)

- **M1 (resolved hazard):** Stale legacy-CLI links in the live Bookings Validation plugin docs — confirmed by direct fetch. Mitigated by verified unified-CLI `SERVICE_PLUGIN` support; keep T-VP0 as a build gate. (§2.2)
- **M2 (material correction):** `contactDetails.contactId` availability in validation payloads is **UNPROVEN** — the intro's redaction sentence contradicts or fails to support the bookings lane's flat assertion, and the schema alone doesn't resolve sanitization behavior. Duplicate protection must be designed identity-free-first; T-VP3 amended into a payload-field probe that must also cover `metadata.identity`. (§3.2)
- **M3 (new finding, confirmed conflict):** Collection-schema rollout ambiguity (minor-vs-major propagation). Persistence layer must tolerate schema drift across installed versions; avoid assumptions that all sites share the latest collection shape. (§5, row 4)
- **M4 (correction):** Counting algorithm must paginate `listLocations` (SDK default page 50, max 1000). (§4.2)
- **M5 (confirmed contradictions, resolutions ratified):** `expirationDate`/`expiresOn` semantics (now two-pages-vs-one); `queryLocations.exists` aggregate. Both were self-flagged by researchers; their conservative resolutions are ratified and become contract rules. (§5)
- **M6 (provisional items demoted):** `.wix/app.config.json` / `WIX_SITE_ID` mechanics, unattended `wix release --api-key`, React-16 pin, `wix.config.json` app-project fields, free-trial numeric caps, App Installations API details, Tipalti specifics — plausible but not independently verified; must be confirmed from a real scaffold/CI run or later doc fetch, and must not appear in the contract as facts. (§2.3, §4.4)
- **M7 (confirmed non-issue):** No Developer Preview gating found on any load-bearing mechanism as fetched 2026-08-24. The bookings lane's conditional STABLE_PRODUCTION classification for the validation plugin, with mandatory pre-release dev-site gates T-VP1–T-VP5, is upheld.
- **M8 (deprecated-path hygiene):** The proposed stack touches no deprecated surface: Bookings-scoped Calendar APIs and Velo `queryAvailability` are avoided; Calendar V3 + Time Slots V2 + Writer/Reader V2 are current. Verified deprecation notice: https://dev.wix.com/docs/api-reference/business-solutions/bookings/calendar/introduction.md (the Velo label itself was not re-fetched; non-load-bearing since the stack never calls it).

**New audit findings (not in any researcher report):**

- **N1:** Validation payloads carry `metadata.identity` — one-of `anonymousVisitorId` / `memberId` / `wixUserId` / `appId` (verified in https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-create.md). This is a potential identity signal for duplicate protection even if `contactDetails` values are redacted; it may be `ANONYMOUS_VISITOR` for guest checkout, so it complements rather than replaces the identity-free fallback. Must be probed in T-VP3.
- **N2:** Bulk validation requests cap at `maxItems 12` items (same page) — bounds rule-evaluation batch design and error-message fan-out.
- **N3:** The `expirationDate` conflict is now triple-sourced (schema + identify-users vs lifecycle); the advisory-only rule stands on stronger ground.
- **N4:** The unified-CLI service-plugin guide confirms an interactive "select a service plugin from a list" menu; whether Bookings Validation appears there is exactly the T-VP0 empirical question, and the REST/dashboard fallback is documented on the plugin page itself.
- **N5:** The official quick-start's worked example is a Locations dashboard page calling `listLocations()` from `@wix/business-tools` — direct confirmation that our counting/dashboard pattern follows the canonical documented path (https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/get-started/quick-start-a-wix-cli-app.md).
- **N6:** Data-collections "major version"-only propagation note verified verbatim; see M3.
- **N7:** Update Location requires `SCOPE.DC-MULTILOCATION.MANAGE-LOCATIONS`; our product never mutates locations, so least-privilege means this scope must NOT be requested. Scope hygiene confirmation.

---

## 7. Capability classification (constitution list, final for contract)

Legend: classification per MAIN_PROMPT; confidence reflects documentation strength × residual empirical risk. All basis claims verified above unless noted.

| # | Capability | Classification | Confidence | Basis |
|---|---|---|---|---|
| 1 | Different booking/opening hours by location | **STABLE_PRODUCTION** | High (docs) / Medium (semantics pending U1, T-WH2) | No native per-location hours ("all business locations must have the same opening hours"; Location `businessSchedule` "Not supported by Wix Bookings"). Sanctioned mechanism: per-location staff `WORKING_HOURS` events (About Service Locations; Events V3 `location.type=BUSINESS`). Mutating → destructive-write gates mandatory. |
| 2 | Different booking hours by service | **STABLE_PRODUCTION** | Medium-High | Service policies verified in the Service object (`limitEarlyBookingPolicy`, `limitLateBookingPolicy`, `bookAfterStartPolicy`); appointment windows enforceable via validation plugin keyed on `slot.serviceId`; classes/courses via CLASS/COURSE events. |
| 3 | Split daily windows (09–12, 14–18) | **STABLE_PRODUCTION** | Medium-High (pending T-WH3) | Recurrence restricts each MASTER to one weekday (min 1/max 1 day, WEEKLY only) but does not cap MASTER count per weekday; multiple same-day MASTERs is the natural encoding and must be proven once on a dev site. |
| 4 | Date-specific exceptions, closures, holidays, temporary overrides | **STABLE_PRODUCTION** | High | Documented and verified: INSTANCE cancel/update→EXCEPTION, one-off blocking events, recurring DEFAULT MASTERs, OPAQUE staff vacation events. |
| 5 | Duplicate-booking protection beyond native | **STABLE_PRODUCTION** (conditional) | Medium (M2/N1) | Native `doubleBooked` behavior verified. Plugin-enforced extra rules possible, but identity keying (`contactId`) is unproven; identity-free fallback required; T-VP3 payload probe (including `metadata.identity`) mandatory. |
| 6 | Max booking counts per day | **STABLE_PRODUCTION** | High mechanism / inherent TOCTOU disclosed | `validateBeforeCreate` fail-closed + Count/Query Extended Bookings (UTC filters). Residual race under concurrent checkouts cannot be eliminated platform-side; must be stated in-product. |
| 7 | Max booking counts per service | **STABLE_PRODUCTION** | High | Same mechanism keyed on `slot.serviceId`. |
| 8 | Max booking counts per location | **STABLE_PRODUCTION** | Medium-High | Keyed on `slot.location.id` — verified present, "Available only … `OWNER_BUSINESS`". Counts must declare included statuses (PENDING/CONFIRMED). |
| 9 | Advanced cancellation/rescheduling rules | **STABLE_PRODUCTION** for native policies; **best-effort only** for plugin-enforced reschedule | High (on the limitation) | Native policy fields verified. Plugin CANCEL is fail-closed; RESCHEDULE is documented fail-open — unconditional reschedule guarantees are impossible and must never be promised. |
| 10 | Clear preview/explanation of allowed/blocked rule | **STABLE_PRODUCTION** | High | Dashboard page/modal extensions verified; customer-facing rejection text (`InvalidReason.message`, `FieldViolation.description`) verified as displayed to customers. |

Supporting platform/billing classifications: unified CLI app architecture, dashboard extensions, data collections persistence, HTTP endpoints, event/webhook handling, Wix-managed hosting — **STABLE_PRODUCTION** (High). Bookings Validation service plugin — **STABLE_PRODUCTION per current official docs** with mandatory pre-release dev-site gates (Medium-High). Availability time slots configuration and booking policy plugins — present and CLI-supported in the official catalog (fitness decision deferred to build; optional). Recurring 4-plan monetization, plan identification, upgrade URL, revenue share/payouts, AI-review submission — **STABLE_PRODUCTION** (High). Wix-managed free trials — STABLE_PRODUCTION in principle (numeric caps provisional per §4.4). No capability requires PREVIEW_GATED classification on today's evidence; none is UNSUPPORTED for the MVP as scoped. Explicitly UNSUPPORTED and must not be built or advertised: native per-location hours objects for Bookings; unconditional reschedule enforcement.

---

## 8. Mandatory empirical gates (dev-site; block production claims, not build start)

Carried from the bookings/platform lanes, ratified, with amendments:

- **T-VP0 (first integration task):** scaffold with `npm create @wix/new@latest app`; record whether Bookings Validation appears in the unified `wix generate` service-plugin menu; record actual generated files and `wix.config.json` fields (also resolves §2.3 items).
- **T-VP1–T-VP5:** as specified in BOOKINGS_API.md §10, with T-VP3 amended to first **probe which `contactDetails` fields (esp. `contactId`) and which `metadata.identity` variants actually arrive** before asserting duplicate-protection behavior.
- **T-WH1–T-WH6, T-BK1–T-BK4, T-RB1–T-RB2:** as specified (schedule mutation safety, split windows, DST, idempotent replay, revision conflicts, webhook chaos, kill-the-power, uninstall baseline).
- **U1–U5 unknowns:** per-location WORKING_HOURS semantics; third-party write access to Bookings-owned schedules (documented integrator flows and app-ID filtering imply yes; ownership filtering unproven); multiple same-day MASTERs; validation-plugin surface coverage (widget/dashboard/API); availability-provider exclusivity on install.

These gates require human-owned prerequisites (Wix account, scaffold/bind producing real appId/namespace/code identifier, dev-site install consent, CI API key). Until then, credential-free work (pure domain core, unit tests, extension scaffolds without real IDs) may proceed; no production-capability claim may ship before the gates pass.

---

## 9. Human-owned prerequisites (ratified minimum set)

1. Wix account able to authorize the CLI; owner/co-owner for API Keys Manager (https://dev.wix.com/docs/wix-cli/command-reference/global-commands/login.md).
2. One-time scaffold/bind (`npm create @wix/new@latest app`) choosing immutable namespace + code identifier (quick-start, verified).
3. One interactive dev-site install consent; dev-site pinning for automation (mechanism provisional per §2.3).
4. API key stored as CI secret — never committed.
5. Payout account setup before any paid app publishes (requirement verified on https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/submit-your-first-app-version.md; onboarding specifics provisional).
6. `wix release` approvals, App Market Submit & Publish, pricing/listing content entry, demo-account maintenance — never automated.

---

## 10. Directive to the recon director

The three reports are accepted as substantially accurate with the corrections in §6. Before advancing `docs/state.json.phase` to `build`, the director must fold into `docs/WIX_TECHNICAL_CONTRACT.md` and `docs/BUILD_BLUEPRINT.md`:

1. The §7 capability table verbatim (classifications + confidence + gates).
2. M2/N1: duplicate protection designed identity-free-first; `contactId` treated as unproven until T-VP3 probes the payload (including `metadata.identity`).
3. M3/N6: persistence tolerance for collection-schema drift across installed versions.
4. M4: paginated location counting (SDK default page 50); counted-service policy decision (recommend: all non-hidden services; document the single-location floor for CUSTOM-only businesses); fail-open vs fail-closed entitlement-error posture decision (commerce recommends fail-open for enforcement continuity with prominent dashboard warning — director must ratify).
5. M5: `expirationDate`/`exists` handling rules as contract invariants.
6. Explicit product-copy bans: no "different business hours per location object" claims (mechanism is staff working-hours based); no unconditional reschedule-enforcement promises; TOCTOU residual-risk disclosure for daily caps.
7. T-VP0 as the first integration-lane task, with the dashboard-created-extension fallback documented.
8. Quarantine list: §2.3 and §4.4 provisional items must be labeled UNVERIFIED in the contract and resolved at first scaffold/CI run — never asserted as facts.

---

## 11. Verdict

**PASS_WITH_BLOCKERS**

The reconnaissance is trustworthy in substance: every load-bearing architectural claim survived independent verification against current official documentation, no deprecated path is recommended, no Developer Preview capability is presented as production, and the monetization/entitlement model is the documented Wix pattern. The blockers below are narrow, concrete, and resolvable by the director before build starts; none requires new research beyond a first authenticated scaffold.

**Exact blockers the recon director must resolve before build may start:**

1. **B1 — Contract correction (M2/N1):** Reclassify `contactDetails.contactId` availability in validation payloads as UNPROVEN; duplicate-protection design must carry an identity-free fallback; amend T-VP3 into a payload-field probe covering `metadata.identity`. Current researcher text asserts `contactId` availability as fact — this must not enter the contract.
2. **B2 — Contract invariants from confirmed contradictions (M5):** codify (a) `billing.expirationDate`/webhook `expiresOn` as advisory-only signals with webhook+`isFree`+plan-ID primacy, and (b) prohibition on using `queryLocations.exists` for per-location counting.
3. **B3 — Counting algorithm sign-off (M4):** approve the corrected billable-location algorithm (paginated locations + paginated services, `archived=false` ∩ BUSINESS service references), the counted-service policy, the 0→1 single-location floor, and the fail-open/fail-closed entitlement-error posture.
4. **B4 — Schema-drift tolerance (M3/N6):** require the persistence layer to tolerate older collection schemas on installed sites and specify reconciliation behavior.
5. **B5 — Empirical gate ordering (M1/N4):** insert T-VP0 (unified-CLI service-plugin generation check + scaffold identifier capture) as the first build-cycle task, with the documented fallback (extension creation in the app dashboard + SDK handlers) if the menu lacks the Bookings Validation plugin.
6. **B6 — Copy constraints:** encode the marketing/UI language bans (no native per-location-hours claims; no unconditional reschedule guarantees; TOCTOU residual-risk disclosure for daily caps).
7. **B7 — Provisional-items quarantine (M6):** mark §2.3/§4.4 items UNVERIFIED in the contract and gate them on first scaffold/CI evidence; they must not be restated as facts anywhere in accepted docs.

— End of audit. This report is the only artifact produced by this audit run.
