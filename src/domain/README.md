# Rules domain (pure core)

Deterministic availability/booking rule semantics for Wix Bookings advanced
rules. This layer is pure: **zero Wix SDK imports** (CI purity gate enforces
this over `src/domain/**`), no I/O, no network, no host clock, no environment
reads. All platform signals arrive through `ports.ts` interfaces or the
evaluation deps.

## Module map

| Path | Responsibility |
|---|---|
| `ports.ts` | Canonical adapter ports (accepted contract; frozen — see `docs/NEXT_CYCLE.json`) |
| `model/primitives.ts` | Local dates, wall-clock minutes, weekday math, reserved ids, window interval algebra |
| `time/intlZone.ts` | IANA zone decomposition/construction; DST gap/overlap policies (Contract §4.7) |
| `time/wallClock.ts` | Proposal slot → site-zone wall-clock facts (`resolveSlot`) |
| `windows/weeklyWindows.ts` | Weekly windows per location/service; split hours; location ∩ service intersection |
| `exceptions/exceptions.ts` | Date closures/overrides; CLOSED beats OVERRIDE; same-tier override intersection |
| `limits/limits.ts` | Caps per day/service/location; declared statuses; site-zone day → UTC count bounds |
| `duplicates/duplicates.ts` | Identity-free-first duplicate protection + optional identity key |
| `explain/explain.ts` | Explainable outcomes: stable ruleIds and machine codes, customer-safe messages |
| `validate.ts` | Structural RuleSet validation shared with the dashboard mirror |
| `evaluate.ts` | The single decision function (`evaluateRules`) |

## Binding semantics

### Time zones and DST (Contract §4.7)

- The IANA tz database (via platform `Intl`) is the only zone authority; day
  boundaries are always computed in the SITE zone supplied with the proposal,
  never in UTC and never in the host zone.
- Spring-forward nonexistent local times advance to the next valid local time
  (the transition instant). Example: America/New_York 2026-03-08 02:30
  resolves to 03:00 EDT (`07:00Z`).
- Fall-back ambiguous local times resolve to their first occurrence; the
  second occurrence is never produced by this domain.
- Count/cap day buckets are computed in the site zone, then converted to the
  UTC-bounded intervals that Wix count APIs require.

### Midnight boundary (B4 repair)

A slot ENDING exactly at next-day local midnight is minute **1440** of the
target day (exclusive), so it fits a configured window ending at `24:00`
(`[0,1440)` etc.). A slot ending AFTER midnight on the next day is a genuine
overnight span and is blocked as `overnight_slot`. v1 never fits overnight
spans into weekly windows.

### Weekly windows

- Windows are declared per weekday; any number of windows per weekday models
  split hours. Window ends are exclusive; `24:00` is legal only as an end.
- If BOTH service and location declare windows for the weekday, effective
  availability is their INTERSECTION (never the union).
- If NO weekly window exists anywhere in the RuleSet, weekly evaluation is
  unconstrained (fresh-install default-open posture). Once ANY weekly window
  exists, the week is exhaustive: an unconfigured weekday/scope is closed.

### Exceptions

- Exact-date matching gives bounded overrides automatic expiry.
- `CLOSED` beats `OVERRIDE` on the same date.
- Multiple overrides on one date intersect (empty intersection ⇒ closed).

### Caps

- At-limit (`count >= maxCount`) blocks; one-under allows; declared
  `includedStatuses` decide what counts (cancellations free capacity).
- Counter unavailability degrades fail-open WITH a visible explanation notice
  (never silently, never by throwing) per Blueprint §4 flow 4.

### Duplicate protection

- Identity-free first (Contract §11 C1): same service + overlapping interval
  (half-open; back-to-back is allowed, contained intervals conflict) whose
  existing booking STARTS on the proposal's site-zone day blocks regardless of
  identity.
- Identity key (only when supplied): same key + overlapping time + different
  service ⇒ `IDENTITY_TIME_CONFLICT`.
- **Known v1 limitation:** start-bucket convention means a native overnight
  booking that starts the PREVIOUS day but overlaps the proposal is not
  caught. Consistent with the caps' bucket convention; revisit with real
  payload evidence at gate T-VP3.

## Fail-closed classification

`evaluateRules` never throws. Invalid configuration ⇒ `RULESET_INVALID`;
malformed slots ⇒ `INVALID_SLOT`; unexpected internal failures ⇒
`EVALUATION_ERROR` — all surfaced as blocking explanations with
customer-safe messages that never embed internal identifiers.

## Reserved rule ids

Engine explanation families `weekly-windows`, `entitlement`, `ruleset`,
`limits` are reserved; user-supplied limit/exception ids must not collide with
them (validated against the single constant in `model/primitives.ts`).
