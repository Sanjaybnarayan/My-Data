/**
 * What a deposit is worth now, rather than what it was worth when it was typed.
 *
 * ## The bug, and why it is the loan bug in a mirror
 *
 * `holding.currentValue` is a number somebody typed once. Net worth reads it as
 * the asset. A fixed deposit earns interest every quarter and the figure never
 * moves, so two years into a ₹5,00,000 deposit at 7.1% the application reports:
 *
 *     value  ₹5,00,000     — actually about ₹5,75,571
 *     gain   ₹0            — actually about ₹75,571
 *
 * `loan.outstanding` had the same shape: typed once, never falls, so net worth
 * carried a debt that was already smaller. Both errors push the same way —
 * **net worth understates**, once by holding an asset down and once by holding
 * a liability up.
 *
 * The application already records `valuedOn`, so it knows exactly when the
 * figure was last true. It simply never looked.
 *
 * ## What this is
 *
 * Compound interest, which is exact arithmetic, applied from `valuedOn` to
 * today at the rate the household recorded.
 *
 * ## What this is not
 *
 * **The bank's own figure.** Rates on new deposits change, TDS is deducted at
 * source on interest above a threshold, a premature withdrawal is penalised,
 * and a matured deposit may auto-renew at a rate nobody here knows. So nothing
 * is written back — the estimate sits beside the stored figure, and the
 * bank's statement stays the authority.
 *
 * ## Where it refuses
 *
 * Guessing here would be worse than silence, so the refusals are the design:
 *
 *   - **No `valuedOn`.** Without knowing when the figure was true there is
 *     nothing to accrue *from*.
 *   - **A recurring deposit.** Its value depends on an instalment schedule, not
 *     on a lump sum sitting still. Applying the lump-sum formula would overstate
 *     it substantially, because most instalments have not been in for the full
 *     term.
 *   - **Anything market-linked** — stocks, funds, NPS, gold. Their value is a
 *     price, not an accrual, and a rate field on one of those means something
 *     else entirely.
 */


import { roundMoney } from '../core/money.js';
/**
 * How often each instrument compounds, by convention in India.
 *
 * Absent from this table means "do not accrue", which is the safe default: a
 * kind nobody has thought about is a kind nobody has checked.
 */
export const COMPOUNDING = Object.freeze({
  'fixed deposit': 4,   // quarterly, the standard for Indian bank FDs
  PPF: 1,               // annually, credited at year end
  EPF: 1,               // annually, at the rate declared for the year
});

/**
 * Kinds a household would recognise as a deposit.
 *
 * The distinction matters only for the report: a fixed deposit missing its
 * rate is worth naming, because somebody could fix it. A share is not, because
 * it never could have been accrued in the first place.
 */
export const DEPOSIT_LIKE = Object.freeze([
  ...Object.keys(COMPOUNDING),
  'recurring deposit',
]);

/**
 * A recurring deposit compounds quarterly too, by the same convention — but on
 * each instalment separately, from the day it went in.
 *
 * Kept apart from `COMPOUNDING` on purpose. That table is what `canAccrue`
 * consults, and an RD must never reach the lump-sum formula: applying it would
 * treat every instalment as though it had been in since the first one.
 */
export const RECURRING_COMPOUNDING = 4;

/** Investment transaction kinds that are money going *into* a deposit. */
const INSTALMENT_KINDS = new Set(['contribution', 'buy']);

/** Kinds this deliberately refuses, with the reason a person would want. */
export const REFUSED = Object.freeze({
  // Refused *as a lump sum*, which is what `canAccrue` answers. Its instalments
  // are recorded — see `recurringValue`, which values it properly.
  'recurring deposit': 'a recurring deposit grows by instalments, not as a lump sum — '
    + 'each one has to be accrued from its own date',
  NPS: 'NPS is market-linked, so its value is a price rather than an accrual',
  stock: 'a share price is not an interest rate',
  'mutual fund': 'a fund’s value is a price, not an accrual',
  ETF: 'an ETF’s value is a price, not an accrual',
  gold: 'gold is priced, not accrued',
  silver: 'silver is priced, not accrued',
  crypto: 'a crypto price is not an interest rate',
  bond: 'a bond pays coupons and its price moves — neither is compound accrual',
});

const DAY = 24 * 60 * 60 * 1000;

/** Years between two days, or null if either is unreadable. */
export function yearsBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / (365.25 * DAY);
}

/**
 * Can this holding's value be accrued at all?
 *
 * `why` is always present and empty when it can. A union of `{ok: true}` and
 * `{ok: false, why}` reads better but is not what this returns, and narrowing
 * every caller to reach a string that is always there would be ceremony around
 * a fiction.
 *
 * @returns {{ok: boolean, why: string}}
 */
