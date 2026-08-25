/**
 * Accessibility suite — labels, keyboard operability, dialog semantics and
 * live-region roles across the whole rendered page.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderRulesEditorPage } from '../../src/ui/pages/rulesEditorPage.js';
import { createEditorStore } from '../../src/ui/state/editorStore.js';
import { openDiffPreviewModal } from '../../src/ui/modals/diffPreviewModal.js';
import { computeScheduleDiff } from '../../src/ui/diff/computeScheduleDiff.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, allByTestId } from './helpers/dom.js';
import { auditLabels, assertKeyboardOperable, assertDialogSemantics } from './helpers/a11y.js';

function fullPage() {
  const doc = createDocument();
  const store = createEditorStore({
    savedRuleSet: null,
    locations: [{ id: 'l1', label: 'Downtown' }],
    services: [{ id: 's1', label: 'Consultation' }],
  });
  // Build a rich, VALID draft so every control variant renders enabled.
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'MON' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'location',
    scopeId: 'l1',
    weekday: 'MON',
    index: 0,
    patch: { start: '09:00', end: '12:00' },
  });
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'service', scopeId: 's1', weekday: 'TUE' });
  store.dispatch({
    type: 'PATCH_WEEK_WINDOW',
    scopeType: 'service',
    scopeId: 's1',
    weekday: 'TUE',
    index: 0,
    patch: { start: '10:00', end: '13:00' },
  });
  store.dispatch({ type: 'ADD_EXCEPTION', date: '2026-12-25' });
  store.dispatch({ type: 'SET_LIMIT', dimension: 'DAY', targetId: null, rawValue: 10 });
  const page = renderRulesEditorPage({
    store,
    document: doc,
    locations: [{ id: 'l1', label: 'Downtown' }],
    services: [{ id: 's1', label: 'Consultation' }],
  });
  doc.body.appendChild(page.root);
  return { doc, store, page };
}

test('every control on the page has an accessible name', () => {
  const { doc, page } = fullPage();
  const violations = auditLabels(doc.body);
  assert.deepEqual(violations, []);
  page.destroy();
});

test('every clickable element is keyboard operable (Enter/Space activation proven)', () => {
  const { doc, page } = fullPage();
  assert.equal(assertKeyboardOperable(doc.body, doc), true);
  page.destroy();
});

test('issues region uses role=alert; status region uses role=status with aria-live', () => {
  const { doc, store, page } = fullPage();
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'WED' });
  assert.equal(byTestId(doc.body, 'issues-list').getAttribute('role'), 'alert');
  const status = byTestId(doc.body, 'action-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  page.destroy();
});

test('diff modal exposes full dialog semantics over the headless DOM', () => {
  const doc = createDocument();
  const { ops, hash } = computeScheduleDiff(
    null,
    { locationWindows: { l1: { MON: [{ start: '09:00', end: '12:00' }] } }, serviceWindows: {}, exceptions: [], limits: [] },
  );
  const controller = openDiffPreviewModal({
    ops,
    renderedHash: hash,
    canConfirm: true,
    document: doc,
  });
  doc.body.appendChild(controller.root);
  assertDialogSemantics(byTestId(controller.root, 'diff-preview-dialog'));
  controller.close();
});

test('review button title explains WHY it is disabled while issues exist', () => {
  const { doc, store, page } = fullPage();
  store.dispatch({ type: 'ADD_WEEK_WINDOW', scopeType: 'location', scopeId: 'l1', weekday: 'THU' }); // incomplete row
  const reviewButton = byTestId(doc.body, 'review-changes');
  assert.equal(reviewButton.disabled, true);
  assert.match(reviewButton.getAttribute('title'), /validation issue/);
  page.destroy();
});
