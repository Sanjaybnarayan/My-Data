/**
 * A payment-app statement, which is not an account statement.
 *
 * A PhonePe export lists what somebody did across **every** bank account the
 * app is linked to. A bank statement lists what happened on one. They are two
 * records of the same movements, so importing both without linking them
 * doubles the household's spending — the hazard `domain/settlement.js` names
 * for a card bill, here across a thousand rows at once.
 *
 * Measured on a real export: 1,047 rows spanning four accounts, every one of
 * which the household also has a bank statement for.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  readInstrument, kindOf, counterpartyOf, isPaymentApp, byInstrument,
  alreadyOnRecord, referencesIn, describeImport,
  matchInstruments, splitByAccount, describeSplit, transferTarget, resolveTransfers,
} from '../js/domain/paymentapp.js';
import { parseTable, readDate } from '../js/domain/tabular.js';

setSuite('payment app');

/** The shape PhonePe exports, preamble and all. */
const STATEMENT = `Transaction Statement for 8861975785
Duration,"01 Apr, 2026 - 15 Aug, 2026"

Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount
"Aug 15, 2026","01:10 am","Paid to Google Asia Pacific Pte.Ltd","T260815011023","618037311994","DEBIT","Paid by XXXXXXXXXX84","69"
"Aug 14, 2026","09:11 pm","Received from ROOPESH K ","T260814211103","659278215400","CREDIT","Credited to XXXXXXXXXX84","680"
"Aug 14, 2026","07:23 pm","Transfer to XXXXXXXXXX84","T260814192351","131295827881","DEBIT","Paid by XXXX005391","56000"
"Aug 13, 2026","09:10 pm","Paid to ZOMATO LIMITED","T260813211035","876987316943","DEBIT","Paid by XXXXXXXX8177","30"
"Aug 11, 2026","05:58 pm","Mobile recharged 6362827026","NX2608111758","539786775081","DEBIT","Paid by XXXXXXXX8177","303"
"Aug 05, 2026","10:00 am","Loan Installment","T260805100000","111111111111","DEBIT","Paid by XXXXXXXX8177","4500"
"Aug 04, 2026","10:00 am","Electricity bill","T260804100000","222222222222","DEBIT","Paid by XXXXXXXX8963","1240"
`;

describe('the file parses at all', () => {
  test('a month-first date is read, which used to skip every row', () => {
    // `readDate` knew ISO, `15-Aug-2026` and `15/08/2026`. PhonePe writes
    // `Aug 15, 2026`, so all 1,047 rows were dropped for having no date.
    assert.equal(readDate('Aug 15, 2026'), '2026-08-15');
    assert.equal(readDate('Apr 1, 26'), '2026-04-01');
  });

  test('the preamble above the heading row is skipped', () => {
    assert.length(parseTable(STATEMENT).transactions, 7);
  });

  test('an amount with no decimals is still an amount', () => {
    const [first] = parseTable(STATEMENT).transactions;
    assert.equal(first.amount, 69_00);
  });

  test('direction comes from the type column, not from a column position', () => {
    const [paid, received] = parseTable(STATEMENT).transactions;
    assert.equal(paid.direction, 'out');
    assert.equal(received.direction, 'in');
  });

  test('the UTR is kept apart from the app’s own transaction id', () => {
    // The UTR is the only thing the bank also writes down. Taking the app's
    // id instead would leave nothing to match on.
    const [first] = parseTable(STATEMENT).transactions;
    assert.equal(first.utr, '618037311994');
    assert.equal(first.reference, 'T260815011023');
  });

  test('and the instrument column is not mistaken for a deposit amount', () => {
    // `Credit/debit instrument` begins with the word "Credit", so the deposit
    // pattern claimed it — a money column holding the text "Paid by XXXX8177".
    const [first] = parseTable(STATEMENT).transactions;
    assert.equal(first.instrument, 'Paid by XXXXXXXXXX84');
  });
});

