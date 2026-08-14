/**
 * Identity.
 *
 * Everything here except one card is the generic CRUD screen, and deliberately
 * so — a person, an identity document and an employment record are lists, and
 * a list is what `modules/crud.js` already builds from the schema.
 *
 * The exception is KYC. A table of what each institution holds answers nothing
 * on its own: the question a household has is *"do my bank, my broker and my
 * insurer all hold the same address"*, and that is a comparison across rows
 * rather than a column in one. `domain/kyc.js` does the comparing; this puts
 * the answer above the table.
 *
 * ## What this screen must never imply
 *
 * Nothing in this application contacts the Central KYC Records Registry. Every
 * value on a KYC record was typed in by the household from something they were
 * shown, and every sentence here says so. A screen that let somebody believe
 * these figures came from a registry would be worse than no screen: they would
 * stop checking.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, listItem, chip, pageHeader, button } from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entitiesOfModule } from '../data/schema.js';
import { kycDrift, describeDrift, stale, kinNote, latestPerInstitution } from '../domain/kyc.js';
import { formatDay, today } from '../core/dates.js';

const TABS = ['person', 'identityDocument', 'kycRecord', 'employment'];

export async function render(route) {
  const entities = entitiesOfModule('identity');
  const active = route.entity && TABS.includes(route.entity) ? route.entity : 'person';

  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const body = h('div', {});
  let section = null;

  const host = h('div', {}, [
    pageHeader('Identity', {
      subtitle: 'Who everyone is, and what each institution holds',
      actions: [button('Add', {
        variant: 'primary', iconName: 'plus', onClick: () => section?.openForm(),
      })],
    }),
    h('div', { class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' } },
      TABS.map((name) => chip(entities.find((e) => e.name === name)?.labels.many ?? name, {
        pressed: name === active,
        onClick: () => app().router.navigate({ module: 'identity', entity: name }),
      }))),
    body,
  ]);

  section = await listSection(active, {
    autoOpenNew: route.id === 'new',
    banner: active === 'kycRecord' ? kycBanner : undefined,
  });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * What the KYC records say when read against each other.
 *
 * Rebuilt on every load rather than computed once, so correcting a record
 * changes the finding immediately — the same derived-at-read-time rule the rest
 * of the application follows.
 */
async function kycBanner() {
  const { db } = app();

  const [people, records, documents] = await Promise.all([
    db.repo('person').list({ limit: 500 }),
    db.repo('kycRecord').list({ limit: 2000 }),
    db.repo('identityDocument').list({ limit: 2000 }),
  ]);

  const live = records.filter((r) => !r.deletedAt);
  if (!live.length) return null;

  const cards = [provenanceNote()];

  for (const person of people.filter((p) => !p.deletedAt)) {
    const drift = kycDrift(person, live, documents);
    if (drift.length) cards.push(driftCard(person, drift));
  }

  const notChecked = stale(live, today());
  if (notChecked.length) cards.push(staleCard(notChecked));

  const malformed = latestPerInstitution(live)
    .map((record) => ({ record, note: kinNote(record.kin) }))
    .filter(({ note }) => note);
  if (malformed.length) cards.push(kinCard(malformed));

  return cards;
}

/**
 * Said once, above everything else, and not softened.
 *
 * The whole value of these records is that a household knows where each number
 * came from. A screen that let them drift into believing it came from a
 * registry would quietly turn notes into evidence.
 */
function provenanceNote() {
  return card({ class: 'card--quiet kyc-provenance' }, [
    h('p', { class: 'small muted', style: { margin: 0 } },
      'These are your own notes on what each institution holds, taken from '
      + 'statements, portals and letters. Nothing here is fetched from the '
      + 'Central KYC Records Registry, and nothing here is verified — only '
      + 'compared.'),
  ]);
}

function driftCard(person, drift) {
  return card({ class: 'kyc-drift' }, [
    cardHeader(`${person.name}: recorded differently in more than one place`,
      badge(String(drift.length), 'warning'), { iconName: 'info' }),

    h('div', { class: 'list' }, drift.map((entry) => listItem({
      title: entry.label,
      subtitle: describeDrift(entry),
    }))),

    h('p', { class: 'small faint' },
      'Which of these is current is not something this can work out. The one '
      + 'to trust is whichever you last confirmed with the institution itself.'),
  ]);
}

function staleCard(records) {
  return card({ class: 'card--quiet kyc-stale' }, [
    cardHeader('Not checked in a long time', badge(String(records.length)), { iconName: 'info' }),
    h('p', { class: 'small muted' },
      'An address that has not changed needs no update, so this is not a '
      + 'problem in itself. It is worth knowing when two records disagree: the '
      + 'older one is the likelier to be out of date.'),
    h('div', { class: 'list' }, records.map((record) => listItem({
      title: record.institution,
      subtitle: `Last known on ${formatDay(record.recordedOn)}`,
      href: Router.href({ module: 'identity', entity: 'kycRecord', id: record.id }),
    }))),
  ]);
}

function kinCard(entries) {
  return card({ class: 'card--quiet kyc-kin' }, [
    cardHeader('Worth a second look', badge(String(entries.length)), { iconName: 'info' }),
    h('div', { class: 'list' }, entries.map(({ record, note }) => listItem({
      title: record.institution,
      subtitle: note,
      href: Router.href({ module: 'identity', entity: 'kycRecord', id: record.id }),
    }))),
  ]);
}
