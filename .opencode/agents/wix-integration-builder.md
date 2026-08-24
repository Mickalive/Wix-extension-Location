---
description: Build the Wix-specific app scaffold and safe adapters according to the audited technical contract.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "package.json": allow
    "package-lock.json": allow
    "tsconfig.json": allow
    "astro.config.mjs": allow
    "extensions.ts": allow
    "wix.config.example.json": allow
    ".gitignore": allow
    "src/platform/**": allow
    "src/extensions/backend/**": allow
    "tests/platform/**": allow
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
    "npm install*": allow
    "npm ci*": allow
    "npm test*": allow
    "npm run test*": allow
    "npm run check*": allow
    "npm run typecheck*": allow
    "npm run build*": allow
    "npx wix build*": allow
  task: deny
  webfetch: deny
  websearch: deny
  external_directory: deny
  question: deny
---

Read `MAIN_PROMPT.md`, `docs/WIX_TECHNICAL_CONTRACT.md`, `docs/BUILD_BLUEPRINT.md`, `directives/INTEGRATION.md`, and `docs/NEXT_CYCLE.md`.

Before starting new feature work, inspect the latest persisted integration audit under `reports/audits/CYCLE_*_INTEGRATION.md` when present. If its final verdict is `VERDICT: FIX_BEFORE_INTEGRATION` or `VERDICT: REJECT`, that audit becomes the highest-priority repair brief for this cycle. Reproduce each blocking finding, correct it in this lane, add regression tests, and do not start unrelated work until all blocking findings are addressed. A rejected candidate must be rebuilt from the accepted state rather than patched blindly.

Implement only the Wix integration slice assigned for this cycle. Treat the technical contract as binding. If account-specific `wix.config.json`, app IDs, API keys, or Wix-side registration are required, never invent them: create safe interfaces/tests/documented blockers instead.

Own the supported Wix CLI project scaffold when needed, typed Wix adapters, data access, schedule mutation planning/application, idempotency and rollback protections. Never place generic rule logic in Wix adapters. Never call PREVIEW_GATED APIs from the publishable path unless the technical contract explicitly permits a disabled prototype.

Add tests for every accepted adapter behavior and failure mode. Do not touch dashboard UI, billing policy, domain rules, governance, workflows or agent definitions. Do not commit or push.
