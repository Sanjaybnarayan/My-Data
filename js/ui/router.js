/**
 * Routing.
 *
 * Hash-based, so the app can be served from any static host — including a
 * `file://` open of the folder — with no server rewrite rules. A PWA that
 * needs `try_files` configured is a PWA that breaks on somebody's shared
 * hosting.
 *
 *   #/finance                    module
 *   #/finance/transaction        an entity list
 *   #/finance/transaction/txn_1  one record
 *   #/finance/transaction/new    the create form
 *
 * Module code is loaded on first navigation with a dynamic `import()`, so the
 * opening payload is the shell and the dashboard rather than all sixteen
 * modules. A second visit is served from the module cache.
 */

import { bus, TOPIC } from '../core/bus.js';
import { closeAllModals } from './components/modal.js';
import { announce } from './dom.js';

/**
 * A path segment, escaped so the browser does not have to guess.
 *
 * The segments were written into the hash raw. Everything routed by this
 * application until now was a module name, an entity name or a ULID, none of
 * which contain a character that needs escaping — so it read as correct and
 * was never exercised.
 *
 * Then a screen started routing on a category. Fourteen of the forty-six
 * categories the schema offers contain a space — `food delivery`,
 * `rental income`, `sent to person` — and assigning `location.hash` makes the
 * browser percent-encode them on the way in. Nothing decoded on the way out,
 * so the screen was handed `food%20delivery`, which matches no category, and
 * showed "nothing recorded" for one a household spends in every week.
 *
 * `encodeURIComponent` and not `encodeURI`: a `/` inside a segment is data,
 * not a separator, and `encodeURI` leaves it alone.
 */
const encodeSegment = (part) => encodeURIComponent(part);

/**
 * And back again.
 *
 * A hand-edited address can carry a malformed escape — `%zz` — on which
 * `decodeURIComponent` throws. A route is not worth an exception: the segment
 * is passed through as written and the screen it reaches shows its own empty
 * state, which is what an address naming nothing should do.
 */
