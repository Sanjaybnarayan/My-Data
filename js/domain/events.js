/**
 * One movement of money, seen from both ends.
 *
 * ## The distinction this file exists to hold
 *
 * **An account transaction is not an economic event.** A statement line is a
 * bank telling you what it did to one account. An economic event is what
 * happened in the household's economy. Moving ₹50,000 from HDFC to ICICI is
 * *one* event and *two* statement lines, and treating the lines as the events
 * is how a household ends up reading that they moved ₹100,000.
 *
 * The categoriser already gets the totals right — `self-transfer` has kind
 * `internal`, and `summarise` keeps internal out of spending and income. What
 * it cannot do is say the two lines are the *same* ₹50,000. So `internalOut`
 * and `internalIn` each carry the full amount, correctly per account and
 * uselessly for the question "how much did we actually move".
 *
 * ## What the gap actually is
 *
 * A `transaction` already has a `toAccount`. A transfer entered by hand fills
 * it in and is one row. A transfer *imported from two statements* is two rows
 * with `kind: 'transfer'`, opposite directions, and `toAccount` empty on both.
 *
 * So the missing link is a field nobody filled in, and this file proposes what
 * belongs there.
 *
 * ## Nothing here decides anything
 *
 * Every function returns a proposal. None writes, and none is a verification —
 * a confidence is this module's opinion about a coincidence of amount and
 * date, and an opinion is not a fact somebody checked. The rules that follow
 * are shaped by that:
 *
 *   - **Unequal amounts never match automatically.** ₹50,000 out and ₹49,950
 *     in is probably a fee and might be two unrelated payments. It is offered
 *     with the difference named, and only when nothing exact is available.
 *   - **An ambiguous match is not a match.** If one debit could pair with two
 *     credits equally well, neither pairing is probable. Picking the first is
 *     how a household finds their ledger quietly rearranged.
 *   - **Both rows survive a confirmation.** Each is the bank's own record,
 *     with its own narration, reference and running balance. Merging them
 *     would destroy source data to tidy a screen.
 */

const DAY = 24 * 60 * 60 * 1000;

export const CONFIDENCE = Object.freeze({
  /** Exact amount, close in time, and the only candidate either side. */
  PROBABLE: 'probable',
  /** Worth a person looking at. Never applied without one. */
  POSSIBLE: 'possible',
});

/** Days apart, or `null` if either date is unreadable. */
function daysBetween(a, b) {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round(Math.abs(x - y) / DAY);
}

/**
 * Is this row one leg of a movement that has not been joined up yet?
 *
 * `toAccount` already set means somebody — or an earlier confirmation — has
 * said where it went, and proposing it again would offer to redo a decision
 * that has been made.
 */
export function isLooseLeg(txn) {
  return Boolean(txn)
    && txn.kind === 'transfer'
    && !txn.deletedAt
    && !txn.toAccount
    && (txn.direction === 'in' || txn.direction === 'out')
    && Number.isFinite(txn.amount)
    && txn.amount > 0;
}

/**
 * Pair up the loose legs.
 *
 * @param {object[]} transactions
 * @param {{windowDays?: number, nearWindow?: number}} [options]
 *   `windowDays` — how far apart two legs may be and still be one movement.
 *   Three days covers a weekend, which is when most of them land.
 *   `nearWindow` — the largest difference in amount that is worth mentioning
 *   at all, in minor units. Above it, two amounts are simply two amounts.
 * @returns {{proposals: object[], unmatched: object[]}}
 */
