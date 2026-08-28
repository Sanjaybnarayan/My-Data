/**
 * What the household is already committed to, every month.
 *
 * ## The gap
 *
 * The Finance screen printed this sentence:
 *
 *     "₹79,590 a month is already committed to bills, EMIs and subscriptions."
 *
 * `committedMonthlyOutflow(recurring, loans)` takes two arguments. There is a
 * `subscription` entity, with `amount`, `frequency`, `renewsOn`, `active` and
 * `autoRenew`, and a `digitalAsset` entity with `annualCost` and `renewsOn`.
 * Neither reached the figure. Measured on a household with five live
 * subscriptions and two digital assets:
 *
 *     committed, as the screen reported it : ₹79,590.00
 *     subscriptions recorded, per month    :  ₹5,341.92
 *     digital assets recorded, per month   :    ₹598.33
 *     the truth                            : ₹85,530.25
 *
 * The number being low is the smaller half. **The sentence named subscriptions
 * and the number excluded them**, so a household reading it had been told the
 * figure covered something it did not.
 *
 * Five of those subscriptions renewed inside the next thirty days and none
 * appeared among the upcoming bills. The household was told *"Netflix renews
 * in 3 days"* — a date, with no amount attached to it.
 *
 * ## What `autoRenew` means, and why reading it matters
 *
 * A subscription that renews itself is a commitment: the money leaves whether
 * or not anybody acts. One that does not is the opposite — it **lapses**
 * unless somebody acts. Counting the second as committed outflow would report
 * money the household is not going to spend, and would hide the only thing
 * worth saying about it, which is that the service stops on that date.
 *
 * So `autoRenew` splits the two, and both are reported. That is the whole
 * content of the field, and it had never been read.
 *
 * ## The double count it refuses to guess at
 *
 * A household can record Netflix twice: once on the Subscriptions screen, and
 * once as a recurring payment whose `kind` is *subscription*. Nothing links
 * them. Adding both overstates the commitment; picking one silently discards a
 * record the household entered on purpose.
 *
 * Neither is done. Both are counted, and the pair is **named** with the amount
 * at stake, the same way `domain/settlement.js` names a card bill counted
 * twice rather than quietly correcting it. A likely duplicate is a question
 * for the household, not a decision for this file.
 *
 * ## The other direction: money that leaves and nothing records
 *
 * Everything above asks what the *records* add up to. The bank statement
 * answers a different question — what actually left — and until now the two
 * were never put side by side. Measured on one salaried household:
 *
 *     committed, from the records         : ₹53,500 a month
 *     repeating charges the ledger can see : ₹64,329 a month
 *
 * ₹10,829 a month, ₹1,29,948 a year, of real outgoings on a real schedule that
 * no record accounts for — a subscription nobody wrote down, which is the kind
 * a household most wants to be told about because it is the kind they forgot.
 *
 * Both figures are honest about their own inputs. They disagree because they
 * are answers to different questions, and the disagreement is the finding.
 *
 * So this reports the difference and **does not resolve it**. Nothing is
 * created, nothing is added to the committed total: a detected charge is not a
 * record, and promoting one to a record on a name match would be this file
 * deciding something the household did not. It is the `duplicates` treatment
 * again — name the disagreement, price it, leave the decision where it
 * belongs.
 */

import { today } from '../core/dates.js';
import { divide } from '../core/money.js';

/** A year of a thing, as a month of it. */
const PER_MONTH = {
  weekly: (a) => divide(a * 52, 12),
  monthly: (a) => a,
  quarterly: (a) => divide(a, 3),
  'half-yearly': (a) => divide(a, 6),
  yearly: (a) => divide(a, 12),
};

/** What a subscription costs per month, whatever cycle it bills on. */
export function monthlyCost(record) {
  const amount = record?.amount ?? 0;
  return (PER_MONTH[record?.frequency] ?? PER_MONTH.monthly)(amount);
}

/** Live, not deleted, not cancelled. */
const isLive = (r) => Boolean(r) && !r.deletedAt && r.active !== false;

/**
 * Subscriptions and digital assets, split by whether the money leaves on its
 * own.
 *
 * @returns {{committed: number, lapsing: number, rows: Array<object>}}
 *   `committed` is what renews itself. `lapsing` is what stops unless somebody
 *   renews it — real money, but not money that is going to leave.
 */
