import { test, describe, assert, setSuite } from './harness.mjs';
import {
  parseDate, parseStatement, detectColumns, readAccount, readSummary, reconcile,
} from '../js/domain/statement.js';
import {
  classify, categorise, channelOf, counterpartyOf, counterpartyKey, looksLikePerson,
  resolveAliases, summarise, peopleLedger, recurring, lendingLedger, businessLedger,
  categoryLabel, CATEGORIES,
} from '../js/domain/categorise.js';
import { insights } from '../js/domain/insights.js';

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

  test('a numeric date is read day-first, as Indian banks print it', () => {
    // This used to be refused, and the refusal is what kept the parser
    // Kotak-only: ICICI prints `16.07.2026` and Axis `18-06-2026`, so a real
    // ICICI statement with 3,242 readable rows produced zero transactions.
    assert.equal(parseDate('01/04/2025'), '2025-04-01');
    assert.equal(parseDate('16.07.2026'), '2026-07-16');
    assert.equal(parseDate('18-06-2026'), '2026-06-18');
  });

  test('and day-first is the whole of that decision', () => {
    // Reading this as the seventh of August, where the bank meant the eighth
    // of July, moves a transaction by a month for eleven days in every twelve
    // — and nothing on screen would say so.
    assert.equal(parseDate('07.08.2026'), '2026-08-07');
    assert.notEqual(parseDate('07.08.2026'), '2026-07-08');
  });

  test('a year-first date is not read off its own tail', () => {
    // `2026-01-15` matched against the day-first pattern on the substring
    // `26-01-15` comes back as 2015 — wrong by eleven years, and plausible.
    assert.equal(parseDate('2026-01-15'), '2026-01-15');
  });

  test('anything else is refused rather than guessed', () => {
    assert.equal(parseDate('01 Xyz 2025'), null);
    assert.equal(parseDate('32/01/2025'), null);
    assert.equal(parseDate('01/13/2025'), null);
    assert.equal(parseDate('not a date'), null);
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

  /*
   * The payee is not at a fixed position in a UPI narration, and every fixture
   * in this repository used to be the one shape where it is second. These pin
   * the shapes that are not.
   */
  test('a direction indicator is not a counterparty', () => {
    assert.equal(counterpartyOf('UPI/DR/305012345678/Amazon/UTIB/amazon@axis/UPI'), 'Amazon');
    assert.equal(counterpartyOf('UPI/CR/218765432109/SANJAY NARAYAN/ICIC/sanjay@okicici/UPI'), 'SANJAY NARAYAN');
  });

  test('a reference number is not a counterparty', () => {
    assert.equal(counterpartyOf('UPI/052012345678/Payment from Ph/SANJAY/HDFC BANK'), 'SANJAY');
  });

  test('a narration that packs its fields with dashes is read too', () => {
    assert.equal(
      counterpartyOf('UPI-NETFLIX ENTERTAINMENT-NETFLIX@HDFCBANK-HDFC0000060-412345678901-PAYMENT'),
      'NETFLIX ENTERTAINMENT',
    );
  });

  test('a VPA names the payee when no field does', () => {
    assert.equal(counterpartyOf('UPI/DR/412345678901/netflix.payu@hdfcbank/Payment'), 'netflix payu');
  });

  test('a narration naming nobody says so rather than inventing a name', () => {
    // A phone-number VPA identifies an account, not a person.
    assert.equal(counterpartyOf('UPI/DR/412345678901/9876543210-2@ybl/Payment'), 'UPI payment');
    assert.equal(counterpartyOf('UPI/DR/412345678901/Payment'), 'UPI payment');
  });

  test('the whole narration is never returned as a name', () => {
    const name = counterpartyOf('UPI/DR/412345678901/Payment');
    assert.not(/\d{6,}/.test(name), 'a reference number is not part of a counterparty');
  });

  test('two ICICI payees group apart, and one payee groups together', () => {
    // The bug this replaces: both of these read as `DR`, and `counterpartyKey`
    // reduced that to `unknown` — so every UPI payment on the statement, in
    // both directions, was one counterparty.
    const netflix = counterpartyKey(counterpartyOf('UPI/DR/412345678901/NETFLIX/HDFC/n@hdfcbank/Pay'));
    const swiggy = counterpartyKey(counterpartyOf('UPI/DR/512345678901/SWIGGY/YESB/swiggy@ybl/Food'));
    const netflixAgain = counterpartyKey(counterpartyOf('UPI/DR/999999999999/NETFLIX/HDFC/n@hdfcbank/Pay'));

    assert.not(netflix === swiggy, 'two different payees are not one counterparty');
    assert.equal(netflix, netflixAgain);
    assert.not(netflix === 'unknown', 'a named payee is not grouped as unknown');
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

  test('three payees on one statement are three subscriptions, not one', () => {
    // What this looked like before the payee was read from the right field: all
    // nine rows keyed on `DR`, reported as a single charge of the median amount
    // on a cadence made of the *gaps between different payees* — nine payments
    // ten days apart read as weekly, and the largest of the three vanished into
    // a figure that described none of them.
    const months = ['04', '05', '06'];
    const rows = categorise(months.flatMap((m) => [
      t(`UPI/DR/30501111222${m}/LANDLORD RENT/ICIC/landlord@okicici/Rent`, 'out',
        { amount: 35_000_00, date: `2026-${m}-05` }),
      t(`UPI/DR/41234567890${m}/NETFLIX/HDFC/netflix.payu@hdfcbank/Pay`, 'out',
        { amount: 649_00, date: `2026-${m}-14` }),
      t(`UPI/DR/51234567890${m}/CLOUD BACKUP/UTIB/backup@axis/Plan`, 'out',
        { amount: 1_180_00, date: `2026-${m}-18` }),
    ]));

    const found = recurring(rows, { asOf: '2026-06-30' });
    assert.length(found, 3);
    assert.equal(found.map((r) => r.amount).sort((a, b) => b - a).join(),
      [35_000_00, 1_180_00, 649_00].join());
    for (const charge of found) {
      assert.equal(charge.period, 'monthly', `${charge.name} repeats monthly`);
      assert.equal(charge.occurrences, 3);
    }
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

/* ------------------------------------------- statements that are not Kotak */

/**
 * Three banks, three layouts.
 *
 * The parser was built against Kotak and quietly assumed all three of its
 * conventions: a serial column, a date spelled `15 Jul 2026`, and a bank named
 * anywhere in the first forty lines. Real ICICI and Axis statements — 3,242
 * and 67 rows of perfectly readable text — produced **zero** transactions.
 *
 * These fixtures are the shapes those files actually have, retyped. The files
 * themselves are somebody's bank statements and do not belong in a repository.
 */
const cells = (...texts) => ({
  cells: texts.map(([x, text]) => ({ x, text })),
});

describe('an ICICI statement: serial, and a dotted date', () => {
  const rows = [
    cells([40, 'S No.'], [90, 'Transaction Date'], [300, 'Transaction Remarks'],
      [430, 'Withdrawal Amount (INR)'], [530, 'Deposit Amount (INR)'], [620, 'Balance (INR)']),
    cells([40, '1'], [90, '16.07.2026'], [300, 'MMT/IMPS/619712558765/KKBKTransfer'],
      [530, '3900.00'], [620, '5141.53']),
    cells([40, '2'], [90, '16.07.2026'], [300, 'UPI/KEERTAN R/Payment fr/HDFC BANK'],
      [430, '4000.00'], [620, '1141.53']),
  ];

  test('the dotted date is what used to stop it dead', () => {
    const { transactions } = parseStatement(rows);
    assert.length(transactions, 2);
    assert.equal(transactions[0].date, '2026-07-16');
  });

  test('the amounts and directions come off the columns', () => {
    const [credit, debit] = parseStatement(rows).transactions;
    assert.equal(credit.amount, 3_900_00);
    assert.equal(credit.direction, 'in');
    assert.equal(debit.amount, 4_000_00);
    assert.equal(debit.direction, 'out');
  });

  test('and the narration keeps neither the serial nor half the date', () => {
    // `16.07.2026` contains `16.07`, which is shaped exactly like an amount.
    // Stripping figures before the date left `.2026` glued to every narration,
    // and the narration is what the categoriser and the duplicate fingerprint
    // both read.
    const [first] = parseStatement(rows).transactions;
    assert.equal(first.description, 'MMT/IMPS/619712558765/KKBKTransfer');
    assert.not(/\.2026/.test(first.description), first.description);
    assert.not(/^1\b/.test(first.description), first.description);
  });
});

describe('an Axis statement: no serial column at all', () => {
  const rows = [
    cells([40, 'Tran Date'], [120, 'Chq No'], [200, 'Particulars'],
      [420, 'Debit'], [500, 'Credit'], [580, 'Balance']),
    cells([40, '18-06-2026'], [200, 'INDDR/KKBK/Payment/'], [420, '101.00'], [580, '6133.00']),
    cells([40, '14-08-2026'], [200, 'NEFT/CARE HEALTH INSURANCE'], [500, '56495.00'], [580, '62628.00']),
  ];

  test('a row that begins with its date still begins a transaction', () => {
    // The serial is a convenience for reporting a bad row back to a person. It
    // is not what identifies a transaction, and requiring one excluded every
    // bank that does not print it.
    const { transactions } = parseStatement(rows);
    assert.length(transactions, 2);
    assert.equal(transactions[0].date, '2026-06-18');
    assert.equal(transactions[0].serial, null);
  });

  test('and the figures still land in the right columns', () => {
    const [out, incoming] = parseStatement(rows).transactions;
    assert.equal(out.direction, 'out');
    assert.equal(out.amount, 101_00);
    assert.equal(incoming.direction, 'in');
    assert.equal(incoming.amount, 56_495_00);
  });
});

describe('whose statement it is', () => {
  test('a labelled IFSC names the bank', () => {
    assert.equal(readAccount([
      'Account Statement', 'Account No. 5612488963', 'Sanjay B N',
      'IFSC Code KKBK0008067',
    ]).bank, 'Kotak Mahindra Bank');
  });

  test('a counterparty’s IFSC in a narration does not', () => {
    // The bug exactly: an ICICI statement whose early rows carried
    // `KKBK0008067` inside somebody else's transfer reference was reported as
    // Kotak, because the scan covered forty lines and Kotak was tested first.
    // Getting this wrong sends the import at the wrong account.
    assert.equal(readAccount([
      'Statement of Transactions in Saving Account no. 008401532684 in INR',
      'SANJAY B N Your Base Branch: ICICI BANK LIMITED,',
      'BANGALORE',
      '1 16.07.2026 MMT/IMPS/619712558765/KKBK0008067/Transfer 3900.00',
    ]).bank, 'ICICI Bank');
  });

  test('the account number is found however the bank labels it', () => {
    const number = (line) => readAccount([line]).number;
    assert.equal(number('Account No. 5612488963'), '5612488963');
    assert.equal(number('Statement of Axis Account No: 926010022005391 for the period'), '926010022005391');
    assert.equal(number('Statement of Transactions in Saving Account no. 008401532684 in INR'), '008401532684');
  });

  test('and an unknown bank is empty rather than a guess', () => {
    assert.equal(readAccount(['Some statement', 'no bank named here']).bank, '');
  });
});

describe('a statement that never states an opening balance', () => {
  // ICICI prints no "Opening Balance" line, so `running` stayed null and the
  // check against the printed balance never ran. The importer reported zero
  // problems on 595 transactions whatever the rows said — the most confident
  // an importer can be while being wrong.
  //
  // The unit of the check is a **date**, not a row: a bank orders same-day
  // rows by its own sequence, not by the running balance, and ICICI printed a
  // withdrawal above the deposit that funded it.
  const rows = (balances) => [
    cells([40, 'S No.'], [90, 'Transaction Date'], [300, 'Transaction Remarks'],
      [430, 'Withdrawal Amount (INR)'], [530, 'Deposit Amount (INR)'], [620, 'Balance (INR)']),
    ...balances.map(([serial, out, balance], i) => cells(
      [40, String(serial)], [90, `0${i + 1}.04.2025`], [300, 'UPI/SOMEONE/Payment'],
      [430, out], [620, balance],
    )),
  ];

  test('consecutive printed balances are checked against each other', () => {
    // 1,000 out of 5,000 leaves 4,000; the bank printed 3,500.
    const parsed = parseStatement(rows([[1, '1000.00', '4000.00'], [2, '500.00', '3500.00'], [3, '1000.00', '1000.00']]));

    assert.equal(parsed.openingBalance, null);
    assert.length(parsed.transactions, 3);
    assert.length(parsed.problems, 1);
    assert.includes(parsed.problems[0].reason, 'do not add up to any balance printed for it');
  });

  test('and a statement whose rows do follow reports nothing', () => {
    const parsed = parseStatement(rows([[1, '1000.00', '4000.00'], [2, '500.00', '3500.00'], [3, '1000.00', '2500.00']]));
    assert.length(parsed.problems, 0);
  });

  test('the row is still imported — flagged, not dropped', () => {
    // A row the household can see and correct beats one silently missing.
    const parsed = parseStatement(rows([[1, '1000.00', '4000.00'], [2, '500.00', '9999.00']]));
    assert.length(parsed.transactions, 2);
    assert.length(parsed.problems, 1);
  });
});

describe('the balance carried into the statement', () => {
  test('ICICI prints it as a dated B/F row, which is not a transaction', () => {
    // It has a date in the first cell, so the date-first rule made it look
    // like one — and it became a transaction with no readable amount, on
    // every statement that opens with one.
    const rows = [
      cells([40, 'DATE'], [120, 'MODE**'], [200, 'PARTICULARS'],
        [430, 'DEPOSITS'], [530, 'WITHDRAWALS'], [620, 'BALANCE']),
      cells([40, '01-04-2025'], [120, 'B/F'], [620, '50087.53']),
      cells([40, '02-04-2025'], [200, 'UPI/SOMEONE/Payment'], [530, '87.53'], [620, '50000.00']),
    ];

    const parsed = parseStatement(rows);
    assert.equal(parsed.openingBalance, 50_087_53);
    assert.length(parsed.transactions, 1);
    assert.length(parsed.problems, 0);
  });

  test('and "Opening Balance" still works where banks spell it out', () => {
    const rows = [
      cells([40, '#'], [75, 'Date'], [124, 'Description'],
        [355, 'Withdrawal (Dr.)'], [429, 'Deposit (Cr.)'], [498, 'Balance']),
      cells([124, 'Opening Balance'], [498, '10,000.00']),
      cells([39, '1'], [73, '01 Apr 2025'], [119, 'UPI/X/Payment'], [391, '500.00'], [525, '9,500.00']),
    ];
    assert.equal(parseStatement(rows).openingBalance, 10_000_00);
  });
});

describe('a bank that prints same-day rows out of order', () => {
  // Straight from a real ICICI statement: a ₹650 withdrawal printed *above*
  // the ₹650 deposit that funded it. Both rows read correctly, both balances
  // correct, the pair in the wrong order. Checking row against row put two
  // false alarms on a statement of 595 — and a warning that cries wolf is one
  // people learn to click past.
  const rows = (...spec) => [
    cells([40, 'S No.'], [90, 'Transaction Date'], [300, 'Transaction Remarks'],
      [430, 'Withdrawal Amount (INR)'], [530, 'Deposit Amount (INR)'], [620, 'Balance (INR)']),
    ...spec.map(([serial, date, out, into, balance]) => cells(
      [40, String(serial)], [90, date], [300, 'UPI/SOMEONE/Payment'],
      ...(out ? [[430, out]] : []), ...(into ? [[530, into]] : []), [620, balance],
    )),
  ];

  test('the day is the unit, so the order inside it does not matter', () => {
    const parsed = parseStatement(rows(
      [1, '26.02.2026', '173.39', null, '0.01'],
      [2, '03.03.2026', '650.00', null, '0.01'],
      [3, '03.03.2026', null, '650.00', '650.01'],
    ));

    assert.length(parsed.transactions, 3);
    assert.length(parsed.problems, 0);
  });

  test('and a day whose amounts reach no printed balance is still caught', () => {
    const parsed = parseStatement(rows(
      [1, '26.02.2026', '173.39', null, '0.01'],
      [2, '03.03.2026', '650.00', null, '0.01'],
      [3, '03.03.2026', null, '999.00', '650.01'],
    ));

    assert.length(parsed.problems, 1);
    assert.includes(parsed.problems[0].reason, 'do not add up to any balance printed for it');
    assert.equal(parsed.problems[0].date, '2026-03-03');
  });

  test('a wide balance that overflows left of its heading is still a balance', () => {
    // Amounts are right-aligned, so a figure wider than its heading starts to
    // the left of it. A balance of `100236.53` began 1.1pt left of the
    // `Balance` heading on a real statement: 48 rows came back with no balance
    // at all, and on a row with no deposit that balance would have been read
    // *as* the deposit — an inward amount invented out of a running total.
    const overflow = [
      cells([40, 'S No.'], [90, 'Transaction Date'], [300, 'Transaction Remarks'],
        [430, 'Withdrawal Amount (INR)'], [530, 'Deposit Amount (INR)'], [620, 'Balance (INR)']),
      // The balance sits at 610 — left of its own heading at 620, and inside
      // the deposit column's range.
      cells([40, '1'], [90, '03.04.2025'], [300, 'INF/INFT/Self'], [545, '45000.00'], [610, '100236.53']),
    ];

    const [txn] = parseStatement(overflow).transactions;
    assert.equal(txn.direction, 'in');
    assert.equal(txn.amount, 45_000_00);
    assert.equal(txn.printedBalance, 1_00_236_53);
  });

  test('a row with a single amount keeps it as the amount, not a balance', () => {
    // The rightmost-is-the-balance rule must not eat a lone figure, or the row
    // comes back with no amount at all.
    const one = [
      cells([40, 'S No.'], [90, 'Transaction Date'], [300, 'Transaction Remarks'],
        [430, 'Withdrawal Amount (INR)'], [530, 'Deposit Amount (INR)'], [620, 'Balance (INR)']),
      cells([40, '1'], [90, '03.04.2025'], [300, 'Fee'], [440, '650.00']),
    ];

    const [txn] = parseStatement(one).transactions;
    assert.equal(txn.amount, 650_00);
    assert.equal(txn.direction, 'out');
    assert.equal(txn.printedBalance, null);
  });
});
