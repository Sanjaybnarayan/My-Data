/**
 * The application frame.
 *
 * Navigation, header, global search, sync indicator, theme toggle, and the
 * outlet the router renders into. Built once at boot and never re-created —
 * only its state changes — so navigating does not rebuild the sidebar or lose
 * the scroll position of the nav.
 *
 * What appears in the navigation is decided by the signed-in role, not by
 * hiding things with CSS: a child's device does not have a Finance link
 * because `visibleModules` did not return one.
 */

import { h, replace, $, delegate, announce } from './dom.js';
import { icon } from './icons.js';
import { Router } from './router.js';
import { modules } from '../data/schema.js';
import { visibleModules } from '../security/rbac.js';
import { bus, TOPIC } from '../core/bus.js';
import { storedTheme, applyTheme, nextTheme, effectiveTheme } from './theme.js';
import { SYNC_STATE } from '../sync/engine.js';
import { avatar, iconButton } from './components/basics.js';
import { moduleLabel } from '../core/labels.js';

/** The five that fit on a phone's bottom bar. */
const PRIMARY = ['dashboard', 'finance', 'documents', 'tasks', 'settings'];

export function buildShell({ actor, onSearch, onSync, onLock, router }) {
  const allowed = visibleModules(actor, modules);

  const outlet = h('main', { class: 'app-content', id: 'main', tabindex: '-1' });

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search everything',
    'aria-label': 'Search everything',
    autocomplete: 'off',
    onInput: (e) => onSearch?.(e.target.value, results),
    onKeydown: (e) => {
      if (e.key === 'Escape') {
        e.target.value = '';
        results.hidden = true;
      }
    },
  });

  const results = h('div', { class: 'search-results', hidden: true, role: 'listbox' });

  const syncPill = h('button', {
    class: 'sync-pill',
    type: 'button',
    dataset: { state: 'idle' },
    title: 'Sync now',
    onClick: () => onSync?.(),
  }, [icon('cloud', { size: 16 }), h('span', {}, 'Synced')]);

  const themeButton = iconButton('sun', {
    label: 'Change theme',
    onClick: () => {
      const preference = applyTheme(nextTheme());
      renderThemeIcon(preference);
      announce(`Theme: ${preference}`);
    },
  });

  function renderThemeIcon(preference = storedTheme()) {
    const name = preference === 'system' ? 'settings'
      : effectiveTheme(preference) === 'dark' ? 'moon' : 'sun';
    replace(themeButton, icon(name, { size: 20 }));
    themeButton.setAttribute('title', `Theme: ${preference}`);
  }
  renderThemeIcon();

  const drawerToggle = iconButton('menu', {
    label: 'Open navigation',
    class: 'nav-toggle',
    onClick: () => toggleDrawer(),
  });

  const nav = h('nav', { class: 'app-nav', 'aria-label': 'Sections' }, [
    h('div', { class: 'brand' }, [
      h('div', { class: 'brand-mark' }, 'FO'),
      h('span', {}, 'FamilyOS'),
    ]),
    h('div', { class: 'nav-group' }, allowed.map((mod) => navLink(mod))),
    h('div', { class: 'nav-group' }, [
      h('div', { class: 'nav-group-label' }, 'Signed in'),
      h('div', { class: 'nav-item', style: { cursor: 'default' } }, [
        avatar(actor.name ?? 'You'),
        h('span', {}, actor.name ?? 'You'),
      ]),
      h('button', {
        class: 'nav-item',
        type: 'button',
        style: { width: '100%', border: 0, background: 'none', cursor: 'pointer' },
        onClick: () => onLock?.(),
      }, [icon('lock', { size: 20 }), h('span', {}, 'Lock now')]),
    ]),
  ]);

  const bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Main sections' },
    allowed.filter((m) => PRIMARY.includes(m.id)).map((mod) => h('a', {
      href: Router.href({ module: mod.id }),
      dataset: { module: mod.id },
    }, [icon(mod.icon, { size: 22 }), h('span', {}, moduleLabel(mod))])));

  const scrim = h('div', { class: 'drawer-scrim', onClick: () => toggleDrawer(false) });

  const header = h('header', { class: 'app-header' }, [
    drawerToggle,
    h('div', { class: 'search-box' }, [icon('search', { size: 18 }), searchInput, results]),
    h('div', { class: 'spacer' }),
    syncPill,
    themeButton,
  ]);

  const root = h('div', { class: 'app', dataset: { nav: 'full' } }, [
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
    nav,
    header,
    h('main', { class: 'app-main' }, outlet),
    bottomNav,
    scrim,
  ]);

  function navLink(mod) {
    return h('a', {
      class: 'nav-item',
      href: Router.href({ module: mod.id }),
      dataset: { module: mod.id },
    }, [icon(mod.icon, { size: 20 }), h('span', {}, moduleLabel(mod))]);
  }

  /**
   * Open or close the drawer.
   *
   * Closing moves focus back to the button that opened it. Without that, a
   * keyboard or screen-reader user who opens the drawer and closes it again is
   * left with focus on a panel that is no longer on screen, and the next Tab
   * starts from the top of the document.
   *
   * Only when the focus is still inside the drawer: closing it because
   * somebody followed a link should leave focus where the new screen puts it,
   * not drag it back to the header.
   *
   * Opening deliberately does *not* move focus. The drawer is a panel beside
   * the content rather than a dialog over it, and pulling focus into it would
   * take a pointer user's caret out of the search box they were typing in.
   */
  function toggleDrawer(open) {
    const next = open ?? root.dataset.drawer !== 'open';
    const wasInside = !next && nav.contains(document.activeElement);

    root.dataset.drawer = next ? 'open' : 'closed';
    drawerToggle.setAttribute('aria-label', next ? 'Close navigation' : 'Open navigation');
    drawerToggle.setAttribute('aria-expanded', String(next));

    if (!next && wasInside) drawerToggle.focus();
  }

  // Following a link inside the drawer should close it; leaving it open over
  // the content the user just navigated to is the classic mobile-nav bug.
  delegate(nav, 'click', 'a', () => toggleDrawer(false));

  bus.on(TOPIC.route, (route) => {
    for (const link of root.querySelectorAll('[data-module]')) {
      const isCurrent = link.dataset.module === route.module;
      if (isCurrent) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    results.hidden = true;
  });

  bus.on(TOPIC.syncState, ({ state }) => {
    syncPill.dataset.state = state;
    const [text, iconName] = {
      [SYNC_STATE.idle]: ['Synced', 'cloud'],
      [SYNC_STATE.running]: ['Syncing', 'refresh'],
      [SYNC_STATE.offline]: ['Offline', 'cloudOff'],
      [SYNC_STATE.blocked]: ['Needs attention', 'alert'],
      [SYNC_STATE.error]: ['Sync failed', 'alert'],
    }[state] ?? ['Synced', 'cloud'];
    replace(syncPill, [icon(iconName, { size: 16 }), h('span', {}, text)]);
  });

  // Ctrl/Cmd-K is the search shortcut people already have in their fingers.
  globalThis.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  return {
    root,
    outlet,
    router: router ?? new Router(outlet),
    searchInput,
    searchResults: results,
    setDrawer: toggleDrawer,
    /** Refresh the nav after a role change without rebuilding the shell. */
    refreshNav(nextActor) {
      const next = visibleModules(nextActor, modules);
      replace($('.nav-group', nav), next.map(navLink));
    },
  };
}