export function canAccrue(holding) {
  if (!holding) return { ok: false, why: 'nothing to value' };

  const kind = String(holding.kind ?? '');
  if (REFUSED[kind]) return { ok: false, why: REFUSED[kind] };
  if (!COMPOUNDING[kind]) {
    return { ok: false, why: `nothing here knows how a ${kind || 'holding'} of this kind accrues` };
  }
  if (!(holding.interestRate > 0)) return { ok: false, why: 'no interest rate is recorded' };
  if (!holding.valuedOn) {
    return {
      ok: false,
      why: 'no date is recorded for when the value was last true, so there is '
        + 'nothing to accrue from',
    };
  }
  if (!(holding.currentValue > 0) && !(holding.invested > 0)) {
    return { ok: false, why: 'no amount is recorded' };
  }
  return { ok: true, why: '' };
}

/**
 * What the deposit should be worth, accrued from when it was last valued.
 *
 * Interest stops at maturity. What happens after is unknowable from here — the
 * money may have been withdrawn, or the deposit auto-renewed at a rate nobody
 * recorded — so the estimate stops there and says it has matured rather than
 * projecting through a date the household needs to look at anyway.
 */
export function accruedValue(holding, asOf) {
  const check = canAccrue(holding);
  if (!check.ok) return null;

  // Interest runs to today, or to maturity if that came first.
  const until = holding.maturesOn && holding.maturesOn < asOf ? holding.maturesOn : asOf;
  const years = yearsBetween(holding.valuedOn, until);
  if (years === null || years <= 0) return null;

  const base = holding.currentValue > 0 ? holding.currentValue : holding.invested;
  const n = COMPOUNDING[holding.kind];
  const value = base * (1 + (holding.interestRate / 100) / n) ** (n * years);

  return {
    // Carried along so the run can be described on its own. Every sentence
    // this produces names the date the figure was last true and the rate it
    // assumed, and neither is knowable from the arithmetic alone.
    holding,
    base,
    value: roundMoney(value),
    interest: roundMoney(value - base),
    years,
    compoundedTimesAYear: n,
    matured: Boolean(holding.maturesOn && holding.maturesOn < asOf),
  };
}

/* ------------------------------------------------------ recurring deposits */

/**
 * The instalments recorded against a deposit, oldest first.
 *
 * These are ordinary investment transactions — `holding`, `date`, `amount` —
 * and `domain/portfolio.js` has always read them to build cash flows. They were
 * there the whole time.
 */
