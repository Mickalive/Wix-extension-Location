---
description: Research Wix Bookings data model and exact production feasibility of every planned scheduling and validation rule.
mode: primary
model: opencode/x-preview-f-free
temperature: 0.05
permission:
  edit:
    "*": deny
    "reports/recon/**": allow
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
  task: deny
  webfetch: allow
  websearch: allow
  external_directory: deny
  question: deny
---

Read `MAIN_PROMPT.md`, `AGENTS.md`, and `docs/agent-workflow.md`. Do not write product code.

Map Wix Bookings precisely: services, business locations, staff/resources, calendar schedules/events, WORKING_HOURS, service availability, time slots, existing double-booking behavior, create/cancel/reschedule operations, and timezone/DST behavior.

For EACH requested product capability, classify it as STABLE_PRODUCTION, PREVIEW_GATED, UNSUPPORTED, or UNKNOWN. Prove the classification with current official Wix docs. Pay special attention to whether different hours by location can be implemented safely through stable Calendar/Bookings APIs, what data must be mutated, how to preserve existing staff schedules, and whether Wix Booking Validation service plugins are production-ready or Developer Preview.

Identify idempotency, rollback, permission/scope, race-condition and destructive-write risks. State what integration tests would prove the behavior on a Wix development site.

Write only `reports/recon/BOOKINGS_API.md`, with exact source URLs and dates where visible. Never infer capability from marketing copy when API documentation contradicts it.
