/**
 * Test helpers: hermetic document creation and query utilities built on the
 * lane's DOM kit. No external dependencies.
 */

import { createDocument } from '../../../src/ui/dom/kit.js';

export { createDocument };

export function byTestId(root, testId) {
  const found = root.querySelectorAll(
    (node) => node.getAttribute('data-testid') === testId,
  );
  if (found.length === 0) {
    throw new Error(`No element with data-testid="${testId}"`);
  }
  return found[0];
}

export function maybeByTestId(root, testId) {
  const found = root.querySelectorAll(
    (node) => node.getAttribute('data-testid') === testId,
  );
  return found[0] ?? null;
}

export function allByTestId(root, testId) {
  return root.querySelectorAll(
    (node) => node.getAttribute('data-testid') === testId,
  );
}

/** Asserts a synchronous function throws an AssertionError-like failure. */
export function assertThrows(fn, messageIncludes) {
  try {
    fn();
  } catch (error) {
    if (
      messageIncludes !== undefined &&
      !String(error?.message ?? '').includes(messageIncludes)
    ) {
      throw new Error(
        `Expected error containing "${messageIncludes}", got: ${error?.message}`,
      );
    }
    return error;
  }
  throw new Error('Expected function to throw, but it returned normally.');
}
