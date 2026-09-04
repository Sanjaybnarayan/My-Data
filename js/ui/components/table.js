/**
 * Lists, built from the schema.
 *
 * Columns come from the fields marked `list`, formatting from the field type,
 * and filters from the enum and date fields. So a new module gets a working,
 * sortable, filterable, searchable list by existing.
 *
 * Past `virtualListThreshold` rows the body is windowed: only the rows in
 * view plus a small overscan exist in the DOM. Forty thousand transactions
 * render as thirty nodes, and scrolling stays at frame rate on a phone.
 */

import { h, replace, delegate } from '../dom.js';
import { icon } from '../icons.js';
import { badge, money, empty, dueBadge } from './basics.js';
import { entity, listFields } from '../../data/schema.js';
import { formatDay } from '../../core/dates.js';
import { sortBy } from '../../data/repository.js';
import { config } from '../../core/config.js';
import { maskable, mask, classify } from '../../data/classification.js';
import { t, noun } from '../../core/locale.js';
import { entityLabel, fieldLabel } from '../../core/labels.js';

const ROW_HEIGHT = 49;
const OVERSCAN = 6;

/** One cell, formatted by the field's declared type. */
export function cellFor(field, record, { currency = 'INR', reveal = false } = {}) {
  const value = record[field.key];

  if (value === null || value === undefined || value === '') {
    return h('span', { class: 'faint' }, '—');
  }

  // Identifiers and credentials show their last four characters in a list —
  // not everything sensitive, only the values that *prove or grant* something.
  // Those are the ones whose whole purpose is to be copied, so a passport
  // number on a screen in a café is read by whoever walks past. A name is not
  // a secret from the person who opened the record, and hiding it would
  // destroy the list rather than protect anything.
  //
  // The full value is on the record itself, behind a deliberate press.
  if (!reveal && maskable(field)) {
    return h('span', {
      class: 'mono',
      title: 'Hidden — open the record to see it in full',
    }, mask(value, classify(field)));
  }

  switch (field.type) {
    case 'currency':
      return money(value, { currency, signed: field.signed });
    case 'date':
      return field.expiry
        ? h('span', { class: 'row row--tight' }, [formatDay(value), ' ', dueBadge(value, { leadDays: field.expiryLead ?? 30 })])
        : h('span', {}, formatDay(value));
    case 'boolean':
      return value ? badge('yes', 'positive') : h('span', { class: 'faint' }, 'no');
    case 'enum':
      return badge(value, toneForEnum(field.key, value));
    case 'tags':
    case 'multienum':
      return h('span', { class: 'chip-row' },
        (value ?? []).slice(0, 3).map((t) => badge(t)));
    case 'ref':
      return h('span', { class: 'muted' }, record[`${field.key}Label`] ?? '—');
    case 'number':
      return h('span', { class: 'numeric' }, String(value));
    default:
      return h('span', { class: 'truncate' }, String(value));
  }
}

/**
 * Whether a cell has nothing in it.
 *
 * `cellFor` draws an em dash for an absent value, which is right in a table
 * column — the column exists, and the dash says this row has no value where
 * the row above does. On a phone there is no column, so the same dash becomes
 * a labelled line that reads `Account —`: a field name and a mark meaning
 * there is nothing to tell you.
 *
 * The subject is never blanked, so a row cannot disappear entirely, and the
 * record itself still lists every field.
 */
export function blank(field, record) {
  const value = field.type === 'ref' ? record[`${field.key}Label`] : record[field.key];
  return value === null || value === undefined || value === '';
}

/**
 * Whether a cell only repeats what the row's subject has already said.
 *
 * A household names its accounts after the bank, so the schema's own columns
 * produced, on a phone:
 *
 *     Deccan Cooperative Bank savings     <- the name
 *     Kind           savings              <- said
 *     Bank/provider  Deccan Cooperative Bank   <- said
 *     Holder         Lakshmi Iyer         <- the only thing that differs
 *
 * Five accounts at the same bank, and the one line telling them apart is the
 * faintest and the last. This is the rule `accountSubtitle` already applies on
 * the overview — drop a part the name carries — generalised, and driven by the
 * data rather than by a list of field names kept somewhere else.
 *
 * Only where a repetition is possible: a date, an amount or a flag is never a
 * restatement of a name, and comparing them would be looking for something
 * that cannot be there. Three characters minimum, so a short code cannot match
 * by accident inside a longer word.
 */
