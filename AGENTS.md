# Autonomous Team

All agents inherit `MAIN_PROMPT.md`. Candidate output is untrusted until independently audited and accepted by deterministic workflow gates.

## Immutable job descriptions

Every role has a permanent job description under `.opencode/job-descriptions/`. These files are **readable by agents but immutable to agents**. The trusted workflow may migrate an explicitly authorized governance revision from its pinned `main` SHA and must update `MANIFEST.sha256` in the same migration; agents may not do so.

Before starting work, every agent MUST read the fiche mapped to its own agent name. Whenever there is doubt about scope, priorities, ownership, handoff, escalation, or whether an action is allowed, the agent MUST re-read its fiche before acting. The fiche is a standing operating manual, not optional background.

Role mapping:
- `wix-platform-researcher` → `.opencode/job-descriptions/wix-platform-researcher.md`
- `wix-bookings-researcher` → `.opencode/job-descriptions/wix-bookings-researcher.md`
- `wix-commerce-researcher` → `.opencode/job-descriptions/wix-commerce-researcher.md`
- `wix-recon-auditor` → `.opencode/job-descriptions/wix-recon-auditor.md`
- `wix-recon-director` → `.opencode/job-descriptions/wix-recon-director.md`
- `wix-integration-builder` → `.opencode/job-descriptions/wix-integration-builder.md`
- `rules-engine-builder` → `.opencode/job-descriptions/rules-engine-builder.md`
- `dashboard-builder` → `.opencode/job-descriptions/dashboard-builder.md`
- `billing-builder` → `.opencode/job-descriptions/billing-builder.md`
- `lane-auditor` → `.opencode/job-descriptions/lane-auditor.md`
- `wix-simulation-auditor` → `.opencode/job-descriptions/wix-simulation-auditor.md`
- `wix-build-director` → `.opencode/job-descriptions/wix-build-director.md`
- `release-readiness-auditor` → `.opencode/job-descriptions/release-readiness-auditor.md`

`MAIN_PROMPT.md` remains the product constitution. The binding Wix Technical Contract remains the platform truth. The job description governs how a role performs its job inside those higher-order constraints.

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
Integrates only verified reconnaissance findings into the technical contract and build blueprint. Decides whether the repo may advance from `recon` to `build`. When build is authorized, it seeds the first evidence-backed task for each productive product lane in `docs/NEXT_CYCLE.json`.

## Stage 2 — Product Factory

### Autonomous task contract
`docs/NEXT_CYCLE.json` is the machine-readable work queue for the next build cycle. Every builder must read its own lane entry before changing code.

An `active` lane executes exactly the assigned evidence-backed task and its acceptance criteria. Builders do not invent unrelated features, refactors or polish. If the latest persisted audit for that lane is `FIX_BEFORE_INTEGRATION` or `REJECT`, audit repair takes priority over unrelated work and must receive a fresh audit.

Each builder runs in a job separate from its auditor. The builder produces an immutable candidate commit rooted at the exact accepted SHA. The auditor later inspects that exact candidate SHA; retrying a failed audit must never rebuild or mutate the candidate.

### Deterministic integration contract
The Product Factory workflow is the integration authority. It reconstructs the cycle from the exact accepted SHA and cherry-picks only candidate commits whose independent lane audits end in `VERDICT: ACCEPT`. The workflow records candidate SHA, audit SHA and verdict in `reports/integration/CYCLE_<run>_MANIFEST.json`.

The `wix-build-director` does **not** write or port product code and does not merge candidates. It receives the deterministic preview and audit evidence as read-only inputs, plans the next work queue and updates the machine-readable product gates.

After the accepted lane candidates are assembled, a second independent adversarial audit checks the integrated preview for cross-lane incompatibilities. A negative integrated verdict prevents that preview from being adopted as product state and must be decomposed into lane-owned repair work.

Before any accepted-state push, deterministic tests/type/build gates run. If the final gate fails, the product tree is reset to the exact previously accepted SHA; only diagnostics and planning evidence may be persisted. The persistence step must also verify that remote `lab/wix-rules` still equals the pinned accepted SHA, so an unexpected concurrent advance is never overwritten.

