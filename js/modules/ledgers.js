/**
 * Who money went to, who owes whom, and what is worth saying out loud.
 *
 * Every number here comes from `domain/categorise.js`, which has been able to
 * produce all of it since the statement importer was written. The only thing
 * that was missing was somewhere to see it: the ledgers ran on a command line
 * and the application showed a category total and stopped.
 *
 * These read the whole history rather than one file, which is the part a
 * command line could never do well. "How much has gone back and forth with
 * this person, ever" is not a question about a statement.
 *
 * ## Corrections are retroactive
 *
 * A counterparty corrected here is corrected everywhere, including in every
 * transaction imported before the correction was made — the categoriser is
 * re-run over the stored narrations rather than its old conclusions being
 * read back. That is why the override list lives on this screen: it is the
 * one place where the effect of a correction is visible immediately.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, button, badge, empty, listItem, metric, money, divider,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { app } from '../context.js';
import { fromRecords, confidence, overridesFrom } from '../domain/ledger.js';
import {
  CATEGORIES, categoryLabel, peopleLedger, lendingLedger, insights, summarise,
} from '../domain/categorise.js';
import { format } from '../core/money.js';
import { TRANSACTION_LIMIT } from '../services/service.js';

/** Where corrections are kept. Shared with the statement importer. */
const OVERRIDES = 'finance.overrides';
const BUSINESSES = 'finance.businesses';

/**
 * @param {'people'|'lending'|'insights'} view
 */
