/**
 * Minimal DOM kit for the dashboard lane (credential-free cycle).
 *
 * Why this exists: the React + design-system mount is deliberately deferred
 * until the first authenticated scaffold pins the real dependency versions
 * (Contract section 8.4 / UQ3, gate T-VP0). Until then the lane builds real,
 * testable UI structure against this tiny DOM abstraction instead of faking
 * React. The API mirrors the small browser surface the lane actually uses so
 * the eventual port is mechanical.
 *
 * Purity: no Wix SDK access here. The ONLY lane module allowed to reference
 * Wix runtime modules is `src/ui/services/bridge.js` (enforced by
 * `tests/ui/noWixImports.test.js`).
 */

let sharedDocument = null;

/** @returns {boolean} */
function isFocusableTag(tagName) {
  return (
    tagName === 'button' ||
    tagName === 'input' ||
    tagName === 'select' ||
    textareaTag(tagName)
  );
}

function textareaTag(tagName) {
  return tagName === 'textarea';
}

class ClassList {
  constructor(node) {
    this.node = node;
  }

  /** @returns {string[]} */
  entries() {
    const raw = this.node.getAttribute('class') ?? '';
    return raw.split(/\s+/).filter((entry) => entry.length > 0);
  }

  add(...names) {
    const set = new Set(this.entries());
    for (const name of names) set.add(name);
    this.node.setAttribute('class', [...set].join(' '));
  }

  remove(...names) {
    const removeSet = new Set(names);
    const next = this.entries().filter((name) => !removeSet.has(name));
    if (next.length === 0) this.node.removeAttribute('class');
    else this.node.setAttribute('class', next.join(' '));
  }

  toggle(name, force) {
    const has = this.contains(name);
    const shouldHave = force === undefined ? !has : Boolean(force);
    if (shouldHave) this.add(name);
    else this.remove(name);
    return shouldHave;
  }

  contains(name) {
    return this.entries().includes(name);
  }
}

export class UiEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.key = options.key ?? null;
    this.bubbles = options.bubbles ?? false;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

let nextNodeId = 0;

export class UiNode {
  constructor(tagName, document) {
    this.tagName = String(tagName).toLowerCase();
    this.ownerDocument = document;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.id = `node-${(nextNodeId += 1)}`;
    this.classList = new ClassList(this);
    this.value = '';
  }

  // ---------------------------------------------------------------- attributes

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'value') this.value = String(value);
    return this;
  }

  getAttribute(name) {
    const value = this.attributes.get(name);
    return value === undefined ? null : value;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get disabled() {
    return this.getAttribute('disabled') !== null;
  }

  set disabled(value) {
    if (value) this.setAttribute('disabled', 'disabled');
    else this.removeAttribute('disabled');
  }

  get tabIndex() {
    const raw = this.getAttribute('tabindex');
    return raw === null ? -1 : Number(raw);
  }

  set tabIndex(value) {
    this.setAttribute('tabindex', String(value));
  }

  // -------------------------------------------------------------------- tree

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    // Browser-like adoption: inserting a node built against another document
    // adopts the whole subtree into THIS document, so ownerDocument-relative
    // behavior (focus tracking, labelledby resolution) always follows the
    // tree the node actually lives in.
    if (child.ownerDocument !== this.ownerDocument) {
      const targetDoc = this.ownerDocument;
      const adopt = (node) => {
        node.ownerDocument = targetDoc;
        for (const nested of node.children ?? []) adopt(nested);
      };
      adopt(child);
    }
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
    return this;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChildren(...children) {
    for (const child of [...this.children]) this.removeChild(child);
    for (const child of children) this.appendChild(child);
    return this;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }

  // ------------------------------------------------------------------- text

  get textContent() {
    return this.children
      .map((child) => (child.isTextNode ? child.textContent : child.textContent))
      .join('');
  }

  set textContent(value) {
    this.replaceChildren(createTextNode(value, this.ownerDocument));
  }

  // ------------------------------------------------------------------ events

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
    return () => this.removeEventListener(type, listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index !== -1) list.splice(index, 1);
  }

  dispatchEvent(event) {
    event.target = event.target ?? this;
    event.currentTarget = this;
    const list = this.listeners.get(event.type) ?? [];
    for (const listener of [...list]) listener(event);
    return !event.defaultPrevented;
  }

  /**
   * Activates the node the way a user would. Buttons honour native browser
   * semantics: a disabled button swallows clicks entirely, and Enter/Space on
   * an enabled button synthesizes a click (that is how real UAs behave, and
   * how the keyboard-operability tests prove activation).
   */
  click() {
    if (this.disabled) return false;
    return this.dispatchEvent(new UiEvent('click'));
  }

  press(key) {
    const event = new UiEvent('keydown', { key, bubbles: true });
    const notCancelled = this.dispatchEvent(event);
    if (
      notCancelled &&
      this.tagName === 'button' &&
      !this.disabled &&
      (key === 'Enter' || key === ' ')
    ) {
      this.click();
    }
    return !event.defaultPrevented;
  }

  // ------------------------------------------------------------------- focus

  get isFocusable() {
    if (this.disabled) return false;
    if (isFocusableTag(this.tagName)) return true;
    // Mirrors real UA semantics: an explicit tabindex makes an element
    // programmatically focusable even when the value is -1 (out of tab order
    // but reachable via .focus()) — required for dialog containers.
    return this.getAttribute('tabindex') !== null;
  }

  focus() {
    if (!this.ownerDocument) return;
    if (!this.isFocusable) return;
    this.ownerDocument._adoptFocus(this);
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument._adoptFocus(null);
    }
  }

  // ---------------------------------------------------------------- querying

  /** Depth-first walk of this subtree (inclusive of `this`). */
  walk(visit) {
    visit(this);
    for (const child of this.children) {
      if (!child.isTextNode) child.walk(visit);
    }
  }

  querySelectorAll(predicate) {
    const matches = [];
    this.walk((node) => {
      if (node !== this && predicate(node)) matches.push(node);
    });
    return matches;
  }

  /** All descendant/boundary control elements: button, input, select, textarea. */
  controls() {
    return this.querySelectorAll(
      (node) =>
        node.tagName === 'button' ||
        node.tagName === 'input' ||
        node.tagName === 'select' ||
        textareaTag(node.tagName),
    );
  }

  buttons() {
    return this.querySelectorAll((node) => node.tagName === 'button');
  }
}

