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
Integrates only verified findings into the technical contract and build blueprint. Decides whether the repo may advance from `recon` to `build`. When build is authorized, it must seed the first evidence-backed task for each productive product lane in `docs/NEXT_CYCLE.json`.

## Stage 2 — Product Factory

### Autonomous task contract
`docs/NEXT_CYCLE.json` is the machine-readable work queue for the next build cycle. Every builder must read its own lane entry before changing code.

An `active` lane must execute exactly the assigned evidence-backed task and its acceptance criteria. Builders do not invent unrelated features, refactors or polish. If the latest persisted audit for that lane is `FIX_BEFORE_INTEGRATION` or `REJECT`, audit repair takes priority over the scheduled task and must be completed before new work.

After each cycle, the Director must replace completed work with the next highest-value non-redundant task justified by accepted evidence. A lane may be marked `complete` only with completion evidence, or `blocked` only by a concrete external prerequisite. The global process must keep useful lanes moving autonomously until no evidence-backed work remains, at which point the Director must propose `release_candidate` rather than manufacture busywork.

### wix-integration-builder
Owns Wix-specific adapters, extension registration, API access, persistence integration, schedule mutation safety and project/bootstrap structure. It must not implement generic business rules or pricing policy.

### rules-engine-builder
Owns deterministic domain logic for availability windows, location/service rules, split hours, exceptions, booking limits, duplicate protection and explainable rule outcomes. Wix SDK calls are forbidden in the pure domain core.

### dashboard-builder
Owns the Wix dashboard configuration UX, accessibility, validation, preview/explanation UI and safe user flows. It consumes typed domain/platform interfaces rather than bypassing them.

### billing-builder
Owns pricing-plan recognition, count of managed active Bookings locations, entitlement enforcement, upgrade states and billing-related tests. Feature availability must remain identical across paid tiers; only supported location count changes.

### lane-auditor
Each builder lane has an independent adversarial audit. Auditors inspect the real candidate diff, run deterministic checks, verify scope boundaries and try edge cases rather than rubber-stamping. Every audit ends with exactly `VERDICT: ACCEPT`, `VERDICT: FIX_BEFORE_INTEGRATION`, or `VERDICT: REJECT`.

### Mandatory repair feedback loop
Only `VERDICT: ACCEPT` permits integration. `FIX_BEFORE_INTEGRATION` and `REJECT` send the exact findings back to the same specialized builder in the next autonomous cycle. That builder must repair the findings before starting new feature work, add regression tests, and submit a fresh candidate to a new independent audit. A technical/OX audit crash is infrastructure failure and is handled by retry/recovery rather than being misrouted to a code builder.

### wix-simulation-auditor — autonomous QA lane
Runs independently after a completed Product Factory run and NEVER appears in the Product Factory dependency chain. It must not delay builders, lane audits, the Director, or dispatch of the next product cycle.

It reconstructs the four candidate branches over their common accepted base in an isolated worktree and acts as an adversarial simulated Wix Bookings runtime using only the binding Technical Contract as the local platform oracle. It runs deterministic tests plus cross-lane scenarios for multi-location/service hours, staff-hour intersection, split windows, exceptions, DST, caps, duplicate protection, create/cancel/reschedule behavior, concurrency/idempotency, schedule rollback, pagination, billing/location counting, downgrade handling and dashboard confirmation safety. Simulation never replaces real Wix/dev-site testing.

Each simulation persists to `qa/wix-sim/<source-run>` and updates `qa/wix-sim-latest`; it never writes directly to `lab/wix-rules`. At the Director's next available pass, the latest QA report is mounted if present. Every simulator blocker must then receive an explicit disposition: `repair`, `resolved`, or `superseded`, with evidence. A `repair` finding becomes evidence-backed work for the responsible lane(s). A finding already fixed by the current cycle may be marked `resolved` only with concrete tests/diff evidence. Missing/not-yet-finished simulation evidence does not block the current product cycle.

### wix-build-director
The only integration authority and continuous team planner. It reads candidates and lane audits immediately, and also consumes the latest available asynchronous simulated-Wix feedback when present. It ports only `ACCEPT` lane work into `lab/wix-rules`, preserves failed-audit and unresolved simulation findings as repair work, resolves accepted cross-lane conflicts, runs integration checks, writes the next evidence-backed tasks to `docs/NEXT_CYCLE.json`, and decides continue/stop/release_candidate.

### release-readiness-auditor
Runs only when the Director proposes a release candidate. It checks build/test health, technical-contract compliance, Wix production-readiness assumptions, permissions, destructive-write safety, billing coherence and remaining manual prerequisites. It must also check whether simulated-Wix evidence is sufficiently recent and whether unresolved simulator blockers remain. It may reject release candidacy and feed exact blockers back into the next autonomous cycle. Real Wix/dev-site gates remain mandatory where simulation cannot prove behavior.

## Immutable boundaries

Candidate agents must never modify:
- `MAIN_PROMPT.md`
- `.github/**`
- `.opencode/**`
- `opencode.json`
- `AGENTS.md`
- `directives/DIRECTOR.md`

Agents never commit, push, merge, dispatch workflows, publish to Wix, submit to Marketplace, or create secrets. Trusted workflow shell performs repository persistence.
