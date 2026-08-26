# Dashboard lane (`src/ui`)

Native Wix dashboard configuration experience for advanced booking rules,
built credential-free until the first authenticated scaffold (Contract §16,
gate T-VP0). The React + `@wix/design-system` mount is deliberately deferred
until that scaffold pins the real dependency versions (Contract §8.4 / UQ3);
this cycle ships real, tested UI structure and behavior instead of a mockup.

## Layout

| Path | Role |
|---|---|
| `dom/kit.js` | Tiny DOM abstraction standing in for the deferred React mount; product code receives its document via options, never reads globals. |
| `pages/rulesEditorPage.js` | Page assembly: windows by location/service, split rows, exceptions, caps, issues, statuses, actions; plus the §7 management-side entitlement restriction (DASH-C5-1, decision 9). |
| `pages/locationsUsagePage.js` | Billable-location meter page (DASH-C4-1a): count vs plan allowance, over-limit state, persistent degraded banner, floor note, upgrade CTA. |
| `upgrade/upgradeUrl.js` | Dashboard-lane mirror of the contracted Contract §7 upgrade URL builder (see decisions below). |
| `modals/diffPreviewModal.js` | Contract §9.2 informed-consent dialog. |
| `state/editorStore.js` | Deterministic state machine: draft, issues, hash-gated confirmation, save/apply states. |
| `state/mutationPoller.js` | Bounded mutation-status poll controller: stops permanently on terminal state or bridge error; never auto-recovers. |
| `diff/computeScheduleDiff.js` | Deterministic ops + FNV-1a hash + human descriptions. |
| `validation/mirror.js` | Single seam between UI and rule-validation semantics (`setValidationSource`). |
| `validation/ruleDraftValidators.js` | Provisional bundled validators (see below). |
| `services/bridge.js` | Typed bridge to platform HTTP endpoints; the ONLY module permitted to reference Wix runtime modules (enforced by test). Exposes the rule-set endpoints, the mutation-lifecycle pair `getMutationStatus(planId)` / `recover(scope)`, and the entitlement meter `getEntitlementMeter()` — each matching the accepted/pinned platform DTOs. |
| `explain/explainPanel.js` | Renders typed domain `Explanation[]` outcomes verbatim; never re-implements evaluation. |

## Decisions of record

1. **Provisional validators (audit F-N1, Director-tracked).** Rule-validation
   semantics belong to the rules lane. Canonical `src/domain` validators do not
   exist in the accepted base yet, so `validation/ruleDraftValidators.js`
   carries a narrow provisional mirror wired through the single repoint seam
   `mirror.setValidationSource()`. When the Rules lane reaches VERDICT: ACCEPT,
   the Director's tracked obligation is to repoint that seam at the canonical
   validators and add a cross-lane parity contract test. No other file changes.
   **DASH-C3-1 extension (F-N1 repoint, UI half):** the seam now also accepts a
   server-shaped `ValidationResult` (`{valid, issues}` — the exact PUT /ruleset
   domain-side validation response shape from canonical
   `src/domain/validate.ts`) injected verbatim; the mirror adapts it into a
   source function returning its issues unchanged. The bundled provisional
   validators remain the offline fallback, behavior is unchanged when
   unconfigured, and non-conforming sources are rejected fail-closed.
2. **React/design-system mount deferred** to T-VP0 dependency pinning; not
   faked. `dom/kit.js` mirrors the small browser surface used here so the port
   is mechanical.
3. **Consent gating is triple-layered** (Contract §9.2): reducer refuses to
   open review or land confirmation while validation issues exist; the page
   disables "Review changes" with an explanatory title while issues exist;
   the modal independently disables Confirm and lists blocking issues in a
   `role="alert"` warning if ever open with an invalid draft.
4. **No silent controls.** Save/Apply always drive a visible `role="status"`
   region: pending, saved/applied, or explicit unavailable messaging when the
   backend is not connected.
