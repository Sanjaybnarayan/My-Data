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
import { parseTable, looksLikeCard } from '../domain/tabular.js';
import {
  isPaymentApp, byInstrument, alreadyOnRecord, referencesIn, describeImport,
} from '../domain/paymentapp.js';
import {
  planStatement, reviewBatch, toRecord, toStatementRecord, accountFromStatement,
} from '../domain/import.js';
import { summarise, categoryLabel, businessLedger } from '../domain/categorise.js';
import { today } from '../core/dates.js';
import { format } from '../core/money.js';
import { transact } from '../data/unit.js';
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
    accept: 'application/pdf,.pdf,text/csv,.csv,.tsv,.txt',
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
        button('Choose files', { variant: 'primary', iconName: 'plus', onClick: () => input.click() }),
      ], { subtitle: 'Every account and card, every month, read on this device', iconName: 'receipt' }),
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
    const { keys: existingKeys, references } = await importedKeys(db);
    const next = [];

    for (const file of files) {
      try {
        const plan = isTable(file)
          ? await loadTable(file, { accounts, existingKeys, references, businesses })
          : await loadPdf(file, { accounts, existingKeys, businesses });

        if (plan.error) {
          next.push({ file: file.name, error: plan.error });
          continue;
        }

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

  /** A PDF: a picture of a table, which has to be found before it is read. */
  async function loadPdf(file, options) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await extract(bytes);

    if (result.encrypted) {
      return { error: 'This PDF is password-protected. Remove the password and try again.' };
    }

    const rows = result.pages.flatMap((page) => page.rows);
    const plan = planStatement(rows, { file: file.name, ...options });
    // Kept so a plan can be redone against a newly created account without
    // asking for the file again.
    plan.rows = rows;
    return plan;
  }

  /**
   * A CSV, TSV or card export: already a table.
   *
   * Worth preferring where a bank offers it. None of the PDF reader's failure
   * modes — columns found by where the ink landed, wrapped lines, arithmetic
   * checked against a printed balance — exist when the bank has already said
   * which figure is the withdrawal.
   */
  async function loadTable(file, options) {
    const text = await file.text();
    const card = looksLikeCard(text);
    const parsed = parseTable(text, { card });

    if (parsed.error) return { error: parsed.error };

    // `parsed` short-circuits the PDF path inside the planner; everything
    // after it — categorising, fingerprinting, reconciling — is identical.
    const plan = planStatement([], { file: file.name, parsed, ...options });
    plan.card = card;
    plan.rows = null;

    // A payment app's export is not one account's statement: it spans every
    // bank account the app is linked to, and every row of it is a movement the
    // bank also recorded. Both facts change what this screen must say.
    if (isPaymentApp(parsed)) {
      const { seen } = alreadyOnRecord(parsed.transactions, options.references ?? new Set());
      const onRecord = new Set(seen.map((row) => row.utr));

      plan.paymentApp = {
        accounts: byInstrument(parsed.transactions),
        seen: seen.length,
        fresh: parsed.transactions.length - seen.length,
      };

      // Moved out of `fresh` rather than dropped: the row is real, it is
      // simply already counted, and a household comparing the two files should
      // see it named as a duplicate rather than silently missing.
      plan.duplicates = [...plan.duplicates,
        ...plan.fresh.filter((row) => row.utr && onRecord.has(row.utr))];
      plan.fresh = plan.fresh.filter((row) => !(row.utr && onRecord.has(row.utr)));
    }

    return plan;
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

        // One unit per file, and the reason is the `importedCount` below. The
        // statement record states how many rows came out of it; the rows are
        // written after it. Before this, a failure part way through — a full
        // disk, a closed tab, one malformed row — left a statement saying
        // forty transactions were imported sitting next to the twelve that
        // were, and nothing anywhere knew the two were meant to agree.
        //
        // All-or-nothing rather than keeping what was written, because the
        // import is safe to re-run: rows carry a fingerprint and a second
        // attempt at the same file is recognised as a duplicate rather than
        // doubled. Losing 198 good rows in order to retry them is cheaper than
        // a statement that lies about its own contents.
        //
        // Per file rather than per batch, so one enormous transaction cannot
        // form out of several statements at once.
        await transact(db, async (unit) => {
          const statement = await unit.create(
            'bankStatement',
            toStatementRecord(plan, { accountId, importedCount: plan.fresh.length, today: today() }),
          );

          for (const row of plan.fresh) {
            await unit.create(
              'transaction',
              toRecord(row, { accountId, statementId: statement.id, personId: plan.personId }),
            );
          }
        });

        written += plan.fresh.length;
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
    const { keys: existingKeys } = await importedKeys(db);
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
    const { keys: existingKeys } = await importedKeys(db);

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
        message: 'Choose one or more statements — PDF, CSV or a credit card export. Each is matched to an account by the number printed on it.',
        iconName: 'file',
        action: button('Choose files', { variant: 'primary', onClick: () => input.click() }),
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

      // A payment app's export is not one account's statement, and the account
      // match above is exactly the thing that needs qualifying: there is no
      // single account for this file to belong to.
      plan.paymentApp
        ? h('p', { class: 'small muted', style: { marginTop: 'var(--space-3)' } },
          describeImport(plan.paymentApp, format))
        : null,

      h('div', { class: 'chip-row', style: { marginTop: 'var(--space-3)' } }, [
        chip(`${plan.transactions.length} rows`),
        plan.paymentApp ? chip(`${plan.paymentApp.accounts.length} accounts`) : null,
        chip(plan.duplicates.length ? `${plan.duplicates.length} already here` : 'none duplicated'),
        chip(plan.check.balanced ? 'arithmetic closes' : `off by ${format(plan.check.difference)}`),
        plan.problems.length ? chip(`${plan.problems.length} unreadable`) : null,
        chip(plan.parsed.mode === 'table' ? (plan.card ? 'card export' : 'read from a table')
          : plan.parsed.mode === 'columns' ? 'read by column' : 'read from balances'),
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
      h('li', {}, 'Choose every statement you have this month — PDF or CSV, bank accounts and credit cards, all people, at once.'),
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
  return {
    keys: new Set(rows.map((row) => row.importKey).filter(Boolean)),
    // Every bank reference already on record. A payment app's row and a bank's
    // row are the same movement written down twice, and the fingerprint cannot
    // see it: the narrations differ completely, so both would import and the
    // household's spending would double. The UTR is the one thing both records
    // carry — the bank writes it into its narration — and is the only exact
    // link between them. See `domain/paymentapp.js`.
    references: referencesIn(rows),
  };
}

/**
 * Whether a file is a table rather than a page.
 *
 * By extension and type rather than by sniffing the bytes: a bank's CSV export
 * is served as everything from `text/csv` to `application/octet-stream`
 * depending on the browser, and the name is the one thing that stays put.
 */
function isTable(file) {
  return /\.(csv|tsv|txt)$/i.test(file.name)
    || /^text\/(csv|tab-separated-values|plain)$/.test(file.type ?? '');
}

/** Where the household's own firms are kept. */
const BUSINESSES = 'finance.businesses';

const sameName = (a, b) => String(a ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  === String(b ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
