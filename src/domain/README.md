# Rules domain (pure core)

Deterministic availability/booking rule semantics for Wix Bookings advanced
rules. This layer is pure: **zero Wix SDK imports** (CI purity gate enforces
this over `src/domain/**`), no I/O, no network, no host clock, no environment
reads. All platform signals arrive through `ports.ts` interfaces or the
evaluation deps.

## Module map

| Path | Responsibility |
|---|---|
| `ports.ts` | Canonical adapter ports (accepted contract; cycle-4 ADDITIVE evolution `EvaluationTargetContext` authorized by `docs/NEXT_CYCLE.json` `canonical_contracts_notice`) |
| `model/primitives.ts` | Local dates, wall-clock minutes, weekday math, reserved ids, window interval algebra |
| `time/intlZone.ts` | IANA zone decomposition/construction; DST gap/overlap policies (Contract §4.7) |
| `time/wallClock.ts` | Proposal slot → site-zone wall-clock facts (`resolveSlot`) |
| `windows/weeklyWindows.ts` | Weekly windows per location/service; split hours; location ∩ service intersection |
| `exceptions/exceptions.ts` | Date closures/overrides; CLOSED beats OVERRIDE; same-tier override intersection |
| `limits/limits.ts` | Caps per day/service/location; declared statuses; site-zone day → UTC count bounds |
| `duplicates/duplicates.ts` | Identity-free-first duplicate protection + optional identity key + RESCHEDULE subject exclusion |
| `explain/explain.ts` | Explainable outcomes: stable ruleIds and machine codes, customer-safe messages |
| `validate.ts` | Structural RuleSet validation shared with the dashboard mirror |
| `evaluate.ts` | The single decision function (`evaluateRules`); target-aware per CREATE/CANCEL/RESCHEDULE |

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
- **RESCHEDULE subject exclusion (cycle 4):** when the evaluation carries
  `targetContext.subjectBookingId`, existing facts carrying that booking id are
  skipped — the mover's own still-existing booking never conflicts with its own
  proposed slot, while genuine overlaps with OTHER bookings still block.
  Matching is conservative: facts without a `bookingId` can never match.
- **Known v1 limitation:** start-bucket convention means a native overnight
  booking that starts the PREVIOUS day but overlaps the proposal is not
  caught. Consistent with the caps' bucket convention; revisit with real
  payload evidence at gate T-VP3.

### Target-aware evaluation (cycle 4, RULES-C4-1)

**Motivation (Integration audit `CYCLE_32792897988_INTEGRATION.md` §4–5,
Observation A):** uniform rule evaluation (a) blocked cancelling the only
booking on an at-capacity day because the cap counted the very booking being
cancelled, and (b) flagged a RESCHEDULE overlapping the booker's own
still-existing booking as `DUPLICATE_BOOKING`. Both probes were reproduced by
the independent auditor and escalated to this lane under Director coordination.

**Contract evolution (strictly additive, per the cycle-4
`canonical_contracts_notice`):** `EvaluationDeps` gained one OPTIONAL field,

```ts
targetContext?: EvaluationTargetContext   // src/domain/ports.ts
// EvaluationTargetContext = { target: 'CREATE' | 'CANCEL' | 'RESCHEDULE',
//                             subjectBookingId?: string | null }
```

`EvaluationTarget` aliases the shared `TargetOperation` union (compile-time
sync with `failureSemanticsFor`). The six platform targets collapse onto the
three operations: `*_MULTI_SERVICE` shares its base operation's semantics
(multi-service bookings are sequences of single-service bookings under one
operation); the platform layer performs that mapping. **Safe default:** an
absent context evaluates every family exactly as before cycle 4 — bit-for-bit,
pinned by Part 1 of `tests/domain/targets/targetAware.spec.ts` (executed green
against the unmodified tree BEFORE this change landed). Accepted platform and
billing consumers compile and behave unchanged.

**Per-target rule-family matrix** (binding semantics source: Technical
Contract §5.3 — validation runs before the operation persists; CREATE/CANCEL
fail-closed, RESCHEDULE fail-open):

