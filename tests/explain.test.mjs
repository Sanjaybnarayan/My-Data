/**
 * Explaining a movement — rule 57, on the record the rule is about.
 *
 * Against a real database rather than plain arrays, because the whole point is
 * a reverse lookup through an index the schema had to gain.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import {
  explainEvent, explainability, describeExplanation, legsOf, amountFromLegs,
} from '../js/domain/explain.js';
import { lineageOf, describe as describeLineage } from '../js/data/lineage.js';

setSuite('explain');

async function household() {
  const db = await makeDb();
  const hdfc = await db.repo('account').create({
    name: 'HDFC Savings', kind: 'savings', institution: 'HDFC',
  });
  const broker = await db.repo('account').create({
    name: 'Zerodha', kind: 'savings', institution: 'Zerodha',
  });
  const statement = await db.repo('bankStatement').create({
    account: hdfc.id, periodFrom: '2026-07-01', periodTo: '2026-07-31',
    fileName: 'hdfc-jul-2026.pdf', reconciled: true,
  });
  return { db, hdfc, broker, statement };
}

const leg = (over) => ({
  date: '2026-07-15', kind: 'expense', amount: 50_000_00, movementRole: 'leg', ...over,
});

describe('the answer that used to be “something not recorded”', () => {
  test('a movement now reaches the file its legs were parsed from', async () => {
    const { db, hdfc, broker, statement } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00, title: 'To broker',
      why: 'a debit and a credit of the same amount one day apart',
    });
    await db.repo('transaction').create(leg({
      account: hdfc.id, statement: statement.id, movement: event.id, direction: 'out',
    }));
    await db.repo('transaction').create(leg({
      account: broker.id, statement: statement.id, movement: event.id,
      direction: 'in', kind: 'income', date: '2026-07-16',
    }));

    const said = describeExplanation(await explainEvent(db, event.id));
    assert.includes(said, 'hdfc-jul-2026.pdf');
    assert.includes(said, 'because a debit and a credit');
    assert.not(said.includes('not recorded'), said);
  });

  test('and the entity itself no longer claims it came from nowhere', async () => {
    // The measurement that opened this tranche, kept as a test: the sentence
    // `data/lineage.js` produced for a movement, before anything was taught to
    // read one.
    const { db } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 1_000_00, why: 'same amount, same day',
    });
    const said = describeLineage(await lineageOf(db, 'economicEvent', event.id));
    assert.includes(said, 'came from a calculation');
    assert.not(said.includes('something not recorded'), said);
  });

  test('the legs are found by index, not by reading every transaction', async () => {
    const { db, hdfc, broker } = await household();
    const mine = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    const other = await db.repo('economicEvent').create({
      date: '2026-07-20', kind: 'transfer', amount: 50_000_00,
    });

    await db.repo('transaction').create(leg({ account: hdfc.id, movement: mine.id, direction: 'out' }));
    await db.repo('transaction').create(leg({ account: broker.id, movement: other.id, direction: 'in' }));
    await db.repo('transaction').create(leg({ account: hdfc.id, direction: 'out' }));

    assert.length(await legsOf(db, mine.id), 1);
  });
});

describe('the amount, and what it refuses to do about it', () => {
  test('legs that no longer add up are reported, and neither figure is changed',
    async () => {
      const { db, hdfc, broker } = await household();
      const event = await db.repo('economicEvent').create({
        date: '2026-06-10', kind: 'transfer', amount: 25_000_00, title: 'Rent moved',
      });
      await db.repo('transaction').create(leg({
        account: hdfc.id, movement: event.id, direction: 'out', amount: 22_000_00,
      }));
      await db.repo('transaction').create(leg({
        account: broker.id, movement: event.id, direction: 'in', amount: 22_000_00,
      }));

      const out = await explainEvent(db, event.id);
      assert.equal(out.amount.recorded, 25_000_00);
      assert.equal(out.amount.fromLegs, 22_000_00);
      assert.equal(out.amount.agrees, false);
      // Still 25,000 in the database. This file reports; it does not repair.
      assert.equal((await db.repo('economicEvent').get(event.id)).amount, 25_000_00);
      assert.includes(describeExplanation(out), 'nothing changes either');
    });

  test('the movement is the larger side, not the sum of both', () => {
    // Each leg carries the full amount of its own side. Summing them reports a
    // ₹50,000 transfer as ₹1,00,000 — the distinction the events file exists
    // to hold, and this had to learn it too.
    assert.equal(amountFromLegs([
      { direction: 'out', amount: 50_000_00 },
      { direction: 'in', amount: 50_000_00 },
    ]), 50_000_00);
  });

  test('a fee is not part of the amount', async () => {
    const { db, hdfc, broker } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    await db.repo('transaction').create(leg({ account: hdfc.id, movement: event.id, direction: 'out' }));
    await db.repo('transaction').create(leg({
      account: broker.id, movement: event.id, direction: 'in', kind: 'income',
    }));
    await db.repo('transaction').create(leg({
      account: hdfc.id, movement: event.id, movementRole: 'fee',
      direction: 'out', amount: 50_00,
    }));

    const out = await explainEvent(db, event.id);
    assert.equal(out.amount.fromLegs, 50_000_00);
    assert.equal(out.amount.agrees, true);
    assert.length(out.fees, 1);
    assert.length(out.legs, 2);
  });

  test('rows with no direction give null, never zero', async () => {
    // Zero is a claim about the money. Null is the gap it actually is.
    const { db, hdfc } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    await db.repo('transaction').create(leg({ account: hdfc.id, movement: event.id }));

    const out = await explainEvent(db, event.id);
    assert.equal(out.amount.fromLegs, null);
    assert.equal(out.amount.agrees, null, 'an unanswered question is not an agreement');
    assert.ok(out.problems.some((p) => p.includes('which way the money went')));
  });
});

describe('what it counts as a problem', () => {
  test('a movement with no rows behind it at all', async () => {
    const { db } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-05-01', kind: 'transfer', amount: 10_000_00, title: 'Orphan',
    });

    const out = await explainEvent(db, event.id);
    assert.length(out.legs, 0);
    assert.ok(out.problems.some((p) => p.includes('nothing behind the figure')));
    assert.includes(describeExplanation(out), 'nothing behind the figure');
  });

  test('a movement with one leg is not a movement', async () => {
    const { db, hdfc } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    await db.repo('transaction').create(leg({
      account: hdfc.id, movement: event.id, direction: 'out',
    }));

    const out = await explainEvent(db, event.id);
    assert.ok(out.problems.some((p) => p.includes('only one row')));
  });

  test('a typed leg is explainable, and is not counted as documented', async () => {
    const { db, hdfc, broker, statement } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    await db.repo('transaction').create(leg({
      account: hdfc.id, statement: statement.id, movement: event.id, direction: 'out',
    }));
    await db.repo('transaction').create(leg({
      account: broker.id, movement: event.id, direction: 'in', kind: 'income',
    }));

    const out = await explainEvent(db, event.id);
    assert.equal(out.documented, 1);
    assert.equal(out.handTyped, 1);
    assert.not(out.fullyDocumented, 'half of it came from somebody’s memory');
    // And it is still explained — to a person, which is a real answer.
    assert.includes(describeExplanation(out), 'somebody typing it in');
  });

  test('nothing here ever says a person checked it', async () => {
    const { db, hdfc, broker, statement } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00, why: 'same amount, one day apart',
    });
    for (const account of [hdfc.id, broker.id]) {
      await db.repo('transaction').create(leg({
        account, statement: statement.id, movement: event.id,
        direction: account === hdfc.id ? 'out' : 'in',
      }));
    }

    const said = describeExplanation(await explainEvent(db, event.id));
    assert.includes(said, 'None of this was checked by a person');
    for (const word of ['verified', 'confirmed by', 'proven']) {
      assert.not(said.toLowerCase().includes(word), word);
    }
  });
});

describe('counting the ones that cannot be explained', () => {
  test('the household total separates all four answers', async () => {
    const { db, hdfc, broker, statement } = await household();

    const documented = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    for (const account of [hdfc.id, broker.id]) {
      await db.repo('transaction').create(leg({
        account, statement: statement.id, movement: documented.id,
        direction: account === hdfc.id ? 'out' : 'in',
      }));
    }

    const typed = await db.repo('economicEvent').create({
      date: '2026-06-10', kind: 'transfer', amount: 22_000_00,
    });
    for (const account of [hdfc.id, broker.id]) {
      await db.repo('transaction').create(leg({
        account, movement: typed.id, amount: 22_000_00,
        direction: account === hdfc.id ? 'out' : 'in',
      }));
    }

    await db.repo('economicEvent').create({
      date: '2026-05-01', kind: 'transfer', amount: 10_000_00, title: 'Orphan',
    });

    const out = await explainability(db);
    assert.equal(out.total, 3);
    assert.equal(out.documented, 1);
    assert.equal(out.partlyTyped, 1);
    assert.equal(out.unexplained, 1);
    assert.equal(out.disagreeing, 0);
    assert.equal(out.problems.length, 1, 'only the orphan has anything wrong with it');
  });

  test('a disagreement is counted apart from how well documented it is', async () => {
    // A movement can be fully documented *and* disagree with its rows. Folding
    // the two together would hide the most interesting row on the report.
    const { db, hdfc, broker, statement } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    for (const account of [hdfc.id, broker.id]) {
      await db.repo('transaction').create(leg({
        account, statement: statement.id, movement: event.id, amount: 40_000_00,
        direction: account === hdfc.id ? 'out' : 'in',
      }));
    }

    const out = await explainability(db);
    assert.equal(out.documented, 1);
    assert.equal(out.disagreeing, 1);
  });

  test('a household with no movements is zero, not a crash', async () => {
    const { db } = await household();
    const out = await explainability(db);
    assert.equal(out.total, 0);
    assert.length(out.problems, 0);
  });

  test('a movement that does not exist explains nothing rather than throwing',
    async () => {
      const { db } = await household();
      assert.equal(await explainEvent(db, 'cnm_nothing'), null);
      assert.equal(describeExplanation(null), null);
    });
});
