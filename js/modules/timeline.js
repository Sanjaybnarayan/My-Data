/**
 * The family timeline.
 *
 * Everything that has happened to a household's records, in order, with what
 * happened said in words rather than shown as a table of `update` rows.
 *
 * ## Why this exists when the dashboard already has a card
 *
 * The card answers "what changed since I last looked" and shows eight lines of
 * it. The service was already building every story in the window and the card
 * was slicing the first eight off the front — on a small store that is 26 built
 * and dropped, and on a household that has used this for a year it is nearly
 * all of them. The history was there and unreachable, which is the same shape
 * as `fuelLog.litres` being collected and read by nothing.
 *
 * It also asks a different question. `recent()` collapses to the latest when
 * nothing is unseen, which is right for a card that would otherwise be empty
 * and wrong for a history — a household opening a timeline wants the whole
 * thing, not the part they have not acknowledged.
 *
 * ## What it does not claim
 *
 * This is the audit log, so it is what *this device* recorded. A change made on
 * a phone and synced here arrives as a row like any other, but a device that
 * has never synced has a timeline of its own, and nothing here pretends
 * otherwise. Deletions appear as deletions; a record somebody removed does not
 * vanish from its own history.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, pageHeader, listItem, chip } from '../ui/components/basics.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entity } from '../data/schema.js';
import { TimelineService } from '../services/timeline.js';
import { relativeDays, formatDay } from '../core/dates.js';

export async function render(route) {
  const host = h('div', {});
  await paint(host, route?.query?.entity ?? '');
  return { node: host };
}

async function paint(host, filter) {
  const { db } = app();
  const timeline = new TimelineService(db);
  const history = await timeline.history(filter ? { entityName: filter } : {});

  replace(host, [
    pageHeader('Family timeline', {
      subtitle: history.entries === 0
        ? 'Nothing has happened yet'
        : `${history.stories.length} ${history.stories.length === 1 ? 'entry' : 'entries'}`
          + (history.truncated ? ', the most recent — there are older ones' : ''),
    }),

    filters(history.present, filter, (next) => paint(host, next)),

    history.stories.length
      ? card({ class: 'card--flush' }, days(history))
      : card({}, [
        cardHeader('Nothing to show', null, { iconName: 'clock' }),
        h('p', { class: 'small muted' }, filter
          ? 'Nothing has happened to these records on this device.'
          : 'This is the log of what has happened to your records. It fills as you '
            + 'use FamilyOS, and it is kept on this device.'),
      ]),
  ]);
}

/**
 * Only the entities that appear. Offering all forty-three would be offering
 * forty-something filters that return nothing, which is worse than no filter.
 */
function filters(present, active, onPick) {
  if (present.length < 2) return null;

  return h('div', {
    class: 'row',
    role: 'group',
    'aria-label': 'Filter by entity type',
    style: { gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' },
  }, [
    chip('Everything', { pressed: !active, onClick: () => onPick('') }),
    ...present.map((name) => chip(entity(name).labels.many, {
      pressed: active === name,
      onClick: () => onPick(name),
    })),
  ]);
}

/**
 * Grouped by day, because "3 March" above a run of changes is how somebody
 * reads a history, and a date repeated on every line is noise.
 */
function days(history) {
  const byDay = new Map();
  for (const story of history.stories) {
    const day = String(story.at).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(story);
  }

  const out = [];
  for (const [day, stories] of byDay) {
    out.push(h('div', { class: ['small', 'faint', 'timeline-day'] },
      `${formatDay(day)} · ${relativeDays(day)}`));

    out.push(h('div', { class: 'list' }, stories.map((story) => listItem({
      title: history.describe(story),
      subtitle: String(story.at).slice(11, 16),
      href: story.entity && story.recordId
        ? Router.href({
          module: entity(story.entity).module,
          entity: story.entity,
          id: story.recordId,
        })
        : undefined,
    }))));
  }
  return out;
}
