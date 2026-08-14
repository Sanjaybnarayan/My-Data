/**
 * Who in the household spent what.
 *
 * The arithmetic is trivial. Everything worth testing here is about what the
 * answer is allowed to claim: `transaction.person` is optional and no importer
 * sets it, so a per-member figure is a share of what is *tagged*, and saying
 * otherwise would be wrong by whatever fraction nobody filled in.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { spendByMember, settleable, describeSpendByMember } from '../js/domain/household.js';

setSuite('household');

const ASHA = { id: 'p1', name: 'Asha', deletedAt: null };
const RAVI = { id: 'p2', name: 'Ravi', deletedAt: null };
const PEOPLE = [ASHA, RAVI];

const spent = (over = {}) => ({
  id: `t${Math.random().toString(36).slice(2, 8)}`,
  date: '2026-07-05',
  amount: 1_000_00,
  kind: 'expense',
  direction: 'out',
  category: 'groceries',
  deletedAt: null,
  ...over,
});

describe('what each member paid', () => {
  test('is reported per person, largest first', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 40_000_00 }),
      spent({ person: 'p2', amount: 8_000_00 }),
      spent({ person: 'p1', amount: 12_000_00 }),
    ]);

    assert.deep(report.members.map((m) => m.person.name), ['Asha', 'Ravi']);
    assert.equal(report.members[0].spent, 52_000_00);
    assert.equal(report.members[0].count, 2);
  });

  test('and the largest category each of them paid for', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 40_000_00, category: 'rent' }),
      spent({ person: 'p1', amount: 2_000_00, category: 'groceries' }),
    ]);
    assert.equal(report.members[0].topCategory, 'rent');
  });

  test('income is not spending', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 5_000_00 }),
      spent({ person: 'p1', amount: 90_000_00, kind: 'income', direction: 'in' }),
    ]);
    assert.equal(report.tagged, 5_000_00);
  });

  test('and neither is moving money between your own accounts', () => {
    // Counting a transfer would make whoever moves the money look like the
    // household's biggest spender.
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 5_000_00 }),
      spent({ person: 'p1', amount: 2_00_000_00, kind: 'transfer' }),
    ]);
    assert.equal(report.tagged, 5_000_00);
  });

  test('a deleted transaction is not spending either', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 5_000_00 }),
      spent({ person: 'p1', amount: 9_000_00, deletedAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    assert.equal(report.tagged, 5_000_00);
  });

  test('a period filter is honoured', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', date: '2026-07-05', amount: 5_000_00 }),
      spent({ person: 'p1', date: '2026-06-05', amount: 9_000_00 }),
    ], (t) => t.date >= '2026-07-01');
    assert.equal(report.tagged, 5_000_00);
  });
});

describe('what the percentages are a percentage of', () => {
  test('a share of what is tagged, not of what the household spent', () => {
    // The trap this exists to avoid. Measured on a realistic month: three
    // transactions entered by hand carry a person and twenty imported ones do
    // not, so Asha is 87% of the tagged half and 43% of the real total.
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 52_000_00 }),
      spent({ person: 'p2', amount: 8_000_00 }),
      ...Array.from({ length: 20 }, () => spent({ amount: 3_000_00 })),
    ]);

    assert.equal(report.members[0].shareOfTagged, 87);
    assert.equal(report.coverage, 50);
    assert.not(report.complete);
    // The figure a naive report would have printed as "Asha's share".
    assert.equal(Math.round((report.members[0].spent / report.total) * 100), 43);
  });

  test('and the untagged remainder is carried, never dropped', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 10_000_00 }),
      spent({ amount: 30_000_00 }),
      spent({ amount: 10_000_00 }),
    ]);

    assert.equal(report.untagged, 40_000_00);
    assert.equal(report.untaggedCount, 2);
    assert.equal(report.total, 50_000_00);
    assert.equal(report.tagged + report.untagged, report.total);
  });

  test('a person id nobody recognises is untagged, not a member', () => {
    // A member removed from the household leaves transactions behind. Inventing
    // a row for an id with no record would print a blank name.
    const report = spendByMember(PEOPLE, [spent({ person: 'p-gone', amount: 5_000_00 })]);

    assert.length(report.members, 0);
    assert.equal(report.untagged, 5_000_00);
  });

  test('a deleted person is not a member either', () => {
    const report = spendByMember(
      [ASHA, { ...RAVI, deletedAt: '2026-01-01T00:00:00.000Z' }],
      [spent({ person: 'p2', amount: 5_000_00 })],
    );
    assert.length(report.members, 0);
    assert.equal(report.untagged, 5_000_00);
  });

  test('everything tagged is said to be complete', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 10_000_00 }),
      spent({ person: 'p2', amount: 10_000_00 }),
    ]);

    assert.equal(report.coverage, 100);
    assert.ok(report.complete);
  });

  test('nothing at all is not an error, and not complete either', () => {
    const report = spendByMember(PEOPLE, []);
    assert.length(report.members, 0);
    assert.equal(report.coverage, 0);
    assert.not(report.complete, 'no spending is not "all of it accounted for"');
    assert.equal(describeSpendByMember(report), null);
    assert.equal(describeSpendByMember(null), null);
  });
});

describe('who owes whom', () => {
  test('is refused, and the reason is a missing fact rather than missing effort', () => {
    // Not arithmetic and not more tagging. The question needs to know which
    // costs are shared, and nothing in this application records that.
    const check = settleable();

    assert.not(check.ok);
    assert.includes(check.why, 'which costs are shared');
    assert.includes(check.why, 'guess');
  });
});

describe('the sentence', () => {
  test('says what the figures are shares of when some rows carry nobody', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 10_000_00 }),
      spent({ amount: 30_000_00 }),
    ]);
    const said = describeSpendByMember(report);

    assert.includes(said, 'shares of what is tagged');
    assert.includes(said, 'rather than of what the household');
    assert.includes(said, 'Asha');
  });

  test('and does not qualify a figure that needs no qualifying', () => {
    const report = spendByMember(PEOPLE, [spent({ person: 'p1', amount: 10_000_00 })]);
    const said = describeSpendByMember(report);

    assert.includes(said, 'Every payment this period has somebody recorded');
    assert.not(/shares of what is tagged/.test(said), said);
  });

  test('and never claims to know who owes whom', () => {
    const report = spendByMember(PEOPLE, [
      spent({ person: 'p1', amount: 40_000_00 }),
      spent({ person: 'p2', amount: 2_000_00 }),
    ]);
    const said = describeSpendByMember(report);

    assert.not(/owes|settle|fair share|should pay/i.test(said), said);
  });
});
