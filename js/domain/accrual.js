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

/** Kinds this deliberately refuses, with the reason a person would want. */
export const REFUSED = Object.freeze({
  'recurring deposit': 'a recurring deposit grows by instalments, not as a lump sum — '
    + 'its value needs the payment schedule, which is not recorded here',
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
    value: Math.round(value),
    interest: Math.round(value - base),
    years,
    compoundedTimesAYear: n,
    matured: Boolean(holding.maturesOn && holding.maturesOn < asOf),
  };
}

/**
 * Every deposit whose recorded value has drifted, and every one that cannot be
 * checked, with the reason.
 *
 * @param {object[]} holdings
 * @param {string} asOf
 * @param {number} tolerance smallest drift worth mentioning, in minor units
 */
export function accrualReport(holdings, asOf, tolerance = 100_00) {
  const drifted = [];
  const unchecked = [];

  for (const holding of (holdings ?? []).filter((h) => !h.deletedAt && h.active !== false)) {
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

  const since = entry.holding.valuedOn;
  const every = { 1: 'yearly', 2: 'half-yearly', 4: 'quarterly' }[entry.compoundedTimesAYear]
    ?? `${entry.compoundedTimesAYear} times a year`;

  const matured = entry.matured
    ? ' It matured, so interest is counted only up to that date — what happened after, '
      + 'a withdrawal or a renewal, is not recorded here.'
    : '';

  return `Valued at ${money(entry.base)} on ${since} and not since. At `
    + `${entry.holding.interestRate}% compounded ${every} that is about `
    + `${money(entry.value)} now — ${money(entry.interest)} of interest this has not `
    + `been counting.${matured} The bank's figure is the one that counts.`;
}