export class UiTextNode {
  constructor(text, document) {
    this.isTextNode = true;
    this.textContent = text;
    this.ownerDocument = document;
    this.parentNode = null;
  }
}

export function createTextNode(text, document) {
  return new UiTextNode(text, document);
}

export class UiDocument {
  constructor() {
    this.activeElement = null;
    this.body = new UiNode('body', this);
  }

  createElement(tagName) {
    return new UiNode(tagName, this);
  }

  createTextNode(text) {
    return new UiTextNode(text, this);
  }

  /** @internal focus bookkeeping — drives focus restore in modals. */
  _adoptFocus(node) {
    if (this.activeElement === node) return;
    const previous = this.activeElement;
    this.activeElement = node;
    if (previous) {
      for (const listener of previous.listeners.get('blur') ?? []) {
        listener(new UiEvent('blur', { bubbles: false }));
      }
    }
    if (node) {
      for (const listener of node.listeners.get('focus') ?? []) {
        listener(new UiEvent('focus', { bubbles: false }));
      }
    }
  }
}

/**
 * Fresh document for one render/test. Product code receives its document via
 * options and never reads a global, so tests stay hermetic.
 */
export function createDocument() {
  return new UiDocument();
}

/** Lazily-created shared document for callers that do not inject one. */
export function sharedDoc() {
  if (!sharedDocument) sharedDocument = createDocument();
  return sharedDocument;
}

/**
 * Hyperscript-style builder.
 *
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs] - attributes; `class` maps to
 *   classList, `on*` keys map to event listeners, `text` sets textContent.
 * @param {Array<UiNode|UiTextNode|string>} [children]
 */
export function el(tag, attrs, ...children) {
  const doc = attrs?.document ?? sharedDoc();
  const node = doc.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'document') continue;
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
        continue;
      }
      if (key === 'text') {
        node.textContent = String(value);
        continue;
      }
      if (key === 'class') {
        node.setAttribute('class', String(value));
        continue;
      }
      node.setAttribute(key, typeof value === 'string' ? value : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    if (typeof child === 'string') node.appendChild(doc.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

/** Finds the first node whose data-testid attribute matches. */
export function findByTestId(root, testId) {
  return (
    root.querySelectorAll(
      (node) => node.getAttribute('data-testid') === testId,
    )[0] ?? null
  );
}

/** Finds every node whose data-testid attribute matches. */
export function findAllByTestId(root, testId) {
  return root.querySelectorAll(
    (node) => node.getAttribute('data-testid') === testId,
  );
}
