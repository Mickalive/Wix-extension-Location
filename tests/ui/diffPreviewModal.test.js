/**
 * diffPreviewModal — the Contract §9.2 informed-consent gate.
 *
 * Repair regressions (F-B1): rendered lines must expose both prior and new
 * kind+hours for exception updates, and the removed entry's kind/hours for
 * removals — asserted against the RENDERED modal content, not just the
 * renderer function.
 *
 * Repair regressions (F-B2 layer 3): with blocking issues present the Confirm
 * button renders disabled next to a role="alert" warning listing the issues,
 * and clicking it can never confirm.
 *
 * Repair regression (F-N2): focus moves into the dialog on open and is
 * restored to the previously focused element on close.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { openDiffPreviewModal } from '../../src/ui/modals/diffPreviewModal.js';
import { computeScheduleDiff } from '../../src/ui/diff/computeScheduleDiff.js';
import { createDocument } from '../../src/ui/dom/kit.js';
import { byTestId, allByTestId } from './helpers/dom.js';
import { assertDialogSemantics } from './helpers/a11y.js';

function savedSet() {
  return {
    locationWindows: {},
    serviceWindows: {},
    exceptions: [{ exceptionId: 'e1', date: '2026-12-25', kind: 'CLOSED', windows: [], note: '' }],
    limits: [],
  };
}

function draftSet() {
  return {
    locationWindows: {},
    serviceWindows: {},
    exceptions: [
      {
        exceptionId: 'e1',
        date: '2026-12-25',
        kind: 'OVERRIDE',
        windows: [{ start: '10:00', end: '14:00' }],
        note: '',
      },
    ],
    limits: [],
  };
}

function openModal(doc, overrides = {}) {
  const { ops, hash } = computeScheduleDiff(savedSet(), draftSet());
  const confirmed = [];
  let cancelled = 0;
  const controller = openDiffPreviewModal({
    ops,
    renderedHash: hash,
    canConfirm: true,
    document: doc,
    onConfirm: (h) => confirmed.push(h),
    onCancel: () => {
      cancelled += 1;
    },
    ...overrides,
  });
  return { controller, ops, hash, confirmed, cancelled: () => cancelled };
}

test('renders the CLOSED -> OVERRIDE update with prior and new kind+hours in the dialog', () => {
  const doc = createDocument();
  const { controller } = openModal(doc);
  const lines = allByTestId(controller.root, 'diff-line').map((node) => node.textContent);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'Change exception - 2026-12-25: closed all day -> open 10:00-14:00');
  assertDialogSemantics(byTestId(controller.root, 'diff-preview-dialog'));
});

test('renders removals with the removed entry kind/hours in the dialog', () => {
  const doc = createDocument();
  const saved = savedSet();
  const draft = draftSet();
  draft.exceptions = [];
  const { ops, hash } = computeScheduleDiff(saved, draft);
  const controller = openDiffPreviewModal({
    ops,
    renderedHash: hash,
    canConfirm: true,
    document: doc,
  });
  const lines = allByTestId(controller.root, 'diff-line').map((node) => node.textContent);
  assert.equal(
    lines[0],
    'Remove exception - 2026-12-25: closed all day',
  );
});

test('dialog exposes roles, labelled title, summary and change-set reference', () => {
  const doc = createDocument();
  const { controller, hash } = openModal(doc);
  const dialog = byTestId(controller.root, 'diff-preview-dialog');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.getAttribute('aria-labelledby'));
  assert.match(byTestId(controller.root, 'diff-summary').textContent, /Nothing changes until you confirm/);
  assert.match(byTestId(controller.root, 'diff-hash').textContent, new RegExp(hash));
});

test('confirm click reports the rendered hash exactly once; cancel closes without confirming', () => {
  const doc = createDocument();
  const { controller, hash, confirmed } = openModal(doc);
  byTestId(controller.root, 'confirm-diff').click();
  assert.deepEqual(confirmed, [hash]);
  controller.close();

  const second = openModal(createDocument());
  byTestId(second.controller.root, 'cancel-diff').click();
  assert.deepEqual(second.confirmed, []);
  assert.equal(second.cancelled(), 1);
});

test('Escape closes via the cancel path and never confirms', () => {
  const doc = createDocument();
  const { controller, confirmed, cancelled } = openModal(doc);
  byTestId(controller.root, 'diff-preview-dialog').press('Escape');
  assert.deepEqual(confirmed, []);
  assert.equal(cancelled(), 1);
  // Overlay removed from the document body.
  assert.equal(allByTestId(doc.body, 'diff-preview-overlay').length, 0);
});

test('F-B2 layer 3: disabled Confirm + alert warning when blocking issues exist', () => {
  const doc = createDocument();
  const { ops, hash } = computeScheduleDiff(savedSet(), draftSet());
  const confirmed = [];
  const controller = openDiffPreviewModal({
    ops,
    renderedHash: hash,
    canConfirm: false,
    blockingIssues: [
      { code: 'X', message: 'Window 1 on MON needs both a start and an end time.', path: 'x' },
      { code: 'Y', message: '"2026-02-30" is not a real calendar date (use YYYY-MM-DD).', path: 'y' },
    ],
    document: doc,
    onConfirm: (h) => confirmed.push(h),
  });
  const confirmButton = byTestId(controller.root, 'confirm-diff');
  assert.equal(confirmButton.disabled, true);

  const warning = byTestId(controller.root, 'modal-invalid-warning');
  assert.equal(warning.getAttribute('role'), 'alert');
  const items = warning.querySelectorAll((n) => n.tagName === 'li').map((n) => n.textContent);
  assert.deepEqual(items, [
    'Window 1 on MON needs both a start and an end time.',
    '"2026-02-30" is not a real calendar date (use YYYY-MM-DD).',
  ]);

  // Even a forced dispatch cannot reach the confirm callback.
  confirmButton.click();
  confirmButton.dispatchEvent({ type: 'click', preventDefault() {}, defaultPrevented: false });
  assert.deepEqual(confirmed, []);
});

test('empty op list renders an explicit empty state and disables confirm', () => {
  const doc = createDocument();
  const controller = openDiffPreviewModal({
    ops: [],
    renderedHash: '00000000',
    canConfirm: true,
    document: doc,
  });
  assert.ok(byTestId(controller.root, 'diff-empty'));
  assert.equal(byTestId(controller.root, 'confirm-diff').disabled, true);
});

test('F-N2: focus moves into the dialog on open and restores on close', () => {
  const doc = createDocument();
  const trigger = doc.createElement('button');
  trigger.setAttribute('data-testid', 'review-trigger');
  doc.body.appendChild(trigger);
  trigger.focus();
  assert.equal(doc.activeElement, trigger);

  const { controller } = openModal(doc);
  const dialog = byTestId(controller.root, 'diff-preview-dialog');
  assert.equal(doc.activeElement, dialog, 'focus must move into the dialog');

  controller.close();
  assert.equal(doc.activeElement, trigger, 'focus must restore to the trigger on close');
});

test('F-N2: closing via Escape also restores focus', () => {
  const doc = createDocument();
  const trigger = doc.createElement('button');
  doc.body.appendChild(trigger);
  trigger.focus();

  const { controller } = openModal(doc);
  byTestId(controller.root, 'diff-preview-dialog').press('Escape');
  assert.equal(doc.activeElement, trigger);
});

test('double close is idempotent', () => {
  const doc = createDocument();
  const { controller } = openModal(doc);
  controller.close();
  controller.close();
  assert.equal(allByTestId(doc.body, 'diff-preview-overlay').length, 0);
});
