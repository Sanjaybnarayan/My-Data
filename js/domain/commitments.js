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
 */

import { today } from '../core/dates.js';

/** A year of a thing, as a month of it. */
const PER_MONTH = {
  weekly: (a) => Math.round((a * 52) / 12),
  monthly: (a) => a,
  quarterly: (a) => Math.round(a / 3),
  'half-yearly': (a) => Math.round(a / 6),
  yearly: (a) => Math.round(a / 12),
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
      perMonth: Math.round(d.annualCost / 12),
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

/**
 * Everything the household is committed to each month, and what is uncertain
 * about the figure.
 *
 * @returns {{total, base, subscriptions, lapsing, duplicates, duplicated,
 *            rows, loans}}
 *   `base` is bills and EMIs — what the figure used to be on its own.
 *   `duplicated` is how much of `total` might be counted twice, and
 *   `duplicates` names the pairs. Neither is deducted: which of the two
 *   records is the real one is a question for the household.
 */
export function commitmentSummary({
  recurring = [], loans = [], subscriptions = [], digitalAssets = [], base = 0,
} = {}) {
  const subs = subscriptionOutflow(subscriptions, digitalAssets);
  const duplicates = duplicateCommitments(recurring, subscriptions);

  return {
    base,
    subscriptions: subs.committed,
    lapsing: subs.lapsing,
    total: base + subs.committed,
    duplicates,
    duplicated: duplicates.reduce((t, d) => t + d.amount, 0),
    rows: subs.rows,
    loans: loans.length,
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

  return parts.join('');
}
