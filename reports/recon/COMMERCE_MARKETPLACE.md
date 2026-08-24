# RECON REPORT — Commerce / Marketplace Lane

- **Lane:** wix-commerce-researcher (Stage 1, cycle 1)
- **Date of research:** 2026-08-24 (all sources retrieved live on this date unless a page displays its own publication date, noted inline)
- **Scope:** Wix App Market monetization and operations: pricing plans, instance/plan identification, revenue share, payment handling, trials, upgrades, listing/review requirements, permissions/scopes, billable-location entitlement feasibility, human-owned prerequisites.
- **Method:** Official Wix developer documentation only (`dev.wix.com/docs/**`). The docs portal exposes markdown via `.md` URL suffix (stated in portal navigation banner). No community/forum evidence is used for capability claims.
- **Constitution compliance:** This report makes no product-code decisions. Every capability claim below carries an official source URL. Claims that could not be fully confirmed from official docs are explicitly marked as assumptions/open items in §11.

---

## 0. Verdict summary

| # | Question | Verdict | Confidence |
|---|----------|---------|------------|
| 1 | Recurring paid plans supported? | YES — monthly and/or yearly recurring billing models, Wix-managed checkout | High (official) |
| 2 | How many plans can we define? | Multiple plans per app; marketplace listing and Wix-hosted pricing page each display up to 4 plans | High (official) |
| 3 | Can we identify which plan a site purchased? | YES — `vendorProductId` (instance JWT/webhooks), `packageName` + `isFree` + `billing` object (Get App Instance REST/SDK) | High (official) |
| 4 | Revenue share | 80/20 (developer keeps 80%) after first 12 months at 100%; minus 2.5% transaction fee and applicable sales tax; $200 minimum monthly payout | High (official) |
| 5 | Who handles payments? | Wix (Wix Billing System). Developer must never build external purchase flows or license keys | High (official) |
| 6 | Free trials | YES — Wix-managed trial up to 30 days for recurring plans; one trial per app per Wix account | High (official) |
| 7 | Upgrade flow | Standard upgrade URL `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>`; plan enforcement is the developer's responsibility | High (official) |
| 8 | Location-count-based tiers technically valid? | YES — but only as self-enforced entitlements mapped to fixed plans. Wix provides no native metered/per-location billing primitive; developer-side restriction logic is explicitly required by Wix | High (official), mechanism Low→Medium until empirically verified (§11) |
| 9 | Clean billable-location definition available from official APIs? | YES — ACTIVE (non-archived) business location connected to ≥1 Bookings service, computed via Locations API ∩ Bookings Services API | Medium-High |
| 10 | Marketplace review | Automated AI review with dashboard blockers; iterate until pass; detailed guidelines exist | High (official) |

---

## 1. Monetization architecture

### 1.1 Business models and billing models

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-pricing-plans-and-business-models.md (accessed 2026-08-24)

Billing models supported per pricing plan:
- **Free** — installable at no charge.
- **Single** — one-time upfront fee per usage/service. Cannot be shown in App Market listing or Wix-hosted pricing page.
- **Recurring (monthly and/or yearly)** — stable recurring fee; yearly discount optional.
- **Usage-based (monthly)** — variable monthly fee. Requires separate App Market approval.
- **Custom** — variable immediate fees. Requires separate App Market approval.

Business models (determine App Market label):
- **Free**, **Freemium** (free plan + ≥1 paid plan), **Premium** (paid plans only, no free plan), **Custom billing** (approval required).

Combination rules: recurring+single plans (with or without free plan) are allowed; usage-based cannot be combined with recurring.

Labels applied by Wix: "Free Plan Available", "Free to Install", "From <lowest price>", "From <lowest price>/month".

### 1.2 Plan setup constraints

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-premium-business-model.md (page shows Published: 2025-11-27)

- A premium business model = at least one single and/or recurring paid plan.
- Multiple paid plans allowed, each with own features/benefits.
- **Plan name max 23 characters.**
- **Up to 4 benefits per plan** (or paragraph form).
- **Marketplace listing displays up to 4 plans** (via Visible toggles); extra plans require an external pricing page.
- **Wix-hosted pricing page displays up to 4 recurring plans** with a benefits table and monthly/yearly toggle; one plan can be marked "POPULAR".

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-wix-pricing-page.md (accessed 2026-08-24)

### 1.3 Fit to our target tiers

