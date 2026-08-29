import { test, describe, assert, setSuite } from './harness.mjs';
import {
  REFUSED, readKind, readTrade, readUnits, matchHolding, planTrades,
  toInvestmentTransaction,
} from '../js/domain/tradebook.js';

setSuite('tradebook');

/**
 * Money is stored in minor units — paise — everywhere in this schema, so
 * `15000` in a file is `1500000` in a record. Written out rather than hidden
 * behind a helper: the first version of `tradebook.js` ran a share count
 * through the money reader and inflated every holding a hundredfold, and this
 * is the line that would have made that obvious sooner.
 */
const paise = (rupees) => rupees * 100;

const MAPPING = {
  date: 'Trade Date', symbol: 'Symbol', kind: 'Type',
  units: 'Qty', pricePerUnit: 'Price', amount: 'Value', charges: 'Brokerage',
};

const row = (over = {}) => ({
  'Trade Date': '2026-04-15', Symbol: 'INFY', Type: 'BUY',
  Qty: '10', Price: '1500', Value: '15000', Brokerage: '20', ...over,
});

const HOLDINGS = [
  { id: 'h_infy', name: 'Infosys', symbol: 'INFY' },
  { id: 'h_tcs', name: 'TCS', symbol: 'TCS' },
];

describe('reading one row', () => {
  test('a whole row becomes a trade', () => {
    const { trade } = readTrade(row(), MAPPING);
    assert.equal(trade.symbol, 'INFY');
    assert.equal(trade.kind, 'buy');
    // Units are a count and stay one; the money is in paise.
    assert.equal(trade.units, 10);
    assert.equal(trade.amount, paise(15000));
    assert.equal(trade.charges, paise(20));
    assert.not(trade.derivedAmount);
  });

  test('a missing total is worked out, and says that it was', () => {
    // Safe arithmetic the household can check. Charges are deliberately not
    // folded in — this is the gross, and `charges` stays its own field.
    const { trade } = readTrade(row({ Value: '' }), MAPPING);
    assert.equal(trade.amount, paise(15000));
    assert.ok(trade.derivedAmount, 'a worked-out figure was passed off as one the file stated');
  });

  test('and with nothing to work it out from, the row is refused', () => {
    // Never a zero. A trade imported as ₹0 lands in a P&L calculation.
    const out = readTrade(row({ Value: '', Price: '' }), MAPPING);
    assert.equal(out.why, REFUSED.amount);
    assert.equal(out.trade, undefined);
  });
});

describe('units are a count, not money', () => {
  test('a share count is never scaled by the currency', () => {
    /*
     * The bug this file caught. `readAmount` returns paise, because that is
     * how every `money` field is stored; the first draft read `units` with it
     * too, so ten shares became a thousand and `units * pricePerUnit` came out
     * in paise-squared. A holding inflated a hundredfold is not a rounding
     * error — it is a portfolio saying something untrue about somebody's money.
     */
    assert.equal(readUnits('10'), 10);
    assert.equal(readUnits('1,250'), 1250);
    assert.equal(readUnits('0.5'), 0.5);
    assert.equal(readUnits('12.3456'), 12.3456);
    assert.equal(readUnits(''), null);
    assert.equal(readUnits('ten'), null);
  });

  test('and the derived total is a count times a price, in paise', () => {
    const { trade } = readTrade(row({ Qty: '3', Price: '250.50', Value: '' }), MAPPING);
    assert.equal(trade.units, 3);
    assert.equal(trade.amount, paise(751.5));
  });

  test('a fractional unit count survives, because mutual funds have them', () => {
    const { trade } = readTrade(row({ Qty: '104.567', Value: '' , Price: '10' }), MAPPING);
    assert.equal(trade.units, 104.567);
  });
});

describe('what a row must say before it is believed', () => {
  test('an unreadable date is refused', () => {
    assert.equal(readTrade(row({ 'Trade Date': 'sometime' }), MAPPING).why, REFUSED.date);
  });

  test('a row naming no instrument is refused', () => {
    assert.equal(readTrade(row({ Symbol: '  ' }), MAPPING).why, REFUSED.symbol);
  });

  test('a direction this does not recognise is refused, never guessed', () => {
    /*
     * `kind` decides whether units go up or down. Guessing it wrong turns a
     * purchase into a disposal in somebody's capital-gains position, so an
     * unrecognised word stops the row rather than defaulting to a buy.
     */
    assert.equal(readTrade(row({ Type: 'SQUARE-OFF' }), MAPPING).why, REFUSED.kind);
    assert.equal(readTrade(row({ Type: '' }), MAPPING).why, REFUSED.kind);
  });

  test('the words tradebooks actually print are recognised', () => {
    for (const word of ['BUY', 'b', 'Bought', 'purchase']) assert.equal(readKind(word), 'buy');
    for (const word of ['SELL', 's', 'Sold', 'Sale']) assert.equal(readKind(word), 'sell');
    assert.equal(readKind('transfer'), null);
  });
});

