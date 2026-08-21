/**
 * Travel.
 *
 * The list is the ordinary generic one. What is not generic is the line above
 * it: for every trip that leaves the country, whether the people going have a
 * passport that outlives the return date.
 *
 * It sits on the module rather than on one trip's record because the question
 * is asked while planning, not while looking at a booking — and because a
 * finding nobody passes on their way to something else is a finding nobody
 * reads.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, pageHeader, listItem, empty } from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { TravelService } from '../services/travel.js';

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const readiness = await new TravelService(db).readiness();

  replace(host, [
    pageHeader('Travel', { subtitle: 'Journeys, and the papers they need' }),
    passportCard(readiness),
    await listSection('trip', route),
  ]);
  return { node: host };
}

function passportCard(rows) {
  if (!rows.length) return null;

  const problems = rows.filter((r) => r.readiness.checked && r.readiness.findings.length);

  return card({}, [
    cardHeader('Before you go',
      problems.length
        ? badge(`${problems.length} to sort out`, 'warning')
        : badge('nothing outstanding', 'positive'),
      { iconName: 'globe' }),

    rows.length
      ? h('div', { class: 'list' }, rows.map((row) => listItem({
        title: row.trip.destination,
        subtitle: row.line,
        trailing: row.readiness.checked && row.readiness.findings.length
          ? badge('check', 'warning')
          : null,
        href: Router.href({ module: 'travel', entity: 'trip', id: row.trip.id }),
      })))
      : empty({ title: 'No trips coming up', iconName: 'globe' }),
  ]);
}