The constitution's four tiers (USD 9.99 / 19.99 / 34.99 / 49.99 per month, differentiated only by managed active Bookings locations):

- Map exactly onto **one app with Premium business model + 4 recurring plans** — precisely at the 4-plan display limit of both the listing and the Wix pricing page. No external pricing page needed.
- Plan names must fit 23 chars: e.g. "1 Location", "2–3 Locations", "4–10 Locations", "11+ Locations" all fit.
- Benefits text should express the location-count allowance (e.g., "Up to 3 active locations").
- Alternative: Freemium (free plan limited to 1 location + 3 paid tiers) would consume one of the 4 visible slots and change the label to "Free Plan Available". This is a Director/human commercial decision; both are officially supported. Note the constitution says "All paying plans expose the same product features" — it does not mandate a free tier.
- Usage-based billing (per active location per month) exists but requires separate App Market approval and adds operational complexity; not recommended for launch.

---

## 2. Instance and plan identification

### 2.1 Core identifiers

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users.md (accessed 2026-08-24)

- **`instanceId`** — unique ID of our app on a specific site; available in all contexts.
- **`vendorProductId`** — the purchased plan's ID (as displayed in our app dashboard); present in the signed app-instance query parameter and webhook payloads; **empty/missing ⇒ free plan**.
- **`packageName`** — same plan identifier, returned by Get App Instance REST/SDK.
- **`isFree`** — boolean from Get App Instance; `true` ⇒ free version installed.
- Cancelled-but-not-yet-expired subscriptions **keep returning** `vendorProductId`/`packageName` until expiry.
- Users on free trials count as paid (`isFree: false`).
- **`originInstanceId`** — present when the site was cloned/duplicated from another site that had our app; detects cloned installations.
- Wix's explicit instruction: *"You're responsible for adding entry points to the pricing page"* and implementing restriction logic; failure to do so lets unpaid users access paid features (review tests this).

### 2.2 Get App Instance REST API

Source: https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance.md (accessed 2026-08-24)

- `GET https://www.wixapis.com/apps/v1/instance`, authenticated as the app (OAuth client credentials with appId+appSecret+instanceId).
- Permission scope: `SCOPE.DC.MANAGE-YOUR-APP` ("Manage Your App").
- Response highlights:
  - `instance.isFree`, `instance.billing` (only when `isFree:false`) containing `packageName`, `billingCycle` (enum incl. MONTHLY/YEARLY/ONE_TIME), `timeStamp`, `expirationDate`, `autoRenewing`, `invoiceId`, `source` (coupon info), `freeTrialInfo {status: IN_PROGRESS|ENDED|NOT_AVAILABLE, endDate}`.
  - `instance.freeTrialAvailable` — whether this instance can still start a trial.
  - `instance.permissions[]` — scopes granted.
  - `instance.originInstanceId`, `instance.copiedFromTemplate`.
  - `site.siteId`, `site.paymentCurrency`, `site.installedWixApps[]` (Wix-made apps only).
- ⚠️ Schema note: `expirationDate` description says "Available only for yearly and multi-yearly plans", while the lifecycle article describes monthly expiration updates too — see contradiction §11.2.

### 2.3 Signed instance parameter (iframes/dashboard)

Source: https://dev.wix.com/docs/build-apps/build-your-app/app-instance/identify-users-app-instance (accessed 2026-08-24)

- Signed `instance` query param (JWT) contains `instanceId`, `uid`, `permissions`, `siteOwnerId`, `vendorProductId` (only if upgraded), `originInstanceId`, `signDate`. Must be signature-verified with the app public key.
- REST/SDK Get App Instance is user-context-independent; prefer it for authoritative plan state.

---

## 3. Purchase lifecycle, webhooks, and state changes

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/the-app-purchase-lifecycle-in-wix.md (accessed 2026-08-24)

Lifecycle stages and signals:

| Event | Webhook | Get App Instance signal | Instance JWT signal |
|---|---|---|---|
| Installation | App Instance Installed | `isFree: true` | no `vendorProductId` |
| Upgrade (with or without free-trial signup) | **Paid Plan Purchased** | `isFree: false`; `billing.freeTrialInfo` during trial; `expirationDate` set after real charge | `vendorProductId` present |
| Trial converts to paid | **NO event fired** | `expirationDate` updated post-charge | unchanged |
| Auto-renewal cancelled | Paid Plan Auto Renewal Cancelled (immediate) | still paid until period ends | unchanged until expiry |
| Plan/trial expires | none | `isFree: true` again | `vendorProductId` gone |
| Expired date passed but `isFree:false` | none | treat as PAID (owner has a billing issue; dunning in progress) | n/a |