export function saidAlready(subject, field, record) {
  // No guard for an empty subject: nothing of three characters or more is
  // inside the empty string, so the length rule below already answers it. A
  // branch no test can tell the presence of is a branch that is not there.
  const said = field.type === 'ref'
    ? record[`${field.key}Label`]
    : (field.type === 'text' || field.type === 'enum' ? record[field.key] : null);

  const text = String(said ?? '').trim().toLowerCase();
  return text.length >= 3 && subject.includes(text);
}

/** Colour the few enum values where the meaning is unambiguous. */
function toneForEnum(key, value) {
  const good = new Set(['done', 'active', 'attended', 'paid', 'income', 'scheduled']);
  const bad = new Set(['blocked', 'missed', 'cancelled', 'abandoned', 'overdue', 'expired']);
  const warn = new Set(['on hold', 'doing', 'urgent', 'high']);
  if (good.has(value)) return 'positive';
  if (bad.has(value)) return 'danger';
  if (warn.has(value)) return 'warning';
  if (key === 'kind' || key === 'category') return '';
  return '';
}

/**
 * @param {string} entityName
 * @param {object[]} rows already decrypted and permission-filtered
 * @param {{onOpen?: (record) => void, columns?: string[], currency?: string,
 *          labels?: Record<string, Record<string,string>>, emptyAction?: Node,
 *          sort?: string}} [options]
 */
export function entityTable(entityName, rows, options = {}) {
  const def = entity(entityName);
  const {
    onOpen, currency = 'INR', labels = {}, emptyAction,
    columns = listFields(entityName).map((f) => f.key),
  } = options;

  const fields = columns.map((key) => def.fieldMap[key]).filter(Boolean);
  let sortSpec = options.sort ?? def.sort;
  let current = decorate(rows);

  const head = h('thead', {}, h('tr', {}, fields.map((field) => h('th', {
    scope: 'col',
    class: field.type === 'currency' || field.type === 'number' ? 'cell--numeric' : '',
    'aria-sort': ariaSort(field.key),
    tabindex: '0',
    role: 'columnheader',
    onClick: () => toggleSort(field.key),
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(field.key); }
    },
  }, fieldLabel(def.name, field)))));

  const body = h('tbody');
  const table = h('table', { class: 'table table--responsive' }, [head, body]);
  const wrap = h('div', { class: 'table-wrap' }, table);
  const host = h('div', {}, wrap);

  function ariaSort(key) {
    if (sortSpec === key) return 'ascending';
    if (sortSpec === `-${key}`) return 'descending';
    return 'none';
  }

  function toggleSort(key) {
    sortSpec = sortSpec === key ? `-${key}` : key;
    for (const [i, field] of fields.entries()) {
      head.rows[0].cells[i].setAttribute('aria-sort', ariaSort(field.key));
    }
    render();
  }

  /** Resolve `ref` ids to names once, rather than per cell on every paint. */
  function decorate(list) {
    return list.map((record) => {
      const out = { ...record };
      for (const field of fields) {
        if (field.type !== 'ref') continue;
        out[`${field.key}Label`] = labels[field.ref]?.[record[field.key]] ?? '';
      }
      return out;
    });
  }

  /*
   * Cells carry what they are, so the phone layout can lay them out as a row
   * rather than as a column of equal parts.
   *
   * On a phone this table becomes stacked cards, and every column was given
   * the same weight: a label taking 40% of the line and a value taking the
   * rest. So an account read
   *
   *     Name           Harbour National Ban…
   *     Kind           savings
   *     Bank/provider  Harbour National Bank
   *     Holder         Anand Iyer
   *     Archived       no
   *
   * — the one field that says which account this is, truncated, above a field
   * that spells the same bank out in full, and a line per record spent saying
   * a flag is not set. Twelve accounts of that is unreadable.
   *
   * `cell--primary` is the leftmost column, which is the column a table puts
   * its subject in. `cell--flag-off` is a boolean that is not set: shown on a
   * desktop where a column costs nothing, omitted on a phone, which is what
   * this application already does with `autoDebit` in the bills list — a flag
   * that is not set is not news, and the record itself still carries it.
   */
  function buildRow(record) {
    const subject = String(record[fields[0].key] ?? '').toLowerCase();
    return h('tr', {
      dataset: { id: record.id, ...(onOpen ? { clickable: 'true' } : {}) },
      ...(onOpen ? { tabindex: '0', role: 'button' } : {}),
    }, fields.map((field, index) => h('td', {
      'data-label': fieldLabel(def.name, field),
      class: [
        field.type === 'currency' || field.type === 'number' ? 'cell--numeric' : '',
        index === 0 ? 'cell--primary' : '',
        field.type === 'boolean' && !record[field.key] ? 'cell--flag-off' : '',
        index > 0 && saidAlready(subject, field, record) ? 'cell--said-already' : '',
        index > 0 && blank(field, record) ? 'cell--blank' : '',
      ].filter(Boolean).join(' '),
    }, cellFor(field, record, { currency }))));
  }

  function render() {
    const sorted = sortBy(current, sortSpec);

    if (!sorted.length) {
      replace(host, empty({
        title: t('record.emptyTitle', { many: noun(entityLabel(def, 'many')) }),
        message: emptyAction ? null : 'Nothing has been recorded here.',
        iconName: def.icon,
        action: emptyAction,
      }));
      return;
    }

    replace(host, wrap);

    if (sorted.length <= config().virtualListThreshold) {
      replace(body, sorted.map(buildRow));
      return;
    }
    renderWindowed(sorted);
  }

  /* --------------------------------------------------------- virtual list */

  let detachScroll = null;

  function renderWindowed(sorted) {
    // The viewport scrolls; a spacer of the full height keeps the scrollbar
    // honest while only the visible slice of rows exists.
    wrap.classList.add('virtual-viewport');
    wrap.style.maxHeight = '70dvh';

    const spacer = h('tr', { class: 'virtual-spacer', 'aria-hidden': 'true' },
      h('td', { colspan: String(fields.length), style: { padding: 0, border: 0 } }));

    let first = -1;

    const paint = () => {
      const start = Math.max(0, Math.floor(wrap.scrollTop / ROW_HEIGHT) - OVERSCAN);
      if (start === first) return;
      first = start;

      const count = Math.ceil(wrap.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
      const slice = sorted.slice(start, start + count);

      const top = h('tr', { 'aria-hidden': 'true', style: { height: `${start * ROW_HEIGHT}px` } });
      const bottom = h('tr', {
        'aria-hidden': 'true',
        style: { height: `${Math.max(0, (sorted.length - start - slice.length) * ROW_HEIGHT)}px` },
      });
      replace(body, [top, ...slice.map(buildRow), bottom]);
    };

    detachScroll?.();
    wrap.addEventListener('scroll', paint, { passive: true });
    detachScroll = () => wrap.removeEventListener('scroll', paint);

    void spacer;
    paint();
  }

  if (onOpen) {
    delegate(host, 'click', 'tr[data-id]', (_event, row) => {
      const record = current.find((r) => r.id === row.dataset.id);
      if (record) onOpen(record);
    });
    delegate(host, 'keydown', 'tr[data-id]', (event, row) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const record = current.find((r) => r.id === row.dataset.id);
      if (record) onOpen(record);
    });
  }

  render();

  return {
    node: host,
    update(next, nextLabels) {
      if (nextLabels) Object.assign(labels, nextLabels);
      current = decorate(next);
      render();
    },
    destroy() {
      detachScroll?.();
    },
  };
}