5. **Mutation lifecycle surfaced honestly (DASH-C3-1, Blueprint §4 flow 3).**
   A confirmed apply polls `getMutationStatus(planId)` through
   `state/mutationPoller.js` until the journal reaches a TERMINAL state
   (everything outside the orchestrator's `{SNAPSHOT_PERSISTED,
   APPLY_IN_PROGRESS}` allowlist) and renders that outcome in the status
   region. Polling is hard-bounded and stops permanently on terminal state or
   bridge error. One confirmed consent covers exactly one apply attempt: every
   terminal outcome clears the confirmation so retries require fresh review +
   confirm. Crash-mid-apply recovery exists ONLY as an explicit button that
   calls `bridge.recover(scope)` on click with the scope observed from the
   journal — nothing auto-retries or auto-applies anything destructive
   (Contract §9.2). Recovery outcomes render mismatches/notes verbatim rather
   than pretending success.
6. **Entitlement transparency (DASH-C4-1a, Blueprint §1 pages/LocationsUsage,
   §4 flow 5, Contract §7).** The meter page renders the PINNED cross-lane
   `GET /meter` DTO (`{meter:{count,degraded}, coverage:{allowedLocationIds,
   overLimit,degraded,warning}}`, identically pinned in INT-C4-1c and
   `docs/NEXT_CYCLE.json`) through `bridge.getEntitlementMeter()`. Bridge-side
   strict shape validation means a drifted payload surfaces as typed
   BAD_RESPONSE instead of invented entitlement state; 404 maps to an honest
   n/a state. UI obligations: count vs plan allowance (the allowance is exactly
   the covered-ids length when over limit), over-limit notice with the stable-
   ordering note (default location first, then alphabetical) and a "nothing is
   deleted" reassurance, single-location floor note at count 0, a PERSISTENT
   degraded-warning banner whenever any degraded flag or warning is present
   (fail-open posture must never render as silently healthy — the positive
   "within your plan" note is suppressed on any degraded signal), and an
   upgrade CTA implementing the buildUpgradeUrl contract opened in a NEW tab,
   shown when `overLimit` or tier-restricted. Identifiers arrive injected from
   the dashboard host at scaffold time and are never fabricated: without them
   the restriction notices still render but no link can.
7. **Upgrade URL mirror (DASH-C4-1a).** `upgrade/upgradeUrl.js` mirrors the
   accepted billing builder `src/billing/upgrade/upgradeUrl.ts` byte-for-byte
   in behavior because this lane's Node runner cannot import TypeScript. The
   T-VP0 React/TS port must replace it with a direct import of the billing
   module (same conscious-repoint pattern as the validation mirror).
8. **Recovery-guidance honesty + poller containment (DASH-C4-1b/c/d; audit
   findings N-A/N-B/N-C of CYCLE_32792897988_DASHBOARD).**
   - N-A: failed-state guidance mentions "Recover interrupted apply" ONLY when
     `state.lastMutation?.scope` is known — the affordance cannot render
     without a ScheduleScope, so mentioning it otherwise was unfollowable.
   - N-B: a trivial synchronous in-flight guard collapses same-tick multi-
     clicks on the recover control into one bridge call.
   - N-C: `pollMutationUntilTerminal` wraps `onObservation` exceptions into
     the standard ERROR outcome instead of propagating; polling still stops
     permanently.
   The parity ledger constraint is respected: `ruleDraftValidators.js` is
   byte-for-byte unchanged; R1–R4 decisions of record apply only at the future
   mirror repoint.
9. **Management-side entitlement restriction in the editor (DASH-C5-1;
   Contract §7 "restrict rule management/enforcement coverage to the plan
   allowance"; Blueprint §4 flow 5).** `pages/rulesEditorPage.js` loads the
   billable-location meter once at open through the typed bridge method
   `getEntitlementMeter()` (pinned v1 DTO consumed verbatim — no DTO changes)
   and exposes a host-facing `reload()` seam with the same in-flight guard.
   Behavior contract:
   - **Healthy coverage:** locations OUTSIDE `coverage.allowedLocationIds`
     are visibly restricted for NEW rule configuration — a per-scope badge +
     note (carrying the stable-ordering phrase "default location first, then
     alphabetical"), disabled add-window buttons, read-only window inputs,
     and a locked per-location limit input. EXISTING configuration for those
     locations stays rendered read-only and is NEVER deleted or silently
     dropped: valid rows have no deletion path (Remove disabled) and the
     draft is never rewritten by the page.
   - **Anti-trap corollary:** any control whose current value contributes a
     validation issue (row path, bucket-level path such as an overlap, or
     `limits.LOCATION.<id>`) stays correctable/removable under restriction,
     so plan restriction can never trap the editor in a permanently invalid
     draft. Restriction is a plan boundary, not a brick wall.
   - **Degraded coverage fails OPEN exactly like enforcement (C5):** when
     `coverage.degraded` is true the covered-location list is not trusted for
     restriction (enforcement covers everything while failing open), so the
     editor shows the persistent warning and restricts nobody off that list.
   - **`meter.degraded`** renders the persistent fail-open warning banner
     (`role="alert"`) inside the editor too — warn, never brick editing.
   - **`coverage.overLimit`** surfaces the Contract §7 upgrade CTA (exact
     `buildUpgradeUrl` contract URL, `target="_blank"`, `rel="noopener
     noreferrer"`) alongside the Locations usage page. Identifiers are
     host-injected via `options.upgrade` and never fabricated: without valid
     ones the over-limit section still renders but no link can.
   - **404/null meter** (endpoint may be absent pre-integration of newer
     platform code) degrades to today's unrestricted editor behind a
     non-blocking `role="status"` info notice; typed bridge failures behave
     the same with honest wording. A bridge without the meter method (legacy
     fakes/pre-meter builds) stays silently idle. Never a crash; late
     resolutions after `destroy()` are dropped.

