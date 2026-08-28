import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { roundMoney, divide, mul, percent, toMinor } from '../js/core/money.js';
import { monthlyCost } from '../js/domain/commitments.js';
import { splitPayment } from '../js/domain/amortise.js';

setSuite('rounding');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('a debit and a credit of the same size round to the same size', () => {
  /*
   * The rule `js/core/money.js` states, tested as the property it is.
   *
   * It was stated and not followed. `roundHalfUp` was private, the three
   * helpers using it had no callers at all, and sixty-seven `Math.round` calls
   * across the domain did money arithmetic with the rounding this rule exists
   * to avoid. `Math.round(-2.5)` is `-2` — towards +∞ — so a debit rounded one
   * way and a credit of the same size rounded the other.
   */
  const halves = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5, -12.5, 12.5, -1250.5, 1250.5];

  test('roundMoney is symmetric about zero', () => {
    for (const value of halves) {
      assert.equal(roundMoney(value), -roundMoney(-value), `${value}`);
    }
  });

  test('and Math.round is not, which is the whole point', () => {
    // If this ever stops failing, the platform changed and the rule below is
    // no longer buying anything — better to find out from here than to keep
    // asserting a difference that has gone away.
    const asymmetric = halves.filter((v) => Math.round(v) !== -Math.round(-v));
    assert.ok(asymmetric.length > 0, 'Math.round became symmetric');
  });

  test('divide is symmetric', () => {
    for (const amount of [-150, -9, -3, -1, 1, 3, 9, 150, 35_000, -35_000]) {
      for (const by of [2, 3, 6, 12, 52]) {
        assert.equal(divide(amount, by), -divide(-amount, by), `${amount}/${by}`);
      }
    }
  });

  test('mul and percent are symmetric', () => {
    for (const amount of [-150, -9, 9, 150, 1234]) {
      assert.equal(mul(amount, 0.5), -mul(-amount, 0.5), `${amount}`);
      assert.equal(percent(amount, 15), -percent(-amount, 15), `${amount}`);
      assert.equal(toMinor(amount / 100), -toMinor(-amount / 100), `${amount}`);
    }
  });

  test('dividing by nothing is nothing, not infinity', () => {
    assert.equal(divide(100, 0), 0);
    assert.equal(divide(null, 3), 0);
    assert.equal(roundMoney(NaN), 0);
    assert.equal(roundMoney(undefined), 0);
  });
});

describe('the domain follows it too', () => {
  test('a monthly equivalent is symmetric for every period', () => {
    /*
     * The real reason this matters. A recurring credit — rent received, a
     * salary — entered as a negative recurring payment used to produce a
     * monthly figure a paisa different from the same amount as a debit.
     */
    for (const frequency of ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly']) {
      for (const amount of [150, 9, 3, 35_000, 1]) {
        const out = monthlyCost({ amount, frequency });
        const flipped = monthlyCost({ amount: -amount, frequency });
        assert.equal(out, -flipped, `${frequency} ${amount}: ${out} vs ${flipped}`);
      }
    }
  });

  test('and that check would have failed before this change', () => {
    // The exact case: -₹1.50 a year is -12.5 paise a month. `Math.round` gives
    // -12 and the rule gives -13, so the old code was asymmetric by a paisa.
    assert.equal(divide(-150, 12), -13);
    assert.equal(Math.round(-150 / 12), -12);
    assert.notEqual(divide(-150, 12), Math.round(-150 / 12));
  });

  test('a payment still splits into interest and principal exactly', () => {
    // The rounding changed; the arithmetic must not have. Whatever is not
    // interest is principal, to the paisa.
    for (const balance of [1_000_000, 250_075, 3]) {
      const emi = 25_000;
      const { interest, principal } = splitPayment(balance, 9, emi);
      assert.equal(interest + principal, Math.min(emi, interest + balance),
        `balance ${balance}: ${interest} + ${principal}`);
    }
  });

  test('and interest on a balance is symmetric', () => {
    // A negative balance is not a mortgage, but the rounding rule does not
    // get to have exceptions — that is what made it untrue in the first place.
    for (const balance of [1_000_000, 250_075, 150, 9]) {
      assert.equal(splitPayment(balance, 9, 25_000).interest,
        -splitPayment(-balance, 9, 25_000).interest, `${balance}`);
    }
  });
});

describe('nothing in a money path rounds its own way', () => {
  test('the money helpers are the only place a money figure is rounded', () => {
    /*
     * A backstop, and a deliberately narrow one.
     *
     * It cannot say "no money arithmetic anywhere uses `Math.round`". Days,
     * percentages, units, litres and minutes are rounded all over the domain
     * and none of them is money — `commitments.js` still rounds a day count
     * and `costbasis.js` still rounds units to three places and a gain to two,
     * all correctly. A check that flagged those would be noise, and noise gets
     * switched off.
     *
     * So it names only the three files where *every* rounding was money and
     * all of it was converted. Re-introducing `Math.round` in one of them
     * fails here; the real guarantee is the symmetry properties above.
     */
    const converted = [
      'js/domain/accrual.js', 'js/domain/amortise.js', 'js/domain/runway.js',
    ];
    const offenders = converted.filter((path) => {
      const source = readFileSync(join(ROOT, path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      // `Math.max`/`Math.min` are fine; it is `Math.round` that has a rule.
      return /Math\.round\(/.test(source);
    });
    assert.deep(offenders, []);
  });

  test('and the helpers that hold the rule are actually imported', () => {
    // They had no callers at all. A rule nothing applies is not a rule.
    const users = ['js/domain/accrual.js', 'js/domain/amortise.js',
      'js/domain/commitments.js', 'js/domain/costbasis.js', 'js/domain/finance.js',
      'js/domain/inbox.js', 'js/domain/portfolio.js', 'js/domain/runway.js',
      'js/domain/unusual.js', 'js/domain/sms.js', 'js/domain/tabular.js'];
    const missing = users.filter((path) =>
      !/from '\.\.\/core\/money\.js'/.test(readFileSync(join(ROOT, path), 'utf8')));
    assert.deep(missing, []);
  });
});
