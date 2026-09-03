/**
 * Transactions, as a ledger rather than a list of records.
 *
 * ## Why this is not the generic table
 *
 * The schema-driven table is right for almost every entity in this
 * application and wrong for this one, for a reason worth writing down: it
 * renders `amount` as one column. Money in and money out then look identical,
 * and a column of figures where ₹50,000 arriving and ₹50,000 leaving are
 * printed the same way is not a ledger. It is a list of numbers.
 *
 * Every bank statement ever printed uses two columns and a running balance,
 * and it does that because the eye reads a column of aligned figures far
 * faster than it reads a column of signs. So: **In** and **Out** are separate,
 * right-aligned, tabular-figured, and the balance runs beside them.
 *
 * ## What each row can tell you
 *
 * A row opens in place. Everything the import kept is there — the narration
 * exactly as the bank wrote it, the reference, the balance after, the rule
 * that chose the category, the counterparty it was grouped under, the
 * statement it came from and the receipt that matched it. That is the "look at
 * one transaction in detail" case, and it should not cost a page navigation
 * and a page back.
 *
 * ## Filtering is arithmetic, not decoration
 *
 * Every total on this screen — in, out, net, count — is of the rows currently
 * shown. Narrow to one category and the totals are that category's. A filter
 * that changed the list but not the sums would be a way to read the wrong
 * number confidently.
 */

import { h, replace, delegate } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, button, badge, chip, empty, metric, money, pageHeader,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entity } from '../data/schema.js';
import { format } from '../core/money.js';
import { formatDay, formatInstant, today, addMonths } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { TRANSACTION_LIMIT } from '../services/service.js';

/** Periods worth one press. Anything finer is what the date boxes are for. */
const PERIODS = [
  { id: 'all', label: 'Everything' },
  { id: '1m', label: 'This month', months: 1 },
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '12m', label: '12 months', months: 12 },
];

/** Rows drawn at once. See `shown`: this bounds the drawing, not the sums. */
const PAGE = 300;

const DIRECTIONS = [
  { id: 'all', label: 'Both ways' },
  { id: 'in', label: 'Money in' },
  { id: 'out', label: 'Money out' },
];