export async function render(view = 'people') {
  const { db } = app();
  const host = h('div', {});

  let corrections = await db.meta(OVERRIDES, []);
  const businesses = await db.meta(BUSINESSES, []);
  const people = await db.repo('person').list({ decrypt: false, limit: 200 });
  const holder = people.find((person) => person.role === 'owner')?.name ?? '';

  const records = await db.repo('transaction').list({ decrypt: false, limit: TRANSACTION_LIMIT });
  let rows = [];

  recompute();
  paint();
  return { node: host };

  function recompute() {
    rows = fromRecords(records, {
      holder, businesses, overrides: overridesFrom(corrections),
    });
  }

  async function correct(key, name, category) {
    corrections = [
      ...corrections.filter((entry) => entry.key !== key),
      ...(category ? [{ key, name, category }] : []),
    ];
    await db.setMeta(OVERRIDES, corrections);
    recompute();
    paint();
    toast(category
      ? `${name} is now ${categoryLabel(category)} — everywhere, including past months`
      : `${name} is back to what the rules make of it`, { kind: 'success' });
  }

  function paint() {
    if (!records.length) {
      replace(host, empty({
        title: 'Nothing imported yet',
        message: 'Import a statement and this fills itself in. Every figure here is '
          + 'read from the narrations your bank wrote, on this device.',
        iconName: 'receipt',
        action: button('Import statements', {
          variant: 'primary',
          onClick: () => app().router.navigate({ module: 'finance', entity: 'import' }),
        }),
      }));
      return;
    }

    replace(host, [
      trustCard(),
      view === 'people' ? peopleCard() : null,
      view === 'lending' ? lendingCard() : null,
      view === 'insights' ? insightsCard() : null,
      correctionsCard(),
    ].filter(Boolean));
  }

  /* ----------------------------------------------------------------- trust */

  function trustCard() {
    const sure = confidence(rows);
    if (sure.trustworthy) return null;

    return card({ class: 'card--quiet' }, [
      cardHeader('Some directions are inferred', null, { iconName: 'alert' }),
      h('p', { class: 'muted' }, [
        `${sure.uncertain} of ${sure.total} transactions were imported before this `
        + 'application recorded which way the money went, and are transfers, where '
        + '“in” and “out” cannot be told apart from the narration alone. They are '
        + 'counted as outgoing, which is the commoner half. ',
        h('strong', {}, 'Re-importing those statements would replace the guess with the reading.'),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------- people */

  function peopleCard() {
    const ledger = peopleLedger(rows);
    if (!ledger.length) {
      return empty({
        title: 'No person-to-person payments found',
        message: 'UPI transfers to and from individuals appear here, netted per person.',
        iconName: 'user',
      });
    }

    const sent = ledger.reduce((total, person) => total + person.sent, 0);
    const received = ledger.reduce((total, person) => total + person.received, 0);
    const reciprocal = ledger.filter((person) => person.reciprocal);

    return card({}, [
      cardHeader('Person to person', null, {
        subtitle: `${ledger.length} people, netted over everything imported`,
        iconName: 'user',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Sent', value: money(sent) }),
        metric({ label: 'Received', value: money(received) }),
        metric({ label: 'Net', value: money(received - sent, { signed: true }) }),
        metric({ label: 'Both ways', value: String(reciprocal.length) }),
      ]),

      ...ledger.map((person) => h('div', {}, [
        listItem({
          title: person.name,
          subtitle: [
            `${person.count} ${person.count === 1 ? 'payment' : 'payments'}`,
            person.reciprocal ? 'money both ways' : null,
          ].filter(Boolean).join(' · '),
          value: money(person.balance, { signed: true }),
          trailing: correctChip(person.key, person.name),
        }),
        h('p', { class: 'small faint' }, [
          'Sent ', h('strong', {}, format(person.sent)),
          ', received ', h('strong', {}, format(person.received)),
          person.balance === 0 ? ' — square.'
            : person.balance > 0 ? ' — they have sent you more than you have sent them.'
              : ' — you have sent them more than they have sent you.',
        ]),
      ])),

      reciprocal.length
        ? h('p', { class: 'small muted' },
          'Money moving both ways with the same person is usually a lending '
          + 'relationship or a shared cost, not a series of gifts. Those also appear '
          + 'under Lending, with the outstanding figure.')
        : null,
    ].filter(Boolean));
  }

  /* --------------------------------------------------------------- lending */

  function lendingCard() {
    const ledger = lendingLedger(rows);
    if (!ledger.length) {
      return empty({
        title: 'No borrowing or lending found',
        message: 'EMIs, loan disbursals and money that moves both ways with a person '
          + 'appear here with what is still outstanding.',
        iconName: 'loan',
      });
    }

    const institutions = ledger.filter((line) => line.kind === 'institution');
    const persons = ledger.filter((line) => line.kind === 'person');
    const owed = institutions.reduce((total, line) => total + line.outstanding, 0);

    return card({}, [
      cardHeader('Borrowing and lending', null, {
        subtitle: 'What came in, what has gone back, what is left',
        iconName: 'loan',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Lenders', value: String(institutions.length) }),
        metric({ label: 'People', value: String(persons.length) }),
        metric({ label: 'Net with lenders', value: money(owed, { signed: true }) }),
      ]),

      ...ledger.map((line) => h('div', {}, [
        listItem({
          title: line.name,
          subtitle: `${line.count} transactions · ${line.kind === 'institution' ? 'lender' : 'person'}`,
          value: money(line.outstanding, { signed: true }),
          leading: badge(line.kind === 'institution' ? 'loan' : 'p2p',
            line.kind === 'institution' ? 'warn' : 'info'),
          trailing: correctChip(line.key, line.name),
        }),
        h('p', { class: 'small faint' }, [
          'Received ', h('strong', {}, format(line.borrowed)),
          ', paid back ', h('strong', {}, format(line.repaid)),
          line.outstanding > 0
            ? ' — more has come in than has gone back.'
            : ' — more has gone back than came in.',
        ]),
      ])),

      h('p', { class: 'small muted' },
        'This is what the statements show, not a loan schedule. A loan taken before '
        + 'the earliest statement imported looks smaller than it is, because the '
        + 'money arriving is not in the record and only the repayments are.'),
    ]);
  }

  /* -------------------------------------------------------------- insights */

  function insightsCard() {
    const summary = summarise(rows);
    const notes = insights(rows, summary);

    return h('div', {}, [
      card({}, [
        cardHeader('Everything imported', null, {
          subtitle: `${rows.length} transactions across ${summary.byMonth.length} months`,
          iconName: 'chart',
        }),
        h('div', { class: 'grid grid--tight' }, [
          metric({ label: 'In', value: money(summary.moneyIn) }),
          metric({ label: 'Out', value: money(summary.moneyOut) }),
          metric({ label: 'Spent', value: money(summary.spending) }),
          metric({ label: 'Net', value: money(summary.net, { signed: true }) }),
        ]),
      ]),

      card({}, [
        cardHeader('Worth saying out loud', null, {
          subtitle: 'Facts with the arithmetic attached, not advice',
          iconName: 'sparkle',
        }),
        notes.length
          ? h('div', {}, notes.map((note) => listItem({
            title: note.text,
            value: note.amount ? money(note.amount) : '',
            leading: badge(note.kind, tone(note.kind)),
          })))
          : h('p', { class: 'muted' },
            'Nothing stands out — no overdrawn months, no unusual concentration, '
            + 'nothing repeating that should not be.'),
      ]),

      card({}, [
        cardHeader('Where it goes', null, { iconName: 'wallet' }),
        ...summary.byCategory
          .filter((entry) => entry.kind === 'spending' && entry.out > 0)
          .map((entry) => listItem({
            title: entry.label ?? categoryLabel(entry.key),
            subtitle: `${entry.count} ${entry.count === 1 ? 'payment' : 'payments'}`,
            value: money(entry.out),
          })),
      ]),
    ]);
  }

  /* ----------------------------------------------------------- corrections */

  /**
   * Correcting one counterparty.
   *
   * The rules get most things right and cannot get everything right: a friend
   * whose UPI handle is their shop's name reads as a merchant, a shop trading
   * under a person's name reads as a person. Until now the categoriser
   * accepted an override map that nothing could write to, which is the same as
   * not having one.
   */
  function correctChip(key, name) {
    const current = corrections.find((entry) => entry.key === key);

    const select = h('select', {
      class: 'input input--small',
      'aria-label': `Category for ${name}`,
      onChange: (event) => correct(key, name, event.target.value),
    }, [
      h('option', { value: '' }, current ? 'Undo correction' : 'Correct…'),
      ...CATEGORIES.map((category) => h('option', {
        value: category.key,
        selected: current?.category === category.key,
      }, category.label)),
    ]);

    return select;
  }

  function correctionsCard() {
    if (!corrections.length) return null;

    return card({}, [
      cardHeader('Your corrections', null, {
        subtitle: `${corrections.length} counterparties, applied to every month`,
        iconName: 'edit',
      }),
      ...corrections.map((entry) => listItem({
        title: entry.name,
        subtitle: `Always ${categoryLabel(entry.category)}`,
        trailing: button('Undo', { onClick: () => correct(entry.key, entry.name, '') }),
      })),
      divider(),
      h('p', { class: 'small muted' },
        'A correction is applied when the figures are read, not when a statement is '
        + 'imported — so it reaches every transaction already on record, not only the '
        + 'ones imported after it.'),
    ]);
  }
}

const tone = (kind) => ({
  balance: 'warn', cash: 'warn', charges: 'warn', coverage: 'info',
}[kind] ?? 'info');
