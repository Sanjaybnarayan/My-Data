/**
 * Everything that wants somebody's attention, in one place.
 *
 * ## Why this exists
 *
 * `domain/reminders.js` has derived every deadline in the application for a
 * long time: it walks the schema for fields marked `expiry`, so a new dated
 * field produces reminders the day it is added and nobody has to register it.
 * `moneyReminders` does the same for bills and EMIs. Both are tested.
 *
 * What was missing was a screen. The dashboard shows a handful; nothing showed
 * the list. So this is assembly, not new logic — the arithmetic already
 * existed and is not touched here.
 *
 * ## The entity list is derived, not typed out
 *
 * `js/modules/dashboard.js` names twenty entities in an array to feed the same
 * domain functions. That array is a hand-maintained list beside a derivable
 * one, and this repository has now found that shape often enough to stop
 * writing new instances of it: a dated field added to an entity nobody
 * remembered to add to the array produces no reminder, silently, forever.
 *
 * Here the list comes from the schema — every entity carrying a field marked
 * `expiry`, plus the four the money and anniversary reminders need by name
 * because they are inputs rather than sources of expiry dates.
 */

import { Service } from './service.js';
import {
  allReminders, moneyReminders, mergeReminders, describeReminder, SEVERITY,
} from '../domain/reminders.js';

/*
 * Re-exported, not defined here.
 *
 * Both are pure derivations over the schema with no service behind them, and
 * `js/domain/automation.js` needs them to decide what to load before it can
 * notify — a domain module reaching up into a service to get them would be
 * the dependency pointing the wrong way. They live in `domain/reminders.js`
 * now, beside the code that consumes them; this keeps the name every existing
 * caller already imports.
 */
/*
 * Imported, then re-exported — not `export … from`.
 *
 * Two reasons, and both were found the hard way. `export … from` forwards a
 * name without binding it in this module, and `AttentionService.everything`
 * below calls both, so on its own it left the method referencing names that
 * were not here. Adding a matching `import` beside it fixed that and broke
 * the single-file build instead: `tools/bundle.mjs` flattens modules, and the
 * pair became two declarations of one name.
 */
import { datedEntities, BY_NAME } from '../domain/reminders.js';

export { datedEntities, BY_NAME };

/**
 * Everything due, worst first, from records already in hand.
 *
 * Separate from the service so the dashboard can use it without a second read
 * of eighteen entity types — it has already loaded them for its other widgets.
 * More importantly, it means the count on the Notifications tab and the card
 * on the Dashboard are the *same* arithmetic rather than two implementations
 * that can disagree about what "needs attention" means.
 *
 * @param {Record<string, object[]>} data records keyed by entity name
 * @returns {{items: object[], counts: Record<string, number>, pressing: number}}
 */
export function attentionFrom(data, { horizonDays = 45, clock = Date.now } = {}) {
  /*
   * Merged, not concatenated.
   *
   * `subscription` and `digitalAsset` carry a `renewsOn` the schema marks as
   * an expiry *and* are read by `upcomingBills`, so one Netflix renewal
   * produced two rows here and counted two against the badge on the tab.
   * `mergeReminders` keeps the money row, which carries the amount.
   */
  const items = mergeReminders(
    allReminders(data, { horizonDays, clock }),
    moneyReminders(data, { days: horizonDays, clock }).map((one) => ({ ...one, group: 'money' })),
  )
    .map((one) => ({ ...one, line: describeReminder(one) }))
    .sort((a, b) => {
      const bySeverity = SEVERITY[a.severity] - SEVERITY[b.severity];
      return bySeverity !== 0 ? bySeverity : a.days - b.days;
    });

  const counts = { overdue: 0, urgent: 0, soon: 0, upcoming: 0 };
  for (const one of items) {
    if (one.severity in counts) counts[one.severity] += 1;
  }

  return {
    items,
    counts,
    /*
     * The number worth putting on a badge.
     *
     * Overdue and urgent only. This is **not** an unread count: nothing in
     * this application stores whether a person has read a reminder, so a badge
     * claiming "3 unread" would be inventing a fact. It is a count of things
     * that are actually late or nearly late, and it falls when they are dealt
     * with rather than when they are looked at.
     */
    pressing: counts.overdue + counts.urgent,
  };
}

export class AttentionService extends Service {
  /** The same answer, for a caller that has not loaded the records itself. */
  async everything({ horizonDays = 45, clock = Date.now } = {}) {
    const names = [...new Set([...datedEntities(), ...BY_NAME])];

    /** @type {Record<string, [string, object]>} */
    const spec = {};
    for (const name of names) spec[name] = [name, { decrypt: false, limit: 2000 }];

    return attentionFrom(await this.load(spec), { horizonDays, clock });
  }
}