## Repair provenance (cycle 2, DASH-C2-1-REPAIR)

This candidate was rebuilt from the accepted base because the cycle-1
candidate was never integrated (its audit verdict was FIX_BEFORE_INTEGRATION)
and its worktree is not part of accepted state. Every audit finding is
addressed:

- **F-B1** — `describeOp('UPDATE_EXCEPTION')` renders prior → new kind+hours
  (e.g. `Change exception - 2026-12-25: closed all day -> open 10:00-14:00`)
  including note changes; `describeOp('REMOVE_EXCEPTION')` describes the
  removed entry's kind/hours. Regression tests assert both against rendered
  modal lines, not just the renderer output.
- **F-B2** — see decision 3 above; negative UI tests prove Confirm cannot
  reach a confirmed state through the UI while any issue is open.
- **F-N2** — focus restore-on-close implemented in the modal controller.
- **F-N3** — no probe/placeholder files exist in this tree; a hygiene test
  guards their absence.
- **F-N4** — visible pending/unavailable Save/Apply feedback (decision 4).
- **F-N5** — malformed 2xx JSON bodies map to typed `BridgeError('BAD_RESPONSE')`.
- **F-N6** — the row-scoped weekday-resolution regression guard lives at
  `tests/ui/windowRowWeekdayResolution.test.js` (descriptive name).
- **F-N7** — non-canonical weekday buckets surface as explicit
  `UNKNOWN_WEEKDAY` diff operations instead of being silently dropped.

## Persistence notes for the trusted shell / auditor

- `tests/ui/zzscratch.test.js` (an intentionally emptied remnant of a temporary
  diagnostic scaffold used to isolate the time-parsing defect) was deleted by
  the Director at integration time per audit CYCLE_32787032785_DASHBOARD
  finding N-1. The valuable regression it produced lives in
  `tests/ui/ruleDraftValidators.test.js` ("time parsing captures the minutes
  group…"). The builder sandbox has no delete primitive.

## Running the lane suite

```bash
cd tests/ui && npm run test:unit
```

Node built-in test runner; zero dependencies, zero credentials, zero network.