export function proposeTransfers(transactions, { windowDays = 3, nearWindow = 10_000 } = {}) {
  const legs = (transactions ?? []).filter(isLooseLeg);
  const outs = legs.filter((t) => t.direction === 'out');
  const ins = legs.filter((t) => t.direction === 'in');

  /** Every pairing worth considering at all, with why. */
  const candidates = [];
  for (const out of outs) {
    for (const inn of ins) {
      // The same account paying itself is a statement quirk, not a movement.
      if (out.account && inn.account && out.account === inn.account) continue;

      const days = daysBetween(out.date, inn.date);
      if (days === null || days > windowDays) continue;

      const difference = Math.abs(out.amount - inn.amount);
      if (difference > nearWindow) continue;

      candidates.push({ out, inn, days, difference, exact: difference === 0 });
    }
  }

  // Exact first, then closest in time, then smallest difference. The order
  // matters only for reporting — nothing below picks a winner on it.
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact)
    || a.days - b.days
    || a.difference - b.difference);

  const proposals = candidates.map((c) => ({
    out: c.out,
    in: c.inn,
    amount: c.out.amount,
    days: c.days,
    difference: c.difference,
    ...verdict(c, candidates),
  }));

  const spoken = new Set(proposals.flatMap((p) => [p.out.id, p.in.id]));
  return { proposals, unmatched: legs.filter((leg) => !spoken.has(leg.id)) };
}

/**
 * How much to believe one pairing, given every other pairing on the table.
 *
 * Context is the whole point. A pairing that looks perfect in isolation is not
 * probable if the same debit matches a second credit just as well — and a rule
 * that only looked at the pair in front of it would call both of them certain.
 */
function verdict(candidate, all) {
  const { out, inn, days, difference, exact } = candidate;

  if (!exact) {
    return {
      confidence: CONFIDENCE.POSSIBLE,
      ambiguous: false,
      why: `The amounts differ by ${difference} — a fee would explain it, and so `
        + 'would these being two unrelated payments. Nothing here can tell which.',
    };
  }

  // Rivals: another exact pairing that uses one of these two legs.
  const rivals = all.filter((other) => other !== candidate && other.exact
    && (other.out.id === out.id || other.inn.id === inn.id));

  if (rivals.length) {
    return {
      confidence: CONFIDENCE.POSSIBLE,
      ambiguous: true,
      why: `${rivals.length + 1} rows match this one equally well. Picking one `
        + 'would be a guess, and a guess that rearranged a ledger.',
    };
  }

  return {
    confidence: CONFIDENCE.PROBABLE,
    ambiguous: false,
    why: days === 0
      ? 'Same amount, same day, opposite directions on two of your accounts.'
      : `Same amount ${days} day${days === 1 ? '' : 's'} apart, opposite directions `
        + 'on two of your accounts.',
  };
}

/**
 * What the pairings say about how much was actually moved.
 *
 * The number `internalOut` and `internalIn` cannot give: each of those counts
 * the full amount, correctly per account and twice per movement.
 *
 * Only `probable` pairings count. A possible one is a question, and a total
 * built from questions reads as an answer.
 */
export function movementTotal(proposals) {
  const confident = (proposals ?? []).filter((p) => p.confidence === CONFIDENCE.PROBABLE);
  return {
    movements: confident.length,
    moved: confident.reduce((sum, p) => sum + p.amount, 0),
    /** Pairings a person still has to look at. Never folded into the total. */
    awaiting: (proposals ?? []).filter((p) => p.confidence === CONFIDENCE.POSSIBLE).length,
  };
}

/**
 * What confirming a proposal would change — without changing it.
 *
 * Both rows survive. Each is the bank's own record of one side, with its own
 * narration, reference and running balance, and a household that later
 * questions the figure needs both. What is added is the link that was missing:
 * the outgoing leg learns where the money went.
 */
export function linkFor(proposal) {
  if (!proposal || proposal.confidence !== CONFIDENCE.PROBABLE) return null;
  return {
    transactionId: proposal.out.id,
    patch: { toAccount: proposal.in.account },
    // The other leg is left exactly as the bank reported it. Deleting it, or
    // rewriting its amount to zero, would tidy a total by destroying the
    // evidence for it.
    keeps: proposal.in.id,
  };
}