/**
 * The filter bar above a list. Built from the entity's enum fields plus a
 * text box, because those are the filters that exist for every entity — a
 * module wanting something else adds it beside this, not instead of it.
 */
export function filterBar(entityName, { onChange, extra } = {}) {
  const def = entity(entityName);
  const state = { text: '', ...Object.create(null) };

  const enumFields = def.fields
    .filter((f) => f.type === 'enum' && f.list && f.options.length <= 12)
    .slice(0, 2);

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: t('record.search', { many: noun(entityLabel(def, 'many')) }),
    'aria-label': t('record.search', { many: entityLabel(def, 'many') }),
    onInput: (e) => {
      state.text = e.target.value.trim().toLowerCase();
      onChange(makeFilter());
    },
  });

  const chips = enumFields.map((field) => h('div', { class: 'chip-row' }, [
    h('select', {
      class: 'select',
      'aria-label': fieldLabel(def.name, field),
      style: { width: 'auto', minWidth: '9rem' },
      onChange: (e) => {
        state[field.key] = e.target.value;
        onChange(makeFilter());
      },
    }, [
      h('option', { value: '' }, t('record.allOf', { many: noun(fieldLabel(def.name, field)) })),
      ...field.options.map((o) => h('option', { value: o }, o)),
    ]),
  ]));

  function makeFilter() {
    const searchable = def.fields.filter((f) => f.search && !f.encrypted).map((f) => f.key);
    return (record) => {
      for (const field of enumFields) {
        if (state[field.key] && record[field.key] !== state[field.key]) return false;
      }
      if (!state.text) return true;
      return searchable.some((key) => {
        const value = record[key];
        const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
        return text.toLowerCase().includes(state.text);
      });
    };
  }

  return h('div', { class: 'row', style: { marginBottom: 'var(--space-4)' } }, [
    h('div', { class: 'search-box' }, [icon('search', { size: 18 }), search]),
    ...chips,
    extra,
  ]);
}
