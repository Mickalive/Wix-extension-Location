# MAIN PROMPT — WIX BOOKINGS ADVANCED RULES

## Mission

Build a production-quality native Wix marketplace extension that adds advanced availability and booking rules to Wix Bookings without replacing Wix Bookings.

The commercial objective is a small, reliable, recurring-revenue plugin that is easy to install, easy to understand, low-support, and useful to real Wix Bookings businesses.

## Core product promise

One app that controls WHEN, WHERE, and UNDER WHAT CONDITIONS a Wix Bookings reservation may happen.

Initial product capabilities, subject to Wix production API feasibility:

1. Different booking/opening hours by location.
2. Different booking hours by service.
3. Split daily windows, e.g. 09:00–12:00 and 14:00–18:00.
4. Date-specific exceptions, closures, holidays, and temporary overrides.
5. Duplicate-booking protection where Wix native behavior does not already guarantee the desired rule.
6. Maximum booking counts per day.
7. Maximum booking counts per service.
8. Maximum booking counts per location when technically sound.
9. Advanced cancellation and rescheduling rules only if supported by stable production-capable Wix APIs.
10. Clear preview/explanation of which rule allowed or blocked a booking.

Do NOT build a locations-directory/display plugin. Do NOT replace Wix Bookings. Do NOT build a standalone SaaS, chatbot, or AI assistant.

## Pricing model

All paying plans expose the same product features. Pricing differs only by the number of active Wix Bookings locations managed by the plugin.

Target launch tiers to implement only after Wix billing feasibility is confirmed:
- 1 location: USD 9.99/month
- 2–3 locations: USD 19.99/month
- 4–10 locations: USD 34.99/month
- 11+ locations: USD 49.99/month

The implementation must count relevant active Bookings locations defensibly. Never invent an entitlement mechanism unsupported by Wix.

## Technical truth over feature ambition

Before production code is built, the repository must contain an independently audited Wix Technical Contract based primarily on current official Wix documentation.

Every capability must be classified as one of:
- STABLE_PRODUCTION: supported by current production-capable Wix APIs/frameworks.
- PREVIEW_GATED: technically possible only through Developer Preview or otherwise unstable APIs; code may be prototyped behind a disabled feature flag but must not be relied on for the publishable MVP.
- UNSUPPORTED: not safely implementable with the current platform; do not fake it.

No agent may turn a PREVIEW_GATED or UNSUPPORTED capability into a production claim.

## Required architecture principles

- Native Wix app/extension using the current supported Wix CLI/framework unless reconnaissance proves another Wix-supported architecture is superior.
- Prefer Wix-managed hosting, authentication, SDKs, dashboard components, billing, and marketplace distribution.
- Use the Wix dashboard for configuration; avoid unnecessary site-facing UI.
- Keep business-rule logic deterministic and testable outside Wix through adapters/interfaces.
- Isolate Wix API integration from rule evaluation.
- Persist only data necessary for the plugin.
- Minimize scopes and permissions.
- No external AI/LLM dependency in the product.
- No unnecessary external database or infrastructure.
- No hidden scraping or browser automation against Wix.
- No secrets committed to the repository.
- Account-specific Wix identifiers or credentials must never be fabricated.

## Quality bar

The accepted branch must move toward an actually publishable plugin, not a mockup.

Every accepted behavior must have:
- deterministic unit tests where practical,
- negative and edge-case tests,
- timezone/DST consideration,
- idempotency where writes can be repeated,
- safe error handling,
- no silent destructive schedule rewrites,
- least-privilege Wix permissions,
- accessible dashboard UI,
- clear migration/rollback behavior for any Wix schedule mutations.

Never overwrite or destroy pre-existing Wix schedule data without a reversible strategy and explicit user intent.

## Agent governance

The persistent accepted branch is `lab/wix-rules`.

Candidate agents work from the accepted branch in isolated cycle branches. Their output is untrusted until audited.

Independent auditors must inspect real diffs and run deterministic checks. They must actively try to falsify correctness.

The Director is the only agent authorized to integrate candidate work into the accepted branch. The Director must reject work when evidence is insufficient, tests fail, API assumptions are unproven, or the product becomes less coherent.

The Director must maintain:
- `docs/WIX_TECHNICAL_CONTRACT.md`
- `docs/BUILD_BLUEPRINT.md`
- `docs/NEXT_CYCLE.md`
- `docs/state.json`
- audit/director reports

`MAIN_PROMPT.md`, orchestration, agent definitions, and security boundaries are immutable to candidate agents.

## Two-stage development process

### Stage 1 — Wix Platform Reconnaissance

Before product construction, specialized research agents independently determine:
- current Wix CLI/app architecture,
- how dashboard pages/plugins and backend/service extensions work,
- Wix Bookings service/location/staff/calendar data model,
- how staff working hours and business hours affect availability,
- which APIs can read and update schedules safely,
- what validation hooks exist and whether they are production-ready,
- billing/subscription/plan identification,
- marketplace review and distribution constraints,
- testing/development-site workflow,
- CI authentication requirements,
- security/scopes,
- known preview/deprecation hazards.

Reconnaissance agents must cite exact official documentation URLs and dates when available. Community evidence may identify pain, but platform capability claims require official sources when possible.

An independent Recon Auditor verifies the findings. A Recon Director then writes the Technical Contract and Build Blueprint. Only when the contract is sufficient may `docs/state.json` advance from `recon` to `build`.

### Stage 2 — Product Factory

Specialized builders operate in parallel:
- Wix Integration Builder
- Rules Engine Builder
- Dashboard UX Builder
- Billing & Entitlements Builder

Each builder has an independent auditor. Cross-functional integration is performed only by the Director.

The build loop repeats from the persistent accepted state until the Director marks the product `release_candidate` or a genuine external blocker prevents progress.

## Product judgment

Prefer a small, reliable feature set that can be sold over a broad half-working suite.

If Wix already solves a behavior natively, do not duplicate it unless our workflow is materially better.

If a planned feature becomes native or technically impossible, remove or redesign it rather than preserving obsolete scope.

The commercial wedge remains simple:
“Advanced rules for Wix Bookings — including different hours by location.”

## Stop conditions

The autonomous loop may stop only when:
- a release candidate passes deterministic checks and release-readiness audit; or
- an external prerequisite controlled by the human owner is required (for example a Wix account binding/API key, marketplace submission action, legal/payment onboarding, or production-only manual verification); or
- Wix platform constraints make the current product concept nonviable.

When stopped for an external prerequisite, leave the repository in the most complete testable state possible and document the exact minimum human action required.
