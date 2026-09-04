import { test, describe, assert, setSuite } from './harness.mjs';
import {
  fromRecords, confidence, overridesFrom, ENTERED_CATEGORIES,
} from '../js/domain/ledger.js';
import {
  peopleLedger, lendingLedger, summarise, CATEGORIES, categoryKind,
  classify, RULES,
} from '../js/domain/categorise.js';
import { insights } from '../js/domain/insights.js';
import { entity } from '../js/data/schema.js';

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

  test('including the one for payments nothing could categorise', () => {
    /*
     * Every other note in that list was reached by the fixture above. This one
     * needs a row whose rule is `unmatched`, and no fixture had one, so the
     * only branch in `insights` that calls the module's `total` helper was
     * never run. Moving `insights` to its own file left that helper behind and
     * the whole suite stayed green: a `ReferenceError` on the screen of any
     * household with an uncategorised payment, which is most of them.
     *
     * The type checker caught it. This is what catches the next one.
     */
    const rows = [
      { id: 'u1', rule: 'unmatched', direction: 'out', amount: 250000, date: '2026-08-02',
        description: 'PAYTM 8829', categoryKind: 'spending', category: 'other-spend' },
      { id: 'u2', rule: 'unmatched', direction: 'out', amount: 145000, date: '2026-08-04',
        description: 'NEFT 41182', categoryKind: 'spending', category: 'other-spend' },
    ];
    const note = insights(rows, summarise(rows)).find((n) => n.kind === 'coverage');
    assert.ok(note, 'two unmatched payments should produce a coverage note');
    assert.equal(note.amount, 395000);
    assert.ok(note.text.includes('2 payments'), note.text);
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

/* ------------------------------------------- what somebody typed in by hand */

/**
 * Exactly what the transaction form produces: a category picked from a
 * dropdown, a free-text payee, and **no narration** — that field is hidden and
 * only the importer writes it.
 */
const typed = (over = {}) => ({
  id: `h${Math.random().toString(36).slice(2, 8)}`,
  date: '2026-07-05',
  amount: 100_000,
  kind: 'expense',
  direction: 'out',
  account: 'acc1',
  category: 'groceries',
  payee: 'Big Bazaar',
  ...over,
});

describe('a category somebody chose from the form', () => {
  test('is not thrown away and replaced by a guess from the payee', () => {
    // Measured before this existed: none of five hand-entered categories
    // survived. The form offers forty-odd options and the ledger read none of
    // them, because `fromRecords` never passed `record.category` through.
    const [row] = fromRecords([typed()]);

    assert.equal(row.category, 'groceries');
    assert.equal(row.rule, 'entered');
  });

  test('and a shop is not a person merely because its name has two words', () => {
    // `looksLikePerson` accepts any one-to-four capitalised words with no
    // company suffix, so "Big Bazaar", "Truffles" and "Dr Anita Rao" all read
    // as people. That put them in the people ledger and had the insights
    // announce that three *people* had taken money and not returned it.
    const rows = fromRecords([
      typed({ payee: 'Big Bazaar', category: 'groceries' }),
      typed({ payee: 'Truffles', category: 'dining' }),
      typed({ payee: 'Dr Anita Rao', category: 'health' }),
    ]);

    for (const row of rows) assert.not(row.isP2P, `${row.description} is not a person`);
    assert.length(peopleLedger(rows), 0);
  });

  test('so spending stays spending instead of becoming a transfer', () => {
    // The wrong number this produced. ₹62,500 of ₹71,700 was moved out of the
    // spending total and reported as money sent to people.
    const rows = fromRecords([
      typed({ payee: 'Big Bazaar', category: 'groceries', amount: 12_000_00 }),
      typed({ payee: 'Landlord', category: 'rent', amount: 40_000_00 }),
      typed({ payee: 'Dr Anita Rao', category: 'health', amount: 8_000_00 }),
    ]);
    const totals = summarise(rows);

    assert.equal(totals.moneyOut, 60_000_00);
    assert.equal(totals.spending, 60_000_00);
    assert.equal(totals.transfersOut, 0);
  });

  test('and nothing tells the household that a supermarket owes them money', () => {
    const rows = fromRecords([
      typed({ payee: 'Big Bazaar', category: 'groceries', amount: 12_000_00 }),
      typed({ payee: 'Landlord', category: 'rent', amount: 40_000_00 }),
    ]);

    const said = insights(rows, summarise(rows)).map((note) => note.text).join(' ');
    assert.not(/people have taken more/.test(said), said);
  });

  test('and the row itself stops calling a supermarket a person', () => {
    // Locked directly rather than through a ledger. `peopleLedger` filters on
    // `isP2P`, so no screen notices this field — but `tools/statement.mjs`
    // dumps it to CSV, where somebody would read "person" next to Big Bazaar.
    const [row] = fromRecords([typed({ payee: 'Big Bazaar', category: 'groceries' })]);
    assert.equal(row.counterpartyKind, 'merchant');
  });

  test('rent and maintenance land where the importer already puts them', () => {
    // Not a loss introduced here: the importer's own `utility` rule matches
    // both words and files them as bills.
    assert.equal(fromRecords([typed({ category: 'rent' })])[0].category, 'bills');
    assert.equal(fromRecords([typed({ category: 'maintenance' })])[0].category, 'bills');
  });

  test('a category with no mapping still lands in the right half', () => {
    // `business` is ambiguous — earning from one and putting capital into one
    // are opposite movements. Guessing which would be worse than keeping it
    // uncategorised on the correct side.
    const out = fromRecords([typed({ category: 'business', kind: 'expense' })])[0];
    const inward = fromRecords([typed({
      category: 'business', kind: 'income', direction: 'in',
    })])[0];

    assert.equal(out.category, 'other-spend');
    assert.equal(out.categoryKind, 'spending');
    assert.equal(inward.category, 'other-income');
    assert.equal(inward.categoryKind, 'income');
  });

  test('money genuinely sent to a person is still money sent to a person', () => {
    // The correction must not work only in one direction. A household that
    // picks "sent to person" should end up in the people ledger.
    const rows = fromRecords([typed({ payee: 'Ravi Kumar', category: 'sent to person' })]);

    assert.equal(rows[0].category, 'p2p-out');
    assert.ok(rows[0].isP2P);
    assert.length(peopleLedger(rows), 1);
  });
});

describe('the mapping between the two vocabularies', () => {
  /**
   * `other` is the dropdown's default and `business` is genuinely ambiguous —
   * earning from one and putting capital into one are opposite movements. Both
   * fall through on purpose, and naming them here is what stops the
   * exhaustiveness check below from quietly accepting a third.
   */
  const DELIBERATELY_UNMAPPED = new Set(['other', 'business']);

  test('every option on the form has somewhere to go', () => {
    // A new category added to the schema and forgotten here would fall back to
    // "uncategorised", which is not wrong but is a silent loss. This makes
    // adding one to the schema fail until somebody decides where it belongs.
    const missing = entity('transaction').fieldMap.category.options
      .filter((option) => !DELIBERATELY_UNMAPPED.has(option))
      .filter((option) => !ENTERED_CATEGORIES[option]);

    assert.length(missing, 0, missing.join(', '));
  });

  test('and every destination is a category that actually exists', () => {
    const keys = new Set(CATEGORIES.map((category) => category.key));
    const unknown = Object.entries(ENTERED_CATEGORIES)
      .filter(([, key]) => !keys.has(key))
      .map(([from, key]) => `${from} → ${key}`);

    assert.length(unknown, 0, unknown.join(', '));
  });

  test('the ones a household would notice if they were wrong', () => {
    // The exhaustiveness checks above pass for any table of valid keys, so a
    // scrambled mapping would survive them — dining filed as retail is still a
    // real spending category. These are pinned by hand.
    const expected = {
      dining: 'restaurant',
      groceries: 'groceries',
      health: 'healthcare',
      education: 'education',
      fuel: 'fuel',
      EMI: 'emi',
      salary: 'salary',
      'sent to person': 'p2p-out',
      'own account': 'self-transfer',
      invested: 'investment-out',
    };

    for (const [chosen, key] of Object.entries(expected)) {
      assert.equal(ENTERED_CATEGORIES[chosen], key, `${chosen} should be ${key}`);
    }
  });

  test('an income category never lands on the spending side, or the reverse', () => {
    // The half of the report a category lands in is the part that changes a
    // total, so it is checked separately from the label.
    const income = ['salary', 'business income', 'interest', 'refund', 'loan received'];
    const spending = ['groceries', 'dining', 'rent', 'health', 'fuel', 'EMI', 'tax'];

    for (const chosen of income) {
      assert.equal(categoryKind(ENTERED_CATEGORIES[chosen]), 'income', chosen);
    }
    for (const chosen of spending) {
      assert.equal(categoryKind(ENTERED_CATEGORIES[chosen]), 'spending', chosen);
    }
  });
});

describe('what the form is not allowed to overrule', () => {
  test('an imported row is still re-read from its narration', () => {
    // The design this sits inside. An imported row's category is derived, and
    // re-deriving it at read time is what makes a correction retroactive
    // across years. Only rows with no narration are the household's own word.
    const [row] = fromRecords([record({
      narration: 'UPI/ZOMATO LTD/1004/order', category: 'groceries',
    })]);

    assert.equal(row.category, 'food-delivery');
    assert.not(row.rule === 'entered', row.rule);
  });

  test('the dropdown default is not a choice', () => {
    // `other` is what the field holds when nobody touched it. Treating it as
    // deliberate would switch the categoriser off for most records.
    const [row] = fromRecords([typed({ category: 'other', payee: 'Ravi Kumar' })]);

    assert.not(row.rule === 'entered', row.rule);
    assert.ok(row.isP2P, 'with no category chosen, the heuristic still runs');
  });

  test('a missing category is not a choice either', () => {
    const [row] = fromRecords([typed({ category: undefined, payee: 'Ravi Kumar' })]);
    assert.not(row.rule === 'entered', row.rule);
  });

  test('a counterparty the household marked as their own business stays theirs', () => {
    // `self` and `business` come from configuration the household entered
    // deliberately, not from a heuristic over a name. A category should move a
    // row out of the *person* column and no further.
    const [row] = fromRecords(
      [typed({ payee: 'Rideco Partners', category: 'shopping' })],
      { businesses: ['Rideco Partners'] },
    );

    assert.equal(row.counterpartyKind, 'business');
    assert.equal(row.category, 'retail');
  });

  test('a per-record choice beats a per-counterparty override', () => {
    // A judgement call, and the reasoning is worth keeping. An override is a
    // blanket statement about a *name*, and for a hand-entered row that name
    // is the same weak free-text payee this whole block exists to stop
    // trusting. The choice made on the record itself is the narrower evidence,
    // so it wins — and a household that disagrees can edit the record, which
    // is the natural way to fix one.
    const rows = fromRecords([typed({ payee: 'Big Bazaar', category: 'gifts' })], {
      overrides: overridesFrom([{ key: 'big bazaar', name: 'Big Bazaar', category: 'groceries' }]),
    });

    assert.equal(rows[0].category, 'other-spend');
    assert.equal(rows[0].rule, 'entered');
  });
});

/*
 * The rules that can take money out of spending.
 *
 * `internal` is not a category like the others. `summarise` keeps it out of
 * both spending and income, because moving your own money between your own
 * pockets is not an economic event — which is right, and which means a false
 * positive here does not mis-file a payment, it *deletes* it from what the
 * household believes it spent. Nothing tells them; the total is simply
 * smaller.
 *
 * So these rules are held to a higher bar than the rest: an ordinary word must
 * not be enough on its own. Both directions are checked, because deleting the
 * rules would satisfy the first half and lose every real investment.
 */
describe('a rule that removes money from spending', () => {
  const kindOf = (description) => categoryKind(
    classify({ description, direction: 'out', amount: 2500, date: '2026-08-01' }).category,
  );

  /*
   * Real Indian merchant names, each of which the patterns used to swallow.
   * `KITE CAFE` and `KITEX GARMENTS` matched a bare `kite`; `NIPPON PAINT`
   * and a rent transfer through `BANDHAN BANK` matched a bare fund-house
   * name; `AMC FOR AIR CONDITIONER` matched `\bamc\b`, which in an Indian
   * statement is more often an annual maintenance contract than an asset
   * management company.
   */
  const SPENDING = [
    'UPI/KITE CAFE BENGALURU/Payment',
    'POS/KITEX GARMENTS LTD',
    'UPI/NIPPON PAINT INDIA/paint',
    'UPI/AMC FOR AIR CONDITIONER/service',
    'NEFT/BANDHAN BANK LTD/rent to landlord',
    'POS/DIGITAL XEROX CENTRE',
    'UPI/QUANT SURVEYORS PVT LTD',
    'UPI/AXIS TOOLS AND HARDWARE',
  ];

  for (const description of SPENDING) {
    test(`${description.slice(0, 44)} is spending, not an internal transfer`, () => {
      assert.not(kindOf(description) === 'internal',
        `classified internal, so it vanishes from the household's spending`);
    });
  }

  /*
   * And the other direction. Without these the whole guard is satisfied by
   * deleting the broker and mutual-fund rules, which would put every real
   * investment back into spending — the same error pointing the other way.
   */
  const INVESTMENT = [
    'UPI/ZERODHA BROKING LTD',
    'NEFT/NIPPON INDIA MF SIP INSTALMENT',
    'NEFT/HDFC MF PURCHASE',
    'ACH/GROWW INVEST TECH',
    'NEFT/INDIAN CLEARING CORP',
  ];

  for (const description of INVESTMENT) {
    test(`${description.slice(0, 44)} is still internal`, () => {
      assert.equal(kindOf(description), 'internal',
        'a real investment counted as spending overstates what was consumed');
    });
  }

  test('only three rules can produce an internal category at all', () => {
    // The premise. A fourth would need the same scrutiny, and this is where
    // somebody adding one finds that out.
    const internalRules = RULES.filter((rule) => categoryKind(rule.out) === 'internal'
      || categoryKind(rule.in) === 'internal').map((rule) => rule.key);
    assert.deep(internalRules.sort(), ['broker', 'mutual-fund', 'sweep']);
  });
});
