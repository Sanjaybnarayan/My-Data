import { test, describe, assert, setSuite } from './harness.mjs';
import {
  STATUS, progressOf, reviewGoals, contestedSources, targetOf,
  emergencyTarget, whyNotMeasurable, describeGoal,
} from '../js/domain/goals.js';
import { monthsBetween } from '../js/core/dates.js';

setSuite('goals');

const NOW = '2026-08-21';
const clock = () => NOW;
/** @type {Record<string, number>} */
const BALANCES = { acc1: 500000, acc2: 120000, acc3: 0, acc4: 250000 };
/** @type {(id: string) => number} */
const balanceOf = (id) => BALANCES[id] ?? 0;
/** @type {Record<string, number>} */
const VALUES = { hold1: 300000 };
/** @type {(id: string) => number} */
const holdingValueOf = (id) => VALUES[id] ?? 0;

const house = {
  id: 'g1', name: 'House deposit', kind: 'purchase',
  targetAmount: 2000000, targetDate: '2028-08-21', accounts: ['acc1'],
};

describe('whole months', () => {
  test('a payment that has not come round yet is not counted', () => {
    // 2.8 months is not two-point-eight opportunities to pay something.
    assert.equal(monthsBetween('2026-08-21', '2026-11-15'), 2);
    assert.equal(monthsBetween('2026-08-21', '2026-11-21'), 3);
  });

  test('a date in the past is negative', () => {
    assert.equal(monthsBetween('2026-08-21', '2026-05-01'), -4);
    assert.equal(monthsBetween('2026-08-21', '2026-08-20'), -1);
  });
});

describe('a target that was not typed', () => {
  test('an emergency fund is months of spending, in rupees', () => {
    assert.equal(emergencyTarget({ targetMonths: 6 }, 80000), 480000);
  });

  test('and has no target at all when spending is unknown', () => {
    // A fund sized against a made-up monthly figure is worse than one with no
    // target, because it will be declared complete.
    assert.equal(emergencyTarget({ targetMonths: 6 }, 0), null);
    assert.equal(targetOf({ kind: 'emergency fund', targetMonths: 6 }, { monthlySpend: 0 }), null);
  });

  test('a typed amount on an emergency fund wins over the months', () => {
    const goal = { kind: 'emergency fund', targetMonths: 6, targetAmount: 100000 };
    assert.equal(targetOf(goal, { monthlySpend: 80000 }), 100000);
  });
});

describe('one goal', () => {
  test('progress is read from the balances that fund it', () => {
    const row = progressOf(house, { balanceOf, clock });
    assert.equal(row.funded, 500000);
    assert.equal(row.percent, 25);
    assert.equal(row.remaining, 1500000);
    assert.equal(row.status, STATUS.OPEN);
  });

  test('holdings count toward it too', () => {
    const row = progressOf({ ...house, holdings: ['hold1'] }, { balanceOf, holdingValueOf, clock });
    assert.equal(row.funded, 800000);
  });

  test('what it would take a month is arithmetic, not a forecast', () => {
    // 1,500,000 left over 24 whole months. Nothing here claims the household
    // will manage it; it says what reaching the date would require.
    const row = progressOf(house, { balanceOf, clock });
    assert.equal(row.monthsLeft, 24);
    assert.equal(row.monthlyNeeded, 62500);
  });

  test('a passed date is overdue, and asks for nothing a month', () => {
    // Dividing what is left by a negative number of months produces a
    // negative "needed", which reads as though the goal funds itself.
    const row = progressOf({ ...house, targetDate: '2026-01-01' }, { balanceOf, clock });
    assert.equal(row.status, STATUS.OVERDUE);
    assert.equal(row.monthlyNeeded, null);
    assert.includes(describeGoal(row), 'the date has passed');
  });

  test('funded to target is reached even without the date', () => {
    const row = progressOf({ ...house, targetAmount: 400000 }, { balanceOf, clock });
    assert.equal(row.status, STATUS.REACHED);
    assert.equal(row.percent, 100);
  });

  test('a percentage never runs past a hundred', () => {
    const row = progressOf({ ...house, targetAmount: 100000 }, { balanceOf, clock });
    assert.equal(row.percent, 100);
    assert.equal(row.remaining, 0);
  });

  test('marked reached by hand stays reached', () => {
    const row = progressOf({ ...house, achievedOn: '2026-07-01' }, { balanceOf, clock });
    assert.equal(row.status, STATUS.REACHED);
  });
});

