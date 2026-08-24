---
description: Build the deterministic booking and availability rule engine, isolated from Wix SDK calls.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "src/domain/**": allow
    "tests/domain/**": allow
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

Read `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/RULES.md`, and `docs/NEXT_CYCLE.md`.

Build only pure deterministic domain behavior assigned for this cycle. No Wix imports are allowed in `src/domain/**`.

Model location/service weekly windows, multiple windows per day, date exceptions/closures, limits, duplicate-rule semantics, precedence, timezone-aware inputs, explainable allow/block results, and only capabilities classified as publishable or safely modeled by the technical contract.

Use explicit types and exhaustive tests including overlapping rules, empty schedules, boundary times, DST/timezone inputs, conflicting overrides, duplicate attempts, limits at N/N+1, and invalid configuration. Never fabricate Wix behavior. Do not touch integration, UI, billing, dependencies, orchestration or governance. Do not commit or push.