| Rule family | CREATE | CANCEL | RESCHEDULE |
|---|---|---|---|
| Fail-closed classification (`RULESET_INVALID`, `INVALID_SLOT`, `EVALUATION_ERROR`) | yes | **yes** | yes |
| Entitlement coverage | yes | **no** | yes (proposed slot) |
| Exceptions + weekly windows | yes | **no** | yes (proposed slot) |
| Caps (day / service / location) | yes | **no** | yes (**PROPOSED slot**) |
| Duplicate protection | yes | **no** | yes, excluding the subject booking |

Cell rationale:

- **Classification everywhere.** §5.3 keeps CANCEL fail-closed: an internally
  invalid request or broken ruleset still yields an explicit block, never a
  silent pass. Target-awareness changes WHICH availability families evaluate;
  it never weakens failure semantics.
- **CANCEL: availability families skipped.** The operation REMOVES occupancy:
  - caps count what the cancellation reduces — "cancel-frees-capacity"; a
    maximum count cannot be violated by removing a booking, so evaluating caps
    against counts that include the cancelled booking can only block the
    release of its own capacity (audit probe 1);
  - windows/exceptions describe when a NEW slot may be claimed; the vacated
    slot is not a new claim (a holiday closure must not strand an existing
    reservation);
  - duplicate protection stops double-HOLDING a slot; a cancellation unwinds
    a hold (probe 1's `DUPLICATE_BOOKING` accumulation);
  - entitlement coverage is plan posture governing where OUR rules apply for
    new bookings (§7 over-limit posture: restrict coverage, never trap data);
    it must never block cancelling an existing booking. No entitlement notice
    is emitted for CANCEL either — the family is skipped, not merely satisfied.
- **RESCHEDULE: proposed-slot semantics.** Windows/exceptions/caps evaluate
  exactly as CREATE, against the PROPOSED slot (cap queries bucket the
  proposed site-zone day → UTC bounds, §4.7). Duplicate detection excludes the
  subject booking via `subjectBookingId` while same-service overlaps with OTHER
  bookings (`DUPLICATE_BOOKING`) and cross-service same-key overlaps
  (`IDENTITY_TIME_CONFLICT`) still block (audit probe 2 + controls).

**Honest residuals (disclosed, never hidden — §11 C6 culture):**

1. **RESCHEDULE same-day self-count in caps.** If the subject booking's OLD
   slot falls inside the PROPOSED slot's site-zone day bucket, an authoritative
   counter that includes it can block a same-day reschedule on an at-capacity
   day even though total occupancy would be unchanged. Excluding it would
   require subtracting the subject from authoritative numeric counts based on
   snapshot assumptions the pure domain cannot verify — not done in v1. If
   T-VP evidence shows merchant impact, this needs a Director-coordinated
   platform-side count adjustment, not a domain guess.
2. **`subjectBookingId` depends on unproven payload shape.** Whether RESCHEDULE
   payloads carry the rescheduled booking's identifier is UNPROVEN until the
   payload-probe gates run. Without a subject id the exclusion is inert and
   RESCHEDULE duplicate detection degrades to pre-cycle-4 behavior (own-booking
   overlap can flag). RESCHEDULE enforcement is fail-open best-effort forever
   (§5.3); no enforcement claim is made or permitted (§10 #9, §12).
3. Unknown runtime target values degrade to CREATE semantics (strict typing
   prevents them; the default keeps any such call harmless).

**Dev-site gate implications (Contract §15, T-VP1–T-VP5):**

- **Per-day cap probe must include cancel-frees-capacity:** seed a day at cap,
  cancel the counting booking through a real surface, assert the plugin does
  NOT block the cancellation (optionally follow with a create proving capacity
  was freed). Domain regression: `targetAware.spec.ts` probe 1.
- **Payload-field probe first (T-VP3) extends to RESCHEDULE identity inputs:**
  capture whether real RESCHEDULE payloads carry the rescheduled booking's id
  (feeds `subjectBookingId`) alongside the existing `contactDetails` /
  `metadata.identity` capture. If the id never arrives, residual 2 applies and
  must stay documented — the layer must remain honest rather than ship false
  self-overlap blocks or pretend exclusion.
- **Reschedule surface coverage (widget / dashboard / API):** record that
  domain-level RESCHEDULE evaluation is target-aware while enforcement remains
  FAIL_OPEN best-effort forever; surface coverage claims stay banned until the
  gates pass (§5.3, §10 #9, §12 banned claim 2).
- **Timeout/failure injection:** unchanged binding split — fail-closed
  CREATE/CANCEL vs fail-open RESCHEDULE. Target-awareness never alters failure
  semantics, only family coverage.
- **Out-of-hours create probe (T-VP1):** unchanged; the CREATE path is pinned
  bit-for-bit by the default-contract corpus.

**Standing matrix properties (cycle 5, RULES-C5-1).** The matrix above is now
enforced by executable properties, not only by prose and pin tests:

- **Determinism across the matrix** (`tests/domain/evaluate.spec.ts`,
  "determinism property"): every corpus scenario is repeated under explicit
  CREATE, CANCEL and RESCHEDULE contexts and must produce byte-identical
  outcomes per (scenario, target). The corpus includes split-window scenarios,
  midnight-boundary fits, and DST spring-forward/fall-back fixtures, so the
  guarantee covers the hardest zone math in the matrix.
- **Explanation completeness across the matrix**
  (`tests/domain/evaluate.spec.ts`, "explanation well-formedness"): every
  outcome under ANY target carries full `{ruleId, code, customerMessage}`
  explanations from the closed engine-family vocabulary, with jargon-free
  customer text (no internal identifiers, no machine codes).
- **CANCEL-tail drift guard** (`tests/domain/targets/matrixProperties.spec.ts`):
  CANCEL outcomes may contain ONLY classification-family explanations
  (`ruleset`: `BOOKING_ALLOWED` / `RULESET_INVALID` / `INVALID_SLOT` /
  `EVALUATION_ERROR`). The forbidden-family set is DERIVED from the CANCEL
  column of the matrix table above, so a future notice-emitting family that
  forgets the CANCEL branch fails loudly (anti-vacuity injection proofs
  included), and changing CANCEL behavior requires a conscious matrix edit.
- **Matrix ↔ code consistency**
  (`tests/domain/targets/matrixProperties.spec.ts`): each matrix cell is tied
  to an observed per-target behavior probe; documentation drift in either
  direction fails the suite (deliberate doc-drift simulation included), and
  the accepted cells are pinned outright. The same suite pins the frozen
  cycle-5 `ports.ts` contract (SHA-256 `d46e0743…18802`,
  `canonical_contracts_notice`) so a freeze breach fails in-suite.

## Fail-closed classification

`evaluateRules` never throws. Invalid configuration ⇒ `RULESET_INVALID`;
malformed slots ⇒ `INVALID_SLOT`; unexpected internal failures ⇒
`EVALUATION_ERROR` — all surfaced as blocking explanations with
customer-safe messages that never embed internal identifiers.

## Reserved rule ids

Engine explanation families `weekly-windows`, `entitlement`, `ruleset`,
`limits` are reserved; user-supplied limit/exception ids must not collide with
them (validated against the single constant in `model/primitives.ts`).

## Test-suite ownership note (shared vitest glob)

Domain suites (`tests/domain/**`) execute through the platform-owned vitest
config (`src/platform/vitest.config.ts`), whose include glob is
`tests/**/*.spec.ts` (Rules-lane audit CYCLE_32787032785, observation N3).
That glob is shared infrastructure this lane depends on: it must stay intact,
because narrowing it would silently drop the entire domain suite from the repo
runner. The integration lane must never narrow it, and any packaging/config
change must keep all lanes' specs collected (see `docs/NEXT_CYCLE.json`,
"vitest_glob_rule").
