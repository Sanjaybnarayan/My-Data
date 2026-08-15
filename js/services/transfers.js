/**
 * Movements between the household's own accounts, from both ends.
 *
 * `domain/events.js` holds the rules and knows nothing about a database. This
 * fetches, names the accounts so a proposal reads as *HDFC → ICICI* rather than
 * as two ids, and applies a confirmation.
 *
 * The applying is the part worth reading. It is one line of patch, and it is
 * deliberately only ever a patch: both statement rows survive, because each is
 * a bank's own record of one side with its own narration, reference and running
 * balance. Tidying the total by deleting a row destroys the evidence for it.
 */

import { Service } from './service.js';
import { format } from '../core/money.js';
import {
  proposeTransfers, movementTotal, linkFor, CONFIDENCE,
  proposeMultiLeg, multiLegTotal,
} from '../domain/events.js';

export class TransfersService extends Service {
  /**
   * Every unjoined pair, most confident first, with the accounts named.
   *
   * @param {{windowDays?: number}} [options]
   */
  async pending({ windowDays = 3 } = {}) {
    const { transactions, accounts } = await this.load({
      transactions: ['transaction', { decrypt: false, limit: 20_000 }],
      accounts: ['account', { decrypt: false }],
    });

    const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
    // The rupee sign and the grouping. Without it the near-match sentence
    // prints minor units, and "differ by 5000" for a ₹50 fee is a hundredfold
    // overstatement in the sentence somebody decides from.
    const { proposals, unmatched } = proposeTransfers(transactions, { windowDays, money: format });

    const named = proposals.map((p) => ({
      ...p,
      fromName: nameOf.get(p.out.account) ?? 'an account that is no longer here',
      toName: nameOf.get(p.in.account) ?? 'an account that is no longer here',
    })).sort((a, b) => (a.confidence === b.confidence ? 0
      : a.confidence === CONFIDENCE.PROBABLE ? -1 : 1));

    // A movement that landed in more than one piece. Measured before this was
    // wired: ₹50,000 out of one account arriving as ₹30,000 and ₹20,000 in two
    // others produced no proposal at all and three loose ends — so the legs
    // below were already being reported as unmatched, with nothing to say they
    // add up to something.
    const { proposals: sets, undecided } = proposeMultiLeg(transactions, { windowDays });

    const namedSets = sets.map((set) => ({
      ...set,
      anchorName: nameOf.get(set.anchor.account) ?? 'an account that is no longer here',
      legNames: set.legs.map((l) => nameOf.get(l.account) ?? 'an account that is no longer here'),
    }));

    // The legs a set accounts for are no longer loose ends, so they are taken
    // off that list — reporting the same rows as both "part of this movement"
    // and "we cannot see where this went" would be two answers to one question.
    const inASet = new Set(namedSets
      .filter((set) => set.confidence === CONFIDENCE.PROBABLE)
      .flatMap((set) => [set.anchor.id, ...set.legs.map((l) => l.id)]));

    return {
      proposals: named,
      total: movementTotal(proposals),
      sets: namedSets,
      setsTotal: multiLegTotal(sets),
      // Where the search gave up rather than guessed, and why. Silence here
      // would read as "there is nothing", which is a different claim.
      undecided,
      // Reported rather than dropped: one side of a movement with no partner
      // usually means a statement has not been imported yet, which is a more
      // useful thing to be told than nothing.
      unmatched: unmatched.filter((leg) => !inASet.has(leg.id)).map((leg) => ({
        ...leg,
        accountName: nameOf.get(leg.account) ?? '',
      })),
    };
  }

  /**
   * Record that two rows are one movement.
   *
   * Refuses anything the engine did not call probable — an uncertain pairing
   * applied by a confirm button is still an uncertain pairing, and the button
   * would be doing the deciding rather than the person.
   */
  async confirm(proposal) {
    const link = linkFor(proposal);
    if (!link) {
      throw new Error('only a probable pairing can be confirmed — this one is a question');
    }
    return this.repo('transaction').update(link.transactionId, link.patch);
  }
}
