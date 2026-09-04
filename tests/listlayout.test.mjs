/**
 * What a list shows when there is no room for a table.
 *
 * On a phone the generic table becomes stacked cards, and every column had the
 * same weight: a label taking 40% of the line and a value taking the rest. So
 * an account read
 *
 *     Name           Harbour National Ban…
 *     Kind           savings
 *     Bank/provider  Harbour National Bank
 *     Holder         Anand Iyer
 *     Archived       no
 *
 * — the one field saying which account this is, truncated, above a field
 * spelling the same bank out in full, and a line per record saying a flag is
 * not set. Twelve accounts of that is 2295px of scroll and nothing to read.
 *
 * These are the rules that make it a row again.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { saidAlready, blank } from '../js/ui/components/table.js';
import { thinLabels } from '../js/ui/components/charts.js';

setSuite('list layout');

const field = (key, type = 'text') => ({ key, type });

describe('a detail the title has already given', () => {
  const subject = 'harbour national bank savings';

  test('the kind, when the name ends with it', () => {
    assert.ok(saidAlready(subject, field('kind', 'enum'), { kind: 'savings' }));
  });

  test('the bank, when the name begins with it', () => {
    assert.ok(saidAlready(subject, field('institution'), {
      institution: 'Harbour National Bank',
    }));
  });

  test('but never the holder, which is what tells two of them apart', () => {
    assert.not(saidAlready(subject, field('holder'), { holder: 'Anand Iyer' }));
  });

  test('matched without regard to case, as the overview already does it', () => {
    assert.ok(saidAlready(subject, field('institution'), {
      institution: 'HARBOUR NATIONAL BANK',
    }));
  });

  test('a reference is compared by the name it resolves to', () => {
    // The record holds an id; the label is what the row actually shows.
    assert.ok(saidAlready('sapphire bank savings', field('bank', 'ref'), {
      bank: 'ccn_01ABC', bankLabel: 'Sapphire Bank',
    }));
    assert.not(saidAlready('sapphire bank savings', field('bank', 'ref'), {
      bank: 'ccn_01ABC', bankLabel: 'Kaveri Grameen Bank',
    }));
  });
});

describe('and what is never a repetition', () => {
  test('a date, an amount, a number or a flag is not a restatement of a name', () => {
    // Looking for a repetition in these is looking for something that cannot
    // be there — and `2` inside `2 Sapphire` would find one that is not real.
    for (const type of ['date', 'currency', 'number', 'boolean']) {
      assert.not(saidAlready('anything at all', field('x', type), { x: 'any' }));
    }
  });

  test('a value under three characters cannot match by accident', () => {
    // `no` sits inside `Nominee account`, and a two-letter code should not
    // vanish because a longer word happens to contain it.
    assert.not(saidAlready('nominee account', field('code'), { code: 'no' }));
    assert.not(saidAlready('nominee account', field('code'), { code: 'n' }));
  });

  test('an empty subject hides nothing', () => {
    assert.not(saidAlready('', field('kind', 'enum'), { kind: 'savings' }));
  });

  test('an empty value is not a repetition of anything', () => {
    assert.not(saidAlready('savings', field('kind', 'enum'), { kind: '' }));
  });
});

describe('a cell with nothing in it', () => {
  test('an absent value is blank', () => {
    assert.ok(blank(field('account', 'ref'), { accountLabel: null }));
    assert.ok(blank(field('note'), { note: '' }));
    assert.ok(blank(field('note'), {}));
  });

  test('a reference is judged by its resolved name, not by the id it holds', () => {
    // The id is always there; what the row draws is the label, and an
    // unresolved reference renders as an em dash.
    assert.ok(blank(field('account', 'ref'), { account: 'ccn_01ABC', accountLabel: '' }));
    assert.not(blank(field('account', 'ref'), { account: 'ccn_01ABC', accountLabel: 'Everyday' }));
  });

  test('and zero is a value, not an absence', () => {
    // A balance of nothing is a fact about the account. Hiding it would be
    // the opposite of what this rule is for.
    assert.not(blank(field('amount', 'currency'), { amount: 0 }));
    assert.not(blank(field('active', 'boolean'), { active: false }));
  });
});

describe('an axis with more months than it has room for', () => {
  const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
    'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'].map((label) => ({ label }));

  test('everything is printed when it fits', () => {
    assert.deep(thinLabels(months.slice(0, 5), 7), ['Oct', 'Nov', 'Dec', 'Jan', 'Feb']);
  });

  test('and thinned when it does not', () => {
    // Twelve months across a 316px card gives each label 26px, and the axis
    // truncated to fit: `O. N. D. J. F. M. A. M. J. J. A. S.` — three months
    // beginning with J, two with M, and no way to tell which is which.
    const shown = thinLabels(months, 7);
    assert.deep(shown,
      ['', 'Nov', '', 'Jan', '', 'Mar', '', 'May', '', 'Jul', '', 'Sep']);
  });

  test('the last is always kept, because it is the month you are standing in', () => {
    for (const count of [8, 9, 12, 13, 25]) {
      const shown = thinLabels(months.slice(0, 1).concat(
        Array.from({ length: count - 1 }, (unused, i) => ({ label: `m${i}` }))), 7);
      assert.ok(shown.at(-1) !== '', `${count} months dropped the last one`);
    }
  });

  test('a slot keeps its place when its label is dropped', () => {
    // Empty rather than removed, so what is printed stays under its own bar.
    assert.equal(thinLabels(months, 7).length, months.length);
  });

  test('and no more than asked for are printed', () => {
    for (const room of [2, 3, 5, 7]) {
      const kept = thinLabels(months, room).filter(Boolean);
      assert.ok(kept.length <= room, `room ${room} printed ${kept.length}`);
    }
  });
});
