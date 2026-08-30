/**
 * The vault, and the one comparison this application can make about a will.
 *
 * `domain/estate.js` has said since it was written that **a nominee is not an
 * heir** — a nomination says who an institution may pay, not who is entitled
 * to keep it. It could state the principle and check nothing, because there
 * was nowhere to record what a will says. There is now, so the two can be put
 * side by side.
 *
 * What this screen must never become is the will. It shows the household's own
 * notes on the instrument, says where the original is, and says in as many
 * words that the instrument decides.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, listItem, chip, pageHeader, button } from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entitiesOfModule } from '../data/schema.js';
import { EstateService } from '../services/estate.js';
import { A_NOTE_IS_NOT_THE_WILL } from '../domain/estate.js';
import { formatDay } from '../core/dates.js';

const TABS = ['vaultItem', 'will', 'beneficiary', 'legalDocument'];

const MODULE_OF = {
  account: 'finance', holding: 'investments', policy: 'insurance',
};

export async function render(route) {
  const entities = entitiesOfModule('vault');
  const active = route.entity && TABS.includes(route.entity) ? route.entity : 'vaultItem';

  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const body = h('div', {});
  let section = null;

  const host = h('div', {}, [
    pageHeader('Vault', {
      subtitle: 'Secrets, and the papers a family would have to find',
      actions: [button('Add', {
        variant: 'primary', iconName: 'plus', onClick: () => section?.openForm(),
      })],
    }),
    h('div', { class: 'chip-row', role: 'group', style: { marginBottom: 'var(--space-4)' } },
      TABS.map((name) => chip(entities.find((e) => e.name === name)?.labels.many ?? name, {
        pressed: name === active,
        onClick: () => app().router.navigate({ module: 'vault', entity: name }),
      }))),
    body,
  ]);

  section = await listSection(active, {
    autoOpenNew: route.id === 'new',
    banner: active === 'will' || active === 'beneficiary' ? willBanner : undefined,
  });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * What the will says, beside what each institution was told.
 *
 * The refusal comes first and is not softened. Everything below it is a
 * question for the household, never an answer: a disagreement is shown with
 * both names and no verdict, because which one governs depends on the asset,
 * the statute, and facts this application does not have.
 */
async function willBanner() {
  const review = await new EstateService(app().db).wills();
  if (!review.any) return null;

  const cards = [card({ class: 'card--quiet will-notice' }, [
    h('p', { class: 'small muted', style: { margin: 0 } }, A_NOTE_IS_NOT_THE_WILL),
  ])];

  if (review.duplicates.length) cards.push(duplicateWillsCard(review.duplicates, review.people));
  if (review.conflicts.length) cards.push(conflictCard(review.conflicts));
  if (review.unclear.length) cards.push(unclearCard(review.unclear));

  const { coverage } = review;
  if (coverage.willOnly.length) cards.push(coverageCard(coverage.willOnly));

  return cards;
}

/**
 * Two wills in force for one person.
 *
 * Above the bequest comparison, because until it is settled every bequest in
 * both is being compared as though it still stood.
 */
function duplicateWillsCard(rows, people) {
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? id;

  return card({ class: 'will-duplicates' }, [
    cardHeader('More than one will in force',
      badge(String(rows.length), 'warning'), { iconName: 'alert' }),
    h('p', { class: 'small muted' },
      'A later will usually supersedes an earlier one, and there are enough '
      + 'exceptions that this application does not decide. Mark the ones that '
      + 'no longer apply as revoked, and the comparison below will stop using '
      + 'them.'),
    ...rows.map((row) => h('div', { class: 'list' }, [
      h('p', { class: 'small', style: { padding: '0 var(--space-5)' } },
        `${nameOf(row.testator)} — ${row.wills.length} in force`),
      ...row.wills.map((one) => listItem({
        title: one.title,
        subtitle: one.executedOn
          ? `Executed ${formatDay(one.executedOn)}${one.whereKept ? ` · ${one.whereKept}` : ''}`
          : 'No execution date recorded, so which is later cannot be said',
        href: Router.href({ module: 'vault', entity: 'will', id: one.id }),
      })),
    ])),
  ]);
}

/** A nomination and a bequest naming different people. */
function conflictCard(rows) {
  return card({ class: 'will-conflicts' }, [
    cardHeader('The will and the nomination name different people',
      badge(String(rows.length), 'danger'), { iconName: 'alert' }),
    h('p', { class: 'small muted' },
      'A nomination decides who the institution may pay. A will decides who is '
      + 'entitled to keep it. Both are shown; which one governs is not for this '
      + 'application to say.'),
    h('div', { class: 'list' }, rows.map((row) => listItem({
      title: `${row.label} · ${row.name}`,
      subtitle: `Nominated to ${row.nominee} · the will leaves it to `
        + `${row.beneficiary}${row.share ? ` (${row.share})` : ''}`,
      href: Router.href({ module: MODULE_OF[row.entity] ?? 'vault', entity: row.entity, id: row.id }),
    }))),
  ]);
}

/**
 * A spelling question, kept apart from a disagreement.
 *
 * "M Narayan" against "Meera Narayan" is an abbreviation. Putting it under the
 * heading above would send a household to a solicitor over an initial.
 */
function unclearCard(rows) {
  return card({ class: 'card--quiet will-unclear' }, [
    cardHeader('Possibly the same person, written two ways', badge(String(rows.length))),
    h('div', { class: 'list' }, rows.map((row) => listItem({
      title: `${row.label} · ${row.name}`,
      subtitle: `Nominated to ${row.nominee} · the will says ${row.beneficiary}`,
      href: Router.href({ module: MODULE_OF[row.entity] ?? 'vault', entity: row.entity, id: row.id }),
    }))),
  ]);
}

/** The will speaks to it and no nominee was ever recorded. */
function coverageCard(rows) {
  return card({ class: 'will-coverage' }, [
    cardHeader('The will names these, and the institution was never told',
      badge(String(rows.length), 'warning')),
    h('p', { class: 'small muted' },
      'Without a nomination the institution has nobody to pay, and the family '
      + 'has to claim through the will instead — which is slower, and sometimes '
      + 'much slower.'),
    h('div', { class: 'list' }, rows.map((row) => listItem({
      title: row.name,
      subtitle: row.where,
      href: Router.href({ module: MODULE_OF[row.entity] ?? 'vault', entity: row.entity, id: row.id }),
    }))),
  ]);
}
