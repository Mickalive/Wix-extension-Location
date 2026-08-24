# Platform Recon — Wix Architecture for the Advanced Rules Marketplace Extension

Lane: **wix-platform-researcher** · Cycle 1 · Date: 2026-08-24
Scope: current Wix CLI/app architecture, extension types, hosting, SDK/auth, dev sites, build/preview/release, CI auth, account/app binding, required identifiers.
Method: official `dev.wix.com` documentation fetched directly (markdown endpoints). No community sources used for capability claims. Repo state observed: phase RECON, contract placeholder, branch `lab/wix-rules`.

---

## 1. Executive summary

The current, non-deprecated path for a native Wix marketplace app is the **unified Wix CLI** (Astro-based project framework) creating an **app project** registered in the Wix **Custom Apps** dashboard. The **Legacy Wix CLI for Apps is officially deprecated** (no updates, no new features) and must not be used for new work.

Everything this product needs exists on the current platform:

| Product need | Current platform mechanism | Maturity signal |
|---|---|---|
| Configuration UI | Dashboard page/modal/plugin extensions (React + Wix Design System) | Documented, production |
| Enforcement hook | **Bookings Validation service plugin** (validate before create/cancel/reschedule) | Documented in API reference, CLI-supported; no preview banner seen |
| Availability shaping | **Bookings availability time slots configuration service plugin**, **Bookings booking policy service plugin** | Listed in official extension catalog, CLI-supported |
| Plugin persistence | Data collections extension (app-defined CMS collections created on install/update) | Documented, production |
| Backend logic | HTTP endpoints (`src/pages/api/*`) + event extensions | Documented, production |
| Hosting | Wix-managed serverless (CDN, SSL, session middleware) | Documented, production |
| Testing | Vitest unit tests, officially documented; `wix build` in CI | Documented, production |
| Release | `wix build` → `wix release` → app version → App Market submit (automated AI review) or direct install | Documented, production |

Recommended architecture (Section 11) is fully buildable on this stack. The blocking external prerequisites are human-owned: a Wix account login (to bind the app), an API key for CI, and release/marketplace actions.

---

## 2. Current CLI vs deprecated CLI (explicit distinction)

- **Current: unified Wix CLI.** "The Wix CLI is a unified tool for both Wix apps and Wix-managed headless projects." Scaffolding: `npm create @wix/new@latest app`. Commands: `wix dev`, `wix generate`, `wix build`, `wix preview`, `wix release`, `wix dev-site`, `wix env set|pull`, `wix login [--api-key]`.
  - Source: https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md (no visible date; high confidence)
  - Quick start: https://dev.wix.com/docs/build-apps/get-started/quick-start/create-an-app-with-the-wix-cli (search-indexed date 2026-07-26)
- **Deprecated: Legacy Wix CLI for Apps.** "Deprecated and no longer receives updates or new features. New projects should use the unified Wix CLI." Its docs remain only for maintaining existing projects. Its `create-version` command is itself deprecated in favor of `release`.
  - Source: https://dev.wix.com/docs/wix-cli/legacy-clis/legacy-wix-cli-for-apps/about-the-legacy-wix-cli-for-apps (search-indexed date 2026-05-04; high confidence)
  - Command reference (deprecated): https://dev.wix.com/docs/wix-cli/legacy-clis/legacy-wix-cli-for-apps/app-development/command-reference
- **Detector for legacy projects:** absence of the unified indicators described in https://dev.wix.com/docs/wix-cli/guides/development/determine-which-cli-your-project-uses.md
- Migration guide exists: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/migrate-an-app-from-legacy-cli/migrate-an-app-from-the-legacy-wix-cli-to-the-new-wix-cli.md

Consequence for this repo: any bootstrap must use `npm create @wix/new@latest app` and the unified command set. Legacy concepts (HTTP functions, web methods) are replaced by **HTTP endpoints** in the unified CLI (https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/http-endpoints/about-http-endpoints.md).

Note (doc-lag hazard): the Bookings Validation plugin page still links its "implement with CLI" step to a *legacy* CLI path. The unified CLI's own supported-extension list includes SERVICE_PLUGIN. Treat unified-CLI support for Bookings service plugins as highly likely but verify at first `wix generate` run (see §13 V3).

---

## 3. Project structure and identifiers