export async function render() {
  const { db } = app();

  const host = h('div', {});
  const body = h('div', {});

  const [records, accounts, people, receipts, statements] = await Promise.all([
    db.repo('transaction').list({ decrypt: false, limit: TRANSACTION_LIMIT }),
    db.repo('account').list({ decrypt: false, limit: 500 }),
    db.repo('person').list({ decrypt: false, limit: 200 }),
    db.repo('receipt').list({ decrypt: false, limit: 20_000 }),
    db.repo('bankStatement').list({ decrypt: false, limit: 2000 }),
  ]);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const statementOf = new Map(statements.map((s) => [s.id, s]));
  // A receipt knows what a bank row bought. Indexed by the transaction it was
  // matched to, so opening a row can show it without a second pass.
  const receiptOf = new Map(receipts.filter((r) => r.transaction).map((r) => [r.transaction, r]));

  const filter = {
    text: '', period: 'all', from: '', to: '',
    account: '', category: '', direction: 'all', min: '', max: '',
  };

  let sort = { key: 'date', descending: true };
  /** Which rows are open. Several at once, because comparing two is the point. */
  const open = new Set();
  /**
   * How many rows are in the DOM.
   *
   * A household with years of history has tens of thousands, and putting all
   * of them in a table makes every keystroke in the search box stutter. The
   * totals above are always of *every* matching row, so what this bounds is
   * the drawing, never the arithmetic.
   */
  let shown = PAGE;

  replace(host, [
    pageHeader('Transactions', {
      subtitle: 'Every row, as the bank wrote it',
      actions: [
        button('Import statements', {
          iconName: 'upload',
          onClick: () => app().router.navigate({ module: 'finance', entity: 'import' }),
        }),
        button('Add', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'finance', entity: 'transaction', id: 'new' }),
        }),
      ],
    }),
    body,
  ]);

  paint();
  return { node: host };

  /* ---------------------------------------------------------------- data */

  function visible() {
    const text = filter.text.toLowerCase();
    const min = filter.min ? Number(filter.min) * 100 : null;
    const max = filter.max ? Number(filter.max) * 100 : null;
    const { from, to } = dateWindow();

    const rows = records.filter((record) => {
      if (from && record.date < from) return false;
      if (to && record.date > to) return false;
      if (filter.account && record.account !== filter.account) return false;
      if (filter.category && record.category !== filter.category) return false;
      if (filter.direction !== 'all' && directionOf(record) !== filter.direction) return false;
      if (min !== null && record.amount < min) return false;
      if (max !== null && record.amount > max) return false;

      if (!text) return true;
      return [record.payee, record.narration, record.category, record.reference,
        accountName.get(record.account)]
        .some((value) => String(value ?? '').toLowerCase().includes(text));
    });

    return rows.sort(comparator);
  }

  function comparator(a, b) {
    const { key, descending } = sort;
    let left = a[key];
    let right = b[key];

    if (key === 'account') { left = accountName.get(a.account) ?? ''; right = accountName.get(b.account) ?? ''; }
    if (key === 'description') { left = a.payee || a.narration || ''; right = b.payee || b.narration || ''; }

    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left ?? '').localeCompare(String(right ?? ''));

    // Date is the tie-break for everything, because two rows sorted only by
    // amount jump around between paints otherwise.
    const settled = result || String(a.date).localeCompare(String(b.date));
    return descending ? -settled : settled;
  }

  function dateWindow() {
    if (filter.from || filter.to) return { from: filter.from, to: filter.to };
    const period = PERIODS.find((p) => p.id === filter.period);
    if (!period?.months) return { from: '', to: '' };
    return { from: addMonths(today(), -period.months), to: '' };
  }

  function totals(rows) {
    let moneyIn = 0;
    let moneyOut = 0;
    for (const row of rows) {
      if (directionOf(row) === 'in') moneyIn += row.amount ?? 0;
      else moneyOut += row.amount ?? 0;
    }
    return { moneyIn, moneyOut, net: moneyIn - moneyOut, count: rows.length };
  }

  /* -------------------------------------------------------------- actions */

  function set(patch) {
    Object.assign(filter, patch);
    // Narrowing starts the page again. Somebody who filters to one category
    // is asking a new question, and being left on page four of the answer to
    // the old one is disorienting.
    shown = PAGE;
    paint();
  }

  function toggleSort(key) {
    sort = sort.key === key
      ? { key, descending: !sort.descending }
      : { key, descending: key === 'date' || key === 'amount' };
    paint();
  }

  function toggleRow(id) {
    if (open.has(id)) open.delete(id);
    else open.add(id);
    paint();
  }

  /** Correct one row's category from the row itself, without a form. */
  async function recategorise(record, category) {
    try {
      await db.repo('transaction').update(record.id, { category });
      Object.assign(record, { category });
      toast(`Filed under ${category}`, { kind: 'success' });
      paint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  /* ------------------------------------------------------------- painting */

  function paint() {
    const rows = visible();
    const sums = totals(rows);
    const page = rows.slice(0, shown);

    replace(body, [
      filters(),
      summary(sums, rows),
      rows.length ? ledger(page, rows) : empty({
        title: records.length ? 'Nothing matches those filters' : 'No transactions yet',
        message: records.length
          ? 'Widen the dates, or clear the search.'
          : 'Import a statement and every row lands here, categorised and checked.',
        iconName: 'receipt',
        action: records.length
          ? button('Clear filters', { onClick: () => set(clean()) })
          : button('Import statements', {
            variant: 'primary',
            onClick: () => app().router.navigate({ module: 'finance', entity: 'import' }),
          }),
      }),

      rows.length > page.length
        ? h('div', { class: 'row row--center', style: { marginTop: 'var(--space-4)' } },
          button(`Show ${Math.min(PAGE, rows.length - page.length)} more of ${rows.length - page.length}`, {
            onClick: () => { shown += PAGE; paint(); },
          }))
        : null,
    ].filter(Boolean));
  }

  function filters() {
    const search = h('input', {
      class: 'input',
      type: 'search',
      value: filter.text,
      placeholder: 'Payee, narration, reference…',
      'aria-label': 'Search transactions',
      onInput: (event) => set({ text: event.target.value }),
    });

    const dates = ['from', 'to'].map((which) => h('input', {
      type: 'date',
      class: 'input input--compact',
      value: filter[which],
      'aria-label': which === 'from' ? 'From date' : 'To date',
      onChange: (event) => set({ [which]: event.target.value, period: 'all' }),
    }));

    return card({ class: 'card--tight' }, [
      h('div', { class: 'filter-bar' }, [
        h('div', { class: 'search-box search-box--grow' }, [icon('search', { size: 18 }), search]),

        select('Account', filter.account, [
          { value: '', label: 'All accounts' },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ], (value) => set({ account: value })),

        select('Category', filter.category, [
          { value: '', label: 'All categories' },
          ...[...new Set(records.map((r) => r.category).filter(Boolean))].sort()
            .map((c) => ({ value: c, label: c })),
        ], (value) => set({ category: value })),

        h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Direction' }, DIRECTIONS.map((option) => chip(option.label, {
          pressed: filter.direction === option.id,
          onClick: () => set({ direction: option.id }),
        }))),
      ]),

      h('div', { class: 'filter-bar filter-bar--secondary' }, [
        h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Period' }, PERIODS.map((period) => chip(period.label, {
          pressed: !filter.from && !filter.to && filter.period === period.id,
          onClick: () => set({ period: period.id, from: '', to: '' }),
        }))),

        h('div', { class: 'field-inline' }, [
          h('label', { class: 'small faint' }, 'Between'), dates[0],
          h('label', { class: 'small faint' }, 'and'), dates[1],
        ]),

        h('div', { class: 'field-inline' }, [
          h('label', { class: 'small faint' }, 'Amount'),
          h('input', {
            type: 'number', class: 'input input--compact input--numeric', min: '0',
            value: filter.min, placeholder: 'min', 'aria-label': 'Minimum amount',
            onInput: (event) => set({ min: event.target.value }),
          }),
          h('input', {
            type: 'number', class: 'input input--compact input--numeric', min: '0',
            value: filter.max, placeholder: 'max', 'aria-label': 'Maximum amount',
            onInput: (event) => set({ max: event.target.value }),
          }),
        ]),

        dirty() ? button('Clear', { variant: 'subtle', onClick: () => set(clean()) }) : null,
      ].filter(Boolean)),
    ]);
  }

  function summary(sums, rows) {
    const span = rows.length
      ? `${formatDay(rows.at(-1).date)} – ${formatDay(rows[0].date)}`
      : '';

    return card({ class: 'card--tight' }, [
      h('div', { class: 'grid grid--tight' }, [
        metric({ label: 'Shown', value: String(sums.count), hint: span }),
        metric({ label: 'In', value: money(sums.moneyIn) }),
        metric({ label: 'Out', value: money(sums.moneyOut) }),
        metric({ label: 'Net', value: money(sums.net, { signed: true }) }),
      ]),
      sums.count !== records.length
        ? h('p', { class: 'small faint' },
          `Every figure above is of the ${sums.count} rows shown, not all ${records.length}.`)
        : null,
    ].filter(Boolean));
  }

  /* ------------------------------------------------------------- the table */

  function ledger(rows, all) {
    const table = h('table', { class: 'table table--ledger' }, [
      h('thead', {}, h('tr', {}, [
        column('date', 'Date', 'col--date'),
        column('description', 'Description', 'col--description'),
        column('category', 'Category', 'col--category'),
        column('account', 'Account', 'col--account'),
        column('amount', 'In', 'col--amount cell--numeric'),
        column('amount', 'Out', 'col--amount cell--numeric'),
        column('balance', 'Balance', 'col--amount cell--numeric'),
      ])),
      h('tbody', {}, tableBody(rows, all)),
      // The foot totals every matching row, not the drawn page. A footer that
      // silently summed only what fits on screen would be a way to read the
      // wrong number without noticing.
      h('tfoot', {}, h('tr', {}, [
        h('td', { colspan: '4' }, all.length === rows.length
          ? `${all.length} ${all.length === 1 ? 'row' : 'rows'}`
          : `${rows.length} of ${all.length} rows shown · totals are of all ${all.length}`),
        h('td', { class: 'cell--numeric money--positive' }, format(totals(all).moneyIn)),
        h('td', { class: 'cell--numeric money--negative' }, format(totals(all).moneyOut)),
        h('td', {}),
      ])),
    ]);

    const wrap = h('div', { class: 'table-wrap table-wrap--tall' }, table);

    delegate(wrap, 'click', 'tr[data-open]', (event, row) => {
      // A click on a control inside an open row is not a request to close it.
      if (event.target.closest('a, button, select, input')) return;
      toggleRow(row.dataset.open);
    });
    delegate(wrap, 'keydown', 'tr[data-open]', (event, row) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggleRow(row.dataset.open);
    });

    return wrap;
  }

  /**
   * The rows, with a heading before each new day.
   *
   * A month of statements repeats the same date down twenty rows, and reading
   * it means finding where one day ends by noticing the digits changed. A
   * heading says it once and carries that day's own totals, which is the
   * figure somebody is usually after when they scroll to a date.
   *
   * Only when the table is sorted by date. Grouped by day while sorted by
   * amount would produce a heading per row and mean nothing.
   */
  function tableBody(rows, all) {
    const grouped = sort.key === 'date';
    const perDay = grouped ? dayTotals(all) : null;
    const out = [];
    let day = null;

    rows.forEach((record, index) => {
      if (grouped && record.date !== day) {
        day = record.date;
        out.push(dayRow(day, perDay.get(day)));
      }
      out.push(summaryRow(record, index, grouped));
      if (open.has(record.id)) out.push(detailRow(record));
    });

    return out;
  }

  /**
   * Each day's own totals, over every matching row rather than the drawn page.
   *
   * A page that happens to cut a day in half would otherwise report that half
   * as the day, which is the sort of number somebody quotes.
   */
  function dayTotals(all) {
    const days = new Map();
    for (const record of all) {
      const entry = days.get(record.date) ?? { moneyIn: 0, moneyOut: 0, count: 0 };
      if (directionOf(record) === 'in') entry.moneyIn += record.amount ?? 0;
      else entry.moneyOut += record.amount ?? 0;
      entry.count += 1;
      days.set(record.date, entry);
    }
    return days;
  }

  function dayRow(date, sums = { moneyIn: 0, moneyOut: 0, count: 0 }) {
    return h('tr', { class: 'ledger-day' }, [
      h('td', { colspan: '4', class: 'ledger-day-label' }, [
        formatDay(date),
        h('span', { class: 'ledger-day-count' },
          `${sums.count} ${sums.count === 1 ? 'transaction' : 'transactions'}`),
      ]),
      h('td', { class: 'col--amount cell--numeric money--positive' },
        sums.moneyIn ? format(sums.moneyIn) : null),
      h('td', { class: 'col--amount cell--numeric money--negative' },
        sums.moneyOut ? format(sums.moneyOut) : null),
      h('td', {}),
    ]);
  }

  function column(key, label, className) {
    const active = sort.key === key;
    return h('th', {
      scope: 'col',
      class: className,
      tabindex: '0',
      role: 'columnheader',
      'aria-sort': active ? (sort.descending ? 'descending' : 'ascending') : 'none',
      onClick: () => toggleSort(key),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSort(key); }
      },
    }, label);
  }

  function summaryRow(record, index, grouped = false) {
    const direction = directionOf(record);
    const expanded = open.has(record.id);

    return h('tr', {
      dataset: { open: record.id },
      tabindex: '0',
      // Banded from the row's own position, not from `:nth-child` — an opened
      // row adds a sibling and would otherwise flip every stripe beneath it.
      class: ['ledger-row', index % 2 === 1 && 'ledger-row--band',
        expanded && 'ledger-row--open'],
      'aria-expanded': String(expanded),
    }, [
      // Under a day heading the date is already said, so the cell carries only
      // the control. Saying it twice on every row is the repetition the
      // heading exists to remove.
      h('td', { 'data-label': 'Date', class: 'col--date' }, [
        h('span', { class: 'ledger-chevron', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
        grouped ? null : formatDay(record.date),
      ].filter(Boolean)),

      h('td', { 'data-label': 'Description', class: 'col--description' }, [
        h('div', { class: 'ledger-payee' }, record.payee || '(unnamed)'),
        record.narration
          ? h('div', { class: 'ledger-narration' }, record.narration)
          : null,
      ].filter(Boolean)),

      h('td', { 'data-label': 'Category', class: 'col--category' },
        badge(record.category ?? 'other', '')),

      h('td', { 'data-label': 'Account', class: 'col--account cell--muted' },
        accountName.get(record.account) ?? '—'),

      // Two columns, not one signed column. This is the whole point of the
      // screen: the eye reads a column of aligned figures far faster than it
      // reads a column of signs.
      // `null`, not an empty string: on a phone both money columns land in the
      // same grid cell and only the one carrying a figure is shown, which
      // needs the other to be genuinely empty rather than holding a text node.
      h('td', { 'data-label': 'In', class: 'col--amount cell--numeric money--positive' },
        direction === 'in' ? format(record.amount) : null),
      h('td', { 'data-label': 'Out', class: 'col--amount cell--numeric money--negative' },
        direction === 'out' ? format(record.amount) : null),
      h('td', { 'data-label': 'Balance', class: 'col--amount cell--numeric cell--muted' },
        record.balance === null || record.balance === undefined ? null : format(record.balance)),
    ]);
  }

  /**
   * Everything the import kept about one row.
   *
   * In place rather than on its own page: comparing this row against the two
   * above it is the reason somebody opened it, and a navigation loses that.
   */
  function detailRow(record) {
    const receipt = receiptOf.get(record.id);
    const statement = statementOf.get(record.statement);

    return h('tr', { class: 'ledger-detail' }, h('td', { colspan: '7' }, [
      h('div', { class: 'ledger-detail-grid' }, [
        fact('As the bank wrote it', record.narration
          ? h('code', { class: 'narration' }, record.narration)
          : null, { wide: true }),
        fact('Bank reference', record.reference),
        fact('Paid by', record.method),
        fact('Spent by', personName.get(record.person)),
        fact('Balance after', record.balance != null ? format(record.balance) : null),
        fact('Direction', directionOf(record) === 'in' ? 'money in' : 'money out'),
        fact('Kind', record.kind),
        fact('Tags', record.tags?.length ? record.tags.join(', ') : null),
        fact('Notes', record.notes, { wide: true }),

        statement
          ? fact('From statement', h('a', {
            href: Router.href({ module: 'finance', entity: 'bankStatement', id: statement.id }),
          }, `${statement.fileName || 'statement'} · ${formatDay(statement.periodFrom)} – ${formatDay(statement.periodTo)}`))
          : null,

        receipt
          ? fact('Receipt', h('span', {}, [
            `${receipt.merchant} · ${format(receipt.amount)}`,
            receipt.orderId ? ` · ${receipt.orderId}` : '',
          ]))
          : null,
      ].filter(Boolean)),

      h('div', { class: 'ledger-detail-actions' }, [
        h('label', { class: 'small faint' }, 'File this under'),
        h('select', {
          class: 'select select--compact',
          'aria-label': 'Category',
          onChange: (event) => recategorise(record, event.target.value),
        }, CATEGORY_OPTIONS.map((option) => h('option', {
          value: option,
          selected: record.category === option,
        }, option))),

        button('Open full record', {
          variant: 'subtle',
          onClick: () => app().router.navigate({
            module: 'finance', entity: 'transaction', id: record.id,
          }),
        }),

        h('span', { class: 'small faint' }, [
          `Revision ${record.rev}`,
          record.importKey ? ' · imported' : ' · entered by hand',
          record.syncState === 'pending' ? ' · not yet synced' : '',
          ` · ${formatInstant(record.updatedAt)}`,
        ].join('')),
      ]),
    ]));
  }

  /* --------------------------------------------------------------- helpers */

  function dirty() {
    const fresh = clean();
    return Object.keys(fresh).some((key) => filter[key] !== fresh[key]);
  }
}

/* ------------------------------------------------------------------ bits */

/**
 * The categories a transaction may actually be saved as.
 *
 * Taken from the schema, not from `domain/categorise.js`. The two lists mean
 * the same things and spell them differently — the categoriser works in keys
 * like `food-delivery`, a stored record in `food delivery` — and offering the
 * wrong spelling here would produce a dropdown whose every choice fails
 * validation.
 */
const CATEGORY_OPTIONS = entity('transaction').fieldMap.category.options;

const clean = () => ({
  text: '', period: 'all', from: '', to: '',
  account: '', category: '', direction: 'all', min: '', max: '',
});

/**
 * Which way the money went.
 *
 * `direction` is stored by the current importer. Older records carry only
 * `kind`, which is right for income and spending and cannot tell the two
 * halves of a transfer apart — the same fallback `domain/ledger.js` documents.
 */
function directionOf(record) {
  if (record.direction === 'in' || record.direction === 'out') return record.direction;
  return record.kind === 'income' ? 'in' : 'out';
}

/** One labelled fact, or nothing at all when there is nothing to say. */
function fact(label, value, { wide = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  return h('div', { class: ['ledger-fact', wide && 'ledger-fact--wide'] }, [
    h('div', { class: 'ledger-fact-label' }, label),
    h('div', { class: 'ledger-fact-value' }, value),
  ]);
}

function select(label, value, options, onChange) {
  return h('select', {
    class: 'select select--compact',
    'aria-label': label,
    onChange: (event) => onChange(event.target.value),
  }, options.map((option) => h('option', {
    value: option.value,
    selected: option.value === value,
  }, option.label)));
}
