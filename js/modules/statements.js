/**
 * Importing bank statements.
 *
 * Built for one habit: once a month, download every statement for every
 * account in the household and drop the whole pile in at once. That is the
 * only workflow this screen optimises for, and it is why nothing here asks a
 * question it can answer from the file itself.
 *
 * The order is read → review → write, and the review step is not decoration.
 * Each file arrives with the account it matched, whether its arithmetic
 * closes, how many rows are new and how many are already here. Nothing is
 * written until somebody has seen that, because a statement imported twice, or
 * filed against the wrong account, is far more work to undo than to prevent.
 *
 * Everything happens on the device. The PDF is decoded by `data/pdf-read.js`,
 * the rules are in `domain/categorise.js`, and no part of a statement is sent
 * anywhere — which for this file, of all files, is the point.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, button, badge, empty, listItem, metric, money, chip,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { confirm } from '../ui/components/modal.js';
import { app } from '../context.js';
import { extract } from '../data/pdf-read.js';
import {
  planStatement, reviewBatch, toRecord, toStatementRecord, accountFromStatement,
} from '../domain/import.js';
import { summarise, categoryLabel, businessLedger } from '../domain/categorise.js';
import { today } from '../core/dates.js';
import { format } from '../core/money.js';
import { userMessage } from '../core/errors.js';

export async function render() {
  const host = h('div', {});
  const body = h('div', {});

  /** @type {Array<object>} the plans currently under review */
  let plans = [];
  let busy = false;
  /**
   * The firms this household owns. The one fact no rule can derive: a business
   * account looks exactly like a stranger's until somebody says otherwise.
   */
  let businesses = await app().db.meta(BUSINESSES, []);

  const input = h('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    class: 'sr-only',
    onChange: (event) => {
      const files = [...(event.target.files ?? [])];
      event.target.value = '';
      if (files.length) void load(files);
    },
  });

  // Deliberately not a page header: this screen lives inside Finance's, and
  // two of them stacked reads as two pages.
  replace(host, [
    card({}, [
      cardHeader('Import statements', [
        button('Choose PDFs', { variant: 'primary', iconName: 'plus', onClick: () => input.click() }),
      ], { subtitle: 'Every account, every month, read on this device', iconName: 'receipt' }),
    ]),
    input,
    body,
  ]);

  paint();
  return { node: host };

  /* --------------------------------------------------------------- reading */

  async function load(files) {
    busy = true;
    paint();

    const { db } = app();
    const accounts = await db.repo('account').list({ limit: 500 });
    const existingKeys = await importedKeys(db);
    const next = [];

    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await extract(bytes);

        if (result.encrypted) {
          next.push({ file: file.name, error: 'This PDF is password-protected. Remove the password and try again.' });
          continue;
        }

        const rows = result.pages.flatMap((page) => page.rows);
        const plan = planStatement(rows, { file: file.name, accounts, existingKeys, businesses });
        // Kept so a plan can be redone against a newly created account without
        // asking for the file again.
        plan.rows = rows;

        if (!plan.transactions.length) {
          next.push({ file: file.name, error: 'No transactions found — this may not be a statement.' });
          continue;
        }

        // Within one batch, a row already claimed by an earlier file is not
        // new. Two statements whose periods overlap is the normal case when
        // somebody re-downloads a wider range.
        for (const row of plan.fresh) existingKeys.add(row.importKey ?? '');
        next.push(plan);
      } catch (err) {
        next.push({ file: file.name, error: userMessage(err) });
      }
    }

    plans = [...plans, ...next];
    busy = false;
    paint();
  }

  /* --------------------------------------------------------------- writing */

  async function importAll() {
    const writable = plans.filter((plan) => plan.match?.account && plan.fresh?.length);
    if (!writable.length) return;

    const total = writable.reduce((sum, plan) => sum + plan.fresh.length, 0);
    const unready = writable.filter((plan) => !plan.ready);

    const ok = await confirm({
      title: `Import ${total} transactions?`,
      message: unready.length
        ? `${unready.length} of these ${unready.length === 1 ? 'statement does' : 'statements do'} not fully add up. `
          + 'Importing anyway will leave gaps in the totals.'
        : 'Everything reconciles against the balances the bank printed.',
      confirmLabel: 'Import',
      danger: unready.length > 0,
    });
    if (!ok) return;

    busy = true;
    paint();

    const { db } = app();
    let written = 0;

    try {
      for (const plan of writable) {
        const accountId = plan.match.account.id;
        const statement = await db.repo('bankStatement').create(
          toStatementRecord(plan, { accountId, importedCount: plan.fresh.length, today: today() }),
        );

        for (const row of plan.fresh) {
          await db.repo('transaction').create(
            toRecord(row, { accountId, statementId: statement.id, personId: plan.personId }),
          );
          written += 1;
        }

        plan.imported = plan.fresh.length;
        plan.fresh = [];
      }

      toast(`${written} transactions imported`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  async function createAccountFor(plan) {
    const { db } = app();
    const people = await db.repo('person').list({ limit: 200 });
    const holder = people.find((person) => sameName(person.name, plan.parsed.account.holder));

    const created = await db.repo('account').create(
      accountFromStatement(plan.parsed.account, holder?.id ?? ''),
    );

    // Every file in the batch waiting on the same account now matches, so all
    // of them are redone rather than only the one that was clicked.
    const accounts = await db.repo('account').list({ limit: 500 });
    const existingKeys = await importedKeys(db);
    plans = plans.map((other) => (other.rows && !other.match?.account
      ? Object.assign(
        planStatement(other.rows, { file: other.file, accounts, existingKeys, businesses }),
        { rows: other.rows },
      )
      : other));

    toast(`Account “${created.name}” created`, { kind: 'success' });
    paint();
  }

  /**
   * Add or remove a business, then redo every file already loaded.
   *
   * Re-planning rather than relabelling: naming a business changes what is
   * income and what is not, and half a batch classified under the old answer
   * would be worse than not offering the setting at all.
   */
  async function setBusinesses(next) {
    businesses = next;
    await app().db.setMeta(BUSINESSES, next);

    const { db } = app();
    const accounts = await db.repo('account').list({ limit: 500 });
    const existingKeys = await importedKeys(db);

    plans = plans.map((plan) => (plan.rows && !plan.imported
      ? Object.assign(
        planStatement(plan.rows, { file: plan.file, accounts, existingKeys, businesses }),
        { rows: plan.rows },
      )
      : plan));
    paint();
  }

  /* -------------------------------------------------------------- painting */

  function paint() {
    if (busy) {
      replace(body, card({}, [h('p', { class: 'muted' }, 'Reading…')]));
      return;
    }

    if (!plans.length) {
      replace(body, [instructions(), businessesCard(), empty({
        title: 'No statements loaded',
        message: 'Choose one or more statement PDFs. Each is matched to an account by the number printed on it.',
        iconName: 'file',
        action: button('Choose PDFs', { variant: 'primary', onClick: () => input.click() }),
      })]);
      return;
    }

    const good = plans.filter((plan) => plan.parsed);
    const review = reviewBatch(good);
    const pending = good.reduce((sum, plan) => sum + (plan.fresh?.length ?? 0), 0);

    replace(body, [
      summaryCard(review, pending),
      businessesCard(),
      ...review.gaps.map(gapCard),
      ...plans.map(fileCard),
      pending ? h('div', { class: 'row row--end', style: { marginTop: 'var(--space-4)' } }, [
        button('Start again', { onClick: () => { plans = []; paint(); } }),
        button(`Import ${pending} transactions`, { variant: 'primary', onClick: importAll }),
      ]) : h('div', { class: 'row row--end', style: { marginTop: 'var(--space-4)' } }, [
        button('Start again', { onClick: () => { plans = []; paint(); } }),
      ]),
      ...good.filter((plan) => plan.imported).map(insightsCard),
      businessCard(good.flatMap((plan) => plan.transactions)),
    ].filter(Boolean));
  }

  function summaryCard(review, pending) {
    return card({}, [
      cardHeader(`${plans.length} ${plans.length === 1 ? 'file' : 'files'}`, null, {
        subtitle: 'What importing these would do',
      }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Transactions read', value: String(review.total) }),
        metric({ label: 'New', value: String(pending) }),
        metric({ label: 'Already here', value: String(review.duplicates) }),
        metric({
          label: 'Need attention',
          value: String(review.unmatched + review.unready),
        }),
      ]),
    ]);
  }

  function gapCard(gap) {
    return card({ class: 'card--quiet' }, [
      cardHeader('A statement is missing', null, { iconName: 'alert' }),
      h('p', {}, [
        `Between ${gap.after} and ${gap.before} the balance jumps by `,
        h('strong', {}, format(Math.abs(gap.difference))),
        '. That money moved in a statement that has not been imported, so any '
        + 'total covering this period will be wrong until it is.',
      ]),
    ]);
  }

  function fileCard(plan) {
    if (plan.error) {
      return card({ class: 'card--quiet' }, [
        cardHeader(plan.file, null, { iconName: 'alert' }),
        h('p', {}, plan.error),
      ]);
    }

    const account = plan.match.account;
    const header = plan.parsed.account;

    return card({}, [
      cardHeader(plan.file, [
        plan.imported ? badge(`${plan.imported} imported`, 'success')
          : plan.fresh.length ? badge(`${plan.fresh.length} new`, 'info')
            : badge('nothing new', ''),
      ], {
        subtitle: [header.bank, header.period].filter(Boolean).join(' · '),
        iconName: 'receipt',
      }),

      account
        ? listItem({
          title: account.name,
          subtitle: plan.match.sure
            ? 'Matched by the account number on the statement'
            : 'Best guess — check this is the right account',
          leading: badge(plan.match.sure ? 'matched' : 'unsure', plan.match.sure ? 'success' : 'warn'),
        })
        : h('div', {}, [
          h('p', { class: 'muted' }, [
            'No account on record matches ',
            h('strong', {}, header.number || 'this statement'),
            header.holder ? ` (${header.holder}).` : '.',
          ]),
          button('Create the account', {
            variant: 'primary', onClick: () => createAccountFor(plan),
          }),
        ]),

      h('div', { class: 'chip-row', style: { marginTop: 'var(--space-3)' } }, [
        chip(`${plan.transactions.length} rows`),
        chip(plan.duplicates.length ? `${plan.duplicates.length} already here` : 'none duplicated'),
        chip(plan.check.balanced ? 'arithmetic closes' : `off by ${format(plan.check.difference)}`),
        plan.problems.length ? chip(`${plan.problems.length} unreadable`) : null,
        chip(plan.parsed.mode === 'columns' ? 'read by column' : 'read from balances'),
      ].filter(Boolean)),

      plan.problems.length
        ? h('ul', { class: 'muted', style: { marginTop: 'var(--space-2)' } },
          plan.problems.slice(0, 5).map((problem) => h('li', {},
            `Row ${problem.serial} on ${problem.date}: ${problem.reason}`)))
        : null,
    ].filter(Boolean));
  }

  /**
   * Naming the household's own firms.
   *
   * The name is matched against the counterparty the bank printed, not against
   * a legal name, because that is all a statement carries. Whatever appears in
   * "Who is at the other end" is what to type here.
   */
  function businessesCard() {
    const field = h('input', {
      type: 'text',
      class: 'input',
      placeholder: 'Name as it appears on the statement',
      'aria-label': 'Business name',
      onKeyDown: (event) => { if (event.key === 'Enter') add(); },
    });

    const add = () => {
      const value = field.value.trim();
      if (!value || businesses.includes(value)) return;
      field.value = '';
      void setBusinesses([...businesses, value]);
    };

    return card({}, [
      cardHeader('Your businesses', null, {
        subtitle: 'Money from a firm you own is earnings, not a transfer from a stranger',
        iconName: 'briefcase',
      }),
      businesses.length
        ? h('div', { class: 'chip-row' }, businesses.map((name) => chip(`${name}  ✕`, {
          onClick: () => setBusinesses(businesses.filter((other) => other !== name)),
        })))
        : h('p', { class: 'muted' },
          'None named yet. Until one is, a business account looks exactly like a '
          + 'stranger sending money back and forth — the statement cannot tell them apart.'),
      h('div', { class: 'row', style: { marginTop: 'var(--space-3)', gap: 'var(--space-2)' } }, [
        field,
        button('Add', { onClick: add }),
      ]),
    ]);
  }

  function businessCard(rows) {
    const ledger = businessLedger(rows);
    if (!ledger.length) return null;

    return card({}, [
      cardHeader('Your business, both directions', null, {
        subtitle: 'What the firm paid out, and what went back in',
        iconName: 'briefcase',
      }),
      ...ledger.map((line) => h('div', {}, [
        listItem({
          title: line.name,
          subtitle: `${line.count} transactions across ${line.months} `
            + `${line.months === 1 ? 'month' : 'months'}`,
          value: money(line.net, { signed: true }),
        }),
        h('p', { class: 'muted small' }, [
          'Drawn out ', h('strong', {}, money(line.drawn)),
          ', put in ', h('strong', {}, money(line.contributed)),
          line.net >= 0
            ? ' — the household has taken more out than it has put in.'
            : ' — the household is carrying the business by the difference.',
        ]),
      ])),
    ]);
  }

  function insightsCard(plan) {
    const summary = summarise(plan.transactions);
    const spending = summary.byCategory
      .filter((entry) => entry.kind === 'spending' && entry.out > 0)
      .slice(0, 8);

    return card({}, [
      cardHeader(`What was in ${plan.file}`, null, { subtitle: 'Now on the Finance overview too' }),
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'In', value: money(summary.moneyIn) }),
        metric({ label: 'Out', value: money(summary.moneyOut) }),
        metric({ label: 'Spent', value: money(summary.spending) }),
        metric({ label: 'To people', value: money(summary.transfersOut) }),
      ]),
      ...spending.map((entry) => listItem({
        title: categoryLabel(entry.key),
        subtitle: `${entry.count} ${entry.count === 1 ? 'payment' : 'payments'}`,
        value: money(entry.out),
      })),
    ]);
  }
}

function instructions() {
  return card({}, [
    cardHeader('How this works', null, { iconName: 'info' }),
    h('ol', { class: 'muted' }, [
      h('li', {}, 'Choose every statement PDF you have this month — all accounts, all people, at once.'),
      h('li', {}, 'Each file is matched to an account by the number printed on it. Unknown accounts can be created here.'),
      h('li', {}, 'Rows already imported are skipped, so re-uploading the same month is harmless.'),
      h('li', {}, 'Nothing is written until you have seen what each file contains.'),
    ]),
  ]);
}

/* ---------------------------------------------------------------- helpers */

/**
 * Every fingerprint already on record.
 *
 * Read once per batch rather than queried per row: a household with a few
 * years of history has tens of thousands of transactions, and one pass over
 * them costs less than one index lookup per imported line.
 */
async function importedKeys(db) {
  const rows = await db.repo('transaction').list({ decrypt: false, limit: Infinity });
  return new Set(rows.map((row) => row.importKey).filter(Boolean));
}

/** Where the household's own firms are kept. */
const BUSINESSES = 'finance.businesses';

const sameName = (a, b) => String(a ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  === String(b ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