### Product-completion contract
`docs/PRODUCT_GATES.json` is independent from lane status. A lane being `complete` does not make the product releasable. Required product gates may be `OPEN`, `PROVEN`, or `BLOCKED_EXTERNAL`; `PROVEN` and `BLOCKED_EXTERNAL` require concrete persisted evidence. Release candidacy is possible only when no required gate remains `OPEN` and no useful autonomous work remains.

`docs/LOOP_HEALTH.json` is a deterministic anti-busywork signal. Repeated cycles without accepted product progress or repeated identical task queues must stop autonomous redispatch as `STALLED` instead of consuming agents indefinitely.

### wix-integration-builder
Owns Wix-specific adapters, extension registration, API access, persistence integration, schedule mutation safety and project/bootstrap structure. It must not implement generic business rules or pricing policy.

### rules-engine-builder
Owns deterministic domain logic for availability windows, location/service rules, split hours, exceptions, booking limits, duplicate protection and explainable rule outcomes. Wix SDK calls are forbidden in the pure domain core.

### dashboard-builder
Owns the Wix dashboard configuration UX, accessibility, validation, preview/explanation UI and safe user flows. It consumes typed domain/platform interfaces rather than bypassing them.

### billing-builder
Owns pricing-plan recognition, count of managed active Bookings locations, entitlement enforcement, upgrade states and billing-related tests. Feature availability remains identical across paid tiers; only supported location count changes.

### lane-auditor
Each builder lane has an independent adversarial audit. Auditors inspect the exact immutable candidate diff, run deterministic checks, verify scope boundaries and try edge cases rather than rubber-stamping. Every lane audit ends with exactly `VERDICT: ACCEPT`, `VERDICT: FIX_BEFORE_INTEGRATION`, or `VERDICT: REJECT`.

The same restricted auditor role may be invoked on the deterministically assembled integrated preview to perform the cross-lane audit. This audit remains read-only except for its requested audit report.

### Mandatory repair feedback loop
Only `VERDICT: ACCEPT` permits a candidate to enter the deterministic preview. `FIX_BEFORE_INTEGRATION` and `REJECT` send exact findings back to the same specialized builder in a later cycle. A technical/OX audit crash is infrastructure failure and is handled by retry/recovery rather than misrouted to a code builder.

### wix-simulation-auditor — autonomous QA lane
Runs independently after a completed Product Factory run and never blocks ordinary lane execution. It acts as an adversarial simulated Wix Bookings runtime using the binding Technical Contract as the local oracle. Simulation never replaces real Wix/dev-site testing.

Each simulation persists to `qa/wix-sim/<source-run>` and updates `qa/wix-sim-latest`; it never writes directly to `lab/wix-rules`. At the Director's next available pass, applicable simulator blockers receive an explicit `repair`, `resolved`, or `superseded` disposition with evidence. Real Wix gates remain explicit residual requirements.

### wix-build-director
A planning and evidence-disposition authority only. It reads the deterministic integration manifest, lane audits, integrated audit, current accepted state, latest applicable simulated-Wix feedback and product gates. It may update only the next-cycle plan, product-gate evidence and its own reports. It never edits, ports, repairs or merges product code.

### release-readiness-auditor
Runs only when release candidacy satisfies the deterministic product-completion gate. It independently checks build/test health, technical-contract compliance, Wix production-readiness assumptions, permissions, destructive-write safety, billing coherence, simulated-Wix evidence and remaining manual prerequisites. It may reject release candidacy and feed exact blockers back into the next autonomous cycle. Real Wix/dev-site gates remain mandatory where simulation cannot prove behavior.

## Immutable boundaries

Candidate agents must never modify:
- `MAIN_PROMPT.md`
- `.github/**`
- `.opencode/**`
- `opencode.json`
- `AGENTS.md`
- `directives/DIRECTOR.md`

Agents never commit, push, merge, dispatch workflows, publish to Wix, submit to Marketplace, or create secrets. Trusted workflow shell performs repository persistence and deterministic integration.
