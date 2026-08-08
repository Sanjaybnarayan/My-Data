/**
 * DOM construction.
 *
 * `h()` builds real nodes and sets text through `textContent`. There is no
 * path in this file that parses a string as markup, which is why the rest of
 * the application never has to think about escaping: a payee called
 * `<img onerror=…>` is a payee called `<img onerror=…>`, displayed literally.
 *
 * The one place HTML is unavoidable — the rich-text body of a note — goes
 * through `security/sanitize.js` and nowhere else.
 *
 *   h('div', { class: 'card' }, [
 *     h('h3', {}, 'Passport'),
 *     h('button', { onClick: renew }, 'Renew'),
 *   ])
 *
 * Props are properties where a property exists (`value`, `checked`,
 * `disabled`) and attributes otherwise, because setting `value` as an
 * attribute only changes the default and users notice the difference.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'text',
  'polyline', 'polygon', 'ellipse', 'defs', 'linearGradient', 'stop', 'use',
  'clipPath', 'title', 'tspan']);

/** Props set as DOM properties rather than attributes. */
const PROPERTIES = new Set(['value', 'checked', 'selected', 'disabled', 'readOnly',
  'indeterminate', 'textContent', 'htmlFor', 'multiple', 'open']);

/**
 * @param {string} tag
 * @param {object} [props]
 * @param {Node|string|number|Array|null} [children]
 * @returns {HTMLElement|SVGElement}
 */
export function h(tag, props = {}, children = null) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) el.style.setProperty(kebab(prop), String(v));
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) el.dataset[k] = String(v);
    } else if (key.startsWith('on') && typeof value === 'function') {
      // onClick → click. Capture and passive are opt-in via an array value.
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (PROPERTIES.has(key)) {
      el[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

export function append(parent, children) {
  if (children === null || children === undefined || children === false) return parent;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return parent;
  }
  parent.append(children instanceof Node ? children : document.createTextNode(String(children)));
  return parent;
}

/** Replace everything inside a node. The only sanctioned way to clear one. */
export function replace(parent, children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** A text node, for when a bare string would be ambiguous. */
export const text = (value) => document.createTextNode(String(value ?? ''));

function kebab(prop) {
  return prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/* ------------------------------------------------------------- delegation */

/**
 * One listener on a container instead of one per row. A list of two thousand
 * transactions with a menu button each would otherwise install two thousand
 * listeners and keep two thousand closures alive.
 */
export function delegate(container, eventName, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && container.contains(target)) handler(event, target);
  };
  container.addEventListener(eventName, listener);
  return () => container.removeEventListener(eventName, listener);
}

/* ---------------------------------------------------------------- helpers */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function on(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
}

/**
 * Batch DOM writes into one frame. Ten widgets reacting to the same change
 * event should lay out once, not ten times.
 */
const queued = new Set();
let frameHandle = null;

export function schedule(fn) {
  queued.add(fn);
  if (frameHandle !== null) return;
  const raf = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
  frameHandle = raf(() => {
    frameHandle = null;
    const run = [...queued];
    queued.clear();
    for (const task of run) {
      try {
        task();
      } catch (err) {
        console.error('render task failed', err);
      }
    }
  });
}

/** Focus without scrolling the page out from under the user. */
export function focus(el, { select = false } = {}) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (select && typeof el.select === 'function') el.select();
}

/**
 * Trap focus inside a dialog. Without it, tabbing walks out of the modal and
 * into the page behind, which for a screen-reader user means the dialog
 * silently ceases to exist.
 */
export function trapFocus(container) {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]),'
    + ' select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const onKeydown = (event) => {
    if (event.key !== 'Tab') return;
    const items = $$(selector, container).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

/** Announce something to assistive technology without moving focus. */
let liveRegion = null;

export function announce(message, assertive = false) {
  if (!liveRegion) {
    liveRegion = h('div', {
      class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
    });
    document.body.append(liveRegion);
  }
  liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  // Clearing first forces a re-announcement of an identical message.
  liveRegion.textContent = '';
  schedule(() => { liveRegion.textContent = message; });
}
