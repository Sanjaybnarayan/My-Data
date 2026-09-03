/**
 * Spending unlike its own history.
 *
 * ## What was measured
 *
 * A household spent ₹85,000 on healthcare in a month it had never spent
 * anything on healthcare, and ₹61,000 at a supermarket averaging ₹9,240. The
 * Insights screen said this:
 *
 *     Bills and utilities is the largest spending category, 50% of all spending.
 *     2 payments repeat on a schedule, ₹37,550 a cycle.
 *
 * Both true. Neither about anything that happened. The first points at **rent**
 * — the most predictable line in the household — because "largest" and
 * "unusual" are different questions and only the first was being asked.
 *
 * Nothing in the codebase compared a category to its own history.
 *
 * ## Why the refusals are most of this file
 *
 * An outlier detector is where a household gets told nonsense confidently. A
 * ratio is trivial to compute and almost always misleading, so what matters
 * here is what it declines to say:
 *
 *   - **A first occurrence is not a multiple of anything.** With no history the
 *     ratio is infinite, and reporting "∞ times more than usual" is arithmetic
 *     nobody asked for. It is reported as *never seen before*, which is a
 *     different and honest sentence.
 *   - **Too little history is no history.** Fewer than three prior months of a
 *     category and "usual" has no meaning. Those are dropped rather than
 *     guessed at.
 *   - **Small money is not news** however large the multiple. A category going
 *     from ₹50 to ₹500 is ten times its usual and worth nobody's attention, so
 *     a finding must clear an absolute floor as well as a ratio.
 *   - **The median, not the mean.** One expensive month drags a mean upward and
 *     then hides the next expensive month behind it. Five points make a stable
 *     median and an unstable mean.
 *   - **A partial month is not compared to whole ones.** Three days into
 *     August, every category is "down". The period being incomplete is stated
 *     on the result rather than silently skewing it.
 *
 * ## What it does not do
 *
 * It does not explain, advise, or categorise the *reason*. "You spent more on
 * healthcare" is a fact; "you should budget for healthcare" is advice this file
 * has no standing to give. Every finding carries the two numbers it was derived
 * from so the household can disagree with it.
 */

import { format, divide } from '../core/money.js';
import { settled } from '../data/integrity.js';

/** Below this, a multiple is arithmetic rather than news. ₹2,000 in paise. */
export const FLOOR = 2_000_00;

/** Fewer months than this and "usual" means nothing. */
export const MIN_MONTHS = 3;

/** How far above its own median a category has to sit to be worth saying. */
export const RATIO = 2;

/**
 * How close to the same month last year still counts as "the same again".
 *
 * Generous on purpose. The question is not whether two figures match but
 * whether last year explains this year, and an electricity bill that was
 * ₹9,000 last May and ₹11,000 this May is the same summer, not an anomaly.
 */
export const SEASONAL_TOLERANCE = 0.4;

export const UNUSUAL = Object.freeze({
  /** Spent before, and this period is well above the usual figure. */
  ABOVE: 'above-usual',
  /** Never spent on before. Not a multiple of anything. */
  FIRST: 'first-time',
  /** Above the usual figure, and it was this high the same month last year. */
  SEASONAL: 'seasonal',
});

const monthOf = (date) => String(date ?? '').slice(0, 7);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : divide(sorted[middle - 1] + sorted[middle], 2);
}

/**
 * What each category usually costs in a month, and what it cost in this one.
 *
 * @param {object[]} rows categorised transactions, as `fromRecords` returns
 * @param {{month: string}} options the month under examination, `YYYY-MM`
 */
export function categoryHistory(rows, { month }) {
  const perMonth = new Map();

  for (const row of rows ?? []) {
    if (!settled(row)) continue;
    if (row.direction !== 'out') continue;
    const key = row.category || 'other';
    const at = monthOf(row.date);
    // No upper bound here on purpose: `before` and `current` below each select
    // the months they want, and a guard repeating that rule would be a second
    // place to keep it right. Mutating it away changes no output, which is how
    // it was found.
    if (!at) continue;

    if (!perMonth.has(key)) perMonth.set(key, new Map());
    const months = perMonth.get(key);
    months.set(at, (months.get(at) ?? 0) + (row.amount ?? 0));
  }

  // The same month, a year earlier. A household's own past is the only thing
  // that can tell a summer from a surprise, and it is already in the data.
  const [year, monthOfYear] = month.split('-');
  const lastYear = `${Number(year) - 1}-${monthOfYear}`;

  const out = [];
  for (const [category, months] of perMonth) {
    const before = [...months].filter(([at]) => at < month);
    out.push({
      category,
      current: months.get(month) ?? 0,
      sameMonthLastYear: months.get(lastYear) ?? null,
      // The months it was actually spent in, not the months since the first
      // one. A category bought in January and July has two months of history,
      // and treating the gap as five months of zero would call July normal.
      monthsSeen: before.length,
      usual: median(before.map(([, amount]) => amount)),
      history: before.map(([at, amount]) => ({ month: at, amount })),
    });
  }

  return out.sort((a, b) => b.current - a.current);
}

