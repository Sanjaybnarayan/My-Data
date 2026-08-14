import { test, describe, assert, setSuite } from './harness.mjs';
import {
  parseDate, parseStatement, detectColumns, readAccount, readSummary, reconcile,
} from '../js/domain/statement.js';
import {
  classify, categorise, channelOf, counterpartyOf, counterpartyKey, looksLikePerson,
  resolveAliases, summarise, peopleLedger, recurring, lendingLedger, businessLedger, insights,
  categoryLabel, CATEGORIES,
} from '../js/domain/categorise.js';

setSuite('statement');

/* ---------------------------------------------------------------- fixtures */

/**
 * A statement page the way a PDF gives it up: positioned cells, with the
 * column x values a real Kotak statement uses.
 */
const X = { serial: 39, date: 73, description: 119, reference: 275, withdrawal: 391, deposit: 460, balance: 525 };

const header = () => ({
  y: 720,
  cells: [
    { x: 44, text: '#' }, { x: 75, text: 'Date' }, { x: 124, text: 'Description' },
    { x: 280, text: 'Chq/Ref. No.' }, { x: 355, text: 'Withdrawal (Dr.)' },
    { x: 429, text: 'Deposit (Cr.)' }, { x: 498, text: 'Balance' },
  ],
});

let y = 700;

/** One transaction row. Pass `out` or `in`, never both — a statement never has both. */
function row(serial, date, text, { out, into, balance, reference = '' }) {
  const cells = [
    { x: X.serial, text: String(serial) },
    { x: X.date, text: date },
    { x: X.description, text },
  ];
  if (reference) cells.push({ x: X.reference, text: reference });
  if (out != null) cells.push({ x: X.withdrawal, text: out });
  if (into != null) cells.push({ x: X.deposit, text: into });
  cells.push({ x: X.balance, text: balance });
  return { y: (y -= 14), cells };
}

/** A continuation: description column only, no serial, no figures. */
const wrap = (text) => ({ y: (y -= 8), cells: [{ x: X.description, text }] });

function statement() {
  y = 700;
  return [
    { y: 780, cells: [{ x: 40, text: 'Account Statement' }] },
    { y: 770, cells: [{ x: 40, text: 'Account No. 1234500000' }] },
    { y: 760, cells: [{ x: 40, text: 'Meera R K' }] },
    { y: 755, cells: [{ x: 40, text: 'Account Type Savings' }] },
    { y: 750, cells: [{ x: 40, text: 'MICR 560000000 IFSC Code KKBK0000123' }] },
    header(),
    { y: 710, cells: [{ x: 119, text: 'Opening Balance' }, { x: X.balance, text: '10,000.00' }] },
    row(1, '01 Apr 2025', 'UPI/ZOMATO LIMITED/123/Payment from', { out: '500.00', balance: '9,500.00', reference: 'UPI-100000000003' }),
    wrap('Ph'),
    row(2, '02 Apr 2025', 'Recd:IMPS/100000000001/RAMESH T/KKBK/X2684/IMPS', { into: '2,000.00', balance: '11,500.00' }),
    row(3, '03 Apr 2025', 'NACH-10-DR-KOTAKMAHPRIMELTKKBK-RC4-', { out: '1,000.00', balance: '10,500.00' }),
    { y: 600, cells: [{ x: 40, text: 'Account Summary' }] },
    { y: 590, cells: [{ x: 40, text: 'Savings Account (SA): 10,000.00 10,500.00' }] },
    { y: 580, cells: [{ x: 40, text: 'Any discrepancy in the statement 99,999.00 should be reported' }] },
  ];
}

/* ------------------------------------------------------------------ dates */

