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

/**
 * The last-resort money formatter.
 *
 * Everything in this application is in minor units, and the near-match sentence
 * used to interpolate them raw: a ₹50 fee printed as **"The amounts differ by
 * 5000"**, which a household reads as five thousand rupees. A hundredfold
 * overstatement, in the one sentence that exists to help somebody decide.
 *
 * The convention elsewhere is a `money` parameter defaulting to `String(n)` —
 * fine where every caller passes a real formatter, and the trap here, because
 * no caller could. So the default at least moves the decimal point; the service
 * passes `core/money.js`'s `format` for the rupee sign and the grouping.
 */
function minorToMajor(minor) {
  return (minor / 100).toFixed(2);
}

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
 * @param {{windowDays?: number, nearWindow?: number,
 *           money?: (minor: number) => string}} [options]
 *   `money` — how to render an amount in the sentence a person decides from.
 *   Defaulted to something that at least moves the decimal point; the service
 *   passes the real formatter.
 *   `windowDays` — how far apart two legs may be and still be one movement.
 *   Three days covers a weekend, which is when most of them land.
 *   `nearWindow` — the largest difference in amount that is worth mentioning
 *   at all, in minor units. Above it, two amounts are simply two amounts.
 * @returns {{proposals: object[], unmatched: object[]}}
 */
