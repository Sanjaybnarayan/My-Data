/**
 * A deposit is not a person.
 *
 * The audit's Case 6 called this "wrong label, safe number": `FD BOOKING HDFC
 * DEPOSIT` read as `p2p-out`, which is `transfer` rather than `spending`, so
 * a new fixed deposit was never reported as an expense.
 *
 * The number was indeed safe. What a household actually reads was not — the
 * deposit was listed in the **people ledger** as somebody money had been sent
 * to, with `counterpartyKind: 'person'` written out beside it to CSV.
 *
 * The cause was three tables in `domain/categorise.js` each carrying their own
 * pattern for the same concept. What is checked hardest here is that they
 * agree, because that is the thing that drifted.
 */

import { readFileSync } from 'node:fs';
import { test, describe, assert, setSuite } from './harness.mjs';
import {
  classify, channelOf, counterpartyOf, peopleLedger, summarise, categoryKind, DEPOSIT,
} from '../js/domain/categorise.js';

setSuite('deposit');

/** Every way the banks in these statements write a deposit. */
const DEPOSITS = [
  'FD BOOKING HDFC DEPOSIT',
  'FD BOOKING 50300123456789',
  'FD PREMAT CLOSURE 4417',
  'FD PROCEEDS 50300123',
  'FD RENEWAL 998877',
  'FIXED DEPOSIT OPENING',
  'TERM DEPOSIT BOOKING',
  'TD RENEWAL 12345',
  'RECURRING DEPOSIT 00123',
  'RD INSTALMENT HDFC',
  'SWEEP TRANSFER TO FD',
  'AUTO SWEEP DEPOSIT',
];

/**
 * Things that must never become a deposit.
 *
 * `CASH DEPOSIT` is money paid in at a machine and `SECURITY DEPOSIT` is money
 * a landlord is holding — neither is the household's own savings moving to its
 * own deposit. The rest are the short forms: Indian addresses abbreviate
 * *road* as `RD`, and matching the bare letters would have turned a branch on
 * MG Road into a recurring deposit.
 */
const NOT_DEPOSITS = [
  'CDM CASH DEPOSIT SELF',
  'CASH DEPOSIT BRANCH',
  'SECURITY DEPOSIT LANDLORD',
  'UPI/MG RD BRANCH/PAY',
  'ATM 100 FT RD KORAMANGALA',
  'RD SHARMA CONSULTANCY',
  'TD WATERHOUSE ADVISORY',
  'FD ENTERPRISES PVT LTD',
  'UPI/FD TRADERS/PAY',
  'CHIMNEY SWEEPS LTD',
  'DEPOSIT INSURANCE PREMIUM',
  'SWEEPSTAKES WINNINGS',
  'NEFT ZERODHA BROKING LTD',
  'UPI TO RAMESH KUMAR',
];

// `date` is supplied because `classify` has no declared parameter type, so
// the checker infers one from its call sites — a fixture omitting a field
// every other caller passes widens that inference and reports errors in
// `categorise.js` itself.
const DAY = '2026-08-01';
const out = (description) => classify({ description, date: DAY, amount: 500_000, direction: 'out' });

describe('the case the audit named', () => {
  test('FD BOOKING is no longer money sent to a person', () => {
    const row = out('FD BOOKING HDFC DEPOSIT');
    assert.equal(row.category, 'sweep');
    assert.equal(row.isP2P, false);
    assert.equal(row.counterpartyKind, 'merchant');
  });

  test('and the number it was already right about has not moved', () => {
    // The invariant the audit checked and found holding. It has to survive
    // this change, or a fix for a label would have broken a total.
    const rows = [
      out('FD BOOKING HDFC DEPOSIT'),
      classify({ description: 'ZOMATO ORDER', date: DAY, amount: 45_000, direction: 'out' }),
    ];
    assert.equal(summarise(rows).spending, 45_000);
    assert.equal(categoryKind('sweep'), 'internal');
  });
});