export function subscriptionOutflow(subscriptions = [], digitalAssets = []) {
  const rows = [];

  for (const s of (subscriptions ?? []).filter(isLive)) {
    rows.push({
      id: s.id,
      entity: 'subscription',
      name: s.name,
      perMonth: monthlyCost(s),
      amount: s.amount ?? 0,
      frequency: s.frequency ?? 'monthly',
      renewsOn: s.renewsOn ?? null,
      // The field's whole meaning: does this money leave without anyone doing
      // anything? Defaulted true because the schema does, and because a
      // subscription nobody has said otherwise about does renew.
      autoRenew: s.autoRenew !== false,
      cancelUrl: s.cancelUrl ?? null,
      account: s.account ?? null,
    });
  }

  for (const d of (digitalAssets ?? []).filter(isLive)) {
    // A domain or a hosting plan bills yearly and is priced that way. With no
    // cost recorded there is nothing to add — and nothing to invent.
    if (!d.annualCost) continue;
    rows.push({
      id: d.id,
      entity: 'digitalAsset',
      name: d.name,
      perMonth: divide(d.annualCost, 12),
      amount: d.annualCost,
      frequency: 'yearly',
      renewsOn: d.renewsOn ?? null,
      // A digital asset has no `autoRenew` field. Treating its absence as
      // "renews itself" would put money in the committed figure on the
      // strength of a field that does not exist, so it counts as lapsing —
      // the side that claims less.
      autoRenew: false,
      cancelUrl: null,
      account: null,
    });
  }

  let committed = 0;
  let lapsing = 0;
  for (const row of rows) {
    if (row.autoRenew) committed += row.perMonth;
    else lapsing += row.perMonth;
  }

  return { committed, lapsing, rows };
}

