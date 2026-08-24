---
description: Build Wix plan detection and location-count entitlements with all paid features equal across tiers.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "src/billing/**": allow
    "tests/billing/**": allow
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
    "npm test*": allow
    "npm run test*": allow
    "npm run check*": allow
    "npm run typecheck*": allow
  task: deny
  webfetch: deny
  websearch: deny
  external_directory: deny
  question: deny
---

Read `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/BILLING.md`, and `docs/NEXT_CYCLE.md`.

Implement only billing/entitlement work assigned for this cycle. All paid plans expose identical features; only maximum managed active Wix Bookings locations differs.

Target tiers remain 1, 3, 10, and 11+ locations at the prices in MAIN_PROMPT unless the Director changes only implementation details based on verified Wix constraints. Do not invent Wix billing state or plan APIs. Model plan state behind typed adapters supplied by the integration layer when necessary.

Test location counting definition, upgrade/downgrade transitions, deleted/disabled locations, over-limit behavior, test/development instances, unknown plan states and failure-safe behavior. Never delete customer configuration on downgrade; disable excess management safely and explain upgrade state.

Do not touch domain rules, dashboard UI, Wix adapters, dependencies, governance or workflows. Do not commit or push.
