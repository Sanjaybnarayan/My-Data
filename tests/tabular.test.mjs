import { test, describe, assert, setSuite } from './harness.mjs';
import {
  parseDelimited, detectHeader, readAmount, readDate, parseTable, looksLikeCard,
} from '../js/domain/tabular.js';
import { planStatement } from '../js/domain/import.js';

setSuite('tabular');

/* ------------------------------------------------------------- splitting */

describe('splitting a delimited file', () => {
  test('a comma inside a quoted narration is not a new field', () => {
    // "MERCHANT, MUMBAI" is how half of them are written, and splitting on
    // commas turns one transaction into two half-transactions.
    const [row] = parseDelimited('a,"SWIGGY, BENGALURU",c');
    assert.deep(row, ['a', 'SWIGGY, BENGALURU', 'c']);
  });

  test('a doubled quote inside a quoted field is one quote', () => {
    assert.deep(parseDelimited('"He said ""hi""",2')[0], ['He said "hi"', '2']);
  });

  test('tabs and semicolons are found without being told', () => {
    assert.deep(parseDelimited('a\tb\tc')[0], ['a', 'b', 'c']);
    assert.deep(parseDelimited('a;b;c')[0], ['a', 'b', 'c']);
  });

  test('the delimiter is decided by the busiest line, not the first', () => {
    // A bank export opens with a title carrying no delimiters at all.
    const rows = parseDelimited('Statement of account\nDate\tDescription\tAmount\n01/02/2026\tX\t10');
    assert.length(rows[1], 3);
  });

  test('blank lines are dropped and a byte-order mark does not become a column', () => {
    const rows = parseDelimited('﻿Date,Amount\n\n\n01/02/2026,10\n');
    assert.length(rows, 2);
    assert.equal(rows[0][0], 'Date');
  });

  test('carriage returns do not leave an empty row between every line', () => {
    assert.length(parseDelimited('a,b\r\nc,d\r\n'), 2);
  });
});

/* --------------------------------------------------------------- headers */

describe('finding the table', () => {
  const preamble = [
    'Kotak Mahindra Bank',
    'Account Number: 1234500000',
    'Account Name: MEERA R K',
    '',
  ];

  test('the heading is found below a block of account details', () => {
    const rows = parseDelimited([...preamble,
      'Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance',
      '01/02/2026,UPI/ZOMATO/1/order,,645.00,,10000.00'].join('\n'));

    const header = detectHeader(rows);
    // Blank lines are dropped, so the heading is the fourth row that survived.
    assert.equal(header.row, 3);
    assert.equal(header.columns.withdrawal, 3);
    assert.equal(header.columns.balance, 5);
  });

  test('a file with no date-and-description heading is refused, not guessed at', () => {
    // Guessing would produce transactions out of somebody's address block.
    assert.equal(detectHeader(parseDelimited('Name,Address\nMeera,Bengaluru')), null);
  });

  test('one amount column with no direction beside it is not a table this can read', () => {
    assert.equal(detectHeader(parseDelimited('Date,Description,Amount\n01/02/2026,X,10')), null);
  });

  test('one amount column with a Dr/Cr column is', () => {
    assert.ok(detectHeader(parseDelimited('Date,Description,Amount,Dr/Cr\n01/02/2026,X,10,DR')));
  });
});

/* --------------------------------------------------------------- amounts */

describe('reading a figure a bank wrote', () => {
  test('Indian digit grouping', () => {
    assert.equal(readAmount('1,23,456.78'), 12_345_678);
  });

  test('a rupee sign, a Dr suffix and spaces are not part of the number', () => {
    assert.equal(readAmount('₹ 1,234.50 Dr'), 123_450);
  });

  test('brackets mean negative, because some exports use them instead of a minus', () => {
    assert.equal(readAmount('(500.00)'), -50_000);
    assert.equal(readAmount('-500.00'), -50_000);
  });

  test('an empty cell is nothing, not zero', () => {
    // Zero would make an empty withdrawal column look like a real ₹0 payment.
    assert.equal(readAmount(''), null);
    assert.equal(readAmount('   '), null);
    assert.equal(readAmount('-'), null);
  });
});

describe('reading a date a bank wrote', () => {
  test('day-first, because no Indian bank writes month-first', () => {
    assert.equal(readDate('01/02/2026'), '2026-02-01');
    assert.equal(readDate('01-02-26'), '2026-02-01');
  });

  test('a year-first date is not read backwards', () => {
    assert.equal(readDate('2026-02-01'), '2026-02-01');
  });

  test('a named month is read whichever way it is punctuated', () => {
    assert.equal(readDate('14 May 2026'), '2026-05-14');
    assert.equal(readDate('14-May-26'), '2026-05-14');
  });

  test('something that is not a date is not one', () => {
    assert.equal(readDate('Opening Balance'), null);
    assert.equal(readDate(''), null);
  });
});

/* ------------------------------------------------------- bank statements */