/** Names compared the way a person would: case, spacing and punctuation off. */
const normalise = (name) => String(name ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The same subscription recorded twice, in two different screens.
 *
 * Matched on the name alone, not the amount: a household that recorded Netflix
 * in both places a year apart has two different prices for it, and those are
 * exactly the pairs worth asking about. The amount reported is the *larger* of
 * the two per-month figures — the most that could be double-counted.
 *
 * @returns {Array<{name, amount, recurringId, subscriptionId}>}
 */
export function duplicateCommitments(recurring = [], subscriptions = []) {
  const bySubscription = new Map();
  for (const s of (subscriptions ?? []).filter(isLive)) {
    const key = normalise(s.name);
    if (key) bySubscription.set(key, s);
  }

  const out = [];
  for (const r of (recurring ?? []).filter(isLive)) {
    // Only a recurring payment the household typed as a subscription. A
    // broadband bill that happens to share a name with a streaming service is
    // not the same commitment.
    if (r.kind !== 'subscription') continue;
    const match = bySubscription.get(normalise(r.name));
    if (!match) continue;

    out.push({
      name: r.name,
      amount: Math.max(monthlyCost(r), monthlyCost(match)),
      recurringId: r.id,
      subscriptionId: match.id,
    });
  }

  return out;
}

export const ACCOUNTED = Object.freeze({
  /** A record names this charge. */
  YES: 'accounted',
  /** Something looks like it, on one weak signal. A question, not an answer. */
  MAYBE: 'uncertain',
  /** Nothing records it. */
  NO: 'unaccounted',
});

/** Words too short or too common to identify a commitment on their own. */
const WEAK = new Set(['the', 'and', 'dr', 'cr', 'upi', 'ach', 'nach', 'emi',
  'ltd', 'pvt', 'inc', 'llp', 'bank', 'payment', 'pay', 'auto', 'debit',
  'card', 'pos', 'ecs', 'imps', 'neft', 'rtgs']);

const words = (name) => normalise(name).split(' ').filter(Boolean);

/**
 * Whether a record's name and a charge's narration are about the same thing.
 *
 * Deliberately word-overlap rather than equality: a record says *Rent* and the
 * narration says *LANDLORD RENT*; a record says *Home loan* and the narration
 * says *ACH DR HDFC HOME LOAN EMI*. Requiring equality would report every real
 * commitment as unaccounted, which is a wrong claim in the other direction.
 *
 * `WEAK` is what stops that being too generous. Without it every ACH mandate
 * shares the word *ACH* with every other, and one record would account for all
 * of them.
 */
function nameOverlap(recordName, chargeName) {
  const a = words(recordName).filter((w) => w.length > 2 && !WEAK.has(w));
  const b = words(chargeName).filter((w) => w.length > 2 && !WEAK.has(w));
  if (!a.length || !b.length) return 0;
  return a.filter((word) => b.includes(word)).length;
}

/**
 * Which recorded commitment, if any, accounts for a charge the ledger found.
 *
 * Matched on the **name**, and the amount is then reported rather than
 * required — the same choice `duplicateCommitments` makes, for the same
 * reason. A household whose Netflix record still says ₹499 while ₹649 leaves
 * every month has a stale record, and that pair is precisely what is worth
 * showing. Requiring the amounts to agree would hide it as unaccounted and
 * invent a second commitment that does not exist.
 *
 * Two or more records matching equally well is **not** resolved. Picking the
 * nearer amount would be a guess dressed as an answer, and the standing rule
 * here is that an uncertain match is never forced.
 */
export function matchCommitment(charge, records) {
  const scored = (records ?? [])
    .map((record) => ({ record, score: nameOverlap(record.name, charge?.name) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { record: null, confidence: ACCOUNTED.NO, why: null };
  }

  const [best, next] = scored;
  if (next && next.score === best.score) {
    return {
      record: null,
      confidence: ACCOUNTED.MAYBE,
      why: `${scored.filter((row) => row.score === best.score).length} records could `
        + 'be this charge. Choosing one would be a guess.',
    };
  }

  // One word in common, and only one, on names that are otherwise unalike.
  // "Rent" against "RENTAL CAR HIRE" is exactly this shape, so it is offered as
  // a question rather than counted as accounted for.
  const thin = best.score === 1
    && words(best.record.name).filter((w) => w.length > 2 && !WEAK.has(w)).length > 1;

  return {
    record: best.record,
    confidence: thin ? ACCOUNTED.MAYBE : ACCOUNTED.YES,
    why: thin
      ? `“${best.record.name}” shares one word with this narration and nothing else.`
      : null,
  };
}

/**
 * Repeating charges the ledger can see, set against the commitments recorded.
 *
 * @param {object[]} detected as `domain/categorise.js` `recurring()` returns
 * @param {{recurring?: object[], loans?: object[], subscriptions?: object[],
 *          digitalAssets?: object[]}} recorded
 * @returns {{accounted: object[], uncertain: object[], unaccounted: object[],
 *            unaccountedPerMonth: number}}
 *   `unaccountedPerMonth` counts **only** what nothing records at all.
 *   Uncertain charges are excluded from it deliberately: a figure that counted
 *   maybes would overstate, and the whole value of this number is that a
 *   household can believe it.
 */
export function unrecordedCommitments(detected = [], {
  recurring = [], loans = [], subscriptions = [], digitalAssets = [],
} = {}) {
  const records = [
    ...(recurring ?? []).filter(isLive).map((r) => ({ ...r, entity: 'recurringPayment' })),
    // A loan's name is what a household calls it; the EMI is the money.
    ...(loans ?? []).filter(isLive).map((l) => ({ ...l, entity: 'loan', amount: l.emiAmount ?? 0 })),
    ...(subscriptions ?? []).filter(isLive).map((s) => ({ ...s, entity: 'subscription' })),
    ...(digitalAssets ?? []).filter(isLive)
      .map((d) => ({ ...d, entity: 'digitalAsset', amount: d.annualCost ?? 0, frequency: 'yearly' })),
  ];

  const accounted = [];
  const uncertain = [];
  const unaccounted = [];

  for (const charge of detected ?? []) {
    // A run that has stopped is not a commitment. `recurring()` reports
    // `active: null` when it was given no day to judge against, and that is
    // not the same as false — an unknown is left in rather than dropped on a
    // guess about the clock.
    if (charge?.active === false) continue;

    const match = matchCommitment(charge, records);
    const row = {
      charge,
      record: match.record,
      confidence: match.confidence,
      why: match.why,
      // Only where a record was actually found. A difference against nothing
      // is not a difference.
      differsBy: match.record ? charge.amount - monthlyEquivalent(match.record, charge) : null,
    };

    if (match.confidence === ACCOUNTED.YES) accounted.push(row);
    else if (match.confidence === ACCOUNTED.MAYBE) uncertain.push(row);
    else unaccounted.push(row);
  }

  return {
    accounted,
    uncertain,
    unaccounted,
    unaccountedPerMonth: unaccounted.reduce((sum, row) => sum + perMonth(row.charge), 0),
  };
}

/** A detected charge's amount as a monthly figure, from the cadence observed. */
function perMonth(charge) {
  const amount = charge?.amount ?? 0;
  return (PER_MONTH[charge?.period] ?? PER_MONTH.monthly)(amount);
}

/** A record's amount on the same cycle the charge was observed at. */
function monthlyEquivalent(record, charge) {
  const recordPerMonth = monthlyCost(record);
  const cycles = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
  return divide(recordPerMonth, cycles[charge?.period] ?? 1);
}

/**
 * Everything the household is committed to each month, and what is uncertain
 * about the figure.
 *
 * @param {{recurring?, loans?, subscriptions?, digitalAssets?, base?,
 *          detected?: object[]}} [options]
 *   `detected` is what the ledger found repeating, from `recurring()`. Given
 *   it, the summary can also say what is leaving that nothing records.
 * @returns {{total, base, subscriptions, lapsing, duplicates, duplicated,
 *            rows, loans, unaccounted, unaccountedRows, uncertainRows}}
 *   `base` is bills and EMIs — what the figure used to be on its own.
 *   `duplicated` is how much of `total` might be counted twice, and
 *   `duplicates` names the pairs. Neither is deducted: which of the two
 *   records is the real one is a question for the household.
 *   `unaccounted` is money leaving on a schedule that no record explains. It
 *   is **not** in `total` either, and for the stronger reason: `total` is what
 *   the records say, and a detected charge is not a record.
 */
export function commitmentSummary({
  recurring = [], loans = [], subscriptions = [], digitalAssets = [], base = 0,
  detected = [],
} = {}) {
  const subs = subscriptionOutflow(subscriptions, digitalAssets);
  const duplicates = duplicateCommitments(recurring, subscriptions);
  const unrecorded = unrecordedCommitments(detected, {
    recurring, loans, subscriptions, digitalAssets,
  });

  return {
    base,
    subscriptions: subs.committed,
    lapsing: subs.lapsing,
    total: base + subs.committed,
    duplicates,
    duplicated: duplicates.reduce((t, d) => t + d.amount, 0),
    rows: subs.rows,
    loans: loans.length,
    unaccounted: unrecorded.unaccountedPerMonth,
    unaccountedRows: unrecorded.unaccounted,
    uncertainRows: unrecorded.uncertain,
  };
}

/**
 * Subscription renewals falling due within `days`, shaped like a bill.
 *
 * A renewal *is* a bill: a known amount leaving on a known date. It was
 * already producing a date reminder with no money attached to it, which is the
 * half of the fact that costs nothing to know.
 */
export function subscriptionBills(subscriptions, digitalAssets, {
  from = today(), days = 30,
} = {}) {
  const out = [];

  for (const row of subscriptionOutflow(subscriptions, digitalAssets).rows) {
    if (!row.renewsOn) continue;
    const away = daysBetween(from, row.renewsOn);
    if (away > days) continue;
    // A renewal a month past its date was not a renewal. Unlike a card bill,
    // nothing here says it was ever paid, so nagging about it forever would be
    // a reminder nobody can clear.
    if (away < -30) continue;

    out.push({
      id: `${row.entity}:${row.id}:${row.renewsOn}`,
      source: 'subscription',
      entity: row.entity,
      recordId: row.id,
      name: row.name,
      kind: 'subscription',
      amount: row.amount,
      dueOn: row.renewsOn,
      days: away,
      overdue: away < 0,
      // For a subscription this is exactly what auto-debit means: the provider
      // charges the card without anybody doing anything.
      autoDebit: row.autoRenew,
      cancelUrl: row.cancelUrl,
      // The other half of `autoRenew`, said plainly on the row that would
      // otherwise look identical to a bill that pays itself.
      why: row.autoRenew ? null
        : 'this does not renew itself — it stops on this date unless somebody renews it',
    });
  }

  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * The commitment figure, as a sentence that is true about what is in it.
 *
 * @param {(n: number) => string} money
 */
export function describeCommitments(summary, money = (n) => String(n)) {
  if (!summary) return null;

  const parts = [`${money(summary.total)} a month is already committed`];
  parts.push(summary.subscriptions
    ? ` to bills, EMIs and subscriptions, of which ${money(summary.subscriptions)} is subscriptions that renew themselves.`
    : ' to bills and EMIs.');

  if (summary.lapsing) {
    parts.push(` A further ${money(summary.lapsing)} a month is recorded against `
      + 'subscriptions and digital assets that do not renew themselves, so that '
      + 'money only leaves if somebody renews them.');
  }

  if (summary.duplicated) {
    const names = summary.duplicates.map((d) => d.name).join(', ');
    parts.push(` Up to ${money(summary.duplicated)} of this may be counted twice: `
      + `${names} ${summary.duplicates.length === 1 ? 'is' : 'are'} recorded both as a `
      + 'recurring payment and as a subscription. Both are counted here, because '
      + 'which one is the real record is not something this can decide.');
  }

  if (summary.unaccounted) {
    const rows = summary.unaccountedRows ?? [];
    const names = rows.slice(0, 3).map((row) => row.charge.name).join(', ');
    const more = rows.length > 3 ? `, and ${rows.length - 3} more` : '';
    parts.push(` A further ${money(summary.unaccounted)} a month leaves on a schedule `
      + `that no record here explains — ${names}${more}. That is read from your `
      + 'statements, not from this list, so it is not added to the figure above.');
  }

  return parts.join('');
}
