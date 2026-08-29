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
import { avatar, iconButton } from './components/basics.js';
import { moduleLabel } from '../core/labels.js';
import { t } from '../core/locale.js';

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

/**
 * What a tab's badge should say, given a count.
 *
 * Pure and exported so the decision can be tested without building a shell —
 * and, more to the point, so it can be *mutated*: the fault this replaced was
 * that a failed check and an empty one produced the same DOM, and a check that
 * cannot tell them apart would not have caught it.
 *
 * Three states, not two:
 *
 *   a number   things are late, and how many
 *   nothing    nothing is late
 *   `null`     the count could not be worked out
 *
 * The third had no representation. `app.js` called `setBadge` from a promise
 * ending `.catch(() => {})`, and the badge is created hidden, so a thrown
 * `AttentionService.everything()` left the tab bare — which is exactly what
 * "nothing needs attention" looks like, on the bar a household reads first.
 *
 * @param {number|null} count things needing attention, or null when unknown
 * @param {string} label the tab's own name
 * @returns {{hidden: boolean, text: string, unknown: boolean, ariaLabel: string}}
 */
export function attentionBadge(count, label) {
  if (count === null) {
    // A mark rather than a number, and the shape changes too — a different
    // colour alone would tell a household who cannot see the difference
    // nothing at all.
    return { hidden: false, text: '!', unknown: true, ariaLabel: t('attention.tabUnknown', { label }) };
  }

  const n = Number(count) || 0;
  return {
    hidden: n === 0,
    text: n > 99 ? '99+' : String(n),
    unknown: false,
    ariaLabel: n === 0 ? label
      : (n === 1 ? t('attention.tabOne', { label }) : t('attention.tabMany', { label, n })),
  };
}

export function buildShell({ actor, onSearch, onLock, router }) {
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

  /*
   * Search, as a panel rather than a box wedged into the bar.
   *
   * On a 390px header an inline field had to share the width with a sync pill
   * and two icon buttons, and lost. The field is the same field; what changed
   * is that on a phone it lives in a panel the search button opens, over the
   * content, with room for its own results. Above 901px the panel is simply
   * always open and inline, because a desktop header has the width and an
   * extra tap to search would be a worse trade there.
   *
   * Sync moved out entirely. It said "Synced" almost always, in words, in the
   * most contested strip of a phone screen; it is a card on the Dashboard now,
   * where there is room to say what is wrong when something is.
   */
  const searchPanel = h('div', { class: 'search-panel' }, [
    h('div', { class: 'search-box' }, [icon('search', { size: 18 }), searchInput, results]),
    iconButton('close', {
      label: 'Close search',
      class: 'search-close',
      onClick: () => openSearch(false),
    }),
  ]);

  const searchToggle = iconButton('search', {
    label: 'Search',
    class: 'search-toggle',
    onClick: () => openSearch(),
  });
  searchToggle.setAttribute('aria-expanded', 'false');

  /**
   * Open or close the search panel.
   *
   * Focus moves into the field on open — the whole point of the button is to
   * get somebody typing — and back to the button on close, but only when the
   * focus is still inside the panel. Closing because a result was followed
   * should leave focus where the new screen puts it.
   */
  function openSearch(open) {
    const next = open ?? !searchPanel.classList.contains('is-open');
    const wasInside = !next && searchPanel.contains(document.activeElement);

    searchPanel.classList.toggle('is-open', next);
    searchToggle.setAttribute('aria-expanded', String(next));

    if (next) searchInput.focus();
    else {
      searchInput.value = '';
      results.hidden = true;
      if (wasInside) searchToggle.focus();
    }
  }

  const header = h('header', { class: 'app-header' }, [
    h('div', { class: 'app-title' }, 'FamilyOS'),
    h('div', { class: 'spacer' }),
    searchToggle,
    themeButton,
    searchPanel,
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
     *
     * ## Why there is a third state
     *
     * A badge has two obvious states — a number, and nothing. **Nothing was
     * doing the work of two different facts.** The badge is created hidden and
     * `app.js` called this from a promise ending `.catch(() => {})`, so when
     * `AttentionService.everything()` threw, this was simply never called and
     * the tab stayed bare. A household then read "nothing needs attention" off
     * a check that had failed — on the bar they look at first.
     *
     * Passing `null` says the count could not be worked out. It shows a mark
     * rather than a number, and the accessible name says so in words: the
     * shape carries it as well as the character, because a household that
     * cannot tell a `!` from a `1` at a glance is not a rare one.
     */
    setBadge(moduleId, count) {
      const badge = badges.get(moduleId);
      if (!badge) return;
      const label = moduleLabel(modules.find((m) => m.id === moduleId));
      const state = attentionBadge(count, label);

      badge.hidden = state.hidden;
      badge.textContent = state.text;
      badge.classList.toggle('nav-badge--unknown', state.unknown);
      badge.closest('a')?.setAttribute('aria-label', state.ariaLabel);
    },
  };
}