describe('dates', () => {
  test('a statement date becomes an ISO day', () => {
    assert.equal(parseDate('01 Apr 2025'), '2025-04-01');
    assert.equal(parseDate('9 Dec 2025'), '2025-12-09');
  });

  test('a two-digit year is this century', () => {
    assert.equal(parseDate('05 Mar 26'), '2026-03-05');
  });

  test('anything else is refused rather than guessed', () => {
    assert.equal(parseDate('01/04/2025'), null);
    assert.equal(parseDate('01 Xyz 2025'), null);
    assert.equal(parseDate(''), null);
  });
});

/* -------------------------------------------------------------- the table */

describe('columns', () => {
  test('the headings give the column boundaries', () => {
    const columns = detectColumns([{ cells: header().cells }]);
    assert.ok(columns, 'a statement with a heading row has columns');
    assert.ok(columns.withdrawal < columns.deposit && columns.deposit < columns.balance);
  });

  test('flat text has no columns, and says so', () => {
    assert.equal(detectColumns(['1 01 Apr 2025 something 100.00 900.00']), null);
    assert.equal(parseStatement(['1 01 Apr 2025 UPI/X 100.00 900.00']).mode, 'text');
  });
});

describe('parsing', () => {
  test('direction comes from the column the amount sat in', () => {
    const { transactions, mode } = parseStatement(statement());
    assert.equal(mode, 'columns');
    assert.length(transactions, 3);
    assert.equal(transactions[0].direction, 'out');
    assert.equal(transactions[1].direction, 'in');
    assert.equal(transactions[1].amount, 200_000);
  });

  test('a wrapped description is folded into the row above', () => {
    const { transactions } = parseStatement(statement());
    assert.includes(transactions[0].raw, 'Ph');
    assert.equal(transactions[1].serial, 2, 'the wrap did not become its own transaction');
  });

  test('the small print after the summary is not a transaction', () => {
    const { transactions, problems } = parseStatement(statement());
    assert.length(transactions, 3);
    assert.length(problems, 0);
    assert.not(
      transactions.some((t) => t.raw.includes('99,999')),
      'a figure in the footer must not become an amount',
    );
  });

  test('the reference is pulled out of the narration', () => {
    const [first] = parseStatement(statement()).transactions;
    assert.equal(first.reference, 'UPI-100000000003');
    assert.not(first.description.includes('100000000003'));
  });

  test('opening and closing balances come from the summary block', () => {
    const parsed = parseStatement(statement());
    assert.equal(parsed.openingBalance, 1_000_000);
    assert.equal(parsed.closingBalance, 1_050_000);
    assert.ok(reconcile(parsed).balanced, 'the statement must close on its own arithmetic');
  });

  test('an overdrawn balance printed without its sign is still read correctly', () => {
    // Kotak prints a balance of minus 500 as "500.00". Trusting the print
    // turns one overdraft into a 1,500 swing in the wrong direction.
    y = 700;
    const rows = [
      header(),
      { y: 710, cells: [{ x: 119, text: 'Opening Balance' }, { x: X.balance, text: '1,000.00' }] },
      row(1, '01 Apr 2025', 'UPI/SOMEONE/1/Payment', { out: '1,500.00', balance: '500.00' }),
      row(2, '01 Apr 2025', 'Sweep Trf From: 208481', { into: '2,000.00', balance: '1,500.00' }),
    ];
    const { transactions, problems } = parseStatement(rows);
    assert.length(problems, 0, 'the negative balance is arithmetic, not a parse failure');
    assert.equal(transactions[0].balance, -50_000);
    assert.equal(transactions[1].balance, 150_000);
  });

  test('a row whose amount contradicts the balance is reported, not accepted', () => {
    y = 700;
    const rows = [
      header(),
      { y: 710, cells: [{ x: 119, text: 'Opening Balance' }, { x: X.balance, text: '1,000.00' }] },
      row(1, '01 Apr 2025', 'UPI/SOMEONE/1/Payment', { out: '100.00', balance: '400.00' }),
    ];
    const { problems } = parseStatement(rows);
    assert.length(problems, 1);
    assert.includes(problems[0].reason, 'printed balance');
  });

  test('the account details are read off the head', () => {
    const account = readAccount(statement().map((r) => r.cells.map((c) => c.text).join(' ')));
    assert.equal(account.number, '1234500000');
    assert.equal(account.holder, 'Meera R K');
    assert.equal(account.ifsc, 'KKBK0000123');
    assert.equal(account.bank, 'Kotak Mahindra Bank');
  });

  test('the summary block states both balances', () => {
    const summary = readSummary(['Savings Account (SA): 26,543.14 2,150.12']);
    assert.equal(summary.opening, 2_654_314);
    assert.equal(summary.closing, 215_012);
  });
});

