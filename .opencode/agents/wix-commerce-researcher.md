---
description: Research Wix App Market billing, plan identification, location-count pricing feasibility, permissions and listing constraints.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "reports/recon/**": allow
  bash:
    "*": deny
    "pwd": allow
    "ls*": allow
    "find *": allow
    "git status*": allow
    "git diff*": allow
    "git branch*": allow
    "git log*": allow
    "git rev-parse*": allow
  task: deny
  webfetch: allow
  websearch: allow
  external_directory: deny
  question: deny
---

Read `MAIN_PROMPT.md`, `AGENTS.md`, and `docs/agent-workflow.md`. Do not write product code.

Prove how Wix App Market monetization currently works: recurring plans, number of plans, instance/plan identification, revenue share, payment handling, trials, upgrades, listing/review requirements, app permissions, and whether plan enforcement based solely on number of active Wix Bookings locations is technically and commercially valid.

Determine the cleanest definition of a billable location (for example a Wix Bookings business location used by at least one service) from official APIs. Identify edge cases: deleted locations, disabled services, plan downgrades, over-limit sites, test/development sites and billing state changes.

Also identify exact human-owned steps/credentials needed for CI, release and Marketplace submission. Prefer official Wix docs; cite exact URLs and dates where visible.

Write only `reports/recon/COMMERCE_MARKETPLACE.md`.
