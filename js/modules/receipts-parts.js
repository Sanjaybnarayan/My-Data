/**
 * The parts of the receipts screen that depend on nothing.
 *
 * Split out because `tools/module-size.mjs` refused to let `receipts.js` grow,
 * and it is right to: at 1,008 lines that file is a `render()` with twenty-six
 * closures inside it, and the answer that tool asks for is to move code out
 * rather than raise the number.
 *
 * These three were the honest candidates — pure functions of their arguments,
 * closing over none of `render`'s state, and the only things in the file that
 * could leave without being rewritten. What is left behind still needs
 * breaking up; this is the room to make one fix, not the refactor.
 */

import { h } from '../ui/dom.js';
import { card, cardHeader, restOfList } from '../ui/components/basics.js';
import { today, addDays, addMonths } from '../core/dates.js';

export function explainer() {
  return card({ class: 'card--quiet' }, [
    cardHeader('Why there is no “Connect Zomato” button', null, { iconName: 'info' }),
    h('p', { class: 'muted' },
      'Zomato, Swiggy, Amazon, Flipkart, Blinkit and Zepto do not offer one. None of '
      + 'them publishes an API a household can sign into, so the only way an app can '
      + '“link” to them is to keep your password and drive their website as if it were '
      + 'you. This application will not hold those passwords.'),
    h('p', { class: 'muted' },
      'What every one of them does do is email a receipt for every order. That mail is '
      + 'already yours, it covers shops nobody built an integration for, and reading it '
      + 'needs one connection instead of twenty.'),
    h('p', { class: 'small faint' },
      'Gmail has no per-sender permission — reading mail means a scope that can read all '
      + 'of it. So the limit is the query, printed below before it runs, and the fact '
      + 'that nothing but the merchant, date, total and order number is kept. The message '
      + 'itself stays in Gmail.'),
  ]);
}

/* ----------------------------------------------------------------- helpers */

/** Where to start looking: after the newest receipt, or three months back. */
export function defaultSince(receipts) {
  const latest = latestDate(receipts);
  return latest ? addDays(latest, -1) : addMonths(today(), -3);
}

export function latestDate(receipts) {
  return receipts.reduce((newest, receipt) => (
    receipt.date && (!newest || receipt.date > newest) ? receipt.date : newest
  ), '');
}

/*
 * How many matched pairs the reconciliation card draws.
 *
 * The card's own subtitle reads "31 of 40 receipts found the payment that
 * settled them" and then listed twelve of them — the total stated in a
 * sentence directly above a list that stopped at a third of it, and the
 * worst instance of that fault in the application. No link: this card is the
 * reconciliation view, and there is no fuller one to send anybody to.
 */
export const MATCHED = 12;

/** What the reconciliation card is not showing. */
export function restOfMatched(total) {
  return restOfList(total, MATCHED);
}