export function proposeTransfers(transactions, {
  windowDays = 3, nearWindow = 10_000, money = minorToMajor,
} = {}) {
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
    ...verdict(c, candidates, { money, rows: transactions ?? [], windowDays }),
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
function verdict(candidate, all, { money, rows, windowDays }) {
  const { out, inn, days, difference, exact } = candidate;

  if (!exact) {
    // A charge on either account, inside the window, for exactly the missing
    // amount. Measured: ₹50,000 out, ₹49,950 in, and a ₹50 fee sitting on the
    // same statement the same day — while this sentence said nothing here could
    // tell which. Something here could.
    const charges = chargesExplaining(candidate, rows, windowDays);

    if (charges.length === 1) {
      return {
        confidence: CONFIDENCE.POSSIBLE,
        ambiguous: false,
        evidence: charges,
        // Still `possible`, and deliberately. Unequal amounts never match
        // automatically — a charge for the right amount on the right day is
        // strong evidence and is not the same thing as somebody checking. What
        // changes is that the person deciding is shown the row.
        why: `The amounts differ by ${money(difference)}, and there is a charge of `
          + `${money(charges[0].amount)} on ${charges[0].date}${describeRow(charges[0])} `
          + 'that accounts for it exactly. Worth checking rather than assuming.',
      };
    }

    if (charges.length > 1) {
      return {
        confidence: CONFIDENCE.POSSIBLE,
        ambiguous: false,
        evidence: charges,
        why: `The amounts differ by ${money(difference)}, and ${charges.length} `
          + 'separate charges would each account for it exactly. Which of them '
          + 'belongs to this movement is not something these figures can say.',
      };
    }

    return {
      confidence: CONFIDENCE.POSSIBLE,
      ambiguous: false,
      evidence: [],
      why: `The amounts differ by ${money(difference)} — a fee would explain it, and so `
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
 * Rows that would account for the gap between two near-matching legs.
 *
 * A bank fee is charged where the money left, and an inward-remittance charge
 * where it arrived, so both accounts are looked at. The row must be *exactly*
 * the difference: "about right" would find a coincidence on any statement busy
 * enough, and this sentence is read by somebody about to make a decision.
 *
 * Transfer legs are excluded. A third loose leg of the right size is a
 * candidate for its own pairing, not a fee — treating it as one would explain
 * a movement by consuming another movement.
 */
function describeRow(row) {
  // Truthiness rather than `??`: a narration is an empty string far more often
  // than it is absent, and “” in the middle of the sentence names nothing while
  // looking like it meant to.
  const label = row.narration || row.payee || row.category;
  return label ? ` — “${label}” —` : '';
}

function chargesExplaining(candidate, rows, windowDays) {
  const { out, inn, difference } = candidate;
  // Belt and braces, and worth naming as such: this is only ever called from
  // the `!exact` branch, where the difference is non-zero by definition, so
  // mutation testing shows removing it breaks nothing today. It stays because
  // "there is no gap to explain" is a property of the question rather than of
  // the one caller that happens to ask it.
  if (!difference) return [];

  const accounts = new Set([out.account, inn.account].filter(Boolean));

  return (rows ?? []).filter((row) => {
    if (!row || row.deletedAt) return false;
    if (row.id === out.id || row.id === inn.id) return false;
    if (row.kind === 'transfer') return false;
    if (row.amount !== difference) return false;
    if (!accounts.has(row.account)) return false;
    const days = daysBetween(out.date, row.date);
    return days !== null && days <= windowDays;
  });
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

/**
 * A movement with more than two legs.
 *
 * ## What was measured
 *
 * The prompt's `EconomicEvent` was deferred four times as *"still wanted for
 * movements with more than two legs"*, and nobody had printed what those
 * movements currently do. They do nothing at all:
 *
 *     split — ₹50,000 out of HDFC, ₹30,000 and ₹20,000 in
 *       proposals 0   unmatched 3   moved ₹0
 *
 *     sweep — ₹30,000 and ₹20,000 out, ₹50,000 in
 *       proposals 0   unmatched 3   moved ₹0
 *
 * The household moved ₹50,000 and the application reports nothing moved and
 * three loose ends. `proposeTransfers` pairs one leg with one leg, so a
 * movement that lands in two pieces is invisible to it — not mis-stated, which
 * is something, but not seen either.
 *
 * ## Why this is a separate function
 *
 * The same reason `datesInRange` sits beside `expiryReminders`: the pairwise
 * question is correct and this is a different one. This runs only on legs
 * `proposeTransfers` left **unmatched**, so a plain two-leg transfer is never
 * offered twice, and a set is only ever proposed where the pairing found
 * nothing.
 *
 * ## The rules, which are the pairwise rules
 *
 *   - **Exact only.** A set is proposed when its legs sum to the counterpart
 *     *exactly*. There is no near-miss version: subset-sums are numerous
 *     enough that an approximate one would find a coincidence in any statement.
 *   - **Ambiguity is not a match.** If two different sets close the same
 *     amount, neither is probable — the same rule, for the same reason, as one
 *     debit matching two credits equally well.
 *   - **Bounded, and honest when it gives up.** Subset-sum is exponential, so
 *     the candidate pool is capped. Past the cap the answer is *"too many
 *     candidates to be sure"*, reported as such — a search that quietly
 *     stopped early would report "no movement" for a movement that is there.
 *   - **Nothing is written.** As with everything else in this file, a proposal
 *     is an opinion about a coincidence of amounts and dates.
 *
 * @param {object[]} transactions
 * @param {{windowDays?: number, maxLegs?: number, maxCandidates?: number}} [options]
 * @returns {{proposals: object[], undecided: object[]}}
 */
export function proposeMultiLeg(transactions, {
  windowDays = 3, maxLegs = 4, maxCandidates = 12,
} = {}) {
  // Only what the pairwise pass could not account for. Running over everything
  // would re-offer transfers that already have a two-leg proposal.
  const { unmatched } = proposeTransfers(transactions, { windowDays });

  const proposals = [];
  const undecided = [];
  const used = new Set();

  // One side is the whole amount, the other is the pieces — and it works the
  // same either way round, so a split and a sweep are one piece of code.
  for (const direction of ['out', 'in']) {
    const whole = unmatched.filter((leg) => leg.direction === direction);
    const pieces = unmatched.filter((leg) => leg.direction !== direction);

    for (const anchor of whole) {
      if (used.has(anchor.id)) continue;

      const pool = pieces.filter((leg) => {
        if (used.has(leg.id)) return false;
        if (leg.account && anchor.account && leg.account === anchor.account) return false;
        const days = daysBetween(anchor.date, leg.date);
        return days !== null && days <= windowDays;
      });

      // Two legs is the pairwise case, which has already had its turn.
      //
      // Belt and braces, and worth naming as such: mutation testing shows this
      // guard and the `chosen.length >= 2` below can both be removed without
      // failing anything, because neither is reachable. A single counterpart of
      // exactly the right amount differs by nought, which is inside
      // `nearWindow`, so `proposeTransfers` always makes it a candidate and it
      // is never left unmatched. Both stay because the rule they state — a set
      // is at least two rows — is a property of the answer rather than an
      // accident of what the pairwise pass happens to catch.
      if (pool.length < 2) continue;

      if (pool.length > maxCandidates) {
        undecided.push({
          anchor,
          candidates: pool.length,
          why: `${pool.length} rows within ${windowDays} days could be part of this `
            + 'movement. Working through every combination of them would take longer '
            + 'than it is worth, and guessing at one would be worse.',
        });
        continue;
      }

      const sets = subsetsSummingTo(pool, anchor.amount, maxLegs);
      if (!sets.length) continue;

      const legs = sets[0];
      const ambiguous = sets.length > 1;

      proposals.push({
        anchor,
        legs,
        amount: anchor.amount,
        // The direction of the *anchor*: 'out' is one debit arriving in
        // several places, 'in' is several debits funding one credit.
        shape: direction === 'out' ? 'split' : 'sweep',
        confidence: ambiguous ? CONFIDENCE.POSSIBLE : CONFIDENCE.PROBABLE,
        ambiguous,
        why: ambiguous
          ? `${sets.length} different groups of rows add up to this amount. Picking `
            + 'one would be a guess, and a guess that rearranged a ledger.'
          : `${legs.length} rows add up to exactly this amount, within `
            + `${windowDays} days, on other accounts of yours.`,
      });

      // A leg belongs to one movement. Claiming it twice would let the same
      // ₹20,000 close two different sets.
      if (!ambiguous) {
        used.add(anchor.id);
        for (const leg of legs) used.add(leg.id);
      }
    }
  }

  return { proposals, undecided };
}

/**
 * Every group of at least two legs summing to `target` exactly.
 *
 * Depth-first over a pool already capped by the caller, and it stops at two
 * distinct answers because that is all the caller needs to know: one is a
 * proposal, two or more is ambiguous, and the exact count past that changes
 * nothing.
 */
function subsetsSummingTo(pool, target, maxLegs) {
  const found = [];

  const walk = (start, chosen, total) => {
    // Two is enough to know it is ambiguous; counting further is wasted work.
    // Purely a performance bound — with three sets or thirty the verdict is the
    // same, which is why moving this threshold fails no test.
    if (found.length >= 2) return;
    if (total === target && chosen.length >= 2) {
      found.push([...chosen]);
      return;
    }
    if (total >= target || chosen.length >= maxLegs) return;

    for (let i = start; i < pool.length; i += 1) {
      chosen.push(pool[i]);
      walk(i + 1, chosen, total + pool[i].amount);
      chosen.pop();
    }
  };

  walk(0, [], 0);
  return found;
}

/**
 * What the multi-leg proposals add to the movement total.
 *
 * Kept apart from `movementTotal` deliberately. That figure answers "how much
 * did we move" from pairings; folding a different kind of proposal into it
 * silently would change what the number means without changing its name.
 */
export function multiLegTotal(proposals) {
  const confident = (proposals ?? []).filter((p) => p.confidence === CONFIDENCE.PROBABLE);
  return {
    movements: confident.length,
    moved: confident.reduce((sum, p) => sum + p.amount, 0),
    awaiting: (proposals ?? []).filter((p) => p.confidence === CONFIDENCE.POSSIBLE).length,
  };
}