App project layout (https://dev.wix.com/docs/wix-cli/guides/project-structure/project-structure.md):

```
.agents/skills/        # Wix skills for AI tools
.wix/                  # internal Wix config/logs — DO NOT EDIT
dist/                  # build output
public/
src/
  pages/               # frontend routes (headless) AND backend HTTP endpoints under pages/api/
  extensions/          # generated extensions, each with <name>.extension.ts
  extensions.ts        # registration file for all extensions
  env.d.ts
astro.config.mjs       # includes wix() integration
.env.local             # local auth/env vars; do not edit WIX_CLIENT_* values
package.json
tsconfig.json
wix.config.json        # identifiers binding local code ↔ Wix project — DO NOT EDIT
.gitignore
```

Identifiers and binding:

- Creating the app via CLI **registers a real app** in the [Custom Apps page](https://manage.wix.com/account/custom-apps) of the Wix Studio workspace and initializes a local git repo. Binding to Wix happens at creation time, authenticated by `wix login`.
- `wix.config.json` holds the identifiers connecting local code to the Wix project (documented fields elsewhere include `appId`, and for headless `siteId`; app-project field set should be confirmed from a real scaffold). Docs: "Defines the identifiers that connect your local code to your Wix project. Don't edit this file."
- At app creation the developer chooses a **namespace** (`@prefix/suffix`) and a **code identifier**; both are **immutable after creation**.
- Development-site selection is stored in `.wix/app.config.json` (gitignored, per-developer). Overridable per-run via `WIX_SITE_ID` in `.env.local` only (never from shell/CI env).
- Sources: quick start (§2), project structure (above), `wix dev-site` reference https://dev.wix.com/docs/wix-cli/command-reference/project-commands/app-only/dev-site.md

**What cannot be fabricated:** appId, extension IDs (generated into `.extension.ts` files), namespace/code identifier (chosen once, at creation), siteId/dev-site IDs, API keys, account ID. All originate from an authenticated Wix account. No agent may invent these; they must come from a real scaffold/bind step performed under human-owned credentials.

---

## 4. Extension types available in the unified CLI

`wix generate --type` supports (apps): `DASHBOARD_PAGE`, `DASHBOARD_MODAL`, `DASHBOARD_PLUGIN`, `DASHBOARD_MENU_PLUGIN`, `DASHBOARD_EXTERNAL_PAGE`, `EMBEDDED_SCRIPT`, `CUSTOM_ELEMENT`, `REACT_COMPONENT`, `SITE_PLUGIN`, `EVENT`, `SERVICE_PLUGIN`.
Source: https://dev.wix.com/docs/wix-cli/command-reference/project-commands/generate.md

Full catalog (https://dev.wix.com/docs/build-apps/get-started/overview/how-apps-extend-wix.md) additionally documents dashboard-config-only extensions (data collections, schema plugins, notifications, automations, external links) that do not appear in the generate enum.

Relevant to this product:

### 4.1 Dashboard extensions (configuration UX)
- Pages, modals, plugins, menu plugins; React + `@wix/design-system` + `@wix/dashboard` SDK; hot reload via `wix dev`.
- Sources: https://dev.wix.com/docs/build-apps/develop-your-app/frameworks/wix-cli/supported-extensions/dashboard/about-dashboard-extensions-in-the-wix-cli and per-type how-tos (pages/modals/menu-plugins).

### 4.2 Backend extensions (enforcement + persistence)
- **Service plugins**: "Wix calls your service during a specific flow, waits for your response, then continues the flow based on your response." CLI implementation = Wix hosts the endpoints. Changes take effect only after `wix release` (cannot be tested with hot reload alone).
  - Sources: https://dev.wix.com/docs/build-apps/develop-your-app/extensions/backend-extensions/service-plugins/about-service-plugin-extensions.md , https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/service-plugins/add-service-plugin-extensions-with-the-wix-cli.md
- **Bookings-specific service plugins** (from the official catalog):
  - *Bookings validation service plugin* — validates whether a booking can be **created, canceled, or rescheduled before Wix executes the operation**. CLI or self-managed. https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md
  - *Bookings availability time slots configuration service plugin* — customizes how Wix calculates available time slots. CLI or self-managed.
  - *Bookings booking policy service plugin* — custom booking policies controlling when customers can book. CLI or self-managed.
  - (*Bookings pricing integration service plugin* — REST self-managed only; out of scope.)
- **Events**: code that runs on site events (e.g., booking confirmation). CLI-supported.
- **Data collections extension**: app-defined CMS collections auto-created on install/update; schema/permissions/indexes/initial data defined in repo; requires the site to have the CMS (can be bundled as an app dependency). Collection changes propagate on version updates (up to ~5 min).
  - Source: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/data-collections/add-a-data-collections-extension-with-the-wix-cli.md
- **HTTP endpoints**: file-based `src/pages/api/<name>.ts` → `/api/<name>`; standard `Request`/`Response` handlers; **no built-in permissions model** — caller token must be inspected with `auth.getTokenInfo()` from `@wix/essentials`; frontend calls them with `httpClient.fetchWithAuth()`. They are *not* extensions (not registered in `extensions.ts`, not visible in app dashboard).
- **Schema plugins** (dashboard-config): add fields to the Booking and Booking Service objects — candidate for storing per-booking/per-service metadata without extra reads.

### 4.3 Site extensions
Available (embedded scripts, custom elements, editor React components, site plugins) but **out of scope**: product promise is dashboard-driven control, minimal site-facing UI.

### 4.4 App Tools (Aria AI)
Exists as a backend extension type but is irrelevant here; product constraints forbid AI dependencies. Not used.

---

## 5. Hosting model

Wix-managed, serverless, for CLI projects (https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md#hosting-and-infrastructure):
- static hosting behind global CDN; automatic SSL;
- serverless execution with automatic scaling (HTTP endpoints, service-plugin handlers);
- session-management middleware for visitor sessions;
- optional external CDN via `wix release --base-url` (not needed here).

No external database, container, or infrastructure is required or allowed by our constraints — data collections + Wix hosting satisfy persistence and compute.

---

## 6. SDK and authentication behavior

- **Dashboard context (Wix-managed apps):** import `{ dashboard }` from `@wix/dashboard` and call directly; token management handled by host. Effective permissions = **intersection** of the app's granted permissions and the current Wix user's role permissions.
  - Source: https://dev.wix.com/docs/sdk/host-modules/dashboard/introduction.md
  - **Version warning:** apps must ship `@wix/dashboard >= 1.3.43` (and `@wix/dashboard-react >= 1.0.27`) or risk breakage as rollout proceeds.
- **CLI apps generally:** "token management and authentication are handled for you, eliminating the need to set up a Wix Client" when calling Wix JS SDK methods (https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md).
- **Elevated permissions:** backend-only elevation to Wix-app identity for APIs the current identity can't call (example given: Confirm Booking). Frontend → own HTTP endpoint → elevated SDK call is the documented pattern.
  - Sources: https://dev.wix.com/docs/api-reference/articles/authentication/about-elevated-permissions.md , https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/about-elevation.md
- **API keys:** for CLI/automation auth and admin operations — **not** available to third-party apps' runtime calls (those use OAuth/app identity). Created only by account owner/co-owner in the API Keys Manager.
  - Source: https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/about-api-keys.md
- **Secrets:** secret server variables via `wix env set` stored on Wix servers; pulled locally with `wix env pull`; never committed. `.env.local` holds local auth values (`WIX_CLIENT_*` managed by CLI).
  - Source: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/environment-variables/about-environment-variables-in-the-cli.md

Implication: least-privilege is enforceable and auditable — request only the scopes listed under "Permission Scopes" of each API we call; adding permissions later forces a **major** version (user action required), so scope selection up front matters (§9).

---

## 7. Development sites and local development

- Apps must be installed on a Wix site to run. CLI prompts to pick/create a **development site** (premium Wix sites for testing); **up to 5 simultaneously**.
  - Source: https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md#development-sites
- `wix dev` starts local dev with hot reload and a menu (dashboard, etc.). In non-interactive environments it fails unless a dev site already exists → run `wix dev-site` first.
- `wix dev-site list|current|select <site-id>|create [--template dev|harmony] [--select]`; machine-readable JSON Lines output when non-piped-to-terminal; errors exit code 1 with `error` field. Install-after-select waits up to 2 minutes for a human to complete installation at an install URL.
  - Source: https://dev.wix.com/docs/wix-cli/command-reference/project-commands/app-only/dev-site.md
- First-time app install on the dev site opens a browser install flow (human-in-the-loop even with API-key auth).

CI/agent implication: dev-site bootstrap needs one interactive install consent; afterwards `WIX_SITE_ID` (in `.env.local`) pins the site for automated runs.

---

## 8. Build / preview / release semantics

Source: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/build-and-deploy.md and command references.

| Step | Command | Effect |
|---|---|---|
| Build | `wix build` | Compiles assets locally. Runs in CI without login. Node.js ≥ v20.11.0 required. |
| Preview | `wix preview` | Uploads code to Wix servers; returns shareable preview URLs (site/editor/dashboard). **Does not register all extensions** (embedded scripts, site widgets, site plugins won't be recognized). |
| Release | `wix release` | Pushes to Wix hosting, **registers extensions in app configuration**, creates a new **app version**. Flags: `--site <id>`, `--comment`, `--version-type major\|minor`, `--base-url`. |

Versioning (https://dev.wix.com/docs/build-apps/manage-your-app/versioning/about-app-versioning.md):
- **Minor** releases auto-propagate to installed users. Includes: adding/changing/removing extensions, event/webhook changes, removing permissions, translations.
- **Major** releases require user "Update" action. Includes: **adding permissions**, adding embedded scripts.
- Pricing changes require App Market (re)submission but no version release.
- Service-plugin changes take effect only via release (§4.2).

Distribution (https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/about-app-distribution.md):
- App Market listing requires submit-for-review; review is an **automated AI process, typically minutes**; blockers are listed in dashboard on failure; statuses `DRAFT`/`PUBLISHED`/`ARCHIVED`.
- Unlisted distribution via install link / direct install without review.
- **Paid apps require completed payout account setup before publishing** (https://dev.wix.com/docs/build-apps/launch-your-app/pricing-and-billing/set-up-your-payout-account.md — owned by commerce lane).
- Compatibility caveat: sites built with Wix Vibe/headless can only install apps that have **only dashboard extensions**; Editor/Studio sites accept all app types. Our app (dashboard + backend) targets Editor/Studio sites — the population that runs Wix Bookings dashboards.

---

## 9. CI authentication and automation

- Unit tests + `wix build` need **no Wix credentials** (official GitHub Actions example runs `npm install` + `npm run test:unit`; `wix build` suggested as compile check). Source: https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/cd-workflows.md
- Authenticated commands (`wix dev`, `preview`, `release`, `env pull`) support **`wix login --api-key <token>`** "for automations and CI environments". Network egress must allow `manage.wix.com` and `www.wixapis.com` even with API key. Source: https://dev.wix.com/docs/wix-cli/command-reference/global-commands/login.md
- API keys are created by account owner/co-owner at https://manage.wix.com/account/api-keys with scoped permissions and site access lists. **This is a human-owned prerequisite**; keys must live in CI secrets, never in the repo.
- Non-interactive tooling: `wix dev-site` JSON Lines output; `--api-key` login; `wix generate --type` flags; `wix release` flags exist, but full unattended release behavior is unverified (§13 U2).

---

## 10. Bookings Validation service plugin — platform-level facts

From https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md (API reference; no preview/deprecation banner observed in page content):

- Called by Wix **before** executing create/cancel/reschedule (single- and multi-service). Handler returns `valid` boolean + reason; rejection blocks the operation and shows our message to the customer.
- **Error/timeout semantics:** create/cancel fail-**closed** (blocked on error/timeout); reschedule fails-**open** (operation continues). Our rules engine must treat reschedule enforcement accordingly (defense in depth, not sole gate).
- Multiple providers may register for the same target; all are called concurrently; any rejection/error blocks.
- **PII redaction:** contact details and resource names/emails are redacted in payloads — duplicate-protection logic cannot rely on contact identity fields from the payload.
- Bulk creates validate per item; omitted item results default to valid.
- Implementation via CLI: `bookingsValidation.provideHandlers({...})` from `@wix/bookings/service-plugins`; config declares `validationTargets` (`CREATE`, `CANCEL`, `RESCHEDULE`, plus multi-service variants).
- Use-case match is explicit in docs: "Enforce limits or validate against an external system", "Apply cancellation policies".

Detailed Bookings data-model feasibility (services/locations/staff/schedules read APIs) is owned by the bookings lane; this report only establishes that the enforcement mechanism is platform-supported.

---

## 11. Recommended architecture

**Unified Wix CLI app project** (Astro-based), Wix-managed hosting, no external infra:

1. **Bootstrap:** `npm create @wix/new@latest app` under human-owned credentials → real appId, namespace, code identifier; commit scaffold except gitignored internals.
2. **Configuration UX:** dashboard pages (rules editor: locations × services windows, split hours, exceptions, caps) + dashboard modals (confirmations, previews/explanations) + optionally a dashboard menu plugin inside Wix Bookings pages if a suitable slot exists. Built with `@wix/design-system` + `@wix/dashboard` (≥1.3.43).
3. **Persistence:** data collections extension for rule sets, exceptions, counters, audit/explain records; bundle CMS dependency; versioned via app versions.
4. **Enforcement:** Bookings Validation service plugin (targets CREATE/CANCEL/RESCHEDULE) calling a pure-TS rules core (no SDK imports) with adapters for collection reads; explainable outcomes surfaced in dashboard and customer-facing messages.
5. **Optional shaping:** availability time slots configuration plugin and/or booking policy plugin if bookings lane proves them superior for window/holiday handling; keep MVP on validation plugin alone if either shows instability.
6. **Backend glue:** HTTP endpoints under `src/pages/api` for dashboard↔backend traffic with `fetchWithAuth()` + `getTokenInfo()` checks; event extensions for counter maintenance if needed.
7. **Testing:** Vitest (+ `@testing-library/react@12`, jsdom) per official guide; pure domain core tested without Wix mocks; CI = `npm run test:unit` + `wix build`.
8. **Release path:** `wix build` → `wix release --version-type minor` for iteration; permissions frozen early (adding later = major); marketplace submission and payout setup remain human actions.

This satisfies: native app, Wix-managed hosting/auth/billing surface, dashboard-first UX, deterministic testable core, minimal scopes, no fabricated identifiers.

---

## 12. Human-owned prerequisites (minimum set)

1. A Wix account able to authorize the CLI (interactive first login; owner/co-owner for API keys).
2. Run the one-time scaffold/bind (`npm create @wix/new@latest app`) choosing namespace + code identifier — creates the real app record.
3. One interactive dev-site install consent (≤2-minute wait) per dev site; then `WIX_SITE_ID` pinning for automation.
4. API key created in API Keys Manager, stored as a CI secret, for authenticated CLI steps.
5. `wix release` approval, payout account setup (paid app), and App Market submission — never automated by agents.

Until (1)–(3) happen, builders can still produce the full repo (domain core, tests, extension scaffolds with placeholder-free structure) but cannot produce real extension IDs or run `wix dev`/`release`.

---

## 13. Claims requiring independent verification (auditor input)

- **V1 (high confidence, verified):** Legacy Wix CLI for Apps deprecated; unified CLI current. Two independent official pages agree.
- **V2 (high, verified):** Extension catalog contents incl. three Bookings service plugins marked "CLI or self-managed"; HTTP endpoints replace HTTP functions/web methods.
- **V3 (medium):** Unified CLI can generate/implement the *Bookings* service plugins specifically. Catalog says CLI-supported, but the plugin page's CLI walkthrough links to legacy-CLI paths, and the `generate --type` enum omits `DATA_COLLECTION` while the data-collections how-to uses the interactive menu. Verify at first real `wix generate` run; record actual menu options.
- **V4 (medium):** No Developer Preview gating on the three Bookings service plugins. No preview banner appeared in fetched content, but status markers sometimes render outside article markdown or in the dev-center UI. Must be confirmed in the app dashboard during scaffold.
- **V5 (medium):** `wix release` fully unattended with `--api-key` (flags exist; "guides you through" wording suggests prompts). Verify or plan human-triggered release.
- **V6 (low-medium):** Dashboard extensions pinned to React 16 (inferred from official testing guide mandating `@testing-library/react@12`). Confirm from a real scaffold's package.json.
- **V7 (medium):** Dev-site cap "up to 5" (guide) vs "limited number" (dev-site reference). Treat 5 as nominal.
- **V8 (pending other lanes):** Read/write API coverage for services/locations/staff/schedules (bookings lane); pricing-plan entitlement mechanics and location counting (commerce lane).
- **V9 (medium):** Validation-plugin timeout budget unspecified ("respond as quickly as possible"); design rules engine for fast reads + cached counters; measure in dev site.
- **V10 (medium):** Exact `wix.config.json` field set for app projects (docs show headless shape: `projectType`, `appId`, `siteId`). Confirm from real scaffold; never hand-edit regardless.

## 14. Unresolved questions

- Behavior when another installed app also provides a Bookings validation provider (documented: concurrent, any-rejection-blocks — but UX/composition implications for our error messaging need a dev-site test).
- Serverless execution quotas/limits for CLI app backends (not published on fetched pages).
- Whether `wix preview` can exercise service plugins at all (docs imply no: release required). If not, integration testing of enforcement requires repeated dev releases — plan cycle cadence accordingly.
- Whether schema-plugin fields on Booking/Service objects are readable from validation-plugin payloads (affects duplicate-protection design; bookings lane).

## 15. Source index

| # | URL | Note | Confidence |
|---|---|---|---|
| S1 | https://dev.wix.com/docs/wix-cli/legacy-clis/legacy-wix-cli-for-apps/about-the-legacy-wix-cli-for-apps | deprecation statement (indexed 2026-05-04) | High |
| S2 | https://dev.wix.com/docs/wix-cli/guides/about-the-wix-cli.md | unified CLI overview, dev sites, hosting, auth-handled | High |
| S3 | https://dev.wix.com/docs/build-apps/get-started/quick-start/create-an-app-with-the-wix-cli | scaffold flow, Custom Apps registration, namespace/code-id immutability (indexed 2026-07-26) | High |
| S4 | https://dev.wix.com/docs/wix-cli/guides/project-structure/project-structure.md | project tree, .wix/, wix.config.json, extensions.ts | High |
| S5 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/about-extensions-in-the-wix-cli.md | supported extension types | High |
| S6 | https://dev.wix.com/docs/wix-cli/command-reference/project-commands/generate.md | generate type enum | High |
| S7 | https://dev.wix.com/docs/build-apps/get-started/overview/how-apps-extend-wix.md | full extension catalog incl. Bookings service plugins | High |
| S8 | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md | validation plugin semantics | High |
| S9 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/http-endpoints/about-http-endpoints.md | HTTP endpoints, security model | High |
| S10 | https://dev.wix.com/docs/sdk/host-modules/dashboard/introduction.md | dashboard SDK, permission intersection, min versions | High |
| S11 | https://dev.wix.com/docs/api-reference/articles/authentication/about-elevated-permissions.md + https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/about-elevation.md | elevation model | High |
| S12 | https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/about-api-keys.md | API keys, owner-only, CI use | High |
| S13 | https://dev.wix.com/docs/wix-cli/command-reference/global-commands/login.md | `--api-key`, network allowlist | High |
| S14 | https://dev.wix.com/docs/wix-cli/command-reference/project-commands/app-only/dev-site.md | dev-site automation, WIX_SITE_ID, JSON Lines | High |
| S15 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/build-and-deploy.md | build/preview/release semantics | High |
| S16 | https://dev.wix.com/docs/wix-cli/command-reference/project-commands/release.md | release flags | High |
| S17 | https://dev.wix.com/docs/build-apps/manage-your-app/versioning/about-app-versioning.md | major/minor rules | High |
| S18 | https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/about-app-distribution.md | AI review, statuses, payout prerequisite | High |
| S19 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/cd-workflows.md + .../write-unit-tests-for-a-wix-cli-project.md | CI + Vitest + React 16 hint | High |
| S20 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/backend/data-collections/add-a-data-collections-extension-with-the-wix-cli.md | persistence mechanism | High |
| S21 | https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/configure-permissions-for-your-app.md | permission config, least privilege | High |
| S22 | https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/project-development/environment-variables/about-environment-variables-in-the-cli.md | secrets handling | High |
| S23 | https://dev.wix.com/docs/build-apps/get-started/overview/exposing-apps-publicly-and-privately.md | public/unlisted/private distribution | High |

Pages fetched 2026-08-24. Most dev.wix.com articles display no on-page revision date; dates shown above come from search indexing where available. Confidence reflects direct quotation from official current documentation portals; items flagged in §13 carry residual uncertainty despite high source quality.