describe('reconciling', () => {
  test('a period that does not close is not called balanced', () => {
    const result = reconcile({
      transactions: [{ direction: 'in', amount: 10_000 }],
      openingBalance: 0,
      closingBalance: 50_000,
    });
    assert.not(result.balanced);
    assert.equal(result.difference, 40_000);
  });

  test('a rupee of rounding is tolerated', () => {
    const result = reconcile({
      transactions: [{ direction: 'out', amount: 10_000 }],
      openingBalance: 100_000,
      closingBalance: 90_050,
    });
    assert.ok(result.balanced);
  });
});

/* ------------------------------------------------------------ classifying */

setSuite('categorise');

const t = (description, direction = 'out', over = {}) => ({
  description, direction, amount: 100_00, date: '2025-06-10', ...over,
});

describe('rails', () => {
  test('each narration prefix names the rail it travelled on', () => {
    assert.equal(channelOf('UPI/ZOMATO/1/Pay'), 'upi');
    assert.equal(channelOf('Recd:IMPS/123/RAMESH T/KKBK'), 'imps');
    assert.equal(channelOf('NEFT YESF35 ZERODHA NEFTINW-1'), 'neft');
    assert.equal(channelOf('NACH-10-DR-BILLER-RC4-'), 'nach');
    assert.equal(channelOf('PCD/6706/Puma Sports India'), 'card');
    assert.equal(channelOf('ATL/6706/504432/+UBI'), 'atm');
    assert.equal(channelOf('Sweep Trf From: 2084813760'), 'sweep');
    assert.equal(channelOf('Int.Pd:1234500000:01-04-2025'), 'interest');
    assert.equal(channelOf('something unlabelled'), 'other');
  });
});

describe('counterparties', () => {
  test('every rail packs the name differently and each is unpacked', () => {
    assert.equal(counterpartyOf('UPI/ZOMATO LIMITED/123456/Payment from Ph'), 'ZOMATO LIMITED');
    assert.equal(counterpartyOf('Recd:IMPS/100000000001/RAMESH T/KKBK/X2684/IMPS'), 'RAMESH T');
    assert.equal(counterpartyOf('SentIMPS100000000002Deepak N/SBINX3194/KKBKTrans'), 'Deepak N');
    assert.equal(counterpartyOf('MB:RECEIVED FROM RIDECO PARTNERS'), 'RIDECO PARTNERS');
    assert.equal(counterpartyOf('MB:SENT TO VIJAY M K/ROYAL FAB CO'), 'VIJAY M K');
  });

  test('reference numbers are not part of a name', () => {
    const name = counterpartyOf('PCD/6706/Puma Sports India Pvt/L 900000000001 Amri250925/21:53');
    assert.includes(name, 'Puma Sports India');
    assert.not(/\d{6,}/.test(name), 'the card reference is not part of the merchant');
  });

  test('a mandate that is only a number keeps its number', () => {
    assert.equal(counterpartyOf('NACH-10-DR-5550001- 000000ABCDEFGH 00'), '5550001');
  });

  test('a name is grouped the same however its initials are written', () => {
    assert.equal(counterpartyKey('PRIYA D S'), counterpartyKey('PRIYA DS'));
    assert.equal(counterpartyKey('ZOMATO'), counterpartyKey('Zomato Ltd'));
  });

  test('a person is told from a business by shape, not by a list', () => {
    assert.ok(looksLikePerson('Anita K R'));
    assert.ok(looksLikePerson('Deepak Nowda'));
    assert.not(looksLikePerson('SNITCH APPARELS'));
    assert.not(looksLikePerson('Zerodha Broking Ltd'));
    assert.not(looksLikePerson('9900292581ptyes'));
  });
});

