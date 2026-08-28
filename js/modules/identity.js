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
import {
  card, cardHeader, badge, listItem, chip, pageHeader, button, carousel, walletCard,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { t } from '../core/locale.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entitiesOfModule } from '../data/schema.js';
import { describeDrift } from '../domain/kyc.js';
import { describeConflict, SEVERITY, KIND } from '../domain/kycconflict.js';
import { IdentityService } from '../services/identity.js';
import { describeCompletion } from '../domain/profile.js';
import { summarise } from '../domain/wallet.js';
import { formatDay } from '../core/dates.js';

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
    pageHeader(t('identity.title'), {
      subtitle: t('identity.subtitle'),
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
    banner: active === 'kycRecord' ? kycBanner
      : active === 'person' ? completionBanner
      : active === 'identityDocument' ? walletBanner
      : undefined,
  });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * How much of each profile is filled in, above the list of people.
 *
 * The figure is never shown on its own. A bare percentage is a scold: it tells
 * a household it is failing at something without saying at what, and the only
 * available response is to feel vaguely behind. So each person's number is
 * followed by the sections it is short of, and by how many they have said do
 * not apply — which is the difference between a gap and a decision.
 */
async function completionBanner() {
  const { people, family } = await new IdentityService(app().db).profiles();
  if (!people.length || family.percent === null) return null;

  return [card({ class: 'card--quiet profile-completion' }, [
    cardHeader('Profiles', null, {
      subtitle: `${family.percent}% across ${family.scored} `
        + `${family.scored === 1 ? 'person' : 'people'}`,
    }),
    h('div', { class: 'stack stack--tight' }, people.map((row) => listItem({
      title: row.person.name,
      subtitle: describeCompletion(row),
      trailing: row.percent === null
        ? badge('—')
        : badge(`${row.percent}%`, row.percent === 100 ? 'positive' : ''),
      onClick: () => app().router.navigate({
        module: 'identity', entity: 'person', id: row.person.id,
      }),
    }))),
  ])];
}

/**
 * The identity documents, as cards.
 *
 * ## Why a card and not another row
 *
 * A passport is a physical object a household recognises by its shape. The
 * table below is the right way to *edit* one and the wrong way to answer "has
 * anything lapsed" — which is the question somebody opens this screen with,
 * and which a column of dates makes them do arithmetic for.
 *
 * The design principle is borrowed and the execution is not: no issuer
 * artwork, no imitation of anybody's wallet application, no logo a household
 * would read as a connection to an authority that does not exist.
 *
 * ## What these cards refuse to say
 *
 * **Verified.** Nothing here contacts an issuing authority — no CKYCRR, no
 * DigiLocker, no ABDM. Every number was typed in from a document somebody was
 * holding, and the line under the cards says exactly that. The only status a
 * card carries is about the expiry date they entered, and *unknown* is one of
 * its values: a document with no expiry recorded is not "valid", it is one
 * nobody has said when it runs out.
 *
 * The number is masked by `IdentityService.wallet`, not here. A wallet card is
 * precisely the hand-built surface `data/schema.js` warns about — the kind
 * that never passes through the field renderer — so the masking happens where
 * a second screen cannot forget it.
 */
async function walletBanner() {
  const cards = await new IdentityService(app().db).wallet();
  if (!cards.length) return null;

  const counts = summarise(cards);
  const pressing = counts.expired + counts.soon;

  return [
    card({ class: 'card--flush wallet-strip' }, [
      h('div', { class: 'profile-group-head' }, cardHeader(t('wallet.title'),
        badge(pressing
          ? t('wallet.pressing', { n: pressing })
          : t('wallet.count', { n: cards.length }),
        pressing ? 'warning' : ''), { iconName: 'wallet' })),

      carousel(cards.map(walletDocument), { label: t('wallet.title') }),

      h('p', { class: ['small', 'muted', 'profile-group-head'] }, t('wallet.typed')),
    ]),
  ];
}

/** The five things a card may carry, and no sixth. */
function walletDocument(one) {
  const STATUS = {
    expired: { label: t('wallet.state.expired'), tone: 'danger' },
    soon: { label: t('wallet.state.soon'), tone: 'warning' },
    valid: { label: t('wallet.state.valid'), tone: 'positive' },
    unknown: { label: t('wallet.state.unknown'), tone: '' },
  };

  return walletCard({
    title: one.kind,
    subtitle: one.holder ?? t('wallet.nobody'),
    // Already masked. Printing `one.number` raw here is what the browser
    // suite's identifier sweep exists to catch.
    value: one.number ?? t('wallet.noNumber'),
    meta: one.expiresOn
      ? t('wallet.expires', { day: formatDay(one.expiresOn) })
      : t('wallet.noExpiry'),
    updated: one.updatedAt
      ? t('wallet.updated', { day: formatDay(String(one.updatedAt).slice(0, 10)) })
      : t('wallet.neverUpdated'),
    status: STATUS[one.state],
    href: one.id
      ? Router.href({ module: 'identity', entity: 'identityDocument', id: one.id })
      : undefined,
  });
}

/**
 * What the KYC records say when read against each other.
 *
 * Rebuilt on every load rather than computed once, so correcting a record
 * changes the finding immediately — the same derived-at-read-time rule the rest
 * of the application follows.
 */
async function kycBanner() {
  const review = await new IdentityService(app().db).review();
  if (!review.any) return null;

  const nameOf = IdentityService.nameLookup(review.people);
  const cards = [provenanceNote()];

  // Above the per-person drift, always. One identifier held against two people
  // is not a worse version of an address disagreement — it is a different
  // thing, and the only finding here that can mean somebody's identity is
  // being used twice.
  if (review.conflicts.length) cards.push(conflictCard(review.conflicts, nameOf));

  for (const { person, entries } of review.drift) cards.push(driftCard(person, entries));
  if (review.stale.length) cards.push(staleCard(review.stale));
  if (review.malformed.length) cards.push(kinCard(review.malformed));

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
      t('identity.provenanceNote')),
  ]);
}

/**
 * What is wrong across the household, worst first.
 *
 * The severity is a badge and never an instruction. A household decides what to
 * do about a shared CKYC identifier; this screen's whole job is to make sure
 * they know it exists.
 */
function conflictCard(conflicts, nameOf) {
  const critical = conflicts.filter((one) => one.severity === SEVERITY.CRITICAL);

  return card({ class: 'kyc-conflicts' }, [
    cardHeader(
      critical.length
        ? 'One identifier, more than one person'
        : 'An institution disagrees with your own record',
      badge(String(conflicts.length), critical.length ? 'danger' : 'warning'),
      { iconName: 'info' },
    ),

    h('div', { class: 'list' }, conflicts.map((conflict) => listItem({
      title: conflict.kind === KIND.SHARED_IDENTIFIER
        ? `${conflict.field.toUpperCase()} recorded against ${conflict.people.length} people`
        : `${conflict.institution}: ${conflict.label.toLowerCase()}`,
      subtitle: describeConflict(conflict, nameOf),
      href: conflict.kind === KIND.FIELD
        ? Router.href({ module: 'identity', entity: 'kycRecord', id: conflict.record })
        : undefined,
    }))),

    h('p', { class: 'small faint' },
      'Nothing here is merged, corrected or decided. A disagreement between two '
      + 'identity records is usually evidence that something is wrong somewhere '
      + 'else — at an institution, or in what somebody was told.'),
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
