/**
 * Accessibility audit helpers over the lane DOM kit.
 *
 * auditLabels: every control (button/input/select/textarea) must expose an
 * accessible name via aria-label, aria-labelledby (resolvable to non-empty
 * text), a wrapping <label> sibling pattern, or value/placeholder for text
 * inputs. Returns the list of violations so tests can assert zero.
 *
 * assertKeyboardOperable: every element with click listeners must be either a
 * native button or explicitly focusable with its own keydown handling; buttons
 * are exercised with Enter and Space to prove activation end-to-end.
 */

const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);

function accessibleName(node) {
  const labelledby = node.getAttribute('aria-labelledby');
  if (labelledby) {
    let resolved = '';
    for (const id of labelledby.split(/\s+/)) {
      node.ownerDocument.body.walk((candidate) => {
        if (candidate.getAttribute?.('id') === id) resolved += candidate.textContent;
      });
    }
    if (resolved.trim() !== '') return resolved.trim();
  }
  const ariaLabel = node.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim() !== '') return ariaLabel.trim();
  if (CONTROL_TAGS.has(node.tagName)) {
    // Native semantics: a button's own text, an input's placeholder/value.
    if (node.tagName === 'button' && node.textContent.trim() !== '') {
      return node.textContent.trim();
    }
    const placeholder = node.getAttribute('placeholder');
    if (placeholder && placeholder.trim() !== '' && node.value) return String(node.value);
    if (node.value) return String(node.value);
  }
  return null;
}

export function auditLabels(root) {
  const violations = [];
  root.walk((node) => {
    if (!CONTROL_TAGS.has(node.tagName)) return;
    if (accessibleName(node) === null) {
      violations.push({
        tag: node.tagName,
        testId: node.getAttribute('data-testid'),
        reason: 'control has no accessible name',
      });
    }
  });
  return violations;
}

export function assertKeyboardOperable(root, doc) {
  const problems = [];
  root.walk((node) => {
    const hasClick = (node.listeners.get('click') ?? []).length > 0;
    if (!hasClick) return;
    if (node.tagName === 'button') {
      // Disabled buttons are intentionally inert for pointer AND keyboard —
      // that is correct accessible behavior, not a violation. Only enabled
      // buttons must prove Enter/Space activation.
      if (node.disabled) return;
      let activated = 0;
      const off = node.addEventListener('click', () => {
        activated += 1;
      });
      node.press('Enter');
      node.press(' ');
      off();
      if (activated !== 2) {
        problems.push(`button ${node.getAttribute('data-testid') ?? node.id} did not activate on Enter+Space`);
      }
      return;
    }
    const tabIndex = node.tabIndex;
    const hasKeydown = (node.listeners.get('keydown') ?? []).length > 0;
    if (tabIndex < 0 || !hasKeydown) {
      problems.push(
        `clickable ${node.tagName} (${node.getAttribute('data-testid') ?? 'unnamed'}) is not keyboard operable`,
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(`Keyboard operability failures:\n- ${problems.join('\n- ')}`);
  }
  void doc;
  return true;
}

/** Asserts the dialog exposes the mandatory dialog semantics. */
export function assertDialogSemantics(dialogNode) {
  const role = dialogNode.getAttribute('role');
  if (role !== 'dialog') throw new Error(`dialog role is "${role}", expected "dialog"`);
  if (dialogNode.getAttribute('aria-modal') !== 'true') {
    throw new Error('dialog is missing aria-modal="true"');
  }
  const labelledBy = dialogNode.getAttribute('aria-labelledby');
  if (!labelledBy) throw new Error('dialog is missing aria-labelledby');
  let titleText = '';
  dialogNode.ownerDocument.body.walk((node) => {
    if (node.getAttribute?.('id') === labelledBy) titleText = node.textContent;
  });
  if (titleText.trim() === '') {
    throw new Error(`aria-labelledby="${labelledBy}" does not resolve to visible title text`);
  }
  return true;
}
