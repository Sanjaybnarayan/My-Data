/**
 * Who in the household spent what.
 *
 * ## The field nobody read
 *
 * `transaction.person` — the form calls it *"Spent by"* — has been on every
 * transaction since the schema was written, and `domain/ledger.js` copies it
 * onto every ledger row. Nothing downstream ever looked at it. A household of
 * three tagging every payment could not see who paid for anything.
 *
 * ## The trap, which is the whole design
 *
 * The field is optional and no importer sets it, so in a real household most
 * transactions carry no person at all. Measured on a realistic month — three
 * entered by hand, twenty imported:
 *
 *     spending with a person recorded : 50%
 *     "Asha spent 87% of it"          — of the tagged half
 *     Asha's share of what was spent  — 43%
 *
 * A per-member percentage is therefore **a share of what is tagged, never a
 * share of household spending**, and the coverage is reported beside it every
 * time. A report that quietly divided by the tagged subtotal and called it
 * "your spending" would be wrong by whatever fraction nobody had filled in —
 * an error that grows as the household imports more, which is exactly
 * backwards.
 *
 * ## What this deliberately does not answer
 *
 * **Who owes whom.** That needs to know which costs are shared and which are
 * personal, and nothing in this application records it. A rent payment and a
 * pair of shoes are both "spent by Asha" and only one of them is half Ravi's.
 * Splitting everything equally would be a guess dressed as arithmetic, and
 * `settleable()` below says so rather than producing a number.
 *
 * **Whose expense it was.** `person` records who *made the payment*, not who
 * it was for. That is the account-transaction-is-not-an-economic-event
 * distinction again, and every sentence here says "spent by" rather than
 * "spent on".
 */

import { addable } from '../core/money.js';
import { settled } from '../data/integrity.js';

/**
 * Spending per household member, with the coverage that qualifies it.
 *
 * @param {object[]} people
 * @param {object[]} transactions
 * @param {(txn: object) => boolean} [inPeriod]
 * @returns {{members: object[], tagged: number, untagged: number, total: number,
 *            coverage: number, complete: boolean, count: number, untaggedCount: number}}
 */
export function spendByMember(people, transactions, inPeriod = () => true) {
  const spending = (transactions ?? [])
    .filter((t) => settled(t) && t.direction !== 'in' && t.kind !== 'income')
    // A transfer between the household's own accounts is not spending, and
    // counting it would make whoever moves money look like the big spender.
    .filter((t) => t.kind !== 'transfer')
    .filter(inPeriod);

  const byId = new Map((people ?? []).filter(settled).map((p) => [p.id, p]));

  let tagged = 0;
  let untagged = 0;
  let untaggedCount = 0;
  const totals = new Map();

  for (const txn of spending) {
    const amount = addable(txn.amount);
    // A person id nobody recognises is untagged, not a member. A deleted
    // household member's transactions should not invent a row.
    if (!txn.person || !byId.has(txn.person)) {
      untagged += amount;
      untaggedCount += 1;
      continue;
    }
    tagged += amount;
    const held = totals.get(txn.person) ?? { spent: 0, count: 0, categories: new Map() };
    held.spent += amount;
    held.count += 1;
    held.categories.set(txn.category, (held.categories.get(txn.category) ?? 0) + amount);
    totals.set(txn.person, held);
  }

  const members = [...totals.entries()]
    .map(([id, held]) => ({
      person: byId.get(id),
      spent: held.spent,
      count: held.count,
      // Of what is *tagged*, and named that way everywhere it is used. Of
      // household spending it would be wrong by the untagged remainder.
      shareOfTagged: tagged ? Math.round((held.spent / tagged) * 100) : 0,
      topCategory: [...held.categories.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.spent - a.spent);

  const total = tagged + untagged;

  return {
    members,
    tagged,
    untagged,
    total,
    count: spending.length,
    untaggedCount,
    coverage: total ? Math.round((tagged / total) * 100) : 0,
    complete: untagged === 0 && tagged > 0,
  };
}

/**
 * Can "who owes whom" be answered from this?
 *
 * No, and the reason is worth stating rather than leaving as an absence. It is
 * not a matter of arithmetic or of more tagging: the question needs a fact
 * nobody has recorded, which is **which costs are shared**.
 *
 * @returns {{ok: false, why: string}}
 */
export function settleable() {
  return {
    ok: false,
    why: 'Working out who owes whom needs to know which costs are shared and '
      + 'which are personal, and nothing here records that — rent and a pair of '
      + 'shoes are both spending by one person, and only one of them is half '
      + 'somebody else’s. Splitting everything equally would be a guess with '
      + 'arithmetic around it.',
  };
}

/**
 * The report as a sentence, or null when there is nothing worth saying.
 *
 * @param {(n: number) => string} [money]
 */
export function describeSpendByMember(report, money = (n) => String(n)) {
  if (!report?.members.length) return null;

  const named = report.members
    .map((m) => `${m.person.name} ${money(m.spent)}`)
    .join(', ');

  if (report.complete) {
    return `Every payment this period has somebody recorded against it: ${named}.`;
  }

  return `${named} — out of the ${money(report.tagged)} that has somebody `
    + `recorded against it. A further ${money(report.untagged)} does not, so `
    + 'these are shares of what is tagged rather than of what the household '
    + 'spent. Most imported rows carry no person unless one is added by hand.';
}