describe('what it will not say', () => {
  test('a goal funded by nothing has no figure, and says what is missing', () => {
    const row = progressOf({ id: 'g', name: 'Someday', targetAmount: 100 }, { clock });
    assert.equal(row.status, STATUS.UNKNOWN);
    assert.equal(row.funded, null);
    assert.includes(row.why, 'nothing is named as funding it');
  });

  test('a goal with no target is not a fraction of anything', () => {
    const row = progressOf({ id: 'g', name: 'Vague', accounts: ['acc1'] }, { balanceOf, clock });
    assert.equal(row.status, STATUS.UNKNOWN);
    assert.includes(row.why, 'no target amount is set');
  });

  test('an emergency fund without enough recorded spending says so specifically', () => {
    const row = progressOf(
      { id: 'g', name: 'Emergency', kind: 'emergency fund', targetMonths: 6, accounts: ['acc2'] },
      { balanceOf, monthlySpend: 0, clock },
    );
    assert.equal(row.status, STATUS.UNKNOWN);
    assert.includes(row.why, 'not enough recorded spending');
  });

  test('whyNotMeasurable returns null when it can be measured', () => {
    assert.equal(whyNotMeasurable(house, { target: 2000000, contested: [] }), null);
  });
});

describe('the same rupee twice', () => {
  const emergency = {
    id: 'g2', name: 'Emergency fund', kind: 'emergency fund',
    targetMonths: 6, accounts: ['acc1'],
  };

  test('two goals claiming one account are each told about the other', () => {
    const contested = contestedSources([house, emergency]);
    assert.deep(contested.get('g1'), ['Emergency fund']);
    assert.deep(contested.get('g2'), ['House deposit']);
  });

  test('and neither gets a progress figure until it is settled', () => {
    // Reporting both as funded from the same money would tell a household it
    // has twice what it has — the same error as counting a transfer as income.
    const rows = reviewGoals([house, emergency], { balanceOf, monthlySpend: 80000, clock });
    for (const row of rows) {
      assert.equal(row.status, STATUS.UNKNOWN);
      assert.equal(row.funded, null);
      assert.includes(row.why, 'the same money cannot fund both');
    }
  });

  test('separate funding is measured normally', () => {
    const rows = reviewGoals(
      [house, { ...emergency, accounts: ['acc2'] }],
      { balanceOf, monthlySpend: 80000, clock },
    );
    assert.deep(rows.map((r) => r.status), [STATUS.OPEN, STATUS.OPEN]);
  });

  test('a goal naming the same account twice is not in conflict with itself', () => {
    const twice = { ...house, accounts: ['acc1', 'acc1'] };
    assert.equal(contestedSources([twice]).size, 0);
  });

  test('three goals on one account name all the others, once each', () => {
    const a = { id: 'a', name: 'A', accounts: ['acc1'] };
    const b = { id: 'b', name: 'B', accounts: ['acc1'] };
    const c = { id: 'c', name: 'C', accounts: ['acc1', 'acc2'] };
    const contested = contestedSources([a, b, c]);
    assert.deep(contested.get('a').sort(), ['B', 'C']);
    assert.deep(contested.get('c').sort(), ['A', 'B']);
  });
});

describe('the order', () => {
  test('what cannot be measured comes before what is merely behind', () => {
    // Each goal gets its own account: sharing one would make them contested,
    // which is a different test and would have masked this one.
    const reached = { id: 'r', name: 'Done', targetAmount: 1, accounts: ['acc4'] };
    const overdue = {
      id: 'o', name: 'Late', targetAmount: 9000000,
      targetDate: '2020-01-01', accounts: ['acc2'],
    };
    const broken = { id: 'b', name: 'Unfunded', targetAmount: 5 };
    const rows = reviewGoals([reached, overdue, broken, house], { balanceOf, clock });
    assert.deep(rows.map((r) => r.goal.name), ['Unfunded', 'Late', 'House deposit', 'Done']);
  });
});