describe('which account each row moved on', () => {
  test('a masked instrument gives its digits and its direction', () => {
    assert.deep(readInstrument('Paid by XXXXXXXX8177'),
      { masked: 'XXXXXXXX8177', digits: '8177', direction: 'out' });
    assert.deep(readInstrument('Credited to XXXXXXXXXX84'),
      { masked: 'XXXXXXXXXX84', digits: '84', direction: 'in' });
  });

  test('anything else is not an instrument', () => {
    assert.equal(readInstrument('ZOMATO LIMITED'), null);
    assert.equal(readInstrument(''), null);
    assert.equal(readInstrument(null), null);
  });

  test('the statement is recognised as spanning several accounts', () => {
    const parsed = parseTable(STATEMENT);
    assert.ok(isPaymentApp(parsed));

    const accounts = byInstrument(parsed.transactions);
    assert.length(accounts, 4);
    // Busiest first, so the screen names the one that matters most.
    assert.equal(accounts[0].digits, '8177');
    assert.equal(accounts[0].rows, 3);
  });

  test('money in and money out are kept apart per account', () => {
    const [, second] = byInstrument(parseTable(STATEMENT).transactions);
    assert.equal(second.digits, '84');
    assert.equal(second.out, 69_00);
    assert.equal(second.in, 680_00);
  });

  test('an ordinary bank export spans no instruments at all', () => {
    // A bank statement is one account's, and has no such column. Treating it
    // as a payment app would be the same error in the other direction.
    const bank = 'Date,Description,Withdrawal,Deposit,Balance\n'
      + '01/04/2025,UPI/ZOMATO,500.00,,9500.00\n';
    assert.not(isPaymentApp(parseTable(bank)));
    assert.length(byInstrument(parseTable(bank).transactions), 0);
  });
});

describe('what the app knows that the bank does not', () => {
  test('a loan instalment says so', () => {
    // The bank writes a debit. The app says what it was for.
    assert.equal(kindOf('Loan Installment'), 'loan-repayment');
    assert.equal(kindOf('Electricity bill'), 'electricity');
    assert.equal(kindOf('FASTag Recharge'), 'fastag');
    assert.equal(kindOf('Mobile recharged 6362827026'), 'recharge');
    assert.equal(kindOf('Cylinder Booking'), 'gas');
  });

  test('a transfer between the household’s own accounts is not spending', () => {
    assert.equal(kindOf('Transfer to XXXXXXXXXX84'), 'self-transfer');
    assert.equal(kindOf('Withdrawn from wallet'), 'self-transfer');
  });

  test('and an ordinary payment is a payment', () => {
    assert.equal(kindOf('Paid to ZOMATO LIMITED'), 'paid');
    assert.equal(kindOf('Received from ROOPESH K'), 'received');
    assert.equal(kindOf('Something unfamiliar'), 'other');
  });

  test('the app’s own verb is taken out of the counterparty', () => {
    // "Paid to" is the app talking, not the merchant's name, and leaving it in
    // puts it in front of every categorisation rule and every payee.
    assert.equal(counterpartyOf('Paid to ZOMATO LIMITED'), 'ZOMATO LIMITED');
    assert.equal(counterpartyOf('Received from ROOPESH K '), 'ROOPESH K');
    assert.equal(counterpartyOf('Mobile recharged 6362827026'), '6362827026');
  });
});