describe('aliases', () => {
  test('a name the bank truncated is folded into the full one', () => {
    const rows = resolveAliases(categorise([
      t('Recd:IMPS/1/ZERODHA BR/KKBK/X1/x', 'in'),
      t('UPI/Zerodha Broking/2/Payment'),
    ], { aliases: false }));
    assert.equal(rows[0].counterpartyKey, rows[1].counterpartyKey);
  });

  test('a longer name that merely starts the same is a different party', () => {
    // Truncation cuts mid-word; "SANJAY" and "PRIYA KUMAR CH" are two people,
    // and merging them would put one person's money in another's ledger.
    const rows = resolveAliases(categorise([
      t('UPI/PRIYA D S/1/Payment'),
      t('UPI/PRIYA KUMAR CH/2/Payment'),
    ], { aliases: false }));
    assert.notEqual(rows[0].counterpartyKey, rows[1].counterpartyKey);
  });

  test('a short name is never swallowed by a longer one', () => {
    const rows = resolveAliases(categorise([
      t('UPI/CRED/1/Payment', 'in'),
      t('CC%20PAYMENT VPI-126617591'),
    ], { aliases: false }));
    assert.notEqual(rows[0].counterpartyKey, rows[1].counterpartyKey);
  });
});

describe('categories', () => {
  test('every category a rule can produce is declared', () => {
    const declared = new Set(CATEGORIES.map((c) => c.key));
    for (const row of categorise([
      t('UPI/ZOMATO/1/Pay'), t('UPI/Blinkit/1/Pay'), t('Sweep Trf From: 1'),
      t('Int.Pd:1:01-04-2025', 'in'), t('UPI/Muthoot Finance/1/Pay', 'in'),
    ])) {
      assert.includes(declared, row.category);
      assert.notEqual(categoryLabel(row.category), row.category, 'a category has a label');
    }
  });

  test('the specific rule wins over the general one', () => {
    // Zomato is food delivery before it is e-commerce; Blinkit is quick
    // commerce before it is groceries. Order is the whole mechanism.
    assert.equal(classify(t('UPI/ZOMATO LIMITED/1/Pay')).category, 'food-delivery');
    assert.equal(classify(t('UPI/Blinkit/1/Blinkit')).category, 'quick-commerce');
    assert.equal(classify(t('UPI/Amazon India/1/Pay')).category, 'e-commerce');
  });

  test('a named merchant beats the aggregator that carried the money', () => {
    assert.equal(classify(t('UPI/Razorpay/1/SNITCH Refund', 'in')).category, 'refund');
    // Without a merchant name the app itself is all that is known, and saying
    // "a payment, merchant unnamed" is a different fact from "no idea".
    assert.equal(classify(t('UPI/Razorpay/1/Payment')).category, 'payments');
  });

  test('money moving between your own pockets is not spending', () => {
    const sweep = classify(t('Sweep Trf From: 2084813760', 'in'));
    assert.equal(sweep.category, 'sweep');
    assert.equal(sweep.categoryKind, 'internal');

    const self = classify(t('UPI/MEERA R K/1/Payment'), { holder: 'Meera R K' });
    assert.equal(self.category, 'self-transfer');
    assert.equal(self.counterpartyKind, 'self');
  });

  test('a transfer to a person is a transfer, not a purchase', () => {
    const sent = classify(t('UPI/Anita K R/1/Payment from Ph'));
    assert.equal(sent.category, 'p2p-out');
    assert.ok(sent.isP2P);
    assert.equal(classify(t('Recd:IMPS/1/RAMESH T/KKBK/X1/IMPS', 'in')).category, 'p2p-in');
  });

  test('a NACH debit nobody named is still a standing instruction', () => {
    assert.equal(classify(t('NACH-10-DR-5550001- 000000ATJ 00')).category, 'emi');
    assert.equal(classify(t('NACH-10-DR-KOTAKMAHPRIMELTKKBK-RC4-')).rule, 'vehicle-loan');
  });

  test('a firm the household owns is earnings out and capital in', () => {
    // The one fact no rule can derive. A business account looks exactly like a
    // stranger sending money back and forth, so it is stated, not guessed.
    const options = { businesses: ['RIDECO PARTNERS'] };

    const drawn = classify(t('MB:RECEIVED FROM RIDECO PARTNERS', 'in'), options);
    assert.equal(drawn.category, 'business-income');
    assert.equal(drawn.categoryKind, 'income');
    assert.equal(drawn.counterpartyKind, 'business');
    assert.equal(drawn.rule, 'own-business');

    const put = classify(t('UPI/RIDECO PARTNERS/1/Payment'), options);
    assert.equal(put.category, 'business-outlay');
    assert.equal(put.categoryKind, 'internal', 'capital into your own firm is not spending');
  });

  test('without being told, the same firm is only a counterparty', () => {
    const row = classify(t('MB:RECEIVED FROM RIDECO PARTNERS', 'in'));
    assert.notEqual(row.category, 'business-income');
    assert.notEqual(row.counterpartyKind, 'business');
  });

  test('a business name the bank truncated still counts as yours', () => {
    const row = classify(t('Recd:IMPS/1/RIDECO PART/KKBK/X1/IMPS', 'in'),
      { businesses: ['RIDECO PARTNERS'] });
    assert.equal(row.category, 'business-income');
  });

  test('a household override beats every rule', () => {
    const row = classify(t('UPI/RIDECO PARTNERS/1/Payment', 'in'), {
      overrides: { [counterpartyKey('RIDECO PARTNERS')]: 'salary' },
    });
    assert.equal(row.category, 'salary');
    assert.equal(row.rule, 'override');
  });

  test('every classification says which rule produced it', () => {
    for (const row of categorise([t('UPI/ZOMATO/1/Pay'), t('UPI/Nobody Known/1/Pay')])) {
      assert.ok(row.rule, 'a classification without a reason cannot be corrected');
    }
  });
});

