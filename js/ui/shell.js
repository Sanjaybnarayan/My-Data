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

/**
 * The five that fit on a phone's bottom bar.
 *
 * Dashboard is what is happening, Notifications is what needs doing, Chat is
 * the household talking, Finance is the money, and Profile is you and every
 * control that belongs to you — Settings included, which is why it is no
 * longer here itself.
 *
 * Five, and it stays five. A sixth makes each target narrower than a thumb,
 * and the drawer already reaches every other module.
 */
export const PRIMARY = Object.freeze(['dashboard', 'notifications', 'chat', 'finance', 'profile']);

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

  /*
   * Ordered by `PRIMARY`, not by the schema.
   *
   * `allowed` comes back in schema order, so filtering it would have put
   * Profile second and Chat fifth — the five right tabs in the wrong sequence.
   * The order is part of what was specified, so it is read from the list that
   * specifies it.
   */
  const badges = new Map();
  const bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Main sections' },
    PRIMARY
      .map((id) => allowed.find((m) => m.id === id))
      .filter(Boolean)
      .map((mod) => {
        const badge = h('span', { class: 'nav-badge', hidden: true, 'aria-hidden': 'true' });
        badges.set(mod.id, badge);
        return h('a', {
          href: Router.href({ module: mod.id }),
          dataset: { module: mod.id },
        }, [icon(mod.icon, { size: 22 }), badge, h('span', {}, moduleLabel(mod))]);
      }));

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

    /**
     * Put a count on a tab, or take it away.
     *
     * The number is of things actually late or nearly late — **not** unread.
     * Nothing in this application records whether somebody has read a
     * reminder, so a badge claiming otherwise would be inventing a fact. The
     * accessible name says the whole thing, because "3" beside an icon tells a
     * screen reader nothing.
     */
    setBadge(moduleId, count) {
      const badge = badges.get(moduleId);
      if (!badge) return;
      const n = Number(count) || 0;
      badge.hidden = n === 0;
      badge.textContent = n > 99 ? '99+' : String(n);

      const link = badge.closest('a');
      if (!link) return;
      const label = moduleLabel(modules.find((m) => m.id === moduleId));
      link.setAttribute('aria-label', n === 0
        ? label
        : `${label}, ${n} ${n === 1 ? 'thing needs' : 'things need'} attention`);
    },
  };
}