describe('which holding a trade belongs to', () => {
  test('an exact symbol matches', () => {
    assert.equal(matchHolding('INFY', HOLDINGS).holding.id, 'h_infy');
    assert.equal(matchHolding('  infy ', HOLDINGS).holding.id, 'h_infy');
  });

  test('a name matches when no symbol does', () => {
    assert.equal(matchHolding('Infosys', HOLDINGS).holding.id, 'h_infy');
  });

  test('two candidates is not a match', () => {
    /*
     * The same ticker in two folios is two genuinely different positions.
     * Picking one would put a year of trades against the wrong cost basis,
     * and the rule is never to force an uncertain match.
     */
    const twice = [...HOLDINGS, { id: 'h_infy2', name: 'Infosys (NRE)', symbol: 'INFY' }];
    assert.equal(matchHolding('INFY', twice).why, 'ambiguous');
    assert.equal(matchHolding('INFY', twice).holding, undefined);
  });

  test('an unknown symbol is reported, not invented', () => {
    assert.equal(matchHolding('WIPRO', HOLDINGS).why, 'unknown');
  });

  test('a deleted holding does not match', () => {
    const gone = [{ id: 'h_x', symbol: 'INFY', deletedAt: '2026-01-01T00:00:00.000Z' }];
    assert.equal(matchHolding('INFY', gone).why, 'unknown');
  });
});

describe('planning an import', () => {
  test('refuses to start without the columns it needs', () => {
    const out = planTrades([row()], { mapping: { date: 'Trade Date' }, holdings: HOLDINGS });
    assert.not(out.ready);
    assert.deep(out.missing.sort(), ['amount', 'kind', 'symbol']);
    assert.length(out.planned, 0);
  });

  test('every row lands in exactly one bucket', () => {
    // A household that downloaded rows and sees fewer imported is owed the
    // rest, by name.
    const out = planTrades([
      row(),
      row({ Symbol: 'WIPRO' }),
      row({ 'Trade Date': 'sometime' }),
    ], { mapping: MAPPING, holdings: HOLDINGS });

    assert.ok(out.ready);
    assert.length(out.planned, 1);
    assert.length(out.unmatched, 1);
    assert.length(out.refused, 1);
    assert.equal(out.unmatched[0].symbol, 'WIPRO');
    assert.equal(out.refused[0].row, 3);
  });

  test('two identical fills are two trades, not one', () => {
    /*
     * Partial fills of one order print identically. Collapsing them would
     * understate a holding for ever, which is the failure `import.js` warns
     * about for bank narrations and is worse here.
     */
    const out = planTrades([row(), row()], { mapping: MAPPING, holdings: HOLDINGS });
    assert.length(out.planned, 2);
    assert.not(out.planned[0].fingerprint === out.planned[1].fingerprint,
      'two real fills were given the same fingerprint');
  });

  test('re-importing the same file adds nothing', () => {
    const first = planTrades([row(), row()], { mapping: MAPPING, holdings: HOLDINGS });
    const stored = first.planned.map((p) => ({
      holding: p.holding, date: p.date, kind: p.kind, units: p.units,
      amount: p.amount, reference: p.reference,
    }));

    const again = planTrades([row(), row()],
      { mapping: MAPPING, holdings: HOLDINGS, existing: stored });

    assert.length(again.planned, 0);
    assert.equal(again.duplicates, 2);
  });

  test('and a file with one more fill adds exactly one', () => {
    const stored = planTrades([row(), row()], { mapping: MAPPING, holdings: HOLDINGS })
      .planned.map((p) => ({
        holding: p.holding, date: p.date, kind: p.kind, units: p.units,
        amount: p.amount, reference: p.reference,
      }));

    const again = planTrades([row(), row(), row()],
      { mapping: MAPPING, holdings: HOLDINGS, existing: stored });

    assert.length(again.planned, 1);
    assert.equal(again.duplicates, 2);
  });

  test('a broker trade id separates rows a file otherwise prints twice', () => {
    const mapping = { ...MAPPING, reference: 'Trade ID' };
    const out = planTrades([
      row({ 'Trade ID': 'T1' }),
      row({ 'Trade ID': 'T2' }),
    ], { mapping, holdings: HOLDINGS });

    assert.length(out.planned, 2);
    assert.ok(out.planned[0].fingerprint.includes('T1'));
    assert.ok(out.planned[1].fingerprint.includes('T2'));
  });
});

describe('what is written, and what is not', () => {
  test('the record carries no settlement account', () => {
    /*
     * `account` means "settled through" and a tradebook does not say which
     * bank account paid. Filling it from the household's only account would
     * be a guess written into a financial record.
     */
    const { planned } = planTrades([row()], { mapping: MAPPING, holdings: HOLDINGS });
    const record = toInvestmentTransaction(planned[0]);

    assert.equal(record.account, undefined);
    assert.equal(record.holding, 'h_infy');
    assert.equal(record.amount, paise(15000));
    assert.equal(record.kind, 'buy');
  });

  test('nothing here produces a bank transaction', () => {
    // Money moving from a bank to a broker is not an expense, and
    // `categorise.js` already files those transfers as internal. A trade that
    // also wrote a `transaction` row would count the same rupees twice.
    const { planned } = planTrades([row()], { mapping: MAPPING, holdings: HOLDINGS });
    const record = toInvestmentTransaction(planned[0]);
    assert.not('direction' in record);
    assert.not('narration' in record);
    assert.not('category' in record);
  });

  test('the fingerprint is not stored on the record', () => {
    // It is import bookkeeping, not a fact about the trade.
    const { planned } = planTrades([row()], { mapping: MAPPING, holdings: HOLDINGS });
    assert.equal(toInvestmentTransaction(planned[0]).fingerprint, undefined);
  });
});
