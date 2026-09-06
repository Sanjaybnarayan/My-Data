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

const {
  button, iconButton, card, badge, chip, dueBadge,
} = await import('../js/ui/components/basics.js');
const { entityNames, entity } = await import('../js/data/schema.js');
const { phraseKey } = await import('../js/domain/duewords.js');
const { t } = await import('../js/core/locale.js');
const { restOfMatched, MATCHED } = await import('../js/modules/receipts-parts.js');
const { restOfUnreadable, UNREADABLE } = await import('../js/modules/statements-parts.js');

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

/*
 * The two footers the module-size ratchet was holding up.
 *
 * `receipts.js` and `statements.js` both stated a total above a list that
 * stopped without saying so — receipts worst of all, its subtitle reading
 * "31 of 40 receipts found the payment that settled them" above a list of
 * twelve. Both were over budget at 1,008 and 827 lines, and the ratchet's
 * instruction is to move code out rather than raise the number, so the fix
 * waited for the split that carried these two functions into their own files.
 *
 * Tested here rather than in the browser because the condition needs more
 * receipts than the example household has, and what is worth checking is the
 * arithmetic either side of the cap rather than the pixels.
 */
describe('a capped list in the two files that were too big to fix', () => {
  test('the reconciliation footer counts what is hidden, and only then', () => {
    assert.equal(withDom(() => restOfMatched(MATCHED)), null);
    assert.equal(withDom(() => restOfMatched(MATCHED - 1)), null);

    const shown = withDom(() => restOfMatched(31));
    assert.not(shown === null, 'no footer above the cap');
    assert.includes(String(shown.children.flatMap((c) => c.children ?? c)
      .map((c) => c.textContent ?? c).join(' ')), String(31 - MATCHED));
  });

  test('the unreadable-rows footer does the same', () => {
    assert.equal(withDom(() => restOfUnreadable(UNREADABLE)), null);

    const shown = withDom(() => restOfUnreadable(12));
    assert.not(shown === null, 'no footer above the cap');
    assert.includes(String(shown.children.flatMap((c) => c.children ?? c)
      .map((c) => c.textContent ?? c).join(' ')), String(12 - UNREADABLE));
  });
});

/**
 * What a date behind today is called.
 *
 * `dueBadge` built its label from a literal — `overdue ${relativeDays(day)}` —
 * for every one of the 23 expiry fields in the schema. `domain/duewords.js`
 * exists because that is the wrong shape: it was written when the reminder
 * line read "next dose on expires today", and it already carries a past-tense
 * phrase for all 23. The badge spoke none of them.
 *
 * Driven off the schema rather than a list written here. A new expiry field is
 * covered the day it is declared, which is the property a hand-written copy of
 * the same list would lose.
 */
describe('a date behind today is said in the words its field chose', () => {
  /** Every expiry field the schema declares, as `{entity, key}`. */
  function expiryFields() {
    const out = [];
    for (const name of entityNames()) {
      for (const field of entity(name).fields) {
        if (field.expiry) out.push({ entity: name, key: field.key });
      }
    }
    return out;
  }

  /**
   * The words on the badge for a date `days` from today.
   *
   * The stub wraps text in `{ nodeType: 3, textContent }`, so reading
   * `children[0]` directly gives `[object Object]` — which passes any
   * assertion that only asks whether the string contains "overdue".
   */
  function labelFor(key, days) {
    const day = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const el = withDom(() => dueBadge(day, { field: key }));
    return (el?.children ?? [])
      .map((child) => (typeof child === 'string' ? child : child?.textContent ?? ''))
      .join('');
  }

  test('the schema declares expiry fields for this to walk', () => {
    // A walk over nothing would satisfy every assertion below.
    assert.ok(expiryFields().length >= 20, `${expiryFields().length} expiry fields found`);
  });

  test('every one of them has a phrase, so none falls back to a bare number', () => {
    const missing = expiryFields().filter((one) => !phraseKey(one.key, 'past'));
    assert.deep(missing.map((one) => `${one.entity}.${one.key}`), []);
  });

  test('and the badge says that phrase rather than "overdue"', () => {
    const wrong = [];
    for (const one of expiryFields()) {
      const said = labelFor(one.key, -9);
      const wanted = t(phraseKey(one.key, 'past') ?? '');
      if (!said.startsWith(wanted) || /overdue/i.test(said)) {
        wrong.push(`${one.entity}.${one.key}: "${said}"`);
      }
    }
    assert.deep(wrong, []);
  });

  /*
   * The four that read worst before, named individually. The sweep above would
   * pass on phrases nobody had read; these say what the words actually are.
   */
  test('a course of tablets ended, a deposit matured, an appointment simply was', () => {
    assert.equal(labelFor('endsOn', -3), 'ended 3 days ago');
    assert.equal(labelFor('maturesOn', -6), 'matured 6 days ago');
    assert.equal(labelFor('date', -9), 'was 9 days ago');
    assert.equal(labelFor('nextDoseOn', -9), 'next dose was due 9 days ago');
  });

  test('a date still ahead is the distance alone, with no phrase at all', () => {
    // The badge sits beside the date itself, so "in 16 days" is the whole
    // message ahead of the day. Only the past needed a verb.
    assert.equal(labelFor('endsOn', 16), 'in 16 days');
  });

  test('a field nobody wrote a phrase for gets the bare distance, not a guess', () => {
    // How "next dose on expires today" happened: a word chosen for a field
    // nobody chose one for. The distance is a fact; a verb would be an
    // invention.
    const said = labelFor('noSuchFieldKey', -4);
    assert.equal(said, '4 days ago');
    assert.equal(/overdue/i.test(said), false);
  });
});