describe('a bank statement as a table', () => {
  const csv = [
    'Kotak Mahindra Bank',
    'Account No: 1234500000',
    'IFSC: KKBK0000123',
    '',
    'Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Balance',
    '01/05/2026,"UPI/ZOMATO LTD/1001/order",UPI1001,645.00,,9355.00',
    '02/05/2026,"NEFT SALARY CREDIT",N2002,,50000.00,59355.00',
    '03/05/2026,"ATM WDL, KORAMANGALA",A3003,2000.00,,57355.00',
  ].join('\n');

  test('the direction comes from the column the bank put it in', () => {
    // The same principle the PDF parser uses, with the geometry removed
    // because a table does not need it.
    const { transactions } = parseTable(csv);
    assert.deep(transactions.map((t) => t.direction), ['out', 'in', 'out']);
    assert.deep(transactions.map((t) => t.amount), [64_500, 5_000_000, 200_000]);
  });

  test('the account block above the table is read', () => {
    const { account } = parseTable(csv);
    assert.equal(account.number, '1234500000');
    assert.equal(account.ifsc, 'KKBK0000123');
    assert.equal(account.bank, 'Kotak Mahindra Bank');
  });

  test('the closing balance is the last one printed', () => {
    assert.equal(parseTable(csv).closingBalance, 5_735_500);
  });

  test('a quoted narration with a comma survives into the transaction', () => {
    assert.includes(parseTable(csv).transactions[2].description, 'KORAMANGALA');
  });

  test('a file with no table says so instead of returning nothing quietly', () => {
    const result = parseTable('Name,Address\nMeera,Bengaluru');
    assert.length(result.transactions, 0);
    assert.includes(result.error, 'No transaction table');
  });

  test('a row whose amount cannot be read is reported, not dropped', () => {
    const result = parseTable([
      'Date,Narration,Withdrawal,Deposit',
      '01/05/2026,Fine,100.00,',
      '02/05/2026,Broken,n/a,',
    ].join('\n'));

    assert.length(result.transactions, 1);
    assert.length(result.problems, 1);
    assert.includes(result.problems[0].reason, 'no amount');
  });

  test('an amount column carrying its own sign is read the bank way round', () => {
    const { transactions } = parseTable([
      'Date,Description,Amount,Type',
      '01/05/2026,Paid,645.00,DR',
      '02/05/2026,Received,5000.00,CR',
    ].join('\n'));

    assert.deep(transactions.map((t) => t.direction), ['out', 'in']);
  });
});

/* ------------------------------------------------------- card statements */

describe('a credit card statement', () => {
  const csv = [
    'HDFC Bank Credit Card Statement',
    'Card No: XXXXXXXXXXXX4321',
    'Total Amount Due: 45,678.00',
    '',
    'Date,Transaction Description,Amount,Debit/Credit',
    '03/05/2026,AMAZON IN,2500.00,DR',
    '07/05/2026,PAYMENT RECEIVED - THANK YOU,10000.00,CR',
    '09/05/2026,SWIGGY BENGALURU,480.50,DR',
  ].join('\n');

  test('a card statement is recognised without being sorted by hand', () => {
    // Somebody dropping twelve files in at once should not have to separate
    // the cards from the bank accounts first.
    assert.ok(looksLikeCard(csv));
    assert.not(looksLikeCard('Kotak Mahindra Bank\nAccount No: 123\nDate,Narration,Balance'));
  });

  test('a purchase is money leaving the household even though it credits nothing', () => {
    const { transactions } = parseTable(csv, { card: true });
    assert.deep(transactions.map((t) => t.direction), ['out', 'in', 'out']);
    assert.equal(transactions[0].amount, 250_000);
  });

  test('an unsigned amount column on a card means a purchase', () => {
    // The opposite of a bank statement, where an unsigned figure with no Dr/Cr
    // beside it is money arriving. Getting this backwards would report a
    // year of card spending as income.
    const { transactions } = parseTable([
      'Credit Card Statement',
      'Date,Description,Amount',
      '03/05/2026,AMAZON IN,2500.00',
      '07/05/2026,PAYMENT RECEIVED,-10000.00',
    ].join('\n'), { card: true });

    assert.deep(transactions.map((t) => t.direction), ['out', 'in']);
  });

  test('no running balance is invented for a card', () => {
    // There is no account balance to run, and inventing one would fail the
    // importer's reconciliation on every card file.
    const result = parseTable(csv, { card: true });
    assert.equal(result.openingBalance, null);
    assert.equal(result.closingBalance, null);
  });

  test('the card number is read so the file can be matched to an account', () => {
    assert.includes(parseTable(csv, { card: true }).account.number, '4321');
    assert.equal(parseTable(csv, { card: true }).account.type, 'Credit Card');
  });
});

/* --------------------------------------------------- through the importer */

describe('a table goes through the same importer as a PDF', () => {
  const parsed = parseTable([
    'Account No: 1234500000',
    '',
    'Date,Narration,Withdrawal,Deposit,Balance',
    '01/05/2026,"UPI/ZOMATO LTD/1001/order",645.00,,9355.00',
    '02/05/2026,"UPI/MEERA R K/1002/lent",5000.00,,4355.00',
  ].join('\n'));

  test('its transactions categorise like any others', () => {
    const plan = planStatement(parsed.transactions, {
      parsed, accounts: [], existingKeys: new Set(),
    });

    assert.length(plan.transactions, 2);
    assert.equal(plan.transactions[0].category, 'food-delivery');
    assert.ok(plan.transactions[1].isP2P, 'a person-to-person payment was not recognised');
  });

  test('re-importing the same file adds nothing', () => {
    // The same fingerprint deduplication a PDF gets, which is what makes
    // dropping the whole month in twice harmless.
    const first = planStatement(parsed.transactions, {
      parsed, accounts: [], existingKeys: new Set(),
    });
    const keys = new Set(first.fresh.map((row) => row.importKey));
    const again = planStatement(parsed.transactions, {
      parsed, accounts: [], existingKeys: keys,
    });

    assert.length(again.fresh, 0);
    assert.length(again.duplicates, 2);
  });
});
