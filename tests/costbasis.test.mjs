/**
 * What a holding actually cost.
 *
 * `holding.invested` and `holding.units` are typed on the form; every buy and
 * sell is recorded with units, a price, an amount and charges, and nothing
 * re-read them. A fund bought once and then fed a monthly SIP for eleven
 * months reported 162% gain where the transactions said 24.61% — while the
 * same screen showed an XIRR of 34% worked out from those very transactions.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { costBasis, gainOn, describeCostBasis } from '../js/domain/costbasis.js';

setSuite('cost basis');

const HOLDING = {
  id: 'h1', name: 'Parag Parikh Flexi Cap', kind: 'mutual fund',
  units: 100, averageCost: 500_00, invested: 50_000_00,
  currentValue: 1_31_000_00, active: true, deletedAt: null,
};

const txn = (over) => ({
  id: 'x', holding: 'h1', date: '2025-08-14', kind: 'buy',
  units: 100, pricePerUnit: 500_00, amount: 50_000_00, charges: 0,
  deletedAt: null, ...over,
});

describe('what went in', () => {
  test('a SIP moves the invested figure the form never did', () => {
    const rows = [txn({ id: 'x0' })];
    for (let m = 1; m <= 11; m++) {
      rows.push(txn({
        id: `x${m}`, date: `2025-${String(8 + m).padStart(2, '0')}-14`.replace('2025-13', '2026-01'),
        units: 10, pricePerUnit: 500_00, amount: 5_000_00, charges: 12_00,
      }));
    }

    const basis = costBasis(HOLDING, rows);

    assert.equal(basis.invested, 1_05_132_00);
    assert.equal(basis.count, 12);
    assert.equal(basis.from, 'transactions');
    // The form still says what it said. Nothing here overwrote it.
    assert.equal(basis.stored.invested, 50_000_00);
  });

  test('charges are money the household paid to own this', () => {
    // Leaving brokerage, STT and stamp duty out understates the cost and
    // overstates the gain by exactly that much.
    const basis = costBasis(HOLDING, [txn({ charges: 132_00 })]);

    assert.equal(basis.invested, 50_132_00);
    assert.equal(basis.charges, 132_00);
  });

  test('units come from the transactions too', () => {
    const basis = costBasis(HOLDING, [
      txn({ id: 'a', units: 100 }),
      txn({ id: 'b', date: '2025-09-14', units: 9.921, amount: 5_000_00 }),
    ]);

    assert.equal(basis.units, 109.921);
    assert.equal(basis.stored.units, 100);
  });

  test('a missing amount is reconstructed from the price per unit', () => {
    // `pricePerUnit` was recorded on every buy and read by nothing. Where the
    // amount is absent it is the only thing that can say what was paid.
    const basis = costBasis(HOLDING, [
      txn({ amount: null, units: 40, pricePerUnit: 250_00 }),
    ]);

    assert.equal(basis.invested, 10_000_00);
  });

  test('a deleted transaction never happened', () => {
    const basis = costBasis(HOLDING, [
      txn({ id: 'a' }),
      txn({ id: 'b', date: '2025-09-14', amount: 9_000_00, units: 18, deletedAt: '2025-10-01T00:00:00.000Z' }),
    ]);
    assert.equal(basis.invested, 50_000_00);
  });

  test('another holding’s transactions are not this one’s', () => {
    const basis = costBasis(HOLDING, [
      txn({ id: 'a' }),
      txn({ id: 'b', holding: 'h2', amount: 90_000_00 }),
    ]);
    assert.equal(basis.invested, 50_000_00);
  });
});

describe('what came out', () => {
  test('a sale removes cost at the average paid, not at the sale price', () => {
    // 100 at ₹500 then 100 at ₹700 is ₹1,20,000 for 200 units — an average of
    // ₹600. Selling 50 removes ₹30,000 of cost, whatever they fetched.
    const rows = [
      txn({ id: 'a', units: 100, pricePerUnit: 500_00, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-09-14', units: 100, pricePerUnit: 700_00, amount: 70_000_00 }),
      txn({ id: 'c', date: '2025-10-14', kind: 'sell', units: 50, pricePerUnit: 800_00, amount: 40_000_00 }),
    ];

    const basis = costBasis(HOLDING, rows);

    assert.equal(basis.invested, 90_000_00);
    assert.equal(basis.units, 150);
    // Sold for ₹40,000 what had cost ₹30,000.
    assert.equal(basis.realised, 10_000_00);
  });

  test('charges on a sale come out of the proceeds', () => {
    const rows = [
      txn({ id: 'a', units: 100, pricePerUnit: 500_00, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'sell', units: 50, amount: 40_000_00, charges: 500_00 }),
    ];

    assert.equal(costBasis(HOLDING, rows).realised, 14_500_00);
  });

  test('selling everything leaves no cost and no units', () => {
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'sell', units: 100, amount: 60_000_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.units, 0);
    assert.equal(basis.invested, 0);
    assert.equal(basis.realised, 10_000_00);
  });

  test('a sale with no unit count still sold something', () => {
    // Reconstructed from the average, which beats treating the sale as having
    // disposed of nothing at all.
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'sell', units: null, amount: 25_000_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.units, 50);
    assert.equal(basis.invested, 25_000_00);
  });

  test('the order of the transactions decides the average, so it is sorted', () => {
    // The same three records handed over in reverse must give one answer.
    const rows = [
      txn({ id: 'c', date: '2025-10-14', kind: 'sell', units: 50, amount: 40_000_00 }),
      txn({ id: 'b', date: '2025-09-14', units: 100, pricePerUnit: 700_00, amount: 70_000_00 }),
      txn({ id: 'a', date: '2025-08-14', units: 100, pricePerUnit: 500_00, amount: 50_000_00 }),
    ];

    assert.equal(costBasis(HOLDING, rows).invested, 90_000_00);
  });
});

describe('what is not a disposal', () => {
  test('a dividend is a return, and leaves the cost alone', () => {
    // Reducing the cost every time a stock pays out would eventually report it
    // as having cost nothing.
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'dividend', units: null, amount: 1_200_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.invested, 50_000_00);
    assert.equal(basis.units, 100);
    assert.equal(basis.income, 1_200_00);
    assert.equal(basis.realised, 0);
  });

  test('bonus units cost nothing and lower the average on their own', () => {
    // The amount is deliberately filled in: a bonus issue is often recorded
    // with the notional value of the units received, and treating that as
    // money spent would inflate the cost by an amount nobody paid. A fixture
    // leaving it null makes the whole rule vacuous — found by mutation.
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'bonus', units: 100, amount: 70_000_00, pricePerUnit: 700_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.invested, 50_000_00);
    assert.equal(basis.units, 200);
    // The average halves because the units doubled for nothing.
    assert.equal(gainOn(basis, 1_40_000_00).gainPercent, 180);
  });

  test('and a split the same way', () => {
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'split', units: 900, amount: 4_50_000_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.invested, 50_000_00);
    assert.equal(basis.units, 1000);
  });

  test('a charge is money out with nothing acquired', () => {
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'charge', units: null, amount: 500_00 }),
    ];

    const basis = costBasis(HOLDING, rows);
    assert.equal(basis.invested, 50_500_00);
    assert.equal(basis.units, 100);
  });
});

describe('where it refuses to replace a figure', () => {
  test('no transactions means the form is all there is, and it says so', () => {
    const basis = costBasis(HOLDING, []);

    assert.equal(basis.from, 'stored');
    assert.equal(basis.invested, 50_000_00);
    assert.equal(basis.units, 100);
    assert.includes(basis.why, 'all there is');
  });

  test('a history starting halfway through is named, not trusted silently', () => {
    // The dangerous case: derived is *lower* than stored because the earliest
    // purchases were never recorded. Replacing a right number with a wrong one
    // is worse than the gap this exists to close.
    const basis = costBasis(HOLDING, [txn({ amount: 20_000_00, units: 40 })]);

    assert.equal(basis.invested, 20_000_00);
    assert.equal(basis.difference, -30_000_00);
    assert.includes(basis.why, 'earliest purchases were never recorded');
    assert.includes(describeCostBasis(basis, (n) => String(n)), 'earliest purchases');
  });

  test('and where they agree there is nothing to report', () => {
    const basis = costBasis(HOLDING, [txn({})]);
    assert.equal(basis.difference, 0);
    assert.equal(basis.why, null);
  });

  test('nothing at all is not an error', () => {
    assert.equal(costBasis(undefined, undefined).from, 'stored');
    assert.equal(describeCostBasis(null), null);
  });
});

describe('the gain, against what really went in', () => {
  test('the measured case: 162% becomes 24.61%', () => {
    const rows = [txn({ id: 'x0' })];
    for (let m = 1; m <= 11; m++) {
      rows.push(txn({
        id: `x${m}`, date: `2026-01-${String(m).padStart(2, '0')}`,
        units: 10, amount: 5_000_00, charges: 12_00,
      }));
    }

    const basis = costBasis(HOLDING, rows);
    const gain = gainOn(basis, HOLDING.currentValue);

    assert.equal(gain.invested, 1_05_132_00);
    assert.equal(gain.gain, 25_868_00);
    assert.equal(gain.gainPercent, 24.61);
  });

  test('money already taken out counts towards the gain', () => {
    // A fund sold down to nothing that returned more than it took has not lost
    // everything, and counting only the remaining units would say exactly that.
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'sell', units: 100, amount: 60_000_00 }),
    ];

    const gain = gainOn(costBasis(HOLDING, rows), 0);
    assert.equal(gain.realised, 10_000_00);
    assert.equal(gain.gain, 10_000_00);
  });

  test('and so do dividends', () => {
    const rows = [
      txn({ id: 'a', units: 100, amount: 50_000_00 }),
      txn({ id: 'b', date: '2025-10-14', kind: 'dividend', units: null, amount: 2_000_00 }),
    ];

    const gain = gainOn(costBasis(HOLDING, rows), 50_000_00);
    assert.equal(gain.gain, 2_000_00);
  });

  test('nothing invested has no percentage rather than a zero', () => {
    const gain = gainOn(costBasis({ id: 'h9' }, []), 1_000_00);
    assert.equal(gain.gainPercent, null);
  });
});

describe('the sentence', () => {
  test('names the count and the charges inside the figure', () => {
    const basis = costBasis(HOLDING, [txn({ charges: 132_00 })]);
    const said = describeCostBasis(basis, (n) => `Rs${n}`);

    assert.includes(said, '1 transaction');
    assert.includes(said, 'including Rs13200 of charges');
  });

  test('and says when the form disagrees', () => {
    const basis = costBasis(HOLDING, [
      txn({ id: 'a' }),
      txn({ id: 'b', date: '2025-09-14', amount: 20_000_00, units: 40 }),
    ]);

    assert.includes(describeCostBasis(basis, (n) => String(n)), 'The form says 5000000');
  });
});
