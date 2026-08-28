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
    const segments = pathPart.split('/').filter(Boolean);
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
    const parts = [module, entity, id].filter(Boolean);
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

    // Tear the previous view down before the next one mounts: a module that
    // subscribed to the bus must unsubscribe, or every navigation leaks a
    // listener and the tenth visit renders ten times.
    this.#teardown?.();
    this.#teardown = null;

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

      this.#outlet.replaceChildren();
      if (view?.node) {
        this.#outlet.append(view.node);
        this.#teardown = view.destroy ?? null;
      } else if (view instanceof Node) {
        this.#outlet.append(view);
      }

      this.#current = route;
      bus.emit(TOPIC.route, route);

      // Landing on a new screen should start at the top and announce itself.
      this.#outlet.scrollTop = 0;
      const heading = this.#outlet.querySelector('h1, h2');
      if (heading) heading.setAttribute('tabindex', '-1');
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