Key webhooks (all under App Management, scope `SCOPE.DC.MANAGE-YOUR-APP`):

- **Paid Plan Purchased** — payload: `operationTimeStamp`, `vendorProductId`, `cycle` (MONTHLY/YEARLY/ONE_TIME/…), `expiresOn`, `couponName`, `invoiceId`. Source: https://dev.wix.com/docs/api-reference/app-management/app-instance/paid-plan-purchased.md
- **Paid Plan Auto Renewal Cancelled** — payload includes `cancelReason` (`USER_CANCEL`, `FAILED_PAYMENT`, …), `userReason`, `subscriptionCancellationType` (example value `AT_END_OF_PERIOD`), `cancelledDuringFreeTrial`. User keeps access until end of cycle. Source: https://dev.wix.com/docs/api-reference/app-management/app-instance/paid-plan-auto-renewal-cancelled.md
- **App Instance Installed / App Instance Removed** — install/uninstall notifications. Source: https://dev.wix.com/docs/build-apps/develop-your-app/api-integrations/events-and-webhooks/about-events.md

### 3.1 App Installations API (modern reconciliation channel)

Sources:
- https://dev.wix.com/docs/api-reference/app-management/app-installations/introduction.md
- https://dev.wix.com/docs/api-reference/app-management/app-installations/app-installation-updated.md
- https://dev.wix.com/docs/api-reference/app-management/app-installations/sample-flows.md (all accessed 2026-08-24)

- An **App Installation** record persists across uninstall/reinstall; `instanceId` is stable; `status` flips `INSTALLED` ↔ `UNINSTALLED`.
- **App Installation Updated** fires on *any* field change, explicitly including **plan changes**, site info changes, and reviews. Payload includes `planInfo { planName, planStatus: UPGRADED|CANCELED|AUTO_RENEW_OFF, cycleType: ONE_TIME|RECURRING, cycleDuration, freeTrialInfo, endDate }` and `status`.
- Uninstall is NOT a separate event: subscribe to Updated and filter `status == UNINSTALLED`.
- Recommended pattern (official sample flow): subscribe to Created + Updated, and periodically **Query App Installations** to reconcile backend state against source of truth.

This gives us a clean server-side mirror of plan state without scraping: webhooks (Purchased / AutoRenewalCancelled / InstallationUpdated) + periodic Get App Instance / Query App Installations reconciliation.

---

## 4. Revenue share, payment handling, payouts

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/payments-and-billing-faqs.md (accessed 2026-08-24); https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-monetizing-your-app (page shows Published: 2026-06-30)

- **Revenue share: 80/20 — developer keeps 80%, Wix keeps 20%.** First 12 months on the platform: developer keeps **100%**. Calculated after a **2.5% transaction fee** and applicable sales tax. Applies to users who start at Wix (not already paying elsewhere).
- **Payouts:** monthly, minimum **$200** revenue share in the month; details mid-following-month, funds at beginning of the next (net ~30 EOM). Payouts dashboard updated daily (UTC).
- **Payment processing:** entirely Wix-side ("We handle payments"). Apps collecting money **must implement the Wix Billing System** (guidelines §Payment and pricing). External/partner billing exists but requires setup as a Partner Billed App and revenue reporting — not applicable if we use Wix billing.
- **Failed payments:** 45-day dunning grace period; retry + email every 3 days; after 45 days the package is cancelled. During dunning the instance may still report paid (see lifecycle rule above).
- **Refunds:** developer-issued from the app dashboard (Owner collaborators only).
- **Chargebacks:** Wix auto-reverses where possible; otherwise charged back in payout data.
- **Currency/taxes:** primary price set in USD; Wix computes local-currency prices; exchange-rate changes never raise existing users' prices; Wix handles indirect taxes for Wix-billed apps.
- **Price changes:** changes apply only to NEW subscriptions; active subscriptions keep original price (source: change-app-pricing, §6). Grandfathering rule also in guidelines: users who paid must retain access to functionality they paid for.

Payout onboarding (human): see §10.4.

---

## 5. Free trials

Source: https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-and-manage-free-trials.md (accessed 2026-08-24)

