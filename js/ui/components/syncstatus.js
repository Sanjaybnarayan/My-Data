/**
 * What sync is doing, said in one place.
 *
 * The state-to-words map used to live inline in `js/ui/shell.js`, beside the
 * header pill that was the only thing rendering it. Moving the display off the
 * header would have left a second copy behind, which is the shape this
 * repository keeps finding: a hand-maintained list beside a derivable one.
 *
 * `SYNC_STATE` is the source of the states; this is the source of their words.
 */

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { button, card, cardHeader } from './basics.js';
import { bus, TOPIC } from '../../core/bus.js';
import { SYNC_STATE } from '../../sync/engine.js';
import { toast } from './toast.js';

/**
 * One row per state: the word, the glyph, and whether it is a state somebody
 * has to do something about.
 *
 * `wrong` is not styling. A screen that separated these by colour alone would
 * say nothing to somebody who cannot see the difference, so it drives the
 * word — "Offline" and "Sync failed" are already different sentences — and
 * the tone the row is drawn in on top of that.
 */
export const SYNC_WORDS = Object.freeze({
  [SYNC_STATE.idle]: { text: 'Synced', iconName: 'cloud', wrong: false },
  [SYNC_STATE.running]: { text: 'Syncing', iconName: 'refresh', wrong: false },
  [SYNC_STATE.offline]: { text: 'Offline', iconName: 'cloudOff', wrong: true },
  [SYNC_STATE.blocked]: { text: 'Needs attention', iconName: 'alert', wrong: true },
  [SYNC_STATE.error]: { text: 'Sync failed', iconName: 'alert', wrong: true },
});

/** The words for a state, falling back rather than rendering `undefined`. */
export function describeSync(state) {
  return SYNC_WORDS[state] ?? SYNC_WORDS[SYNC_STATE.idle];
}

/**
 * Run a sync and say what happened.
 *
 * Lifted out of `js/app.js`, where it was the shell's `onSync` callback and
 * the header pill was its only caller. With the pill gone the behaviour would
 * otherwise have been rewritten on the Dashboard, which is how two versions
 * of one sentence start.
 *
 * @param {{run: Function}} sync the engine
 */
export async function syncNow(sync) {
  const result = await sync.run();
  if (result.error) toast(result.error, { kind: 'error' });
  else if (result.skipped === 'not-configured') {
    toast('Connect a Google account in Settings to sync.');
  } else toast(`Synced — ${result.pushed} up, ${result.pulled} down`, { kind: 'success' });
  return result;
}

/**
 * A card that says what sync is doing and offers to run it.
 *
 * It lives on the Dashboard. It used to be a pill in the header, where it
 * said "Synced" almost always, in words, in the most contested strip of a
 * phone screen — competing for width with the search field. The Dashboard is
 * the screen somebody lands on, so a failed sync is still met on the way in
 * rather than buried in Settings, and here there is room to say what is
 * wrong when something is.
 *
 * Returns `destroy` because it subscribes: a screen that mounts this and
 * navigates away would otherwise leave a listener holding a detached node,
 * and the tenth visit would repaint ten times.
 *
 * @param {{state?: string, onSync?: Function}} options
 * @returns {{node: Node, destroy: Function}}
 */
export function syncCard({ state, onSync } = {}) {
  const line = h('div', { class: 'sync-row' });
  const host = card({ class: 'sync-card' }, [
    cardHeader('Sync'),
    line,
  ]);

  function paint(next) {
    const { text, iconName, wrong } = describeSync(next);
    host.dataset.wrong = String(wrong);
    line.replaceChildren(h('div', { class: 'sync-line' }, [
      icon(iconName, { size: 20 }),
      h('span', { class: 'sync-word' }, text),
      h('div', { class: 'spacer' }),
      button('Sync now', { variant: 'subtle', onClick: () => onSync?.() }),
    ]));
  }

  paint(state);
  const off = bus.on(TOPIC.syncState, ({ state: next }) => paint(next));
  return { node: host, destroy: off };
}
