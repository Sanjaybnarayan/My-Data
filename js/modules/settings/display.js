/**
 * Settings: theme, language, and what this build actually is.
 */

import { applyTheme, storedTheme, THEMES } from '../../ui/theme.js';
import { card, cardHeader } from '../../ui/components/basics.js';
import { entities, ROLES } from '../../data/schema.js';
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { labelKeys } from '../../core/labels.js';
import { t, locales, active, choose, missing } from '../../core/locale.js';

/* ------------------------------------------------------------ appearance */

export function appearanceCard() {
  const current = storedTheme();
  return card({}, [
    cardHeader('Appearance', null, { iconName: 'sun' }),
    h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Theme' }, THEMES.map((theme) => h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(theme === current),
      onClick: (event) => {
        applyTheme(theme);
        // `currentTarget`, not `target`: the chip the listener is on, rather
        // than whatever inside it the click landed on. Today these chips hold
        // a bare text node, and a text node is never an event target — the
        // button is — so `target` happens to be right. Put an icon in one and
        // every chip reads `aria-pressed="false"`, the pressed one included,
        // with nothing on screen to show for it.
        //
        // `chat-settings/sections.js` toggles a chip row the same way and
        // already uses `currentTarget`, because its chips carry a `<span>`.
        // Both spellings were in the tree, and the safe one happened to be in
        // the place that needed it.
        for (const chip of event.currentTarget.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === event.currentTarget));
        }
      },
    }, theme === 'system' ? 'Follow the system' : theme))),
  ]);
}

/* -------------------------------------------------------------- language */

/**
 * The language card, which today has one language on it.
 *
 * It says so plainly rather than showing a menu of one, because a picker with
 * a single entry implies others are coming and a household would be entitled
 * to read that as a promise. When a second catalogue is registered the card
 * becomes a chip row, and every chip carries that language's **measured**
 * coverage — not a version number, not a flag, the percentage of the
 * application it can actually say. A language below complete is offered with
 * what it cannot do written next to it.
 *
 * `missing()` is shown when it is not empty. Those are lines whose translation
 * dropped a `{amount}` or a `{name}` and were therefore refused; the household
 * sees English there, and both they and whoever wrote the catalogue should
 * know which lines and why.
 */
export function languageCard() {
  const keys = labelKeys();
  const available = locales({ labelKeys: keys });
  const current = active();

  if (available.length < 2) {
    return card({}, [
      cardHeader(t('locale.title'), null, { iconName: 'globe' }),
      h('p', { class: 'small muted', style: { margin: 0 } }, t('locale.only')),
    ]);
  }

  const refused = missing(current);
  return card({}, [
    cardHeader(t('locale.title'), null, { iconName: 'globe' }),
    h('div', { class: 'chip-row', role: 'group', 'aria-label': t('locale.title') }, available.map(({ tag, name, coverage }) => h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(tag === current),
      onClick: () => { choose(tag); globalThis.location?.reload(); },
    }, coverage >= 1
      ? t('locale.complete', { name })
      : t('locale.partial', { name, percent: Math.floor(coverage * 100) })))),
    refused.length
      ? h('p', { class: 'small muted', style: { marginBottom: 0 } },
        t('locale.refused', {
          n: refused.length,
          name: available.find((l) => l.tag === current)?.name ?? current,
        }))
      : null,
  ]);
}

/* ----------------------------------------------------------------- about */

export function aboutCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader('About', null, { iconName: 'info' }),
    h('dl', { class: 'stack stack--tight', style: { margin: 0 } }, [
      ['Roles', ROLES.join(', ')],
      ['Record types', String(Object.keys(entities).length)],
      ['Encryption', 'AES-256-GCM, key wrapped with PBKDF2-SHA-256'],
      ['Storage', 'IndexedDB on this device; Google Sheets and Drive for backup'],
    ].map(([label, value]) => h('div', { class: 'row row--between small' }, [
      h('dt', { class: 'muted' }, label),
      h('dd', { style: { margin: 0, textAlign: 'right' } }, value),
    ]))),
    h('p', { class: 'small faint' }, [
      icon('info', { size: 14 }),
      ' FamilyOS holds the only copy of your encryption key. Nobody can reset it for you — '
      + 'keep your recovery phrase somewhere safe.',
    ]),
  ]);
}