/**
 * Categories in this month that are unlike their own past.
 *
 * @param {object[]} rows
 * @param {{month: string, complete?: boolean, floor?: number,
 *          ratio?: number, minMonths?: number}} options
 *   `complete` says whether `month` has finished. A month in progress is
 *   reported but never used to claim a *fall*, because three days in,
 *   everything has fallen.
 */
export function unusualSpending(rows, {
  month, complete = true, floor = FLOOR, ratio = RATIO, minMonths = MIN_MONTHS,
}) {
  const findings = [];

  for (const row of categoryHistory(rows, { month })) {
    if (row.current < floor) continue;

    if (row.monthsSeen === 0) {
      findings.push({
        category: row.category,
        kind: UNUSUAL.FIRST,
        amount: row.current,
        usual: null,
        // Deliberately absent. There is no ratio against nothing, and a
        // screen printing "Infinity times usual" is the failure this avoids.
        times: null,
        monthsSeen: 0,
        partial: !complete,
      });
      continue;
    }

    // Some history, but not enough to call anything usual. Dropped rather than
    // reported with a caveat: a finding nobody should act on is noise wearing
    // a disclaimer.
    if (row.monthsSeen < minMonths) continue;
    if (!row.usual) continue;
    if (row.current < row.usual * ratio) continue;

    // It was this high the same month last year, so this is the household's
    // own pattern rather than a departure from it. Reported separately rather
    // than dropped: they asked what is unlike their history, and "your
    // electricity does this every May" is the answer, not silence.
    const lastYear = row.sameMonthLastYear;
    const seasonal = Boolean(lastYear)
      && Math.abs(row.current - lastYear) <= lastYear * SEASONAL_TOLERANCE;

    findings.push({
      category: row.category,
      kind: seasonal ? UNUSUAL.SEASONAL : UNUSUAL.ABOVE,
      sameMonthLastYear: lastYear,
      amount: row.current,
      usual: row.usual,
      times: row.current / row.usual,
      monthsSeen: row.monthsSeen,
      partial: !complete,
    });
  }

  // Departures first, patterns after — whatever the amounts. A big seasonal
  // figure above a small genuine surprise would teach a household to skim
  // past the list, and the surprise is the only part they cannot predict.
  // Within each group, the biggest rupee difference: a household cares about
  // the money, not the multiple, so a ₹50,000 jump beats a tripled ₹3,000.
  const rank = (row) => (row.kind === UNUSUAL.SEASONAL ? 1 : 0);
  return findings.sort((a, b) => rank(a) - rank(b)
    || (b.amount - (b.usual ?? 0)) - (a.amount - (a.usual ?? 0)));
}

/**
 * A finding as a sentence, with the arithmetic it rests on.
 *
 * @param {object} finding
 * @param {(n: number) => string} [money]
 * @param {(key: string) => string} [label]
 */
export function describeUnusual(finding, money = format, label = (k) => k) {
  if (!finding) return null;
  const name = label(finding.category);
  const caveat = finding.partial ? ' so far this month' : '';

  if (finding.kind === UNUSUAL.SEASONAL) {
    return `${money(finding.amount)} on ${name}${caveat}, above a usual `
      + `${money(finding.usual)} — but it was ${money(finding.sameMonthLastYear)} `
      + 'the same month last year, so this looks like your own pattern.';
  }

  if (finding.kind === UNUSUAL.FIRST) {
    return `${money(finding.amount)} on ${name}${caveat} — the first time anything `
      + 'has been spent there.';
  }

  return `${money(finding.amount)} on ${name}${caveat}, against a usual `
    + `${money(finding.usual)} — ${finding.times.toFixed(1)} times, `
    + `measured over ${finding.monthsSeen} earlier months.`;
}
