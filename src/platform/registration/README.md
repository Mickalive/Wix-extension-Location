# Platform registration surface — unified Wix CLI scaffold (INT-C6-R1)

Blueprint §1 assigns `platform/registration/` the extension configs, project
binding and scaffold runbook concerns. This directory is the committed,
credential-free half of that assignment: everything about the Wix CLI app
scaffold and registration that can be derived WITHOUT an authenticated Wix
account. The authenticated half (real identifiers, generated files) exists
only after the human-owned one-time scaffold — empirical gate **T-VP0**
(Technical Contract §15/§16; runbook `docs/runbooks/T_VP0_SCAFFOLD.md`).

## 1. Why there is no committed `wix.config.json`

`wix.config.json` "defines the identifiers that connect your local code to
your Wix project. Don't edit this file" (recon §3, source S4). It is produced
exclusively by `npm create @wix/new@latest app`, which also registers the real
app in the Custom Apps dashboard. Its contents are account-bound
(`appId`; dev-site binding lives separately in gitignored `.wix/` state).
Fabricating any of those values is forbidden by `directives/INTEGRATION.md`,
the lane fiche and `AGENTS.md`.

Consequently:

| Artifact | State | Why |
|---|---|---|
| `wix.config.example.json` (repo root) | **committed** | Shape template; every value is an explicit scaffold-pending placeholder. |
| `wix.config.json` (repo root) | **gitignored** | Generated at scaffold; holds account-bound identifiers; never committed, never hand-written. |
| `extensions.ts` (repo root) | **committed, empty by design** | Documented layout anchor; zero entries because zero extensions exist until the CLI generates them. |
| `src/platform/registration/**` | **committed** | Typed loader, registration inventory, validation-extension shape, prerequisites record. |

The exact app-project field set stays quarantined as **UQ4**: the loader
requires positive evidence of a real `appId` and tolerates unknown fields
(schema-drift discipline, Contract §11 C4 analog) instead of asserting a shape
nobody has observed for app projects. T-VP0 evidence supersedes this template.

## 2. Modules

- `projectConfig.ts` — pure classifier for `wix.config.json` contents:
  `MISSING_FILE` / `UNPARSEABLE` / `UNLINKED` / `LINKED`. `LINKED` demands a
  non-empty, non-placeholder string `appId`. Placeholder detection covers
  empty values, `<…>`/`{{…}}`/`${…}` shapes and marker tokens. Live QA and
  tooling should classify BEFORE claiming anything about scaffold state: a
  placeholder-filled file is UNLINKED, never "linked".
- `exampleProjectConfig.ts` — the exact object serialized into
  `wix.config.example.json` plus deterministic serialization; tests pin the
  committed file byte-for-byte against it and prove the template classifies as
  UNLINKED.
- `validationExtension.ts` — the documented Bookings Validation service-plugin
  registration config (`deploymentUri` + `validationTargets`). Targets are
  DERIVED from `../validation-plugin/targets.ts` (single source of truth), so
  the registered surface cannot drift from the implemented handler matrix.
  Default deployment URI `/api/bookings-validation` derives from the documented
  HTTP-endpoint mapping `src/pages/api/<name>.ts` → `/api/<name>` — a
  project-internal route, not an account identifier.
- `extensionsManifest.ts` — the complete planned registration inventory
  (dashboard pages/modal, validation plugin, data collections, events, plan
  webhooks, HTTP endpoints) with each entry's channel
  (`UNIFIED_CLI_GENERATE` / `APP_DASHBOARD_FALLBACK` / `INTERACTIVE_CLI_MENU` /
  `FILE_BASED_NO_REGISTRATION`) per Contract §3. Every entry is
  `PLANNED_UNTIL_T_VP0`; referenced repo artifacts are existence-checked by
  tests so the inventory cannot point at ghosts.
- `scaffoldPrerequisites.ts` — machine-readable record of the
  account-authenticated steps CI cannot derive (account authorization,
  one-time scaffold/bind, dev-site consent + binding, API key as CI secret,
  release/marketplace approvals), each with owner, gate and runbook anchor,
  plus `externalBlockerStatement()` composing the narrow external-prerequisite
  wording for live-QA reporting.

## 3. Bookings Validation wiring provenance

Documented on the plugin introduction page (fetched 2026-08-24; Contract §3
SERVICE_PLUGIN row; recon §10):

> If [Bookings Validation] does not [appear in the generate menu], the
> documented fallback is on the same plugin page's REST tab: create the
> extension in the app dashboard (Extensions → Create Extension → filter
> Bookings → JSON config with `deploymentUri` + `validationTargets`) and
> implement handlers via the SDK — fully supported.

Handler side: `bookingsValidation.provideHandlers()` from the Bookings
service-plugins SDK module, delegating immediately to `createValidationHandlers`
per `../validation-plugin/README.md` §6 (thin-adapter protocol). The SDK import
path is documented HERE AND IN COMMENTS ONLY, deliberately: no code string in
this directory may carry a module-specifier shape, so the purity gate
(`npm run check:purity`, which protects this directory since INT-C6-R1) keeps
scanning it meaningfully. Service-plugin changes take effect only after
`wix release` (Contract §6).

## 4. Non-claims

Nothing here registers anything, claims registration, or asserts live Wix
behavior. Gates T-VP0–T-VP5 remain open and unbypassed; reschedule enforcement
stays best-effort (Contract §5.3/§10/§12); no production-capability claim is
made or implied anywhere in this surface.
