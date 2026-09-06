/**
 * Which item a sliding row is "on".
 *
 * The wheel draws the chosen face square-on and turns the rest away, and
 * `js/ui/components/slidingrow.js` scrolls that face toward the middle. Both
 * halves need the same answer to one question — *which one is chosen?* — and
 * these rows are two different things wearing the same clothes:
 *
 *   - a row of links to other screens marks its destination `aria-current`
 *   - a row of filters over the list below marks its choice `aria-pressed`
 *
 * The case that matters, and the one that was wrong first: Calendar's source
 * row is six chips with **every one** of them pressed, because every calendar
 * source is on by default. Reading "the first pressed chip" as the selection
 * there would scroll the row back to its first chip every time somebody
 * switched a source off — the row yanking itself out from under the finger
 * that just tapped it.
 *
 * A stub rather than a DOM, because `chosenIn` calls exactly two methods and a
 * stub that implements two methods cannot quietly drift from the real thing
 * the way a hand-written fake of a whole element would.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { chosenIn } from '../js/ui/components/slidingrow.js';

setSuite('sliding row');

/**
 * A row of items, each described by the attributes it carries.
 *
 * `[{ current: true }, {}]` is a two-item row whose first is the destination;
 * `[{ pressed: true }, { pressed: true }]` is a two-switch row with both on.
 */
function row(items) {
  const nodes = items.map((one, index) => ({ index, ...one }));
  const match = (selector) => nodes.filter((one) => (
    selector === '[aria-current="page"]' ? one.current === true : one.pressed === true));
  // `any`, because this is deliberately not an `Element` — it is the two
  // methods `chosenIn` calls and nothing else, and the point of the stub is
  // that it cannot drift by implementing more of the interface than is used.
  return /** @type {any} */ ({
    querySelector: (selector) => match(selector)[0] ?? null,
    querySelectorAll: (selector) => match(selector),
  });
}

/** Which item of the row `chosenIn` picked, or null. */
const chosenIndex = (stub) => /** @type {any} */ (chosenIn(stub))?.index ?? null;

describe('a row of links to other screens', () => {
  test('is on the one marked current', () => {
    assert.equal(chosenIndex(row([{}, { current: true }, {}])), 1);
  });

  test('and is on nothing when none is', () => {
    assert.equal(chosenIn(row([{}, {}])), null);
  });
});

describe('a row of filters', () => {
  test('is on the one pressed', () => {
    assert.equal(chosenIndex(row([{}, {}, { pressed: true }])), 2);
  });

  /*
   * The Calendar case. Six sources, all on, and no "the one you are on"
   * anywhere in that row — so there is nothing to centre, and saying so beats
   * guessing at the first.
   */
  test('but is on nothing when several are pressed at once', () => {
    assert.equal(chosenIn(row([{ pressed: true }, { pressed: true }])), null);
  });

  test('and nothing when none is pressed', () => {
    assert.equal(chosenIn(row([{}, {}])), null);
  });
});

describe('a row carrying both markings', () => {
  /*
   * `aria-current` wins. A row that both links somewhere and tracks a pressed
   * state is answering "where does this go" first; the pressed chip is a
   * filter over what it lands on.
   */
  test('follows the link, not the pressed state', () => {
    assert.equal(chosenIndex(row([{ pressed: true }, { current: true }])), 1);
  });
});
