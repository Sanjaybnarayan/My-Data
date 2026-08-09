import { test, describe, assert, setSuite } from './harness.mjs';
import { fromRecords, confidence, overridesFrom } from '../js/domain/ledger.js';
import { peopleLedger, lendingLedger, insights, summarise } from '../js/domain/categorise.js';

setSuite('ledger');

/**
 * Records as the importer writes them. Narration is the bank's own text, which
 * is the whole reason the categoriser can be run again over stored rows.
 */
const record = (over = {}) => ({
  id: `t${Math.random().toString(36).slice(2, 8)}`,
  date: '2026-05-10',
  amount: 100_000,
  kind: 'expense',
  direction: 'out',
  account: 'acc1',
  narration: 'UPI/PAYTM/1234/Payment',
  payee: 'PAYTM',
  ...over,
});

/* --------------------------------------------------- reading records back */

describe('running the categoriser over stored records', () => {
  test('a record is read back into the shape the ledgers want', () => {
    const [row] = fromRecords([record({
      narration: 'UPI/MEERA R K/402913/HDFC',
      direction: 'out',
    })]);

    assert.equal(row.direction, 'out');
    assert.ok(row.counterpartyKey, 'a counterparty was not derived from the narration');
    assert.ok(row.category, 'no category was derived');
  });

  test('rows with no date or no amount are left out rather than counted as zero', () => {
    assert.length(fromRecords([record({ date: '' }), record({ amount: 0 }), record()]), 1);
  });

  test('the record id survives, so a ledger line leads back to the row', () => {
    const [row] = fromRecords([record({ id: 'txn_42' })]);
    assert.equal(row.id, 'txn_42');
  });
});

/* ------------------------------------------------------------- direction */

describe('which way the money went', () => {
  test('a stored direction is used as read', () => {
    assert.equal(fromRecords([record({ direction: 'in', kind: 'expense' })])[0].direction, 'in');
    assert.not(fromRecords([record({ direction: 'in' })])[0].inferred);
  });

  test('an older record falls back to its kind, and says that it did', () => {
    const [income] = fromRecords([record({ direction: undefined, kind: 'income' })]);
    assert.equal(income.direction, 'in');
    assert.ok(income.inferred, 'an inferred direction must not pass as a reading');
    assert.not(income.uncertain, 'income is not a guess — only transfers are');
  });

  test('an older transfer is a guess, and is marked as one', () => {
    // A transfer is a transfer in both directions, so `kind` cannot say which.
    // Counting an unknown as money arriving would inflate income, so it is
    // counted as outgoing — and flagged, because it could be wrong.
    const [row] = fromRecords([record({ direction: undefined, kind: 'transfer' })]);
    assert.equal(row.direction, 'out');
    assert.ok(row.uncertain);
  });

  test('confidence counts what was read against what was guessed', () => {
    const rows = fromRecords([
      record(),
      record({ direction: undefined, kind: 'income' }),
      record({ direction: undefined, kind: 'transfer' }),
    ]);
    const sure = confidence(rows);

    assert.equal(sure.total, 3);
    assert.equal(sure.read, 1);
    assert.equal(sure.inferred, 1);
    assert.equal(sure.uncertain, 1);
    assert.not(sure.trustworthy, 'a guessed transfer must not report as trustworthy');
  });

  test('a history written by the current importer is trustworthy', () => {
    assert.ok(confidence(fromRecords([record(), record({ direction: 'in' })])).trustworthy);
  });
});

/* ----------------------------------------------------------- corrections */

describe('a correction reaches the whole history', () => {
  const rows = () => [
    record({ date: '2025-01-04', narration: 'UPI/RAVI KUMAR/2001/paid', direction: 'out' }),
    record({ date: '2026-05-04', narration: 'UPI/RAVI KUMAR/2002/paid', direction: 'out' }),
  ];

  test('the same counterparty gets the same key across years', () => {
    const [a, b] = fromRecords(rows());
    assert.equal(a.counterpartyKey, b.counterpartyKey);
  });

  test('an override applies to transactions imported long before it was made', () => {
    // This is the point of re-reading rather than storing conclusions: naming
    // something once fixes every month, not only the ones imported next.
    const [first] = fromRecords(rows());
    const corrected = fromRecords(rows(), {
      overrides: overridesFrom([{ key: first.counterpartyKey, name: 'Ravi', category: 'rent' }]),
    });

    assert.equal(corrected.length, 2);
    for (const row of corrected) {
      assert.equal(row.category, 'rent');
      assert.equal(row.rule, 'override');
    }
  });

  test('an override list drops entries that name nothing', () => {
    assert.deep(overridesFrom([{ key: 'a', category: 'rent' }, { key: '', category: 'rent' },
      { key: 'b' }, null]), { a: 'rent' });
  });

  test('naming a business moves money out of the stranger column', () => {
    const narration = 'UPI/RIDECO PARTNERS/9001/transfer';
    const plain = fromRecords([record({ narration, direction: 'in' })]);
    const named = fromRecords([record({ narration, direction: 'in' })],
      { businesses: ['RIDECO PARTNERS'] });

    assert.not(plain[0].counterpartyKind === 'business', plain[0].category);
    assert.equal(named[0].counterpartyKind, 'business');
  });
});

/* ------------------------------------------------- the ledgers themselves */

describe('what the screens will show', () => {
  const history = [
    record({ date: '2026-01-05', narration: 'UPI/MEERA R K/1001/lent', amount: 500_000, direction: 'out' }),
    record({ date: '2026-03-05', narration: 'UPI/MEERA R K/1002/returned', amount: 200_000, direction: 'in', kind: 'income' }),
    record({ date: '2026-02-11', narration: 'ACH D- MUTHOOT FINANCE EMI', amount: 150_000, direction: 'out' }),
    record({ date: '2026-02-14', narration: 'UPI/ZOMATO LTD/1004/order', amount: 64_500, direction: 'out' }),
  ];

  test('a person who paid money back appears with both directions netted', () => {
    const [meera] = peopleLedger(fromRecords(history));
    assert.equal(meera.sent, 500_000);
    assert.equal(meera.received, 200_000);
    assert.equal(meera.balance, -300_000);
    assert.ok(meera.reciprocal, 'money went both ways and should be flagged as such');
  });

  test('a lender and a person both appear in the lending ledger', () => {
    const ledger = lendingLedger(fromRecords(history));
    const kinds = new Set(ledger.map((line) => line.kind));
    assert.ok(kinds.has('institution'), 'an EMI should read as a lender');
    assert.ok(kinds.has('person'), 'money both ways with a person is lending');
  });

  test('insights are facts with arithmetic, and every one carries its own text', () => {
    const rows = fromRecords(history);
    const notes = insights(rows, summarise(rows));
    assert.ok(notes.length);
    for (const note of notes) {
      assert.ok(note.kind, 'an insight with no kind cannot be styled or tested');
      assert.ok(note.text.length > 10, note.text);
    }
  });

  test('an empty history produces empty ledgers rather than throwing', () => {
    assert.length(fromRecords([]), 0);
    assert.length(peopleLedger([]), 0);
    assert.length(lendingLedger([]), 0);
    assert.deep(confidence([]), {
      total: 0, read: 0, inferred: 0, uncertain: 0, trustworthy: true,
    });
  });
});
