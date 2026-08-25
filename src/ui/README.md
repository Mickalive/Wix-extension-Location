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
| `pages/rulesEditorPage.js` | Page assembly: windows by location/service, split rows, exceptions, caps, issues, statuses, actions. |
| `modals/diffPreviewModal.js` | Contract §9.2 informed-consent dialog. |
| `state/editorStore.js` | Deterministic state machine: draft, issues, hash-gated confirmation, save/apply states. |
| `diff/computeScheduleDiff.js` | Deterministic ops + FNV-1a hash + human descriptions. |
| `validation/mirror.js` | Single seam between UI and rule-validation semantics (`setValidationSource`). |
| `validation/ruleDraftValidators.js` | Provisional bundled validators (see below). |
| `services/bridge.js` | Typed bridge to platform HTTP endpoints; the ONLY module permitted to reference Wix runtime modules (enforced by test). |
| `explain/explainPanel.js` | Renders typed domain `Explanation[]` outcomes verbatim; never re-implements evaluation. |

## Decisions of record

1. **Provisional validators (audit F-N1, Director-tracked).** Rule-validation
   semantics belong to the rules lane. Canonical `src/domain` validators do not
   exist in the accepted base yet, so `validation/ruleDraftValidators.js`
   carries a narrow provisional mirror wired through the single repoint seam
   `mirror.setValidationSource()`. When the Rules lane reaches VERDICT: ACCEPT,
   the Director's tracked obligation is to repoint that seam at the canonical
   validators and add a cross-lane parity contract test. No other file changes.
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
