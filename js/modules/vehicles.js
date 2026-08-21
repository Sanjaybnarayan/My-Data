/**
 * Vehicles, and what each one does to a litre.
 *
 * The mileage sits above the list rather than on one vehicle's record, because
 * a household with two cars wants them side by side — and because the
 * refusals are the interesting part, and a refusal nobody sees is a field
 * still being collected for nothing.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, listItem, chip, pageHeader, button } from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entitiesOfModule } from '../data/schema.js';
import { VehiclesService } from '../services/vehicles.js';
import { describeMileage } from '../domain/fuel.js';
import { format } from '../core/money.js';

const TABS = ['vehicle', 'vehicleService', 'fuelLog'];

export async function render(route) {
  const entities = entitiesOfModule('vehicles');
  const active = route.entity && TABS.includes(route.entity) ? route.entity : 'vehicle';

  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const body = h('div', {});
  let section = null;

  const host = h('div', {}, [
    pageHeader('Vehicles', {
      subtitle: 'What you drive, what it costs, and what it returns',
      actions: [button('Add', {
        variant: 'primary', iconName: 'plus', onClick: () => section?.openForm(),
      })],
    }),
    h('div', { class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' } },
      TABS.map((name) => chip(entities.find((e) => e.name === name)?.labels.many ?? name, {
        pressed: name === active,
        onClick: () => app().router.navigate({ module: 'vehicles', entity: name }),
      }))),
    body,
  ]);

  section = await listSection(active, {
    autoOpenNew: route.id === 'new',
    banner: active === 'vehicle' || active === 'fuelLog' ? mileageBanner : undefined,
  });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * Mileage per vehicle, with what could not be measured said plainly.
 *
 * A household records the litres and ticks "full tank"; until now nothing read
 * either field. The sentence about a missed fill-up is on the card rather than
 * only in the source, because it is the one way this figure can be wrong while
 * looking perfectly reasonable.
 */
async function mileageBanner() {
  const review = await new VehiclesService(app().db).mileage();
  if (!review.any) return null;

  return [card({ class: 'vehicle-mileage' }, [
    cardHeader('What each one returns', null, {
      subtitle: 'Measured between full tanks — the only stretch where the fuel '
        + 'burned is known exactly',
    }),
    h('div', { class: 'list' }, review.rows.map((row) => listItem({
      title: row.vehicle.registration || row.vehicle.name || 'Vehicle',
      subtitle: describeMileage(row, (n) => format(n)),
      trailing: row.kmPerLitre === null
        ? badge('—', 'warning')
        : badge(`${row.kmPerLitre} km/l`),
      href: Router.href({ module: 'vehicles', entity: 'vehicle', id: row.vehicle.id }),
    }))),
    h('p', { class: 'small faint' },
      'A fill-up that was not recorded makes one stretch span two tanks while '
      + 'counting one, and the figure comes out roughly twice what it should '
      + 'be. Nothing here can tell that from an economical stretch, which is '
      + 'why every stretch is listed on the vehicle rather than only a total.'),
  ])];
}
