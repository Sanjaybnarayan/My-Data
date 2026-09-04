/**
 * Importing a tradebook.
 *
 * ## The screen this is, and the one it is not
 *
 * It reads a CSV the household downloaded from their own broker and turns the
 * rows into `investmentTransaction` records. It is not a broker connection and
 * this file will not grow into one — `domain/tradebook.js` has the argument.
 *
 * ## Nothing is written before it is shown
 *
 * The plan is drawn first: what will be imported, what was already here, what
 * matched no holding, and what could not be read at all. Every row of the file
 * appears in exactly one of those. A household that downloaded three hundred
 * rows and sees two hundred and eighty imported is owed the other twenty by
 * name, not left to notice the arithmetic themselves.
 *
 * ## The mapping is theirs to make
 *
 * There is no list of brokers here. Nobody working on this has a real
 * tradebook to test a parser against, so the household says which column holds
 * the date, which the symbol, and so on — and sees the result before agreeing
 * to it.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, button, badge, empty, listItem, metric } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { confirm } from '../ui/components/modal.js';
import { app } from '../context.js';
import { PortfolioService } from '../services/portfolio.js';
import { parseDelimited } from '../domain/tabular.js';
import {
  REQUIRED_COLUMNS, OPTIONAL_COLUMNS, planTrades, toInvestmentTransaction,
} from '../domain/tradebook.js';
import { format, addable } from '../core/money.js';
import { transact } from '../data/unit.js';
import { userMessage } from '../core/errors.js';
import { t } from '../core/locale.js';

/** What each field is called on screen. The file's own headings are the values. */
const LABELS = {
  date: 'tradebook.field.date',
  symbol: 'tradebook.field.symbol',
  kind: 'tradebook.field.kind',
  amount: 'tradebook.field.amount',
  units: 'tradebook.field.units',
  pricePerUnit: 'tradebook.field.pricePerUnit',
  charges: 'tradebook.field.charges',
  reference: 'tradebook.field.reference',
};

