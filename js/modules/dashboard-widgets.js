/**
 * Choosing which widgets the Dashboard shows.
 *
 * Split out of `js/modules/dashboard.js` because that file had reached the
 * ceiling `tools/module-size.mjs` holds it to, and this is the part of it
 * that is genuinely separate: a dialog and the words on its checkboxes,
 * touching nothing the widgets themselves touch.
 *
 * `WIDGET_LABELS` is written by hand beside `ALL_WIDGETS`, which is derived.
 * That pairing is the shape this repository keeps finding wrong, and it is
 * deliberate here: these are sentences somebody reads, and "Papers running
 * out" is not a transformation of `documents`. What stops it drifting is that
 * a widget with no label falls back to its bare id, which is ugly enough to
 * be noticed rather than silently omitted.
 */

import { h } from '../ui/dom.js';
import { button } from '../ui/components/basics.js';
import { app } from '../context.js';
import { ALL_WIDGETS, WIDGET_KEY } from './dashboard.js';

export async function customise(enabled, repaint) {
  const { modal } = await import('../ui/components/modal.js');
  const { db } = app();
  const selection = new Set(enabled);

  const body = h('div', { class: 'stack' }, ALL_WIDGETS.map((id) => h('label', {
    class: 'checkbox',
  }, [
    h('input', {
      type: 'checkbox',
      checked: selection.has(id),
      onChange: (e) => (e.target.checked ? selection.add(id) : selection.delete(id)),
    }),
    h('span', {}, WIDGET_LABELS[id] ?? id),
  ])));

  const { close } = modal({
    title: 'Dashboard widgets',
    body,
    footer: [
      button('Cancel', { variant: 'subtle', onClick: () => close() }),
      button('Save', {
        variant: 'primary',
        onClick: async () => {
          const next = ALL_WIDGETS.filter((id) => selection.has(id));
          await db.setMeta(WIDGET_KEY, next);
          enabled.length = 0;
          enabled.push(...next);
          close();
          await repaint();
        },
      }),
    ],
  });
}

const WIDGET_LABELS = {
  attention: 'What needs attention',
  wallet: 'Your wallet',
  family: 'Household',
  documents: 'Papers running out',
  summary: 'Summary in words',
  networth: 'Family net worth',
  spending: 'This month’s spending',
  reminders: 'Expiring & due',
  bills: 'Upcoming bills',
  budgets: 'Budgets',
  portfolio: 'Investments',
  nominations: 'Nominations',
  dates: 'Birthdays & anniversaries',
  tasks: 'Tasks',
  activity: 'Recent activity',
};