/* -------------------------------------------------------------- summaries */

const ledgerRows = () => categorise([
  t('UPI/ZOMATO LIMITED/1/Pay', 'out', { amount: 50_000, date: '2025-04-01' }),
  t('UPI/Anita K R/2/Payment', 'out', { amount: 200_000, date: '2025-04-02' }),
  t('Recd:IMPS/3/Anita K R/KKBK/X1/IMPS', 'in', { amount: 50_000, date: '2025-05-02' }),
  t('Sweep Trf From: 1', 'in', { amount: 900_000, date: '2025-05-03' }),
  t('Recd:IMPS/4/MUTHOOT FI/KKBK/X1/P2AMO', 'in', { amount: 300_000, date: '2025-05-04' }),
  t('UPI/Muthoot Finance/5/Pay', 'out', { amount: 100_000, date: '2025-06-04' }),
]);

describe('summaries', () => {
  test('the four kinds of movement are kept apart', () => {
    const s = summarise(ledgerRows());
    assert.equal(s.spending, 150_000, 'the meal and the loan repayment, not the sweep or the transfer');
    assert.equal(s.transfersOut, 200_000);
    assert.equal(s.internalIn, 900_000, 'a sweep is not income');
    assert.equal(s.moneyIn - s.moneyOut, s.net);
  });

  test('the people ledger nets both directions per person', () => {
    const [person] = peopleLedger(ledgerRows());
    assert.equal(person.name, 'Anita K R');
    assert.equal(person.sent, 200_000);
    assert.equal(person.received, 50_000);
    assert.equal(person.balance, -150_000);
    assert.ok(person.reciprocal, 'money went both ways');
  });

  test('borrowing is tracked with what has not come back', () => {
    const muthoot = lendingLedger(ledgerRows()).find((l) => l.name.toLowerCase().includes('muthoot'));
    assert.ok(muthoot);
    assert.equal(muthoot.borrowed, 300_000);
    assert.equal(muthoot.repaid, 100_000);
    assert.equal(muthoot.outstanding, 200_000);
  });

  test('a repeating charge is found by its shape, not its name', () => {
    const rows = categorise(['2025-04-12', '2025-05-12', '2025-06-11', '2025-07-12'].map(
      (date) => t('UPI/Some Obscure Service/1/UPI Mandate', 'out', { amount: 29_900, date }),
    ));
    const [found] = recurring(rows, { asOf: '2025-07-20' });
    assert.ok(found, 'four monthly charges of the same size are a subscription');
    assert.equal(found.period, 'monthly');
    assert.equal(found.occurrences, 4);
    assert.equal(found.amount, 29_900);
    assert.ok(found.active, 'the last one was within a cycle');
  });

  test('a run that stopped long ago is not called active', () => {
    const rows = categorise(['2025-04-12', '2025-05-12', '2025-06-11'].map(
      (date) => t('UPI/Cancelled Thing/1/UPI Mandate', 'out', { amount: 29_900, date }),
    ));
    const [found] = recurring(rows, { asOf: '2026-07-20' });
    assert.not(found.active);
  });

  test('one-off payments of different sizes are not a subscription', () => {
    const rows = categorise([
      t('UPI/Random Shop/1/Pay', 'out', { amount: 10_000, date: '2025-04-01' }),
      t('UPI/Random Shop/2/Pay', 'out', { amount: 900_000, date: '2025-04-03' }),
      t('UPI/Random Shop/3/Pay', 'out', { amount: 25_000, date: '2025-04-09' }),
    ]);
    assert.length(recurring(rows), 0);
  });

  test('the business ledger nets both directions of the partner account', () => {
    const rows = categorise([
      t('MB:RECEIVED FROM RIDECO PARTNERS', 'in', { amount: 500_000, date: '2025-04-10' }),
      t('MB:RECEIVED FROM RIDECO PARTNERS', 'in', { amount: 300_000, date: '2025-05-10' }),
      t('UPI/RIDECO PARTNERS/1/Payment', 'out', { amount: 200_000, date: '2025-05-20' }),
    ], { businesses: ['RIDECO PARTNERS'] });

    const [firm] = businessLedger(rows);
    assert.equal(firm.drawn, 800_000);
    assert.equal(firm.contributed, 200_000);
    assert.equal(firm.net, 600_000, 'taken out more than put in');
    assert.equal(firm.months, 2);
  });

  test('a business the household never named has no ledger', () => {
    assert.length(businessLedger(categorise([t('UPI/RIDECO PARTNERS/1/Pay')])), 0);
  });

  test('insights are facts with their arithmetic attached', () => {
    const notes = insights(ledgerRows());
    assert.ok(notes.length);
    for (const note of notes) {
      assert.ok(note.kind && note.text, 'an insight names itself');
      assert.equal(typeof note.amount, 'number', 'and shows the number behind it');
    }
  });
});

describe('the whole pipeline', () => {
  test('a parsed statement categorises without losing a transaction', () => {
    const parsed = parseStatement(statement());
    const rows = categorise(parsed.transactions, { holder: parsed.account.holder });
    assert.length(rows, parsed.transactions.length);
    assert.deep(
      rows.map((r) => r.category),
      ['food-delivery', 'p2p-in', 'emi'],
    );
    assert.equal(summarise(rows).moneyOut, parsed.transactions
      .filter((t2) => t2.direction === 'out')
      .reduce((sum, t2) => sum + t2.amount, 0));
  });
});
