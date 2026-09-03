/**
 * Explaining a movement — rule 57, on the record the rule is about.
 *
 * > Every financial event must be explainable.
 *
 * ## What was measured
 *
 * `data/provenance.js` reads one hop and `data/lineage.js` walks the chain, and
 * both are careful, honest files. Neither could say anything about an
 * `economicEvent`. Asked about a movement whose two legs were parsed from a
 * named PDF, the application answered:
 *
 *     This economic event came from something not recorded.
 *
 * That was false in two ways at once. The reasoning was on the record all along
 * — `economicEvent.why` holds the sentence the matcher wrote — and the legs
 * were findable, because `transaction.movement` points at the event.
 *
 * ## Why the walk runs backwards
 *
 * Every edge `lineage.js` follows is a **forward** reference: a transaction
 * names its statement, a receipt names its transaction. A movement names
 * nothing. Its legs name *it*, which is the right way round for the schema —
 * an event does not know in advance how many rows will turn out to belong to
 * it — and the wrong way round for a walker that only reads forward.
 *
 * So this file does the reverse lookup, and `lineage.js` is left alone. Adding
 * a reverse edge there would make every origin walk a query rather than a get,
 * to serve one entity.
 *
 * ## What it will not do
 *
 * **It never repairs the amount.** If the legs no longer add up to the figure
 * stored on the event, both numbers are reported and neither is corrected. The
 * stored figure is what a person confirmed; the legs are what the rows say now.
 * A disagreement between them is the most interesting thing this file can find,
 * and silently preferring one would destroy it — the same rule the reconciler
 * and the KYC comparison already follow.
 *
 * **It never counts a hand-typed leg as unexplained.** Somebody typing a figure
 * is a real provenance. It is a different one from a bank's own paper, and the
 * two are counted apart rather than summed into a single reassuring number.
 *
 * **It never calls an explanation a verification.** Every chain here ends at
 * something a machine read. `provenance.js` says so on each hop and nothing in
 * this file overrides it.
 */

import { addable } from '../core/money.js';
import { lineageOf, describe as describeLineage, depth } from '../data/lineage.js';
import { provenanceOf, SOURCES } from '../data/provenance.js';
import { t } from '../core/locale.js';

/**
 * The rows recorded as legs of one movement.
 *
 * Uses the `byMovement` index added for this — without it, asking a two-leg
 * movement for its legs is a scan of every transaction the household owns.
 */
export async function legsOf(db, movementId) {
  if (!movementId) return [];
  return db.repo('transaction').list({
    index: 'byMovement',
    range: { only: movementId },
    limit: Infinity,
  });
}

/**
 * The amount the rows say, beside the amount the record says.
 *
 * Each leg carries the full amount of its own side, so the movement is the
 * larger side and **not** the sum — summing them reports a ₹50,000 transfer as
 * ₹1,00,000. Fees are excluded: a ₹50 charge is money that left and did not
 * arrive, and folding it in would overstate what moved.
 *
 * Returns `null` where no leg says which way it went, because a movement whose
 * rows carry no direction has an amount this cannot compute — and zero is a
 * claim, where null is a gap.
 */
export function amountFromLegs(legs) {
  const directed = (legs ?? []).filter((leg) => leg.direction === 'in' || leg.direction === 'out');
  if (!directed.length) return null;

  const side = (which) => directed
    .filter((leg) => leg.direction === which)
    .reduce((total, leg) => total + addable(leg.amount), 0);

  return Math.max(side('out'), side('in'));
}

/**
 * Everything this application can say about where a movement came from.
 *
 * @param {object} db
 * @param {string} id an `economicEvent` id
 */
export async function explainEvent(db, id) {
  const event = await db.repo('economicEvent').get(id).catch(() => null);
  if (!event) return null;

  const rows = await legsOf(db, id);
  const legs = rows.filter((row) => row.movementRole !== 'fee');
  const fees = rows.filter((row) => row.movementRole === 'fee');

  const chains = [];
  for (const leg of legs) {
    const lineage = await lineageOf(db, 'transaction', leg.id);
    chains.push({
      transaction: leg.id,
      account: leg.account ?? null,
      direction: leg.direction ?? null,
      amount: leg.amount ?? null,
      origin: lineage.origin,
      hops: depth(lineage),
      story: describeLineage(lineage),
      source: provenanceOf('transaction', leg).source,
    });
  }

  const fromLegs = amountFromLegs(legs);
  const problems = [];

  // A movement with no rows behind it is the worst case here and the easiest
  // to miss: the record looks complete on a list screen.
  if (!legs.length) {
    problems.push('no account rows are recorded as legs of this movement, so '
      + 'there is nothing behind the figure');
  } else if (fromLegs === null) {
    problems.push('none of its rows says which way the money went, so the '
      + 'amount cannot be checked against them');
  } else if (fromLegs !== event.amount) {
    problems.push(`the rows now add up to a different figure from the one `
      + `recorded on this movement — nothing here changes either`);
  }

  if (legs.length === 1) {
    problems.push('only one row is recorded as a leg, and a movement is money '
      + 'leaving one place and arriving in another');
  }

  const documented = chains.filter((chain) => chain.source !== SOURCES.MANUAL);

  return {
    event,
    why: event.why || null,
    legs,
    fees,
    chains,
    amount: {
      recorded: event.amount ?? null,
      fromLegs,
      // Never `true` when it could not be computed. An unanswered question is
      // not an agreement.
      agrees: fromLegs === null ? null : fromLegs === event.amount,
    },
    // Counted apart, deliberately: a typed leg is explainable to a person and
    // not to a document, and adding the two would overstate the evidence.
    documented: documented.length,
    handTyped: chains.length - documented.length,
    // Every leg was parsed from something outside this application.
    //
    // Named for exactly that and no more. It was first called `complete`, and
    // `complete` is the kind of word a screen turns into a tick — over a
    // movement half of which somebody typed from memory. It also folded in
    // "has more than one leg", which is a different fault with a different
    // fix, and is reported on its own below.
    fullyDocumented: legs.length > 0 && chains.every((chain) => chain.hops > 1),
    problems,
  };
}

