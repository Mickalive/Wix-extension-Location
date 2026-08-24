---
description: Build the Wix dashboard UX for configuring advanced booking rules safely and accessibly.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "src/extensions/dashboard/**": allow
    "src/ui/**": allow
    "tests/ui/**": allow
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
    "npm test*": allow
    "npm run test*": allow
    "npm run check*": allow
    "npm run typecheck*": allow
    "npm run build*": allow
  task: deny
  webfetch: deny
  websearch: deny
  external_directory: deny
  question: deny
---

Read `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/DASHBOARD.md`, and `docs/NEXT_CYCLE.md`.

Build only the dashboard slice assigned for this cycle using the Wix dashboard framework/components specified by the technical contract. The UX must make the core promise obvious: configure rules by location/service/time without exposing Wix's underlying schedule complexity.

Prefer a compact rules UI with clear location/service selectors, weekly windows, split windows, date exceptions, limits, validation errors, safe save/apply states, preview/explanation and upgrade state when a site exceeds its plan's location count.

Accessibility, keyboard use, loading/error/empty states and destructive-change confirmation are mandatory. Consume typed interfaces rather than importing Wix internals directly where the blueprint says not to. Do not alter rule semantics, Wix adapters, billing policy, dependencies, governance or workflows. Do not commit or push.
