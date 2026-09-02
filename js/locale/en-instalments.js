/**
 * English, for recurring-deposit instalments.
 *
 * A separate file for the same reason as `en-settings-data.js`: `en.js` is the
 * catalogue, this is a block that changes with one idea, and the module-size
 * ratchet holds `en.js` under 800 lines. Adding the three missed-instalment
 * sentences to `en.js` put it at 804, which is a new file joining the crowded
 * list — the one thing that ratchet refuses outright.
 */

export const instalmentStrings = {
  // What the portfolio can say about an RD instalment against the ledger.
  // `ambiguous` is deliberately not phrased as a problem to fix: instalments
  // are the same amount every month, so two debits a day apart are genuinely
  // indistinguishable and naming both is the honest answer.
  // A schedule that is missing months, and one nobody recorded. The second is
  // deliberately not phrased as a fault of the household: an unrecorded
  // schedule is a question this application cannot answer, not a late payment.
  'instalments.missed': '{n} instalment(s) the schedule expects have no payment recorded against them.',
  'instalments.missedFirst': 'The earliest is {day}.',
  'instalments.unscheduled': '{n} deposit(s) record no instalment amount or start date, so whether a payment is missing cannot be said either way.',
  'instalments.title': 'Recurring deposit instalments',
  'instalments.subtitle': '{matched} of {total} match a row in the ledger',
  'instalments.unmatched': '{n} instalment(s) have no bank row in the ledger for the same '
    + 'amount within a day. Either the payment is not imported yet, or it did not leave the '
    + 'account.',
  'instalments.ambiguous': '{n} could be more than one row. Instalments are the same amount '
    + 'every month, so nothing here can tell two debits a day apart apart — both are kept and '
    + 'neither is chosen.',
};
