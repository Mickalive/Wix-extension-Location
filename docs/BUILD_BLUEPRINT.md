# Build Blueprint — Advanced Rules for Wix Bookings

- **Status:** ACTIVE (phase `build`, cycle 1). Companion to `docs/WIX_TECHNICAL_CONTRACT.md` (binding). Changes require Director approval.
- **Prime directive:** the rule core is pure, deterministic TypeScript with zero Wix imports; every Wix SDK/API call lives behind an adapter interface that the domain consumes.

---

## 1. Module map

Lives inside the unified-CLI project layout (`src/pages`, `src/extensions`, `extensions.ts` are CLI-owned). Product layering:

```
src/
  domain/                      # RULES-ENGINE LANE. Pure TS. NO @wix/* imports (CI-enforced).
    ports.ts                   #   all adapter interfaces the domain consumes
    model/                     #   RuleSet, Window, Exception, Limit, Identity, RuleOutcome types
    windows/                   #   weekly windows per location/service, split hours, gap math
    exceptions/                #   date-specific closures/overrides, precedence
    limits/                    #   caps per day / service / location, status-inclusive counting policy
    duplicates/                #   identity-free-first duplicate protection (+ optional identity key)
    explain/                   #   explainable outcomes: ruleId, human message, machine code
    time/                      #   injected Clock/Zone; site-IANA-zone day-boundary math; DST-safe
  platform/                    # INTEGRATION LANE. All Wix SDK/API usage.
    adapters/                  #   implementations of domain/ports.ts backed by Wix SDK/REST
      scheduleGateway.ts       #     Calendar V3 reads/writes, snapshots, idempotency keys, revisions
      availabilityGateway.ts   #     Time Slots V2
      bookingCountGateway.ts   #     Count Extended Bookings (UTC filters) + TTL cache
      configStore.ts           #     data collections access, schema-drift tolerant (C4)
      clock.ts                 #     real clock/zone
    validation-plugin/         #   bookingsValidation.provideHandlers wiring -> domain evaluation
    webhooks/                  #   event extensions: dedup by envelope id, entityEventSequence ordering,
                               #   counter reconciliation, billing plan webhooks
    http/                      #   src/pages/api handlers + auth.getTokenInfo() verification
    schedule-mutation/         #   snapshot -> diff -> apply -> verify -> rollback orchestrator (Contract §9)
    registration/              #   extensions.ts, extension configs, scaffold runbook (T-VP0)
  billing/                     # BILLING LANE.
    pure/                      #   no Wix imports: tier mapping, entitlement state machine,
                               #   coverage ordering, decision tables
    counter/                   #   billable-location algorithm (pure core takes fetched pages as input;
                               #   thin Wix paging adapters live in platform/adapters)
    enforcement/               #   entitlement gate consumed by validation-plugin path & dashboard
    upgrade/                   #   upgrade URL builder, warning-signal model (fail-open posture C5)
  dashboard/                   # DASHBOARD LANE. React + @wix/design-system + @wix/dashboard.
    pages/RulesEditor/         #   location/service windows, split hours, exceptions, caps
    pages/LocationsUsage/      #   billable-location meter, plan allowance, upgrade CTA
    modals/                    #   apply confirmations (diff view), previews
    explain/                   #   renders domain RuleOutcome explanations
    services/                  #   typed bridge to platform/http endpoints ONLY (fetchWithAuth)
  shared/                      # joint ownership; changes need Director coordination.
    types.ts                   #   cross-lane DTOs (RuleSetDTO, ValidationRequestDTO, ...)
    errors.ts                  #   error taxonomy mapped to fail-closed/fail-open semantics
tests/
  domain/  billing/  dashboard/  platform/  contracts/   # mirrors above; contracts/ = fake↔adapter parity
```

## 2. Ownership boundaries (hard)

| Lane | Owns | Must NOT do |
|---|---|---|
| **integration-builder** | `src/platform/**`, `src/extensions/**` + `extensions.ts`, `src/pages/api/**`, data-collection schemas, webhook handlers, schedule-mutation safety, scaffold runbook | No business rules, no pricing policy, no UI |
| **rules-engine-builder** | `src/domain/**`, `tests/domain/**` | Any `@wix/*` import, any I/O, any network/time dependence not injected via ports |
| **dashboard-builder** | `src/dashboard/**`, `tests/dashboard/**` | Direct Wix SDK/REST calls outside `services/` bridge; bypassing domain validators |
| **billing-builder** | `src/billing/**`, `tests/billing/**` | Feature gating that differs by tier beyond location count; inventing entitlement mechanisms |
| **Director only** | `src/shared/**` edits, cross-lane merges, contract/blueprint changes | — |

Dependency direction (enforced in review): `dashboard → shared ← domain`; `platform → domain (ports) + shared`; `billing → domain/shared`; `domain → nothing but stdlib`. The CI gate greps `src/domain/**` and `src/billing/pure/**` for `@wix/` imports and fails on match.

## 3. Core ports (domain-owned interfaces, platform-implemented)

```ts
// src/domain/ports.ts (shape indicative, finalized by rules lane with Director sign-off)
export interface Clock { now(): Instant; zone(): IanaZone }            // site IANA zone
export interface RulesConfigStore {
  loadActiveRuleSet(): Promise<RuleSet | null>;
  saveRuleSet(next: RuleSet, expectedRevision: string): Promise<RuleSet>;
}
export interface ScheduleGateway {
  snapshotWorkingHours(scope: ScheduleScope): Promise<ScheduleSnapshot>;        // Contract §9.1
  applyWindowChanges(plan: MutationPlan): Promise<ApplyResult>;                 // idempotency keys + revisions
  verifyApplied(plan: MutationPlan): Promise<VerifyResult>;
  rollbackTo(snapshot: ScheduleSnapshot): Promise<RollbackResult>;
}
export interface AvailabilityGateway { slots(q: SlotQuery): Promise<Slot[]> }
export interface BookingCountGateway { count(q: CountQuery): Promise<number> } // UTC-bounded, cached
export interface EntitlementGate {                             // implemented by billing lane
  allowedLocationIds(): Promise<PolicyDecision>;               // stable ordering, over-limit signal
}
```