describe('the same movement, seen from the other side', () => {
  // The link is exact: the UTR the app prints appears verbatim inside the
  // bank's own narration. No amount tolerance, no date window, no name match.
  const bank = [
    { date: '2026-08-13', amount: 30_00, direction: 'out', raw: 'UPI/ZOMATO LIM/zomato-order@p/Zomato Pay/YES BANK L/876987316943' },
    { date: '2026-08-14', amount: 56_000_00, direction: 'out', raw: 'UPI/SANJAY B N/8861975785-3@a/Payment fr/AXIS BA/131295827881' },
  ];

  test('a reference the bank wrote into its narration is found', () => {
    const refs = referencesIn(bank);
    assert.ok(refs.has('876987316943'));
    assert.ok(refs.has('131295827881'));
  });

  test('rows already imported from a bank are not counted twice', () => {
    const { seen, fresh } = alreadyOnRecord(parseTable(STATEMENT).transactions, referencesIn(bank));

    assert.length(seen, 2);
    assert.length(fresh, 5);
    assert.ok(seen.every((row) => ['876987316943', '131295827881'].includes(row.utr)));
  });

  test('a row with no UTR is imported rather than assumed to be a duplicate', () => {
    // A missing field is not evidence. Refusing it would lose a real payment.
    const { seen, fresh } = alreadyOnRecord(
      [{ utr: null, amount: 100 }, { utr: '', amount: 200 }], referencesIn(bank),
    );
    assert.length(seen, 0);
    assert.length(fresh, 2);
  });

  test('nothing on record means everything is new', () => {
    const { seen, fresh } = alreadyOnRecord(parseTable(STATEMENT).transactions, new Set());
    assert.length(seen, 0);
    assert.length(fresh, 7);
  });

  test('and an amount that merely matches is not a duplicate', () => {
    // ₹30 to Zomato twice in a week is two payments. Only the reference says
    // they are one, and this must never fall back to amount-and-date.
    const other = [{ date: '2026-08-13', amount: 30_00, direction: 'out', raw: 'UPI/ZOMATO/999999999999' }];
    const { seen } = alreadyOnRecord(parseTable(STATEMENT).transactions, referencesIn(other));
    assert.length(seen, 0);
  });
});

describe('what the screen is told', () => {
  test('it says this is a payment app’s record and names the accounts', () => {
    const accounts = byInstrument(parseTable(STATEMENT).transactions);
    const said = describeImport({ accounts, seen: 2, fresh: 5 }, (n) => `Rs${n}`);

    assert.includes(said, 'not an account');
    assert.includes(said, '4 accounts');
    assert.includes(said, 'already imported from a bank statement');
    assert.includes(said, 'rather than counted twice');
  });

  test('and warns when none of them is on record yet', () => {
    // The dangerous case: import this first, the bank statements later, and
    // every payment arrives a second time.
    const accounts = byInstrument(parseTable(STATEMENT).transactions);
    const said = describeImport({ accounts, seen: 0, fresh: 7 }, (n) => `Rs${n}`);

    assert.includes(said, 'will arrive again from the other side');
  });

  test('nothing at all says nothing', () => {
    assert.equal(describeImport({ accounts: [] }), null);
  });
});