/**
 * How much of a household's ledger of movements can be explained at all.
 *
 * The count is the point, the way `coverage` is the point of `provenance.js`:
 * *"every financial event is explainable"* is not a property you have until
 * you can name the ones that are not.
 *
 * ## Two ways this used to fail to name them
 *
 * **`total` was the size of the sample.** It read `events.length` after a
 * `list({ limit })` capped at 500, so a household with nine hundred movements
 * was told about five hundred and the sentence on the screen said
 * "movements" — not "the five hundred most recent". Measured with seven
 * events and a limit of three, the screen said **"0 of 3 movements"**. `total`
 * is now the repository's own count and `examined` is what was walked, so the
 * screen can say which it is talking about.
 *
 * **An event that could not be read vanished.** `explainEvent` returns null
 * when the row cannot be fetched — a decryption failure, a corrupt record —
 * and this loop did `continue`, so the three categories no longer added up to
 * the total beside them while still reading as exhaustive. Measured with two
 * of five unreadable: the buckets summed to three under a stated total of
 * five.
 *
 * So the counts now satisfy an identity, and a test holds it:
 *
 *     documented + partlyTyped + unexplained + unreadable === examined
 *
 * That is the right shape for this file. A ledger whose parts do not add up to
 * its whole is the thing it exists to report, and it was true of its own
 * arithmetic.
 */
export async function explainability(db, { limit = 500 } = {}) {
  const events = await db.repo('economicEvent').list({ limit });

  // The household's real number, not the sample's. `count` walks the store
  // without decrypting, which is why asking is cheap enough to always do.
  const total = await db.repo('economicEvent').count().catch(() => events.length);

  const out = {
    total,
    // How many were actually walked. Equal to `total` unless the limit bit.
    examined: events.length,
    // Walked and not readable. Never folded into `unexplained`: "nothing is
    // recorded behind this movement" and "this movement could not be read" are
    // different sentences, and only one of them is about the household's
    // bookkeeping.
    unreadable: 0,
    // Every leg parsed from a statement, an email or a document.
    documented: 0,
    // At least one leg somebody typed. A real provenance, a weaker one, and
    // never added to the line above.
    partlyTyped: 0,
    // No rows at all behind the figure.
    unexplained: 0,
    // The rows and the recorded figure no longer agree. Counted separately
    // from the three above, because a movement can be fully documented *and*
    // disagree — that is the most interesting row on the report.
    disagreeing: 0,
    problems: [],
  };

  for (const event of events) {
    const explanation = await explainEvent(db, event.id);
    if (!explanation) { out.unreadable += 1; continue; }

    if (explanation.amount.agrees === false) out.disagreeing += 1;
    if (!explanation.legs.length) out.unexplained += 1;
    else if (explanation.fullyDocumented) out.documented += 1;
    else out.partlyTyped += 1;

    for (const problem of explanation.problems) {
      out.problems.push({ event: event.id, title: event.title || event.kind, problem });
    }
  }

  return out;
}

/**
 * The household's explainability, in words.
 *
 * Here rather than in the screen for the same reason `describeExplanation` is:
 * these sentences are the answer to rule 57, and an answer that can only be
 * checked by opening a browser is not being checked.
 *
 * Returns two strings. The second is null unless something could not be read —
 * kept apart from the first because it is not a fourth category of
 * bookkeeping, it is a statement about this device.
 *
 * @param {{total: number, examined: number, documented: number,
 *          partlyTyped: number, unexplained: number, unreadable: number}} review
 * @returns {{counts: string, unreadable: string|null}}
 */
export function describeExplainability(review) {
  // "of N movements" used to be the sample size while saying "movements". A
  // household with nine hundred was told about five hundred.
  const scope = review.examined < review.total
    ? t('explain.scopeCapped', { examined: review.examined, total: review.total })
    : t('explain.scopeAll', { total: review.total });

  return {
    counts: t('explain.counts', {
      scope,
      documented: review.documented,
      partlyTyped: review.partlyTyped,
      unexplained: review.unexplained,
    }),
    unreadable: review.unreadable
      ? t('explain.unreadable', { n: review.unreadable })
      : null,
  };
}

/** A movement's story, for a screen. Never a claim that anybody checked it. */
export function describeExplanation(explanation) {
  if (!explanation) return null;

  const { legs, chains, amount, why, problems } = explanation;

  if (!legs.length) {
    return 'Nothing is recorded as a leg of this movement, so there is nothing '
      + 'behind the figure on it.';
  }

  const origins = [...new Set(chains.map((chain) => chain.origin.label))];
  const sentences = [
    `Made of ${legs.length} account ${legs.length === 1 ? 'row' : 'rows'}, `
      + `from ${origins.join(' and ')}.`,
  ];

  if (why) sentences.push(`It was treated as one movement because ${why}.`);

  if (amount.agrees === false) {
    sentences.push('The rows no longer add up to the figure recorded here. '
      + 'Both are shown and nothing changes either.');
  }

  for (const problem of problems) {
    if (!problem.startsWith('the rows now add up')) sentences.push(`Note: ${problem}.`);
  }

  sentences.push('None of this was checked by a person.');
  return sentences.join(' ');
}
