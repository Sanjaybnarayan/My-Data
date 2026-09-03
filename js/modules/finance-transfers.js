/**
 * The transfers card, on the finance overview.
 *
 * Its own file because `js/modules/finance.js` sits against the 800-line cap
 * the module-size ratchet holds it to, and this is the one card there that
 * neither reads the overview's view model nor is read by anything else in it —
 * it takes a repaint callback and returns a node.
 */

import { h } from '../ui/dom.js';
import { card, cardHeader, badge, button, listItem } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { userMessage } from '../core/errors.js';
import { format } from '../core/money.js';
import { formatDay } from '../core/dates.js';
import { CONFIDENCE } from '../domain/events.js';
import { TransfersService } from '../services/transfers.js';
import { t } from '../core/locale.js';

/**
 * The two ends of one movement, offered for joining up.
 *
 * Hidden entirely when there is nothing to join, because a card that is empty
 * most months teaches somebody to stop looking at it.
 *
 * The two confidences are rendered differently on purpose. A probable pairing
 * gets a button; a possible one gets a sentence saying why nobody can tell,
 * and no button at all. Offering a confirm control for an uncertain pairing
 * would move the deciding from the person to the click.
 */
export function transfersCard(db, transfers, repaint) {
  const { proposals, total, unmatched, sets = [], setsTotal, undecided = [] } = transfers;
  if (!proposals.length && !unmatched.length && !sets.length && !undecided.length) return null;

  const probable = proposals.filter((p) => p.confidence === CONFIDENCE.PROBABLE);
  const questions = proposals.filter((p) => p.confidence === CONFIDENCE.POSSIBLE);

  async function acceptFee(proposal) {
    try {
      await new TransfersService(db).confirmWithFee(proposal);
      toast(t('finance.transfers.confirmedFee'), { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  async function confirmSet(set) {
    try {
      await new TransfersService(db).confirmSet(set);
      toast(t('finance.transfers.confirmedSet'), { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  async function confirm(proposal) {
    try {
      await new TransfersService(db).confirm(proposal);
      toast(t('finance.transfers.confirmedPair'), { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  const line = (p) => listItem({
    title: t('finance.transfers.pair', { from: p.fromName, to: p.toName }),
    subtitle: t('finance.transfers.line', { day: formatDay(p.out.date), why: p.why }),
    value: format(p.amount),
    leading: badge(p.confidence, p.confidence === CONFIDENCE.PROBABLE ? 'info' : 'warning'),
    trailing: p.confidence === CONFIDENCE.PROBABLE
      ? button(t('finance.transfers.one'), { variant: 'subtle', onClick: () => confirm(p) })
      // A near-match with exactly one charge accounting for it can now be
      // accepted by a person. The engine still will not: unequal amounts never
      // match *automatically*, which is not the same as never.
      : p.evidence?.length === 1 && !p.ambiguous
        ? button(t('finance.transfers.acceptFee'), { variant: 'subtle', onClick: () => acceptFee(p) })
        : null,
  });

  return card({}, [
    cardHeader(t('finance.transfers.title'), [], {
      subtitle: total.movements
        ? t('finance.transfers.moved', { amount: format(total.moved), n: total.movements })
        : t('finance.transfers.none'),
      iconName: 'refresh',
    }),

    // The sentence the per-account figures cannot say. Each of them carries
    // the full amount — right for one account, and twice for one movement.
    h('p', { class: 'small muted' }, t('finance.transfers.why')),

    probable.length ? h('div', { class: 'list' }, probable.map(line)) : null,

    questions.length
      ? h('details', { class: 'small' }, [
        h('summary', {}, t('finance.transfers.undecidedSummary', { n: questions.length })),
        h('div', { class: 'list' }, questions.map(line)),
      ])
      : null,

    // A movement that landed in more than one piece. Measured: ₹50,000 out of
    // one account arriving as ₹30,000 and ₹20,000 in two others produced no
    // proposal at all, so all three rows sat under the "no partner" line below
    // with nothing to say they add up to something.
    sets.length
      ? h('div', {}, [
        h('p', { class: 'small muted' }, t('finance.transfers.splitWhy')),
        h('div', { class: 'list' }, sets.map((set) => listItem({
          title: set.shape === 'split'
            ? t('finance.transfers.pair', { from: set.anchorName, to: set.legNames.join(', ') })
            : t('finance.transfers.pair', { from: set.legNames.join(', '), to: set.anchorName }),
          subtitle: t('finance.transfers.line', { day: formatDay(set.anchor.date), why: set.why }),
          value: format(set.amount),
          leading: badge(set.confidence,
            set.confidence === CONFIDENCE.PROBABLE ? 'info' : 'warning'),
          // There is now something a confirmation can write: a shared id on
          // every leg. `linkFor` could not express this — `toAccount` names one
          // destination and a split has several — which is why this row used to
          // carry no control at all.
          trailing: set.confidence === CONFIDENCE.PROBABLE
            ? button(t('finance.transfers.one'), { variant: 'subtle', onClick: () => confirmSet(set) })
            : null,
        }))),
        setsTotal?.movements
          ? h('p', { class: 'small faint' }, t('finance.transfers.setsMoved', {
            amount: format(setsTotal.moved), n: setsTotal.movements,
          }))
          : null,
      ].filter(Boolean))
      : null,

    // Where the search stopped rather than guessed. Saying nothing here would
    // read as "there is nothing", which is a different claim.
    undecided.length
      ? h('p', { class: 'small faint' },
        t('finance.transfers.tooMany', { n: undecided.length, why: undecided[0].why }))
      : null,

    unmatched.length
      ? h('p', { class: 'small faint' },
        t('finance.transfers.noPartner', { n: unmatched.length }))
      : null,
  ].filter(Boolean));
}