describe('one file, several accounts', () => {
  const ACCOUNTS = [
    { id: 'a1', name: 'Kotak Savings', accountNumber: '5612488963', deletedAt: null },
    { id: 'a2', name: 'ICICI Savings', accountNumber: '008401532684', deletedAt: null },
    { id: 'a3', name: 'HDFC Savings', accountNumber: '50100128177', deletedAt: null },
  ];

  const spans = () => byInstrument(parseTable(STATEMENT).transactions);

  test('an instrument is matched by the digits its mask leaves', () => {
    // `XXXXXXXX8177` says the account ends 8177 and nothing else. A payment
    // app prints no IFSC, no holder and no bank, so there is nothing to score.
    const matched = matchInstruments(spans(), ACCOUNTS);
    const byDigits = Object.fromEntries(matched.map((m) => [m.digits, m.account?.id ?? null]));

    assert.equal(byDigits['8177'], 'a3');
    assert.equal(byDigits['8963'], 'a1');
  });

  test('a mask leaving fewer than four digits is refused, not guessed', () => {
    // `XXXXXXXXXX84` leaves two. Two digits match one account in a hundred by
    // chance, and filing a household's spending that way is worse than not
    // filing it.
    const short = matchInstruments(spans(), ACCOUNTS).find((m) => m.digits === '84');

    assert.equal(short.account, null);
    assert.includes(short.why, 'not enough to tell');
  });

  test('two accounts ending the same way are refused too', () => {
    const ambiguous = [
      { id: 'a1', name: 'One', accountNumber: '11118177', deletedAt: null },
      { id: 'a2', name: 'Two', accountNumber: '99998177', deletedAt: null },
    ];
    const matched = matchInstruments(spans(), ambiguous).find((m) => m.digits === '8177');

    assert.equal(matched.account, null);
    assert.includes(matched.why, '2 accounts on record end in 8177');
  });

  test('the digits have to be the end of the number, not merely inside it', () => {
    // `50100081779999` contains 8177 and does not end with it, so it is a
    // different account. Matching anywhere would file this household's
    // spending onto whichever account happened to contain the digits.
    const middle = [{ id: 'a9', name: 'Not this one', accountNumber: '50100081779999', deletedAt: null }];
    const matched = matchInstruments(spans(), middle).find((m) => m.digits === '8177');

    assert.equal(matched.account, null);
    assert.includes(matched.why, 'no account on record ends in 8177');
  });

  test('an account nobody has on record says exactly that', () => {
    const matched = matchInstruments(spans(), []).find((m) => m.digits === '8177');
    assert.equal(matched.account, null);
    assert.includes(matched.why, 'no account on record ends in 8177');
  });

  test('a deleted account does not match', () => {
    const gone = [{ id: 'a1', name: 'Gone', accountNumber: '50100128177', deletedAt: '2026-01-01T00:00:00.000Z' }];
    assert.equal(matchInstruments(spans(), gone).find((m) => m.digits === '8177').account, null);
  });

  test('the rows are split by the account they moved on', () => {
    const parsed = parseTable(STATEMENT);
    const groups = splitByAccount(parsed.transactions, matchInstruments(spans(), ACCOUNTS));

    const filed = groups.filter((g) => g.account);
    const unfiled = groups.filter((g) => !g.account);

    // 8177 and 8963 match; 84 is too short and 005391 is on no record.
    assert.length(filed, 2);
    assert.length(unfiled, 2);
    assert.equal(filed.reduce((n, g) => n + g.rows.length, 0), 4);
  });

  test('every row lands in exactly one group', () => {
    const parsed = parseTable(STATEMENT);
    const groups = splitByAccount(parsed.transactions, matchInstruments(spans(), ACCOUNTS));
    const total = groups.reduce((n, g) => n + g.rows.length, 0);

    assert.equal(total, parsed.transactions.length);
  });

  test('the sentence names where the rows go and what will not be filed', () => {
    const parsed = parseTable(STATEMENT);
    const groups = splitByAccount(parsed.transactions, matchInstruments(spans(), ACCOUNTS));
    const said = describeSplit(groups);

    assert.includes(said, 'HDFC Savings');
    assert.includes(said, 'cannot be imported');
    assert.includes(said, 'not enough to tell');
  });

  test('nothing to split says nothing', () => {
    assert.equal(describeSplit([]), null);
  });
});

