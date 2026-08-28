/**
 * The application frame.
 *
 * Navigation, header, global search, sync indicator, lock, theme toggle, and
 * the outlet the router renders into. Built once at boot and never re-created —
 * only its state changes — so navigating does not rebuild the sidebar or lose
 * the scroll position of the nav.
 *
 * What appears in the navigation is decided by the signed-in role, not by
 * hiding things with CSS: a child's device does not have a Finance link
 * because `visibleModules` did not return one.
 */

import { h, replace, $, announce } from './dom.js';
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
 * and Profile's own groups already reach the other twenty — which is why a
 * phone has this bar and nothing else. There used to be a drawer as well,
 * listing all twenty-five behind a burger, so a phone carried two complete
 * navigations at once.
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

  /*
   * Lock, in the header, where the drawer button used to be.
   *
   * `.app-nav` is the desktop rail and it carries a Lock now row. On a phone
   * the rail is not drawn at all, so without this the only way to lock is
   * Profile → Settings → Security → Lock now: four taps for the control
   * somebody reaches for when they are handing the phone to someone else.
   * It stays one.
   *
   * Grouped with sync and theme rather than left where the burger was: it is
   * a global control, not a way to somewhere. Hidden on desktop by CSS,
   * because the rail's own Lock now row is right there with a word on it —
   * two paths to one action on one screen is the thing this change removes.
   */
  const lockButton = iconButton('lock', {
    label: 'Lock now',
    class: 'lock-now',
    onClick: () => onLock?.(),
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

  const header = h('header', { class: 'app-header' }, [
    h('div', { class: 'search-box' }, [icon('search', { size: 18 }), searchInput, results]),
    h('div', { class: 'spacer' }),
    syncPill,
    lockButton,
    themeButton,
  ]);

  const root = h('div', { class: 'app', dataset: { nav: 'full' } }, [
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
    nav,
    header,
    h('main', { class: 'app-main' }, outlet),
    bottomNav,
  ]);

  function navLink(mod) {
    return h('a', {
      class: 'nav-item',
      href: Router.href({ module: mod.id }),
      dataset: { module: mod.id },
    }, [icon(mod.icon, { size: 20 }), h('span', {}, moduleLabel(mod))]);
  }

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

  /*
   * The bottom bar, while somebody is typing.
   *
   * `windowSoftInputMode="adjustResize"` shrinks the WebView when the soft
   * keyboard opens, so a `position: fixed; bottom: …` bar re-anchors to the
   * new, shorter viewport — it sits directly on top of the keyboard. Sixty-
   * four pixels of tabs, wedged between the keyboard and the field being
   * filled in, in the half of the screen the keyboard did not already take.
   *
   * So it stands down while a field has focus. Not disabled, not moved:
   * `display: none`, which also collapses the padding the content reserves
   * for it, giving the form back the space.
   *
   * Only for fields that actually raise a keyboard. A `select` opens a picker
   * and a checkbox opens nothing, and hiding the navigation when somebody
   * ticks a box would be a bug in the other direction.
   */
  const TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password']);

  function raisesKeyboard(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    // `type` reflects the attribute; a missing or unknown one is a text box.
    if (tag === 'INPUT') return TYPES.has(el.type ?? 'text');
    return false;
  }

  /*
   * Both events, one decision, read off `document.activeElement`.
   *
   * Tabbing from one field to the next fires focusout before focusin, so
   * clearing on focusout alone flickers the bar in and out between two text
   * boxes — and on a phone that is the bar appearing over the keyboard for a
   * frame. The clear is deferred a task; the focusin that follows lands
   * first and the state never changes.
   */
  let pending = null;
  const settle = () => {
    pending = null;
    const typing = raisesKeyboard(document.activeElement);
    if (typing) root.dataset.typing = 'true';
    else delete root.dataset.typing;
  };

  root.addEventListener('focusin', () => {
    if (pending) { clearTimeout(pending); pending = null; }
    settle();
  });
  root.addEventListener('focusout', () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(settle, 0);
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