export async function render() {
  const body = h('div', {});
  const host = h('div', {}, body);

  /** @type {{headings: string[], rows: object[]}|null} */
  let file = null;
  let mapping = {};
  let plan = null;
  let busy = false;

  const picker = h('input', {
    type: 'file',
    class: 'input',
    accept: '.csv,.txt,text/csv',
    'aria-label': t('tradebook.chooseFile'),
    onChange: (event) => readFile(event.target.files?.[0]),
  });

  async function readFile(chosen) {
    if (!chosen) return;
    try {
      const text = await chosen.text();
      const rows = parseDelimited(text);
      if (rows.length < 2) {
        toast(t('tradebook.tooShort'), { kind: 'error' });
        return;
      }

      // The first row is the headings, and every later row is keyed by them —
      // so the mapping the household makes is in the file's own words.
      const headings = rows[0].map((cell) => String(cell ?? '').trim());
      file = {
        headings,
        rows: rows.slice(1).map((cells) => Object.fromEntries(
          headings.map((heading, i) => [heading, cells[i] ?? '']),
        )),
      };
      mapping = guessMapping(headings);
      plan = null;
      paint();
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    }
  }

  /**
   * A first guess at the mapping, from the headings.
   *
   * A guess and nothing more: it fills the picker in and the household can
   * change every one of them. It is offered because typing eight mappings for
   * a file whose headings say `Trade Date` and `Quantity` is work a person
   * should not have to do, and refused as authoritative because a heading is
   * not a promise about what the column holds.
   */
  function guessMapping(headings) {
    const rules = {
      date: /date/i,
      symbol: /symbol|scrip|instrument|isin|name/i,
      kind: /type|side|transaction|buy|sell|action/i,
      amount: /value|amount|total|net/i,
      units: /qty|quantity|units|shares/i,
      pricePerUnit: /price|rate|nav/i,
      charges: /brokerage|charges|fees|commission/i,
      reference: /trade.?id|order.?id|ref/i,
    };
    const out = {};
    for (const [field, pattern] of Object.entries(rules)) {
      const found = headings.find((heading) => pattern.test(heading));
      if (found) out[field] = found;
    }
    return out;
  }

  async function makePlan() {
    const { holdings, existing } = await new PortfolioService(app().db).forImport();
    plan = planTrades(file.rows, { mapping, holdings, existing });
    paint();
  }

  async function apply() {
    if (busy || !plan?.planned.length) return;
    const go = await confirm({
      title: t('tradebook.confirmTitle'),
      message: t('tradebook.confirmBody', { n: plan.planned.length }),
      confirmLabel: t('tradebook.confirmYes'),
    });
    if (!go) return;

    busy = true;
    try {
      // One unit of work: a half-imported tradebook is a portfolio nobody can
      // reconcile, and the household would have no way to tell which rows
      // landed.
      await transact(app().db, async (tx) => {
        for (const planned of plan.planned) {
          await tx.repo('investmentTransaction').create(toInvestmentTransaction(planned));
        }
      });
      toast(t('tradebook.imported', { n: plan.planned.length }), { kind: 'success' });
      file = null;
      plan = null;
      mapping = {};
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    } finally {
      busy = false;
      paint();
    }
  }

  /** One row of the mapping form: our field, and which column it comes from. */
  function mapper(field) {
    const select = h('select', {
      class: 'input input--compact',
      'aria-label': t(LABELS[field]),
      onChange: (event) => {
        mapping = { ...mapping, [field]: event.target.value };
        plan = null;
        paint();
      },
    }, [
      h('option', { value: '' }, t('tradebook.notInFile')),
      ...file.headings.map((heading) => h('option', {
        value: heading,
        ...(mapping[field] === heading ? { selected: 'selected' } : {}),
      }, heading)),
    ]);

    return listItem({
      title: t(LABELS[field]),
      subtitle: REQUIRED_COLUMNS.includes(field)
        ? t('tradebook.required')
        : t('tradebook.optional'),
      trailing: select,
    });
  }

  /** A bucket of rows that did not become trades, named rather than counted. */
  function refusals(title, rows, describe) {
    if (!rows.length) return null;
    return card({ class: 'card--quiet' }, [
      cardHeader(title, badge(String(rows.length), 'danger')),
      h('div', { class: 'list' }, rows.slice(0, 20).map((one) => listItem({
        title: t('tradebook.rowNumber', { n: one.row }),
        subtitle: describe(one),
      }))),
      rows.length > 20
        ? h('p', { class: ['small', 'muted'] }, t('tradebook.andMore', { n: rows.length - 20 }))
        : null,
    ].filter(Boolean));
  }

  function paint() {
    if (!file) {
      replace(body, [card({}, [
        cardHeader(t('tradebook.title'), null, { iconName: 'upload' }),
        h('p', { class: ['small', 'muted'] }, t('tradebook.intro')),
        h('p', { class: ['small', 'muted'] }, t('tradebook.notAConnector')),
        picker,
      ])]);
      return;
    }

    replace(body, [
      card({}, [
        cardHeader(t('tradebook.mapTitle'), badge(t('tradebook.rows', { n: file.rows.length }), 'info')),
        h('p', { class: ['small', 'muted'] }, t('tradebook.mapBody')),
        h('div', { class: 'list' },
          [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].map(mapper)),
        h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
          button(t('tradebook.check'), { variant: 'primary', onClick: makePlan }),
          button(t('tradebook.startAgain'), {
            variant: 'subtle',
            onClick: () => { file = null; plan = null; mapping = {}; paint(); },
          }),
        ]),
      ]),

      plan && !plan.ready
        ? card({ class: 'card--quiet' }, [
          h('p', { class: ['small', 'money--negative'] },
            t('tradebook.missingColumns', {
              fields: plan.missing.map((f) => t(LABELS[f])).join(', '),
            })),
        ])
        : null,

      plan?.ready
        ? card({}, [
          cardHeader(t('tradebook.planTitle')),
          h('div', { class: 'metric-row' }, [
            metric({ label: t('tradebook.willImport'), value: String(plan.planned.length) }),
            metric({ label: t('tradebook.alreadyHere'), value: String(plan.duplicates) }),
            metric({ label: t('tradebook.noHolding'), value: String(plan.unmatched.length) }),
            metric({ label: t('tradebook.unreadable'), value: String(plan.refused.length) }),
          ]),
          plan.planned.length
            ? h('p', { class: 'small' }, t('tradebook.totalValue', {
              amount: format(plan.planned.reduce((sum, one) => sum + addable(one.amount), 0)),
            }))
            : null,
          plan.planned.some((one) => one.derivedAmount)
            ? h('p', { class: ['small', 'muted'] }, t('tradebook.someDerived', {
              n: plan.planned.filter((one) => one.derivedAmount).length,
            }))
            : null,
          plan.planned.length
            ? button(t('tradebook.import', { n: plan.planned.length }), {
              variant: 'primary', disabled: busy, onClick: apply,
            })
            : empty({ title: t('tradebook.nothingToImport') }),
        ].filter(Boolean))
        : null,

      plan?.ready
        ? refusals(t('tradebook.noHoldingTitle'), plan.unmatched,
          (one) => t(one.why === 'ambiguous' ? 'tradebook.ambiguous' : 'tradebook.unknownSymbol',
            { symbol: one.symbol }))
        : null,

      plan?.ready
        ? refusals(t('tradebook.unreadableTitle'), plan.refused, (one) => t(one.why))
        : null,
    ].filter(Boolean));
  }

  paint();
  return { node: host };
}
