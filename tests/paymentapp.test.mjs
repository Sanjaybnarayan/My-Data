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
