# RUNBOOK — T-VP0 First Authenticated Scaffold (Unified Wix CLI)

> **CANONICAL DESTINATION NOTE (integration lane, INT-C1-1 item e):** this
> runbook is authored in-lane because the workflow shell reserves `docs/**`.
> The Director must relocate it verbatim to **`docs/runbooks/T_VP0_SCAFFOLD.md`**
> during integration; content below is final and execution-ready.
>
> - **Gate:** T-VP0 (Contract §15) — first empirical step per audit blocker B5.
> - **Resolves:** UQ1 (dev-site selection storage), UQ2 (unattended release flags — partial),
>   UQ3 (React/testing dependency pins), UQ4 (`wix.config.json` field set).
> - **Blocks:** production claims for the Bookings Validation service plugin;
>   NOT build work (Contract §8.7).
> - **Human-owned prerequisites (Contract §16):** Wix account authorizing the CLI,
>   owner/co-owner API key stored as a CI secret (never committed), one interactive
>   dev-site install consent.

---

## 0. Ground rules

1. Never fabricate `wix.config.json`, app IDs, project IDs, extension IDs,
   namespace/code identifiers or credentials (directives/INTEGRATION.md). Every
   real value captured here originates from the authenticated scaffold.
2. Node.js ≥ v20.11.0 is required for `wix build` (Contract §1).
3. Network egress must allow `manage.wix.com` and `www.wixapis.com` even when
   authenticating with an API key (Contract §6).
4. API keys are created only by an account owner/co-owner in the API Keys
   Manager and live only in a secret store — never in the repository.

## 1. Exact commands (in order)

Run from a machine/shell where the human operator has authenticated:

```bash
# 1. Authenticate the unified CLI (interactive login OR CI-style API key).
wix login                       # interactive; browser/device flow
# or, for automation:
wix login --api-key "$WIX_API_KEY"   # $WIX_API_KEY from the secret store only

# 2. One-time scaffold/bind. Choose the immutable namespace (@prefix/suffix)
#    and code identifier CAREFULLY — both are permanent (Contract §1/§16).
npm create @wix/new@latest app

# 3. Non-interactive shells MUST create/select a dev site before `wix dev`.
wix dev-site list
wix dev-site create --template dev --select   # one interactive install consent follows

# 4. THE T-VP0 QUESTION — inspect the generate menu interactively:
wix generate
#    → navigate to "Service Plugin" → record the FULL list of offered plugins.
#    Record explicitly: does "Bookings Validation" appear? (yes/no + full menu text)

# 5. Capture the generated project shape (see §2 evidence checklist).
ls -R src
cat wix.config.json
cat package.json
cat extensions.ts 2>/dev/null || true

# 6. Credential-free compile check of the scaffolded project.
wix build
```

If `wix generate --type SERVICE_PLUGIN` is used instead of the interactive menu,
capture the same evidence; the interactive menu remains the authoritative check
for whether *Bookings Validation* specifically is offered (audit N4).

## 2. Evidence to capture (commit under `reports/evidence/T_VP0/`)

| # | Evidence | File | Resolves |
|---|---|---|---|
| E1 | Full `wix generate` service-plugin menu listing, with explicit yes/no for "Bookings Validation" | `generate-menu.txt` | B5 / M1 / N4 |
| E2 | Generated file tree for the chosen extension(s) (`src/extensions/**`, `.extension.ts` files) | `generated-files.txt` | UQ4 |
| E3 | Real `wix.config.json` FIELD NAMES (values may be recorded but treat app/account identifiers as sensitive; never commit secrets) | `wix-config-fields.json` | UQ4 |
| E4 | Dependency pins from the scaffolded `package.json`: react, react-dom, `@wix/dashboard`, `@wix/dashboard-react`, `@testing-library/*`, typescript, vite/astro tooling | `dependency-pins.json` | UQ3, dashboard SDK minimums (§2.1 audit) |
| E5 | Dev-site selection storage behavior: does `.wix/app.config.json` appear? Is `WIX_SITE_ID` written to `.env.local`? | `dev-site-binding.txt` | UQ1 |
| E6 | Output of `wix build` (compile check) and, if attempted, `wix release --help` flag listing (do NOT release) | `build-output.txt` | UQ2 (partial) |

Rules for evidence files: redact secrets and API keys; account/app IDs may be
recorded for engineering use but must never be presented as production claims.

## 3. Documented fallback if "Bookings Validation" is absent from the generate menu

This fallback is documented on the plugin page itself and ratified by the recon
audit (§2.2) and Technical Contract (§3, SERVICE_PLUGIN row). Quoted verbatim
from those accepted sources:

> "If it does not, the documented fallback is on the same plugin page's REST
> tab: **create the extension in the app dashboard (Extensions → Create
> Extension → filter Bookings → JSON config with `deploymentUri` +
> `validationTargets`) and implement handlers via the SDK** — fully supported."
> — `reports/audits/RECON.md` §2.2 (fetched 2026-08-24 from
> https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/introduction.md)

> "documented fallback: create extension in app dashboard (Extensions → Create
> Extension → Bookings → JSON config `deploymentUri` + `validationTargets`) and
> implement handlers with `bookingsValidation.provideHandlers()` from
> `@wix/bookings/service-plugins`."
> — `docs/WIX_TECHNICAL_CONTRACT.md` §3, SERVICE_PLUGIN row

Fallback procedure:

1. In the app dashboard: **Extensions → Create Extension → Bookings** → choose
   the Bookings Validation plugin.
2. Configure the extension JSON with `deploymentUri` (our backend endpoint that
   implements the handlers) and `validationTargets`
   (`CREATE`, `CANCEL`, `RESCHEDULE` + the multi-service variants we support).
3. Implement handlers with `bookingsValidation.provideHandlers()` from
   `@wix/bookings/service-plugins`, delegating to the pure rules core via the
   platform adapters (Blueprint §4 flow 1). Remember: omitted bulk items
   default to VALID — return explicit results for every index (Contract §5.3).
4. Record in E1 that the fallback path was taken and why.

Note the doc-lag hazard (audit M1): the plugin page's CLI walkthrough links to
the LEGACY CLI; treat those links as stale. The unified CLI decision stands on
the current unified-CLI service-plugin guide plus this empirical menu check.

## 4. After T-VP0

1. Fold E1–E6 into the Technical Contract (Director amends §13/§15 and retires
   UQ1–UQ4 as resolved or keeps them quarantined with new citations).
2. Only then may the validation-plugin handler wiring (cycle-2 task) be marked
   production-trackable; until gates T-VP1–T-VP5 pass, no production-capability
   claim may appear anywhere in product copy (Contract §12).
3. Service-plugin changes take effect only after `wix release` (Contract §6);
   plan dev-site verification cadence accordingly.