describe('a self-transfer names both of its ends', () => {
  const ACCOUNTS = [
    { id: 'a1', name: 'Kotak Savings', accountNumber: '5612488963', deletedAt: null },
    { id: 'a3', name: 'HDFC Savings', accountNumber: '50100128177', deletedAt: null },
  ];

  test('the destination is read off the row', () => {
    // `Transfer to XXXXXXXX8177`, paid by something else, is the app stating
    // both ends of one movement. `domain/events.js` pairs two bank legs by
    // amount and date and calls that *probable*, because a bank statement
    // names only its own side. This record names both.
    assert.equal(transferTarget('Transfer to XXXXXXXX8177'), 'XXXXXXXX8177');
    assert.equal(transferTarget('Paid to ZOMATO LIMITED'), null);
  });

  test('a destination that is a name is not an account', () => {
    // A redemption from a mutual fund. Calling it an internal transfer would
    // move money into an account that does not exist and take a real
    // investment sale out of the picture.
    assert.equal(transferTarget('Withdrawn from Bandhan ELSS Tax saver Fund'), null);
    assert.equal(transferTarget('Transfer to ROOPESH K'), null);
  });

  test('a resolved transfer becomes movement, not spending', () => {
    const rows = [{
      description: 'Transfer to XXXXXXXX8177', direction: 'out',
      amount: 56_000_00, account: 'a1', kind: 'expense',
    }];

    const { rows: out, linked, unresolved } = resolveTransfers(rows, ACCOUNTS);

    assert.equal(linked, 1);
    assert.equal(unresolved, 0);
    // The shape `domain/finance.js` already reads and `linkFor` already
    // writes — the outgoing leg carrying where it went.
    assert.equal(out[0].toAccount, 'a3');
    assert.equal(out[0].kind, 'transfer');
    assert.equal(out[0].category, 'own account');
  });

  test('a destination the app masks too heavily is left as money out', () => {
    // `XXXXXXXXXX84` leaves two digits. There IS an account ending 84 here on
    // purpose — otherwise the refusal would pass for want of a candidate
    // rather than because two digits is too few, and dropping the length
    // guard would change nothing. Found by mutation.
    const withEightyFour = [...ACCOUNTS,
      { id: 'a2', name: 'ICICI Savings', accountNumber: '008401532684', deletedAt: null }];
    const rows = [{ description: 'Transfer to XXXXXXXXXX84', direction: 'out', amount: 56_000_00, account: 'a1' }];
    const { rows: out, linked, unresolved } = resolveTransfers(rows, withEightyFour);

    assert.equal(linked, 0);
    assert.equal(unresolved, 1);
    assert.equal(out[0].toAccount, undefined);
  });

  test('two accounts ending the same way leave it unresolved', () => {
    const ambiguous = [
      { id: 'x1', name: 'One', accountNumber: '11118177', deletedAt: null },
      { id: 'x2', name: 'Two', accountNumber: '99998177', deletedAt: null },
    ];
    const rows = [{ description: 'Transfer to XXXXXXXX8177', direction: 'out', amount: 100, account: 'a1' }];
    const { rows: out, linked, unresolved } = resolveTransfers(rows, ambiguous);

    assert.equal(linked, 0);
    assert.equal(unresolved, 1);
    assert.equal(out[0].toAccount, undefined);
  });

  test('an account cannot transfer to itself', () => {
    // A row saying so is a misread mask, not a movement, and setting
    // `toAccount` to the source would credit and debit one balance.
    const rows = [{ description: 'Transfer to XXXXXXXX8177', direction: 'out', amount: 100, account: 'a3' }];
    const { linked, unresolved } = resolveTransfers(rows, ACCOUNTS);

    assert.equal(linked, 0);
    assert.equal(unresolved, 1);
  });

  test('no account on record means it stays a payment', () => {
    const rows = [{ description: 'Transfer to XXXXXXXX8177', direction: 'out', amount: 100, account: 'a1' }];
    assert.equal(resolveTransfers(rows, []).linked, 0);
  });

  test('an ordinary payment is untouched', () => {
    const rows = [{ description: 'Paid to ZOMATO LIMITED', direction: 'out', amount: 30_00, account: 'a1' }];
    const { rows: out, linked } = resolveTransfers(rows, ACCOUNTS);

    assert.equal(linked, 0);
    assert.equal(out[0].toAccount, undefined);
    assert.equal(out[0], rows[0], 'the row is returned as it came in');
  });

  test('the sentence says what was joined and what was not', () => {
    const said = describeImport({
      accounts: byInstrument(parseTable(STATEMENT).transactions),
      seen: 0, fresh: 7, linked: 12, unresolvedTransfers: 23,
    }, (n) => String(n));

    assert.includes(said, '12 are transfers between the household’s own accounts');
    assert.includes(said, 'counted as movement rather than spending');
    assert.includes(said, '23 more say they went to another account the app masks too heavily');
  });
});
