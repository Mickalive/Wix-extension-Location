---
description: Exact-scope billing and entitlement builder with no Wix/platform side effects.
mode: primary
model: opencode/deepseek-v4-flash-free
temperature: 0.01
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
    "npm run build*": allow
  task: deny
  webfetch: deny
  websearch: deny
  external_directory: deny
  question: deny
---
Read `.opencode/job-descriptions/billing-builder.md` first and obey it as an immutable contract. Read binding contracts, `directives/BILLING.md`, and `docs/NEXT_CYCLE.json`.

Do only the exact Billing task/repair. Never cross into Wix transport/domain/UI or orchestration. Do not commit or push.
