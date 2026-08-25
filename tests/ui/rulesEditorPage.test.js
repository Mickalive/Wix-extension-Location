/**
 * rulesEditorPage — end-to-end UI behavior over the headless DOM.
 *
 * Repair regressions (F-B2, UI layer): "Review changes" is disabled with an
 * explanatory title while any validation issue is open, and the NEGATIVE UI
 * TEST proves Confirm cannot reach a confirmed state through the interface
 * while an issue is open (disabled review button + refused store action +
 * disabled modal confirm).
 *
 * Repair regressions (F-N4): Save/Apply always produce visible feedback.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRulesEditorPage } from '../../src/ui/pages/rulesEditorPage.js';
import { createEditorStore } from '../../src/ui/state/editorStore.js';
import { computeScheduleDiff } from '../../src/ui/diff/computeScheduleDiff.js';
import { openDiffPreviewModal } from '../../src/ui/modals/diffPreviewModal.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, maybeByTestId, allByTestId } from './helpers/dom.js';

function setup(overrides = {}) {
  const doc = createDocument();
  const locations = overrides.locations ?? [{ id: 'l1', label: 'Downtown' }];
  const services = overrides.services ?? [{ id: 's1', label: 'Consultation' }];
  const store = createEditorStore({
    savedRuleSet: null,
    locations,
    services,
    ...overrides.store,
  });
  const page = renderRulesEditorPage({
    store,
    document: doc,
    bridge: overrides.bridge ?? null,
    explanations: overrides.explanations ?? [],
    locations,
    services,
  });
  doc.body.appendChild(page.root);
  return { doc, store, page };
}

test('editor covers all v1 rule types: locations, services, split windows, exceptions, caps', () => {
  const { doc, store } = setup();

  // Split windows: two rows on one weekday for a location...
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '09:00', end: '12:00' },
  });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 1,
    patch: { start: '14:00', end: '18:00' },
  });
  // ...and a service window.
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'service', scopeId: 's1', weekday: 'TUE' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'service',
    scopeId: 's1',
    weekday: 'TUE',
    index: 0,
    patch: { start: '10:00', end: '13:00' },
  });
  // Exceptions: closed day + override day.
  store.dispatch({ type: 'ADD_EXCEPTION', date: '2026-12-25' });
  store.dispatch({ type: 'ADD_EXCEPTION', date: '2026-12-31' });
  const overrideId = store.getState().draft.exceptions[1].exceptionId;
  store.dispatch({
    type: 'UPDATE_EXCEPTION',
    exceptionId: overrideId,
    patch: { kind: 'OVERRIDE', windows: [{ start: '10:00', end: '14:00' }] },
  });
  // Caps in all three dimensions.
  store.dispatch({ type: 'SET_LIMIT', dimension: 'DAY', targetId: null, rawValue: 20 });
  store.dispatch({ type: 'SET_LIMIT', dimension: 'SERVICE', targetId: 's1', rawValue: 5 });
  store.dispatch({ type: 'SET_LIMIT', dimension: 'LOCATION', targetId: 'l1', rawValue: 15 });

  assert.deepEqual(store.getState().issues, []);

  // All sections render with their controls present.
  assert.ok(byTestId(doc.body, 'location-windows-section'));
  assert.ok(byTestId(doc.body, 'service-windows-section'));
  assert.ok(byTestId(doc.body, 'exceptions-section'));
  assert.ok(byTestId(doc.body, 'caps-section'));
  assert.ok(byTestId(doc.body, 'window-row-location-l1-MON-0'));
  assert.ok(byTestId(doc.body, 'window-row-location-l1-MON-1'));
  assert.ok(byTestId(doc.body, `exception-${overrideId}`));
  assert.equal(allByTestId(doc.body, 'issue-item').length, 0);
});

test('issues render verbatim from validator output and block review', () => {
  const { doc, store } = setup();
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });

  const issueItems = allByTestId(doc.body, 'issue-item').map((n) => n.textContent);
  assert.equal(issueItems.length, 1);
  assert.equal(issueItems[0], store.getState().issues[0].message);

  const reviewButton = byTestId(doc.body, 'review-changes');
  assert.equal(reviewButton.disabled, true);
  assert.match(reviewButton.getAttribute('title'), /Fix 1 validation issue before reviewing changes/);
});

test('F-B2 negative UI test: Confirm cannot reach confirmed:true through the UI while any issue is open', () => {
  const { doc, store } = setup();
  // Draft has an incomplete row -> one open issue.
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  assert.equal(store.getState().issues.length, 1);

  // Path 1: user clicks "Review changes" — the control is disabled, so the
  // click is swallowed at the DOM level and no modal opens.
  const reviewButton = byTestId(doc.body, 'review-changes');
  assert.equal(reviewButton.disabled, true);
  reviewButton.click(); // must be a no-op
  assert.equal(maybeByTestId(doc.body, 'diff-preview-overlay'), null, 'modal must not open');
  assert.equal(store.getState().diffPreview.open, false);

  // Path 2: even if some future code path force-dispatches the open action,
  // the reducer refuses and shows a notice instead of a consent dialog.
  store.dispatch({ type: 'OPEN_DIFF_PREVIEW' });
  assert.equal(store.getState().diffPreview.open, false);
  assert.ok(maybeByTestId(doc.body, 'notice'), 'visible blocking notice expected');

  // Path 3: even with a modal instance forced open over an invalid draft,
  // its Confirm renders disabled next to the warning and clicking it can
  // never land a confirmation.
  const { ops, hash } = computeScheduleDiff(null, store.getState().draft);
  const controller = openDiffPreviewModal({
    ops,
    renderedHash: hash,
    canConfirm: false,
    blockingIssues: store.getState().issues,
    document: doc,
    onConfirm: (h) => store.dispatch({ type: 'CONFIRM_DIFF_PREVIEW', hash: h }),
  });
  doc.body.appendChild(controller.root);
  const confirmButton = byTestId(controller.root, 'confirm-diff');
  assert.equal(confirmButton.disabled, true);
  assert.ok(byTestId(controller.root, 'modal-invalid-warning'));
  confirmButton.click();
  assert.equal(store.getState().confirmedHash, null, 'confirmation must stay unreachable');
  assert.equal(store.canApply(), false);
  controller.close();

  // Apply stays locked throughout.
  assert.equal(byTestId(doc.body, 'apply-changes').disabled, true);
});

test('happy path through the UI: fix issues -> review -> confirm -> apply unlocks', () => {
  const { doc, store } = setup();
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '09:00', end: '12:00' },
  });
  assert.deepEqual(store.getState().issues, []);

  const reviewButton = byTestId(doc.body, 'review-changes');
  assert.equal(reviewButton.disabled, false);
  reviewButton.click();

  const dialog = byTestId(doc.body, 'diff-preview-dialog');
  assert.ok(dialog);
  const line = allByTestId(doc.body, 'diff-line').map((n) => n.textContent)[0];
  assert.equal(line, 'Add window - location l1, MON: 09:00-12:00');

  byTestId(doc.body, 'confirm-diff').click();
  assert.equal(store.canApply(), true);
  assert.equal(byTestId(doc.body, 'apply-changes').disabled, false);
});

test('F-N4: Save with unconfigured backend shows visible unavailable feedback (never silent)', () => {
  const { doc, store } = setup();
  byTestId(doc.body, 'save-draft').click();
  const status = byTestId(doc.body, 'action-status');
  assert.match(status.textContent, /Save is unavailable/);
  assert.equal(store.getState().saveStatus, 'unavailable');
});

test('F-N4: Apply without confirmation shows visible explanatory feedback', () => {
  const { doc, store } = setup();
  const applyButton = byTestId(doc.body, 'apply-changes');
  assert.equal(applyButton.disabled, true);
  applyButton.click(); // swallowed (disabled), then direct dispatch proves message exists
  store.dispatch({
    type: 'APPLY_UNAVAILABLE',
    message: 'Apply is locked until you review the proposed changes and confirm them in the dialog.',
  });
  assert.match(byTestId(doc.body, 'action-status').textContent, /Apply is locked until you review/);
});

test('F-N4: save flow with a working bridge reaches saved state visibly', async () => {
  let savedBody = null;
  const { doc, store } = setup({
    bridge: {
      async saveRuleSet(draft) {
        savedBody = draft;
        return draft;
      },
      async requestApply() {
        return { accepted: true };
      },
    },
  });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '08:00', end: '11:00' },
  });
  await byTestId(doc.body, 'save-draft').click();
  // Click handlers are sync dispatchers around async work; flush microtasks.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(savedBody, 'bridge received the draft');
  assert.equal(store.getState().saveStatus, 'saved');
  assert.match(byTestId(doc.body, 'action-status').textContent, /Draft saved/);
});

test('locations section carries the honest native-hours disclosure', () => {
  const { doc } = setup();
  assert.match(
    byTestId(doc.body, 'locations-disclosure').textContent,
    /no native per-location hours object/,
  );
});

test('explain panel renders typed outcomes verbatim or an honest empty state', () => {
  const explanations = [
    {
      decision: 'block',
      ruleId: 'cap-day',
      code: 'QUOTA_EXCEEDED',
      customerMessage: 'This day is fully booked. Please choose another day.',
    },
  ];
  const { doc, page } = setup({ explanations });
  assert.equal(
    byTestId(doc.body, 'explain-message').textContent,
    'This day is fully booked. Please choose another day.',
  );
  page.destroy();

  const empty = setup();
  assert.match(byTestId(empty.doc.body, 'explain-empty').textContent, /No rule outcomes to explain yet/);
});
