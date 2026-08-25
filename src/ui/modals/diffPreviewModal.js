/**
 * Diff-and-confirm modal (Contract section 9.2 informed-consent gate).
 *
 * Renders EXACTLY what a proposed schedule apply would change:
 *   - window additions/removals with scope, weekday and times;
 *   - exception mutations as full before -> after lines (prior kind + hours
 *     -> new kind + hours), including note changes when present;
 *   - removals described WITH the removed entry's kind/hours;
 *   - limit changes from -> to.
 *
 * Safety behavior:
 *   - Confirm is disabled unless the caller passes canConfirm=true (the page
 *     only does so when the store's canApply() holds: modal open + rendered
 *     hash current + zero validation issues). While issues exist the modal
 *     shows a role="alert" warning listing them, so an invalid proposal can
 *     never be confirmed even if a modal instance is somehow open.
 *   - Focus moves into the dialog on open and is restored to the previously
 *     focused element on close (implemented; see controller.close()).
 *   - Escape closes via the onCancel path (never confirms).
 */

import { el } from '../dom/kit.js';
import { describeOp } from '../diff/computeScheduleDiff.js';

/**
 * @param {object} options
 * @param {Array<object>} options.ops - diff operations to render
 * @param {string} options.renderedHash - hash of the rendered ops
 * @param {boolean} [options.canConfirm] - whether confirming is permitted
 * @param {Array<{code:string,message:string,path:string}>} [options.blockingIssues]
 * @param {(hash: string) => void} [options.onConfirm]
 * @param {() => void} [options.onCancel]
 * @param {UiDocument} [options.document]
 * @returns {{root: UiNode, close: () => void}}
 */
export function openDiffPreviewModal(options) {
  const doc = options.document;
  const onConfirm = options.onConfirm ?? (() => {});
  const onCancel = options.onCancel ?? (() => {});
  const canConfirm = options.canConfirm === true;
  const blockingIssues = options.blockingIssues ?? [];
  const previouslyFocused = doc ? doc.activeElement : null;

  const titleId = 'diff-preview-title';
  const summaryId = 'diff-preview-summary';

  const lineItems = options.ops.map((op) =>
    el('li', { 'data-testid': 'diff-line', text: describeOp(op) }),
  );

  const confirmButton = el(
    'button',
    {
      type: 'button',
      'data-testid': 'confirm-diff',
      disabled: !canConfirm || options.ops.length === 0,
      onClick: () => {
        // Double-guarded: a disabled button cannot dispatch click through the
        // DOM kit, but the handler re-checks so no code path can confirm while
        // disallowed.
        if (!canConfirm || options.ops.length === 0) return;
        onConfirm(options.renderedHash);
      },
    },
    'Confirm changes',
  );

  const cancelButton = el(
    'button',
    {
      type: 'button',
      'data-testid': 'cancel-diff',
      onClick: () => {
        close();
        onCancel();
      },
    },
    'Cancel',
  );

  const dialogChildren = [
    el('h2', { id: titleId, text: 'Review changes before applying' }),
    el(
      'p',
      {
        id: summaryId,
        'data-testid': 'diff-summary',
        text:
          'Applying these changes updates working-hours events on your Wix Bookings schedules. ' +
          'Nothing changes until you confirm here and then apply.',
      },
    ),
  ];

  if (blockingIssues.length > 0) {
    const list = el(
      'ul',
      { 'data-testid': 'modal-blocking-issues', role: 'alert' },
      ...blockingIssues.map((issueItem) => el('li', { text: issueItem.message })),
    );
    dialogChildren.push(
      el(
        'div',
        {
          'data-testid': 'modal-invalid-warning',
          class: 'warning',
          role: 'alert',
          text: 'This draft still has problems that must be fixed before it can be confirmed:',
        },
        list,
      ),
    );
  }

  const opList =
    options.ops.length > 0
      ? el('ul', { 'data-testid': 'diff-lines', 'aria-label': 'Proposed schedule changes' }, ...lineItems)
      : el('p', { 'data-testid': 'diff-empty', text: 'No schedule changes are pending.' });

  dialogChildren.push(opList);
  dialogChildren.push(
    el('p', {
      'data-testid': 'diff-hash',
      text: `Change set reference: ${options.renderedHash}`,
    }),
  );
  dialogChildren.push(el('div', { class: 'actions' }, cancelButton, confirmButton));

  const dialog = el(
    'div',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-describedby': summaryId,
      'data-testid': 'diff-preview-dialog',
      tabindex: '-1',
      class: 'diff-preview-modal',
      onkeydown: (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          onCancel();
        }
      },
    },
    ...dialogChildren,
  );

  const overlay = el(
    'div',
    { class: 'overlay', 'data-testid': 'diff-preview-overlay' },
    dialog,
  );
  doc.body.appendChild(overlay);

  // Move focus into the dialog on open.
  dialog.focus();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    // Restore focus to where the user came from (audit F-N2).
    const stillAttached =
      previouslyFocused &&
      previouslyFocused.ownerDocument === doc &&
      (previouslyFocused.parentNode !== null || previouslyFocused === doc.body);
    if (stillAttached && !previouslyFocused.disabled) {
      previouslyFocused.focus();
    } else if (doc.activeElement === dialog) {
      doc._adoptFocus(null);
    }
  }

  return { root: overlay, dialog, close };
}