function decodeSegment(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export class Router {
  #routes = new Map();
  #fallback = null;
  #current = null;
  #outlet;
  #beforeEach = [];
  #teardown = null;
  #detach = null;
  #navigation = 0;

  constructor(outlet) {
    this.#outlet = outlet;
  }

  /**
   * @param {string} path e.g. `dashboard` or `finance`
   * @param {() => Promise<{render: Function}>} loader dynamic import
   */
  register(path, loader) {
    this.#routes.set(path, loader);
    return this;
  }

  fallback(loader) {
    this.#fallback = loader;
    return this;
  }

  /** Runs before every navigation. Return false to block it. */
  guard(fn) {
    this.#beforeEach.push(fn);
    return this;
  }

  static parse(hash) {
    const clean = String(hash ?? '').replace(/^#\/?/, '');
    const [pathPart, queryPart] = clean.split('?');
    const segments = pathPart.split('/').filter(Boolean).map(decodeSegment);
    return {
      module: segments[0] ?? 'dashboard',
      entity: segments[1] ?? null,
      id: segments[2] ?? null,
      action: segments[2] === 'new' ? 'new' : segments[3] ?? null,
      query: Object.fromEntries(new URLSearchParams(queryPart ?? '')),
      path: segments.join('/') || 'dashboard',
    };
  }

  static href({ module, entity, id, query } = {}) {
    const parts = [module, entity, id].filter(Boolean).map(encodeSegment);
    const search = query && Object.keys(query).length
      ? `?${new URLSearchParams(query)}`
      : '';
    return `#/${parts.join('/')}${search}`;
  }

  start() {
    const onHashChange = () => this.resolve();
    globalThis.addEventListener('hashchange', onHashChange);
    this.#detach = () => globalThis.removeEventListener('hashchange', onHashChange);
    return this.resolve();
  }

  stop() {
    this.#detach?.();
    this.#teardown?.();
  }

  navigate(target, { replace = false } = {}) {
    const href = typeof target === 'string' ? target : Router.href(target);
    if (replace) {
      globalThis.location.replace(href);
    } else {
      globalThis.location.hash = href.startsWith('#') ? href : `#${href}`;
    }
  }

  get current() {
    return this.#current;
  }

  async resolve() {
    const route = Router.parse(globalThis.location.hash);

    // Two navigations can overlap: a module import takes a moment, and in
    // that moment the user has tapped something else. Without a token the
    // *slower* one wins and the screen shows something nobody asked for.
    const token = ++this.#navigation;
    const stale = () => token !== this.#navigation;

    for (const guard of this.#beforeEach) {
      const verdict = await guard(route, this.#current);
      if (verdict === false) return null;
      // A guard may redirect by returning a route; the hash change that
      // follows re-enters this method, so stop here.
      if (typeof verdict === 'string') {
        this.navigate(verdict, { replace: true });
        return null;
      }
    }

    const loader = this.#routes.get(route.module) ?? this.#fallback;
    if (!loader) return null;

    // A dialog is mounted on `document.body`, so replacing the outlet's
    // children leaves it standing over whatever the next screen turns out to
    // be — scroll still locked, focus still trapped, and a confirmation's
    // buttons still wired to the record it was asked about. Whatever caused
    // this navigation, the dialog does not survive it.
    closeAllModals();

    this.#outlet.setAttribute('aria-busy', 'true');
    try {
      const module = await loader();
      if (stale()) return null;

      const view = await module.render(route, { router: this });
      if (stale()) {
        // A newer navigation has already mounted. Tear this one down rather
        // than leaking whatever it subscribed to on the way up.
        view?.destroy?.();
        return null;
      }

      /*
       * Tear the previous view down here, and not before the render.
       *
       * A module that subscribed to the bus must unsubscribe, or every
       * navigation leaks a listener and the tenth visit renders ten times.
       * That was done first, at the top of this method — which was fine for
       * every navigation that worked and wrong for the ones that did not.
       *
       * `replaceChildren` is below and runs only on success, so a render that
       * throws deliberately leaves the previous screen up rather than blanking
       * the app. But its teardown had already run, so what stayed on display
       * was a dead screen: it looked live, its subscriptions were gone, and it
       * would never update again. The household's evidence that anything was
       * wrong was a toast that expires.
       *
       * Nothing is torn down now until there is something to replace it with.
       * The old view stays subscribed for the length of the new render, which
       * costs one repaint of a node about to be discarded.
       */
      this.#teardown?.();
      this.#teardown = null;

      this.#outlet.replaceChildren();
      if (view?.node) {
        this.#outlet.append(view.node);
        this.#teardown = view.destroy ?? null;
      } else if (view instanceof Node) {
        this.#outlet.append(view);
      }

      const first = !this.#current;
      this.#current = route;
      bus.emit(TOPIC.route, route);

      /*
       * Landing on a new screen: top of the page, focus on its heading, and
       * the heading said out loud.
       *
       * This used to set `tabindex="-1"` and stop, under a comment claiming
       * the screen "announces itself". Nothing focused the heading and nothing
       * announced anything — the attribute was a preparation for a call that
       * was never written, and `announce` was not even imported here.
       *
       * What that cost somebody navigating by keyboard: the link they
       * followed was inside the outlet, `replaceChildren` removed it, and
       * focus fell to `<body>`. Every navigation put them back at the top of
       * the document, so reaching anything on the new screen meant tabbing
       * past the skip link, the header and the whole tab bar again.
       *
       * `preventScroll` because the lines above have already put the scroll
       * where it belongs, and focusing would otherwise fight it.
       *
       * Both the outlet and the window, because which of them scrolls depends
       * on the width. `.app-content` is a scrolling column on a desktop and
       * `overflow-y: visible` on a phone, where the document scrolls instead —
       * so for the whole of this application's life on a phone, this line set
       * a property on an element that does not scroll and nothing moved.
       *
       * Measured rather than reasoned about: tapping a category on the
       * overview, 900px down, landed 446px into the screen it opened. Every
       * navigation from a scrolled position did it; it went unnoticed because
       * most screens are short enough for the browser to clamp the offset back
       * to zero on its own.
       */
      this.#outlet.scrollTop = 0;
      globalThis.scrollTo?.(0, 0);
      const heading = this.#outlet.querySelector('h1, h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
        // Not on the first render: the page load announces itself, and saying
        // the name twice is worse than not saying it.
        if (!first) announce(heading.textContent?.trim() ?? '');
      }
      return route;
    } catch (err) {
      console.error(`route ${route.path} failed`, err);
      bus.emit(TOPIC.toast, {
        kind: 'error',
        message: 'That screen could not be opened.',
        detail: err.message,
      });
      return null;
    } finally {
      if (!stale()) this.#outlet.removeAttribute('aria-busy');
    }
  }
}