Rule evaluation signature (pure): `evaluateRules(input: BookingFacts, rules: RuleSet, deps: {clock; counts; entitlement}): RuleOutcome` where `RuleOutcome = {decision: 'allow'|'block', explanations: Explanation[]}` and every block carries a customer-safe message plus a machine `code` (e.g., `QUOTA_EXCEEDED` style codes per plugin docs).

## 4. Binding data flows

1. **Booking-time enforcement:** Wix → validation-plugin handler (`platform/validation-plugin`) → load active RuleSet (`configStore`) → evaluate pure rules → return explicit per-item results for EVERY bulk index (omitted items default valid!) → record explanation entry → respond fast (cached counts; timeout ⇒ blocked create).
2. **Configuration:** dashboard page → `services/` bridge → HTTP endpoint with token verification → domain-side validation of the proposed RuleSet → revision-checked save → never auto-applies to schedules without the mutation flow (4).
3. **Schedule application:** user reviews diff modal → orchestrator runs Contract §9 sequence (snapshot→apply→verify→rollback-on-failure) → audit collection entry → progress/result surfaced in dashboard.
4. **Counters:** booking webhooks (dedup by `id`, ordered by `entityEventSequence`) maintain cached counters; authoritative count via `BookingCountGateway` at validation time with short TTL; discrepancies reconcile lazily; counter failure ⇒ fail-closed for caps is NOT automatic — caps degrade per rule configuration and the incident is logged + surfaced (never silently).
5. **Billing:** plan webhooks + periodic Get App Instance reconciliation (no trial-conversion event exists) → entitlement state machine → `EntitlementGate` feeds both enforcement coverage and dashboard meter; billing API failure ⇒ fail-open + persistent dashboard warning (C5).

## 5. Error model

- Domain blocks always carry `{ruleId, code, customerMessage}`; customerMessage is jargon-free (displayed verbatim by Wix).
- Platform errors map to target semantics: CREATE/CANCEL paths fail-closed (return block-with-retry-hint), RESCHEDULE path must assume fail-open (log + alert; never claim enforcement).
- Entitlement/counting infrastructure errors: fail-open + warning flag persisted so dashboard shows degraded state.
- All writes idempotent; retries safe; no partial multi-event applies left unverified (orchestrator reconciles from snapshot).

## 6. Test strategy per lane

- **rules:** exhaustive Vitest on window math (split hours, gaps, overnight?), exceptions precedence, caps boundary semantics (inclusive/exclusive defined in tests), duplicate identity-free logic, DST fixtures (spring-forward/fall-back per site-zone), determinism property (same input ⇒ same outcome), explanation completeness (every decision explains itself).
- **integration:** fake-adapter contract tests; orchestrator tests incl. kill-the-power mid-apply recovery (T-RB1 simulation); webhook chaos tests (dupes/reordering); token-verification unit tests; schema-drift persistence tests (C4); grep gate proving domain purity.
- **dashboard:** render/interaction tests (@testing-library), validation-mirror tests importing pure domain validators, accessibility assertions (labels, roles, keyboard), diff-modal correctness (shows exactly what will change).
- **billing:** pagination tests (>50 locations, >100 services), intersection/dedup, archived exclusion, CUSTOM-only floor 0→1, entitlement decision table (free/trial/paid/dunning/expired/clones), over-limit ordering stability, fail-open warning emission.
- **Global CI gate:** `npm ci && npm run test:unit && wix build` credential-free; purity greps; typecheck.

## 7. Extension registration plan (executed when credentials exist)

1. Human scaffold/bind (Contract §16) → commit scaffold minus gitignored internals; capture T-VP0 evidence (generate menu contents, `wix.config.json` fields, dependency pins).
2. Generate `DASHBOARD_PAGE` (RulesEditor), `DASHBOARD_MODAL`(s), `EVENT` extensions; create data collections via interactive menu; register Bookings Validation service plugin via generate menu or documented dashboard fallback.
3. Freeze permission set (Contract §5) BEFORE first release — later additions force major versions.
4. `wix release --version-type minor` cadence for iteration; service-plugin changes effective only after release.

## 8. MVP scope fence

In: capabilities 1–10 as classified (reschedule best-effort), 4-plan billing, dashboard UX, counters, audit log, rollback safety.
Out of MVP: site-facing UI, availability-provider/policy shaping plugins, Set Service Locations automation, location mutation, external databases, AI features, PREVIEW_GATED anything (none currently required).

## 9. Build-cycle sequencing (indicative, Director re-plans each cycle)

- **Cycle 1:** ports + fakes + orchestrator skeleton (integration); domain core v1 (rules); editor shell + validation mirror (dashboard); counting algorithm + entitlement engine (billing). All credential-free.
- **Cycle 2:** wire validation-plugin handler shape to domain; webhook counter maintenance; dashboard↔HTTP bridge; billing enforcement hook consumption; contract tests between lanes.
- **Cycle 3+ (credentials permitting):** T-VP0 scaffold evidence, empirical gates T-VP*/T-WH*/T-BK*/T-RB*, then production-claim hardening and release prep.

— End of blueprint.
