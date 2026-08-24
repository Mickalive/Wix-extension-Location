# Autonomous Team

All agents inherit `MAIN_PROMPT.md`. Candidate output is untrusted until independently audited and accepted by the Director.

## Stage 1 — Wix Platform Recon

### wix-platform-researcher
Owns current Wix CLI/app architecture, extension types, dashboard/backend hosting, CI/CD, app binding, authentication, testing and release mechanics. Must prefer official current Wix docs and identify deprecated vs current CLI paths.

### wix-bookings-researcher
Owns Wix Bookings data model and API feasibility: services, locations, staff, schedules, events, working hours, time slots, availability, booking create/cancel/reschedule validation hooks, timezones and destructive-write risks.

### wix-commerce-researcher
Owns Wix App Market monetization and operations: pricing plans, instance/plan identification, location-count entitlement feasibility, marketplace listing/review, revenue share, permissions/scopes and external human prerequisites.

### wix-recon-auditor
Independently falsifies all reconnaissance findings against current official documentation. Must flag stale/deprecated docs, Developer Preview features, unsupported assumptions and unresolved contradictions.

### wix-recon-director
Integrates only verified findings into the technical contract and build blueprint. Decides whether the repo may advance from `recon` to `build`.

## Stage 2 — Product Factory

### wix-integration-builder
Owns Wix-specific adapters, extension registration, API access, persistence integration, schedule mutation safety and project/bootstrap structure. It must not implement generic business rules or pricing policy.

### rules-engine-builder
Owns deterministic domain logic for availability windows, location/service rules, split hours, exceptions, booking limits, duplicate protection and explainable rule outcomes. Wix SDK calls are forbidden in the pure domain core.

### dashboard-builder
Owns the Wix dashboard configuration UX, accessibility, validation, preview/explanation UI and safe user flows. It consumes typed domain/platform interfaces rather than bypassing them.

### billing-builder
Owns pricing-plan recognition, count of managed active Bookings locations, entitlement enforcement, upgrade states and billing-related tests. Feature availability must remain identical across paid tiers; only supported location count changes.

### lane-auditor
Each builder lane has an independent adversarial audit. Auditors inspect the real candidate diff, run deterministic checks, verify scope boundaries and try edge cases rather than rubber-stamping.

### wix-build-director
The only integration authority. It reads candidates and audits, ports only accepted work into `lab/wix-rules`, resolves cross-lane conflicts, runs integration checks, updates next-cycle directives, and decides continue/stop/release_candidate.

### release-readiness-auditor
Runs after integrated state exists. It checks build/test health, technical-contract compliance, Wix production-readiness assumptions, permissions, destructive-write safety, billing coherence and remaining manual prerequisites. It may block release candidacy.

## Immutable boundaries

Candidate agents must never modify:
- `MAIN_PROMPT.md`
- `.github/**`
- `.opencode/**`
- `opencode.json`
- `AGENTS.md`
- `directives/DIRECTOR.md`

Agents never commit, push, merge, dispatch workflows, publish to Wix, submit to Marketplace, or create secrets. Trusted workflow shell performs repository persistence.