- **Wix-managed trials** (our case: recurring plans on Wix billing): configured in Pricing page of app dashboard, **up to 30 days**; Wix collects card at trial start; Wix emails user on start/cancel/end; auto-charges at end; user can cancel anytime from Wix subscriptions page.
- Trial signup triggers **Paid Plan Purchased**; conversion-to-paid triggers **nothing** (poll `billing.freeTrialInfo.status` / `expirationDate`).
- Cancellation during trial triggers **Paid Plan Auto Renewal Cancelled** with `cancelledDuringFreeTrial: DURING_FREE_TRIAL`.
- Detection fields: `isFree:false`, `billing.freeTrialInfo{status,endDate}`, `freeTrialAvailable`.
- **One trial per app per Wix account** (ever). Testing a trial consumes eligibility for that account+app.
- Trial availability goes live only after submit→approve→publish of a new app version.
- Self-managed trials (up to 99 days) exist only for external-billing/usage/single-purchase apps — not our case.
- Blocks-specific caveat: decoded instance lacks trial fields; use REST/SDK instance (we will not be a Blocks app, but noted).

Launch recommendation (for Director): a 7–14 day Wix-managed trial on all four plans is officially supported and removes the need for a free tier while satisfying "try before buy".

---

## 6. Upgrades, downgrades, pricing changes

Sources:
- https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/change-app-pricing.md (accessed 2026-08-24)
- https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/the-app-purchase-lifecycle-in-wix.md
- https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-wix-pricing-page.md

- **Upgrade entry point (required):** all Upgrade CTAs must open `https://www.wix.com/apps/upgrade/<APP_ID>?appInstanceId=<INSTANCE_ID>` in a new tab (works for both Wix-hosted pricing page and trial start).
- **No Wix-native downgrade path:** the lifecycle doc states you can't move a user to a lower plan until their subscription ends. Practically: downgrades happen by non-renewal (auto-renew off → expire → revert to free) then re-purchase at desired tier. Our entitlement logic must therefore handle: paid-tier-A site whose location count exceeds tier A (over-limit), and paid sites reverting to free.
- **Editing published prices:** allowed any time since 2025-08-06 (30-day notice abolished); affects new subscriptions only; hide retired plans via the **Visible toggle instead of deleting** (deletion risks breaking existing subscribers).
- **Coupons/sales:** developer coupons and storewide sales supported (coupon name appears in webhook payload and `billing.source`).

---

## 7. Listing and review requirements

### 7.1 Submission mechanics

Source: https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/submit-your-first-app-version.md (accessed 2026-08-24)

- Submission = click **Submit & Publish** in the app dashboard → **automated AI review** runs → blockers appear in dashboard if checks fail → fix → resubmit (repeat until live). Appeal via support ticket.
- Pre-submission checklist (official): test thoroughly incl. edge cases; graceful error handling; pricing+billing set up AND plan-restriction logic implemented; payout account complete (blocker for paid apps); guidelines compliance; listing fields/assets complete; Wix even publishes an official review-prep skill: https://github.com/wix/skills/blob/main/skills/wix-app/references/APP_MARKET_REVIEW.md
- Profile changes must be **released as a version** (status "Released", not Draft) before submission.

### 7.2 Common rejection reasons (directly relevant to us)

Source: https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/common-reasons-for-app-rejection.md (accessed 2026-08-24)

