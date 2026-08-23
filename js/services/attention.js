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
import { entities } from '../data/schema.js';
import { allReminders, moneyReminders, describeReminder, SEVERITY } from '../domain/reminders.js';

/** Entities carrying at least one field the schema marks as an expiry. */
export function datedEntities(schema = entities) {
  return Object.entries(schema)
    .filter(([, def]) => def.fields.some((field) => field.expiry))
    .map(([name]) => name);
}

/**
 * The entities `moneyReminders` and `upcomingDates` read that carry no expiry
 * field of their own, so the derivation above cannot find them.
 *
 * Named here rather than merged into the list above, because they are inputs
 * to a different question and lumping them together would hide that.
 */
export const BY_NAME = Object.freeze(['person', 'importantDate', 'recurringPayment', 'loan']);

export class AttentionService extends Service {
  /**
   * Everything due, worst first.
   *
   * @returns {Promise<{items: object[], counts: Record<string, number>, pressing: number}>}
   */
  async everything({ horizonDays = 45, clock = Date.now } = {}) {
    const names = [...new Set([...datedEntities(), ...BY_NAME])];

    /** @type {Record<string, [string, object]>} */
    const spec = {};
    for (const name of names) spec[name] = [name, { decrypt: false, limit: 2000 }];
    const data = await this.load(spec);

    const items = [
      ...allReminders(data, { horizonDays, clock }),
      ...moneyReminders(data, { days: horizonDays, clock }).map((one) => ({ ...one, group: 'money' })),
    ]
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
       * this application stores whether a person has read a reminder, so a
       * badge claiming "3 unread" would be inventing a fact. It is a count of
       * things that are actually late or nearly late, and it falls when they
       * are dealt with rather than when they are looked at.
       */
      pressing: counts.overdue + counts.urgent,
    };
  }
}