describe('what a household actually reads', () => {
  test('a deposit is not listed among the people money was sent to', () => {
    const rows = [
      out('FD BOOKING HDFC DEPOSIT'),
      out('RD INSTALMENT HDFC'),
      out('UPI TO RAMESH KUMAR'),
    ];
    const people = peopleLedger(rows).map((entry) => entry.person ?? entry.name
      ?? entry.counterparty);
    assert.length(people, 1);
    assert.includes(String(people[0]), 'RAMESH');
  });

  test('and is named as a deposit rather than by its account number', () => {
    assert.equal(counterpartyOf('FD BOOKING 50300123456789'), 'Your own deposit');
    assert.equal(counterpartyOf('RD INSTALMENT HDFC'), 'Your own deposit');
  });

  test('a recurring deposit is not called a fixed one', () => {
    // The literal used to be `Fixed deposit`, which was true of everything the
    // narrower pattern matched. Widening it without changing the words would
    // have replaced one wrong label with another.
    assert.equal(counterpartyOf('RECURRING DEPOSIT 00123').toLowerCase().includes('fixed'),
      false);
  });
});

describe('the three tables agree', () => {
  test('every deposit narration reads as one on all three axes', () => {
    // The guard. A deposit is a concept the rail table, the counterparty
    // table and the category table each have to recognise, and before this
    // they each had their own pattern and disagreed. `FD BOOKING` matched the
    // rail one and neither of the others: the application knew it had
    // travelled on the deposit rail and called it a person anyway.
    for (const description of DEPOSITS) {
      const row = out(description);
      assert.equal(channelOf(description), 'sweep', `${description}: rail`);
      assert.equal(counterpartyOf(description), 'Your own deposit',
        `${description}: counterparty`);
      assert.equal(row.category, 'sweep', `${description}: category`);
      assert.equal(row.categoryKind, 'internal', `${description}: kind`);
      assert.equal(row.isP2P, false, `${description}: listed as a person`);
    }
  });

  test('in both directions', () => {
    for (const description of DEPOSITS) {
      const row = classify({ description, date: DAY, amount: 500_000, direction: 'in' });
      assert.equal(row.category, 'sweep', description);
      assert.equal(row.isP2P, false, description);
    }
  });

  test('and there is one pattern, not three', () => {
    // Written as a source check because the drift was invisible any other
    // way: three regexes that each looked reasonable on their own line.
    const source = readFileSync(new URL('../js/domain/categorise.js', import.meta.url), 'utf8');
    const uses = source.split('match: DEPOSIT').length - 1;
    assert.equal(uses, 3, `DEPOSIT is read by ${uses} tables, expected 3`);

    // And no table has quietly grown a second copy beside it. Comment lines
    // are skipped, because the block above `DEPOSIT` quotes all three of the
    // old patterns on purpose — the record of what drifted is worth keeping,
    // and a check that could not tell it from live code would have forced its
    // deletion.
    const code = source.split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));
    const strays = code.filter((line) => /FD PREMAT|sweep transfer/i.test(line));
    assert.deep(strays, []);
  });
});

describe('what must never become a deposit', () => {
  test('money paid in at a machine, and money a landlord holds', () => {
    for (const description of ['CDM CASH DEPOSIT SELF', 'CASH DEPOSIT BRANCH',
      'SECURITY DEPOSIT LANDLORD']) {
      assert.equal(DEPOSIT.test(description), false, description);
    }
  });

  test('a road abbreviated the way Indian addresses abbreviate it', () => {
    for (const description of ['UPI/MG RD BRANCH/PAY', 'ATM 100 FT RD KORAMANGALA']) {
      assert.equal(DEPOSIT.test(description), false, description);
    }
  });

  test('nor a person or a firm whose name starts with the same letters', () => {
    // `FD ENTERPRISES` is the one that was missing. Every short form here
    // requires the word that follows it, and nothing checked that for `FD`
    // until a mutation loosened it to the bare letters and no test noticed.
    for (const description of ['RD SHARMA CONSULTANCY', 'TD WATERHOUSE ADVISORY',
      'FD ENTERPRISES PVT LTD', 'UPI/FD TRADERS/PAY',
      'CHIMNEY SWEEPS LTD', 'SWEEPSTAKES WINNINGS']) {
      assert.equal(DEPOSIT.test(description), false, description);
    }
  });

  test('the whole list of them, through the categoriser', () => {
    for (const description of NOT_DEPOSITS) {
      assert.equal(out(description).category === 'sweep', false,
        `${description} was read as a deposit`);
    }
  });

  test('and a broker is still a broker', () => {
    // The deposit rule is matched before the broker one, so widening it could
    // have swallowed Case 5 — which passes and must go on passing.
    assert.equal(out('NEFT ZERODHA BROKING LTD').category, 'investment-out');
  });
});