export function instalmentsFor(holding, transactions) {
  return (transactions ?? [])
    .filter((t) => t.holding === holding?.id && !t.deletedAt)
    .filter((t) => INSTALMENT_KINDS.has(t.kind) && (t.amount ?? 0) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Can this recurring deposit be valued from its instalments?
 *
 * ## A correction to what this file said before
 *
 * The first version refused every recurring deposit on the grounds that "its
 * value needs the payment schedule, which is not recorded here". That was
 * **wrong**. An RD's instalments are investment transactions against the
 * holding — dated, with amounts — and `cashFlows` was already reading them.
 * The schedule was recorded; nothing had looked.
 *
 * What survives of that refusal is narrower and still real: an RD with no
 * instalments recorded cannot be valued, and neither can one that somebody has
 * already been tracking by hand.
 *
 * @returns {{ok: boolean, why: string}}
 */
export function canAccrueRecurring(holding, transactions) {
  if (!holding) return { ok: false, why: 'nothing to value' };
  if (holding.kind !== 'recurring deposit') {
    return { ok: false, why: 'not a recurring deposit' };
  }
  if (!(holding.interestRate > 0)) return { ok: false, why: 'no interest rate is recorded' };

  const paid = (transactions ?? []).filter((t) => t.holding === holding.id && !t.deletedAt);
  if (!instalmentsFor(holding, transactions).length) {
    return {
      ok: false,
      why: 'no instalments are recorded against this deposit, and a recurring '
        + 'deposit is its instalments — add them and this can be valued',
    };
  }

  // Interest already recorded as a transaction means the household is tracking
  // it themselves. Accruing on top would report it twice, which is the credit
  // card double count wearing a different hat.
  if (paid.some((t) => t.kind === 'interest' || t.kind === 'dividend')) {
    return {
      ok: false,
      why: 'interest is already recorded against this deposit as its own '
        + 'transaction, so estimating it again would count it twice',
    };
  }

  // A withdrawal or a charge means the deposit was broken into or penalised.
  // Both change the terms in ways this cannot see, and modelling it as
  // untouched would overstate it.
  if (paid.some((t) => t.kind === 'withdrawal' || t.kind === 'charge')) {
    return {
      ok: false,
      why: 'a withdrawal or a charge is recorded against this deposit, so its '
        + 'terms are not the ones it started with — the bank’s figure is the '
        + 'only reliable one',
    };
  }

  return { ok: true, why: '' };
}

/**
 * What a recurring deposit is worth, accruing every instalment from its own
 * date.
 *
 * This is the whole difference from a lump sum. On a two-year RD the first
 * instalment has been earning for two years and the last for a month, so
 * applying the lump-sum formula to the total would treat every rupee as though
 * it went in on day one — and overstate it substantially.
 *
 * Interest stops at maturity, for the same reason it does on a fixed deposit.
 */
export function recurringValue(holding, transactions, asOf) {
  const check = canAccrueRecurring(holding, transactions);
  if (!check.ok) return null;

  const instalments = instalmentsFor(holding, transactions);
  const until = holding.maturesOn && holding.maturesOn < asOf ? holding.maturesOn : asOf;
  const n = RECURRING_COMPOUNDING;
  const rate = 1 + (holding.interestRate / 100) / n;

  let base = 0;
  let value = 0;

  for (const instalment of instalments) {
    const years = yearsBetween(instalment.date, until);
    // An instalment dated after the end of the run has not earned anything
    // yet, and one with an unreadable date cannot be placed. Both are still
    // money that went in, so both count towards what was paid.
    base += instalment.amount;
    value += years !== null && years > 0
      ? instalment.amount * rate ** (n * years)
      : instalment.amount;
  }

  return {
    holding,
    base,
    value: roundMoney(value),
    interest: roundMoney(value - base),
    instalments: instalments.length,
    // The first instalment, which is what "and not since" means for an RD —
    // there is no single `valuedOn` that describes a deposit paid into monthly.
    since: instalments[0].date,
    compoundedTimesAYear: n,
    recurring: true,
    matured: Boolean(holding.maturesOn && holding.maturesOn < asOf),
  };
}

/**
 * Every deposit whose recorded value has drifted, and every one that cannot be
 * checked, with the reason.
 *
 * @param {object[]} holdings
 * @param {string} asOf
 * @param {{transactions?: object[], tolerance?: number}} [options]
 *   `transactions` are investment transactions; without them a recurring
 *   deposit has no instalments to accrue and is listed as unchecked.
 *   `tolerance` is the smallest drift worth mentioning, in minor units.
 */
export function accrualReport(holdings, asOf, { transactions = [], tolerance = 100_00 } = {}) {
  const drifted = [];
  const unchecked = [];

  for (const holding of (holdings ?? []).filter((h) => !h.deletedAt && h.active !== false)) {
    // A recurring deposit takes the other route entirely — every instalment
    // accrued from its own date rather than the total from one.
    if (holding.kind === 'recurring deposit') {
      const can = canAccrueRecurring(holding, transactions);
      if (!can.ok) {
        unchecked.push({ holding, why: can.why });
        continue;
      }
      const rd = recurringValue(holding, transactions, asOf);
      if (rd && rd.interest > tolerance) drifted.push(rd);
      continue;
    }

    const check = canAccrue(holding);
    if (!check.ok) {
      // Only worth mentioning for things that plausibly *should* accrue. A
      // stock appearing in a list of "deposits we could not value" would be
      // noise, and noise trains people to stop reading. `REFUSED` is not the
      // test here — most of what it refuses is market-linked, and was never a
      // candidate.
      if (DEPOSIT_LIKE.includes(String(holding.kind ?? ''))) {
        unchecked.push({ holding, why: check.why });
      }
      continue;
    }

    const run = accruedValue(holding, asOf);
    if (!run) continue;
    if (run.interest <= tolerance) continue;

    drifted.push(run);
  }

  return {
    drifted,
    unchecked,
    understated: drifted.reduce((n, d) => n + d.interest, 0),
  };
}

/**
 * One deposit's drift, as a sentence. Null when there is nothing to say.
 *
 * @param {(n: number) => string} [money]
 */
export function describeAccrual(entry, money = (n) => String(n)) {
  if (!entry) return null;

  const every = { 1: 'yearly', 2: 'half-yearly', 4: 'quarterly' }[entry.compoundedTimesAYear]
    ?? `${entry.compoundedTimesAYear} times a year`;

  const matured = entry.matured
    ? ' It matured, so interest is counted only up to that date — what happened after, '
      + 'a withdrawal or a renewal, is not recorded here.'
    : '';

  // A recurring deposit has no single date its value was true, so saying
  // "valued at X on Y" would be a sentence about a figure nobody typed. What
  // it has instead is instalments, which is the thing to name.
  const opening = entry.recurring
    ? `${entry.instalments} instalments totalling ${money(entry.base)}, from `
      + `${entry.since} onwards, each earning from the day it went in.`
    : `Valued at ${money(entry.base)} on ${entry.holding.valuedOn} and not since.`;

  return `${opening} At ${entry.holding.interestRate}% compounded ${every} that is about `
    + `${money(entry.value)} now — ${money(entry.interest)} of interest this has not `
    + `been counting.${matured} The bank's figure is the one that counts.`;
}
