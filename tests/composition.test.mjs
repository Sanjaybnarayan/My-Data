/**
 * What a component composer does with the class you hand it.
 *
 * `button({ class: 'btn--small' })` returned an element with **no `btn`
 * class**. Not a wrong class — none. The composer built
 * `['btn', variant, rest.class]` and then spread `...rest` over the top of it,
 * so the caller's own string replaced the composed array wholesale. The
 * element lost its pill shape, its background, its border and its minimum
 * height, and became a run of bare text about seventeen pixels tall.
 *
 * It survived because it was survivable. Half the call sites had been written
 * `class: 'btn btn--small'` — restating `btn` by hand — and those looked
 * perfect, so a reviewer comparing two buttons saw one styled and one not and
 * fixed the call site. `card()` had the same two ingredients in the opposite
 * order and was correct all along, which is the entire difference.
 *
 * A real browser catches this by measuring the rendered box; that check lives
 * in `tests/browser.mjs` and costs five minutes. This one costs a millisecond
 * and says *which function*, so it is worth having both.
 *
 * The stub below is a DOM only in the sense that `h()` cannot tell: it records
 * what was set rather than laying anything out. That is enough to answer the
 * question this file asks — what classes end up on the element — and nothing
 * more is claimed for it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';

setSuite('composition');

/* ------------------------------------------------------------------ stub */

/**
 * `append()` asks `children instanceof Node` to tell an element from a string,
 * so the stub needs a `Node` for elements to be instances of. Node.js has no
 * such global; this supplies one for the duration of the test.
 */
class StubNode {}

class StubElement extends StubNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.style = { setProperty(prop, value) { this[prop] = value; } };
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = '';
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  appendChild(child) { this.children.push(child); return child; }
  append(...items) { this.children.push(...items); }
  get className() { return this.getAttribute('class') ?? ''; }

  /** The classes actually on the element, in no particular order. */
  get classList() { return new Set(this.className.split(/\s+/).filter(Boolean)); }
}

/**
 * Run `fn` with the stub installed, and take it away again afterwards.
 *
 * Per test rather than once at import, because the whole suite shares one
 * process: a `document` left on `globalThis` would change what every later
 * file sees, and a test that only passes when it runs after this one is worse
 * than no test.
 */
function withDom(fn) {
  const previous = Object.hasOwn(globalThis, 'document')
    ? { had: true, value: globalThis.document }
    : { had: false };
  const previousNode = Object.hasOwn(globalThis, 'Node')
    ? { had: true, value: globalThis.Node }
    : { had: false };
  // Cast once, here: the stub is deliberately not a DOM, and describing it as
  // one to satisfy the checker would be a claim this file does not make.
  globalThis.Node = /** @type {any} */ (StubNode);
  globalThis.document = /** @type {any} */ ({
    createElement: (tag) => new StubElement(tag),
    createElementNS: (_ns, tag) => new StubElement(tag),
    createTextNode: (value) => ({ nodeType: 3, textContent: String(value) }),
  });
  try {
    return fn();
  } finally {
    if (previous.had) globalThis.document = previous.value;
    else delete globalThis.document;
    if (previousNode.had) globalThis.Node = previousNode.value;
    else delete globalThis.Node;
  }
}

const { button, iconButton, card, badge, chip } = await import('../js/ui/components/basics.js');

/* ------------------------------------------------------------------ tests */

describe('a caller-supplied class is added, never substituted', () => {
  test('button keeps btn when the caller names a modifier', () => {
    const el = withDom(() => button('Details', { class: 'btn--small' }));
    assert.equal(el.classList.has('btn'), true, el.className);
    assert.equal(el.classList.has('btn--small'), true, el.className);
  });

  test('iconButton keeps btn and btn--icon', () => {
    const el = withDom(() => iconButton('lock', { label: 'Lock now', class: 'lock-now' }));
    assert.equal(el.classList.has('btn'), true, el.className);
    assert.equal(el.classList.has('btn--icon'), true, el.className);
    assert.equal(el.classList.has('lock-now'), true, el.className);
  });

  test('card keeps card — it always did, and that is the comparison', () => {
    const el = withDom(() => card({ class: 'card--quiet' }));
    assert.equal(el.classList.has('card'), true, el.className);
    assert.equal(el.classList.has('card--quiet'), true, el.className);
  });

  test('a variant and a caller class coexist', () => {
    const el = withDom(() => button('Erase', { variant: 'danger', class: 'btn--small' }));
    for (const wanted of ['btn', 'btn--danger', 'btn--small']) {
      assert.equal(el.classList.has(wanted), true, `${wanted} missing from ${el.className}`);
    }
  });

  test('badge and chip take a tone without losing the base class', () => {
    assert.equal(withDom(() => badge('Due', 'danger')).classList.has('badge'), true);
    assert.equal(withDom(() => chip('Overview')).classList.has('chip'), true);
  });
});

describe('the rest of the props still arrive', () => {
  test('spreading rest first does not drop the attributes in it', () => {
    const el = withDom(() => button('Save', { class: 'btn--small', 'data-role': 'save', title: 'Save it' }));
    assert.equal(el.getAttribute('data-role'), 'save');
    assert.equal(el.getAttribute('title'), 'Save it');
  });

  test('and does not let rest overwrite the type or the label', () => {
    // `type` and `aria-label` are composed after the spread on purpose: a
    // caller passing `type` to a button that must be type=button would
    // otherwise turn it into a submit and post the surrounding form.
    const el = withDom(() => iconButton('copy', { label: 'Copy account number', class: 'btn--small' }));
    assert.equal(el.getAttribute('type'), 'button');
    assert.equal(el.getAttribute('aria-label'), 'Copy account number');
  });

  test('a handler passed as onClick is bound as a listener, not an attribute', () => {
    let clicked = 0;
    const el = withDom(() => button('Go', { class: 'btn--small', onClick: () => { clicked += 1; } }));
    assert.equal(typeof el.listeners.get('click'), 'function');
    assert.equal(el.getAttribute('onClick'), null);
    el.listeners.get('click')();
    assert.equal(clicked, 1);
  });
});

describe('the check can fail', () => {
  test('composing the broken way loses the base class', () => {
    // The exact shape the code had. If this ever stops losing `btn`, the
    // test above has stopped proving anything and this says so.
    /** @param {{variant?: string, class?: string}} [options] */
    const broken = ({ variant, ...rest } = {}) =>
      ({ class: ['btn', variant && `btn--${variant}`, rest.class], ...rest });
    const composed = broken({ class: 'btn--small' });
    assert.equal(Array.isArray(composed.class), false,
      'the broken ordering no longer loses the composed array');
    assert.equal(composed.class, 'btn--small');
  });

  test('and the fixed way keeps it', () => {
    /** @param {{variant?: string, class?: string}} [options] */
    const fixed = ({ variant, ...rest } = {}) =>
      ({ ...rest, class: ['btn', variant && `btn--${variant}`, rest.class] });
    assert.equal(Array.isArray(fixed({ class: 'btn--small' }).class), true);
  });
});