- Bugs preventing core functionality; listing/behavior mismatch (don't advertise unimplemented features); unclear UX/onboarding; bad profile media; broken demo site (demo site required when app has visual site component — ours is dashboard-only, so a demo site is likely optional but recommended); audience/required-products misconfiguration (**we must declare Wix Bookings as required product so only compatible sites can install**); pricing page incomplete; **premium upgrade flow failures** (no upgrade CTA; free users reaching paid features; app not recognizing upgrades; owner-facing messages leaking to live site); installation failures; unreleased profile version.

### 7.3 Guidelines with direct impact on our design

Source: https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines.md (accessed 2026-08-24)

- All money collection via **Wix Billing System**; no external purchase CTAs; **no license keys/QR unlock mechanisms** — plan enforcement must use the documented instance/plan identification.
- Price increases apply to new users only; existing payers keep what they paid for.
- Provide an active **demo account + login** for reviewers; keep it alive while listed; explain subtle features (e.g., our location-count metering) in App Review notes.
- Active, monitored **support email**; support free and paying users for the app's lifetime; clear in-app Wix-specific instructions.
- Required legal assets: **privacy policy + Terms of Use links**; GDPR/cookie-consent compliance; security best practices (HTTPS, CSRF/XSS protection, secure secrets, verify identity via instance ID).
- Least privilege: "Never ask for more permissions than the ones required".
- Dashboard apps must be full-screen-capable (≥1200px width, responsive); fast load (≈400ms startup target); no browser-native popups except OAuth; UTF-8; accessibility.
- Basic setup features must be free (color/font/text customization, SEO, accessibility, security, GDPR settings) — n/a for a rules engine but keep in mind for any settings UI.

### 7.4 Listing components

Source: https://dev.wix.com/docs/build-apps/launch-your-app/market-listing/about-market-listings.md (accessed 2026-08-24)

Name, icon, teaser, full description, images/video, availability (countries/languages), keywords. Sub-pages cover app info, media specs, get-found info, audience info (required products), company info, dependencies.

---

## 8. Permissions / scopes

Sources:
- https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/about-permissions.md (page shows Published: 2024-08-15)
- https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/configure-permissions-for-your-app.md (page shows Published: 2026-07-05)
- https://dev.wix.com/docs/build-apps/develop-your-app/access/authentication/authenticate-using-oauth.md (accessed 2026-08-24)

- Scopes are declared in the app dashboard **Permissions** page; site owners approve them in the install consent screen; tokens carry exactly those scopes. Each REST/SDK method documents its required scopes under "Permission Scopes".
- **Market rule:** apps requesting unnecessary or redundant permissions are rejected.
- Webhook subscription auto-adds the single required scope, or prompts selection when multiple scopes qualify.
- Authentication for third-party apps = OAuth client credentials (`oauth2/token` with appId+appSecret+instanceId; token TTL ≈ 4h). Custom authentication (refresh tokens) is **deprecated** for new apps. CLI/Blocks apps handle auth automatically. API keys are NOT available to third-party apps.

Minimum scope set identified for our product (from the individual API pages cited in §9/§2):

| Scope | Used for |
|---|---|
| `SCOPE.DC.MANAGE-YOUR-APP` | Get App Instance; app-management webhooks (install/uninstall/paid-plan events) |
| `SCOPE.DC-BOOKINGS.READ-BOOKINGS-PUBLIC` | Query Services, Query Locations (Bookings v2) — reading services + their business-location connections |
| `SCOPE.DC-MULTILOCATION.READ-LOCATIONS` | List/Query Locations (Locations API) — active business locations |

Plus whatever write-scope the chosen booking-validation/mutation mechanism requires — that determination belongs to the bookings/platform lanes, not this report. Read-only counting needs only the three scopes above.

---

## 9. Billable-location entitlement feasibility (core question)

### 9.1 Data sources (official)

**(a) Locations API (business tools)** — https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md ; https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md (both accessed 2026-08-24)

- `GET https://www.wixapis.com/locations/v1/locations` (+ `POST .../query` variant), scope `SCOPE.DC-MULTILOCATION.READ-LOCATIONS`, SDK module `@wix/business-tools` → `locations`.
- Location object: `id`, `name`, `default` (single default per site; **default cannot be archived**), `status` enum `ACTIVE|INACTIVE` (**INACTIVE currently not supported**), **`archived: boolean`**, `revision`, `timeZone`, `address`, `businessSchedule` (**explicitly "Not supported by Wix Bookings"**).
- **Locations cannot be deleted — only archived; archiving is permanent and irreversible.** Archiving does NOT change `status` (an archived location still reads `status: ACTIVE`).
- `ListLocations` takes `includeArchived` (default **false**) → default responses exclude archived locations. The correct liveness filter is `archived=false` (NOT `status`).

**(b) Bookings Services v2** — https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md ; https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-locations.md (both accessed 2026-08-24)

- `POST https://www.wixapis.com/_api/bookings/v2/services/query`, scope `SCOPE.DC-BOOKINGS.READ-BOOKINGS-PUBLIC`; page size ≤100; filterable fields include **`hidden`**, **`onlineBooking.enabled`**, **`type`**, and **`locations.business.id`**.
- `service.locations[]` (≤500 entries) with `type: BUSINESS|CUSTOM|CUSTOMER`; business entries carry `business.id` = Locations-API GUID.
- Service location types: **Business** (managed via Locations API/Site Properties), **Custom** (ad-hoc address, not in Locations API), **Customer** (visitor-supplied; appointments only). Courses must be single-location; appointments/classes may be multi-location.
- Staff default to working at ALL business locations; per-location staff limitation is done via WORKING_HOURS events (bookings lane territory).
- ⚠️ Product-relevant platform fact: "Currently, **all business locations must have the same opening hours**" (About Service Locations) and the Locations API `businessSchedule` is "Not supported by Wix Bookings". Native Wix therefore does NOT provide different opening hours per Bookings location — confirming our wedge is real (final confirmation belongs to the bookings lane).

**(c) Bookings services `queryLocations`** — https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md (accessed 2026-08-24)

- `POST https://www.wixapis.com/_api/bookings/v2/services/locations/query`, scope `SCOPE.DC-BOOKINGS.READ-BOOKINGS-PUBLIC`.
- Returns business/custom/customer location lists plus an `exists` flag. ⚠️ The prose says "whether each location is connected to at least one service", but the schema defines `exists` at the LIST level ("Whether at least one service matching the filter is connected to ANY of the retrieved business locations") — see §11.1. Do not rely on it for per-location counts.

### 9.2 Recommended definition of a billable location

> **Billable location := a business location L such that (1) L exists in the Locations API with `archived = false`, and (2) at least one Wix Bookings service S references L in `S.locations[type=BUSINESS].business.id`, where S satisfies the counted-service policy.**

Recommended counted-service policy (v1, defensible and simple): **every non-hidden service counts**, regardless of `onlineBooking.enabled`. Rationale: `hidden` is the closest thing to "disabled" in the Services schema (there is no service `status` field among query filters); a hidden service is invisible to booking surfaces, while onlineBooking-disabled services can still be booked manually/in person, so excluding them would undercount. Simpler alternative: count ALL services' locations (ignore hidden too) — even more defensible against gaming (users hiding services to dodge tiers) but harsher on legitimately paused services. Decision belongs to the Director; both are implementable with the documented filters.

Counting algorithm (all calls documented above):
1. `listLocations({ includeArchived: false })` → set A of live business-location GUIDs.
2. Paginate `queryServices` (limit 100) → collect distinct `locations[type=BUSINESS].business.id` from services passing the counted-service policy → set B.
3. `billableCount = |A ∩ B|`.
4. Cache per `instanceId` with short TTL; recompute on relevant webhooks and on dashboard load; reconcile lazily (never block rule evaluation on billing API failure — fail-open or fail-closed is a Director policy decision, see §9.4).

### 9.3 Edge cases

| Edge case | Platform truth (official) | Required product behavior |
|---|---|---|
| Deleted location | Impossible — locations can only be archived; archiving permanent; archived excluded from List by default (`includeArchived:false`) | Archived locations drop out of the billable set automatically on next recount |
| Archived-but-status-ACTIVE | Archiving doesn't touch `status` | Filter on `archived`, never on `status` |
| Default location | Cannot be archived; exactly one per site | Always counts if referenced by a service; a 1-location site always has ≥1 candidate |
| `INACTIVE` status | Not currently supported | Ignore `status` entirely |
| Custom/Customer service locations | Not in Locations API; customer locations visitor-defined and unvalidated | Do NOT count toward billable total (definition restricted to BUSINESS type). Policy gap: a tiny business using only CUSTOM locations would show 0 billable locations — recommend treating "0 computed billable locations" as 1 for tier mapping (single-location floor), documented in UI |
| Disabled/hidden services | Filterable `hidden`; `onlineBooking.enabled` | Apply counted-service policy consistently (§9.2); recompute on service changes |
| Over-limit site (more locations than plan) | Wix enforces nothing; developer must restrict | Restrict RULE MANAGEMENT/enforcement coverage to the plan's location allowance using a stable ordering (e.g., default location first, then alphabetical by id); never delete existing rules; show upgrade CTA (`wix.com/apps/upgrade/...`) |
| Downgrade / non-renewal | No mid-cycle plan switch; expiry flips `isFree:true`, `vendorProductId` disappears; cancellation keeps access till period end | Keep enforcing last entitled tier until expiry signal; on free revert, degrade gracefully (e.g., enforce rules on 1 location only, or freeze config read-only) — never destroy user data |
| Failed payment (dunning) | 45-day grace; instance may stay `isFree:false` past `expirationDate` | Treat expired-date-but-`isFree:false` as PAID (official instruction) |
| Cloned/template sites | `originInstanceId` / `copiedFromTemplate` expose clones; clones create new instances without consent flow (OAuth handles this; legacy auth breaks) | Count locations independently per instance; expect cloned instances to appear as fresh installs |
| Test/dev sites | Free dev sites include Premium capabilities; installs there behave like real installs; premium testing supported (see §10.5) | Dev-site instances are indistinguishable in kind; they simply start free/trial like any site |
| Trial state | `isFree:false` + `freeTrialInfo.status=IN_PROGRESS`; conversion fires no event | Grant full paid features during trial (official guidance); poll/reconcile to detect ENDED |
| Multi-service overlap | Many services may reference the same location | Distinct-set intersection prevents double counting |
| >100 locations | `queryServices` pages at 100; `businessLocationIds` filter caps at 100 GUIDs | Paginate services; don't rely on single-shot queries |

### 9.4 Commercial validity verdict

**VALID — with precise framing.**

1. Wix's own docs make feature restriction by purchased plan **the developer's legal responsibility** ("While Wix handles the billing and payment processing, it's your responsibility as the developer to code behavior that limits features for certain plans." — About Monetizing Your App, Published 2026-06-30). Review actively tests this. So self-metering location counts is not a workaround — it is the documented, expected pattern.
2. Four fixed recurring plans map 1:1 to our tiers within the 4-plan UI limits; `vendorProductId` identifies the purchased tier deterministically.
3. Wix offers NO native per-location metering, proration between tiers, or entitlement API. Anything resembling "usage-based" billing requires separate App Market approval. Therefore the ONLY sound implementation is: fixed plans + developer-computed billable-location count + developer-enforced coverage limit + upgrade CTAs.
4. Residual risks to manage in build: counting correctness (§11.1 empirical check), fail-open vs fail-closed on API errors (Director decision; recommend fail-open for rule *enforcement continuity* with prominent dashboard warning, since blocking paid users' bookings due to a transient API error is worse commercially), and honest listing copy (review rejects listing/behavior mismatch — the listing must describe exactly how location counting works).

Classification per constitution: **STABLE_PRODUCTION** for: recurring plans, multi-plan setup, plan identification via instance/webhooks, upgrade URL, Wix-managed trials, revenue share/payouts, AI review submission, least-privilege scopes, billable-location computation inputs (Locations API + Bookings Services v2 reads). No PREVIEW_GATED or UNSUPPORTED elements were found in the monetization path itself.

---

## 10. Human-owned steps and credentials (cannot be automated by agents)

Per governance, agents never publish, submit, or hold production secrets. Minimum human actions:

**10.1 Account & app creation**
1. Wix account + (for paid apps) join the **Wix Partner Program** (account-level, one-time).
2. Create the app in the Wix Dev Center (app dashboard at dev.wix.com) — creates immutable `appId`.

**10.2 Credentials/secrets (human creates, stores in CI secret manager; never committed)**
- `appId` (public identifier),
- `appSecret` (OAuth page of app dashboard; used for `oauth2/token` client-credentials),
- app **public key** for webhook JWT signature verification,
- (optional, external pricing page only — not needed for Wix-hosted pricing).

**10.3 CI authentication for development**
- `wix login` (browser/device auth) is interactive — CI cannot fabricate it; local dev via Wix CLI requires a human-logged-in environment or pre-provisioned dev-site binding. (Deep CLI mechanics belong to the platform lane; verified here only that CLI apps handle OAuth automatically — authenticate-using-oauth.md.)
- Dev-site creation via **Test App → Test on dev site** (human click) or shared test links for collaborators.

**10.4 Payout onboarding (blocks publishing of paid apps)**
- Join Partner Program → **Earnings > Payouts** → set up **Tipalti** payout account (banking + tax forms). Requires **Manage Earnings** permission (account owner by default). Until complete, a review blocker prevents publishing. Source: set-up-your-payout-account.md.

**10.5 Release & distribution (human clicks in Dev Center)**
- Version release: Distribute tab → **Release Version** (major versions are NOT auto-pushed; users must accept updates in Manage Apps). Source: release-a-new-app-version.md.
- Marketplace submission: resolve all dashboard blockers → **Submit & Publish** → AI review → iterate. Source: submit-your-first-app-version.md.
- Pricing configuration (plans, prices, trial length, visible toggles) and market listing content are entered by the human in the dashboard; agents can draft copy but cannot save/publish it.
- Provide and maintain a **demo account** for reviewers (guidelines).

**10.6 Ongoing human obligations**
- Monitored support email; privacy policy + ToU URLs; GDPR/cookie-consent compliance sign-off; refund handling decisions; price-change decisions (new-subscribers-only).

---

## 11. Contradictions, gaps, and items for the Recon Auditor

1. **`queryLocations` prose vs schema (§9.1c):** method description implies per-location connection flags; the typed response shows a single aggregate `exists` per location list. Impact: we must compute per-location connectivity ourselves (services cross-reference). Empirical verification on a dev site recommended before freezing the counting algorithm.
2. **`expirationDate` semantics:** Get App Instance schema says "Available only for yearly and multi-yearly plans"; the lifecycle article says monthly cycles update it to charge+30 days. Resolution for build: rely on webhooks + `isFree`/`vendorProductId` as primary signals; treat `expirationDate` as advisory only.
3. **Silent trial conversion:** no webhook when a trial converts to paid — periodic reconciliation is mandatory (documented behavior, not a gap we can webhook away).
4. **Archived locations in Query (vs List):** List documents `includeArchived:false` default; the Query variant's archived filtering behavior wasn't separately verified — use List (or verify Query filters) during build-phase integration testing.
5. **Plan-count ceiling:** docs state listing/pricing-page display caps (4) but no explicit hard cap on total defined plans was found; irrelevant for our 4-tier design, flagged for completeness.
6. **Revenue-share nuance:** "applies to users that start at Wix" — users already paying for our app elsewhere are excluded from the 80/20 split mechanics; irrelevant at launch (no external sales), noted for future external-pricing-page plans.
7. **Harmony/Vibe compatibility:** dev-site doc notes Harmony/Vibe don't support every extension type; Harmony dev template "Bookings" exists. Extension-type compatibility must be confirmed by the platform lane before choosing dashboard vs widget extensions.

---

## 12. Source index (all accessed 2026-08-24 unless dated inline)

Monetization & billing:
1. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-monetizing-your-app (Published 2026-06-30)
2. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/about-pricing-plans-and-business-models.md
3. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-premium-business-model.md (Published 2025-11-27)
4. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-one-time-payments (Published 2026-03-23)
5. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-a-wix-pricing-page.md
6. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-and-manage-free-trials.md
7. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/identify-and-manage-app-users.md
8. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/the-app-purchase-lifecycle-in-wix.md
9. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/change-app-pricing.md
10. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/payments-and-billing-faqs.md
11. https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-your-payout-account.md

Instance & events:
12. https://dev.wix.com/docs/api-reference/app-management/app-instance/get-app-instance.md
13. https://dev.wix.com/docs/api-reference/app-management/app-instance/paid-plan-purchased.md
14. https://dev.wix.com/docs/api-reference/app-management/app-instance/paid-plan-auto-renewal-cancelled.md
15. https://dev.wix.com/docs/api-reference/app-management/app-installations/introduction.md
16. https://dev.wix.com/docs/api-reference/app-management/app-installations/app-installation-updated.md
17. https://dev.wix.com/docs/api-reference/app-management/app-installations/sample-flows.md
18. https://dev.wix.com/docs/build-apps/build-your-app/app-instance/identify-users-app-instance
19. https://dev.wix.com/docs/build-apps/develop-your-app/access/authentication/authenticate-using-oauth.md
20. https://dev.wix.com/docs/build-apps/develop-your-app/access/authentication/about-oauth

Bookings/Locations data:
21. https://dev.wix.com/docs/api-reference/business-management/locations/introduction.md
22. https://dev.wix.com/docs/api-reference/business-management/locations/list-locations.md
23. https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
24. https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-locations.md
25. https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/about-service-locations.md

Distribution, review, permissions:
26. https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/submit-your-first-app-version.md
27. https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/common-reasons-for-app-rejection.md
28. https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/app-market-guidelines.md
29. https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/test-your-app/test-your-app-on-a-premium-site.md
30. https://dev.wix.com/docs/build-apps/launch-your-app/market-listing/about-market-listings.md
31. https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/about-permissions.md (Published 2024-08-15)
32. https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/configure-permissions-for-your-app.md (Published 2026-07-05)
33. https://dev.wix.com/docs/build-apps/manage-your-app/versioning/release-a-new-app-version.md
34. https://github.com/wix/skills/blob/main/skills/wix-app/references/APP_MARKET_REVIEW.md (linked from official submission docs)

---

*End of commerce-lane recon report. Findings are untrusted until independently audited (wix-recon-auditor) and integrated by the recon director.*
