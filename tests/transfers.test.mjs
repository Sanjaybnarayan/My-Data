/**
 * The transfers service — the engine against a real database.
 *
 * `events.test.mjs` covers the rules with plain objects. This covers the parts
 * that only exist once records are stored: that the fetch finds the loose legs,
 * that accounts are named rather than shown as ids, that confirming writes the
 * one field that was missing, and that **both bank rows are still there
 * afterwards**.
 *
 * That last one is the point of the whole design and cannot be checked without
 * a database to look in.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makeAccount } from './fixture.mjs';
import { TransfersService } from '../js/services/transfers.js';
import { CONFIDENCE } from '../js/domain/events.js';

setSuite('transfers');

/**
 * A leg as the statement importer writes one.
 *
 * `importKey` is not decoration. The validator refuses a hand-entered transfer
 * with no `toAccount` — *"A transfer needs a destination account"* — and
 * exempts one that came from a statement, because a bank only ever shows its
 * own side and the other end is often not an account this household holds.
 *
 * So a loose leg is an **import-only** state by design, and a fixture without
 * an `importKey` cannot even be saved. The first version of this file left it
 * out and every test failed at validation, which was the schema explaining
 * itself.
 */
let key = 0;
const legOf = (account, direction, over = {}) => ({
  date: '2026-08-01',
  kind: 'transfer',
  amount: 5_000_000,
  account: account.id,
  category: 'own account',
  payee: 'Own account',
  direction,
  importKey: `imp_${++key}`,
  tags: [],
  ...over,
});

async function twoAccounts(db) {
  return {
    hdfc: await makeAccount(db, { name: 'HDFC Savings' }),
    icici: await makeAccount(db, { name: 'ICICI Savings' }),
  };
}

describe('finding the pairs', () => {
  test('two loose legs are one proposal, with the accounts named', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in'));

    const { proposals, total } = await new TransfersService(db).pending();

    assert.length(proposals, 1);
    assert.equal(proposals[0].fromName, 'HDFC Savings');
    assert.equal(proposals[0].toName, 'ICICI Savings');
    assert.equal(total.moved, 5_000_000);
    assert.equal(total.movements, 1);
  });

  test('a transfer that already says where it went is left alone', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out', { toAccount: icici.id }));
    await db.repo('transaction').create(legOf(icici, 'in'));

    assert.length((await new TransfersService(db).pending()).proposals, 0);
  });

  test('an expense is never offered as half of a movement', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create({
      ...legOf(hdfc, 'out'), kind: 'expense', category: 'groceries', payee: 'Shop',
    });
    await db.repo('transaction').create(legOf(icici, 'in'));

    const { proposals, unmatched } = await new TransfersService(db).pending();
    assert.length(proposals, 0);
    assert.length(unmatched, 1, 'only the transfer leg is loose');
  });

  test('probable pairings are listed before the questions', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const sbi = await makeAccount(db, { name: 'SBI Savings' });

    await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in'));
    await db.repo('transaction').create(legOf(sbi, 'out', { amount: 1_200_000 }));
    await db.repo('transaction').create(legOf(hdfc, 'in', { amount: 1_195_000 }));

    const { proposals } = await new TransfersService(db).pending();
    assert.equal(proposals[0].confidence, CONFIDENCE.PROBABLE);
    assert.equal(proposals.at(-1).confidence, CONFIDENCE.POSSIBLE);
  });
});

describe('confirming one', () => {
  test('fills in the field that was missing', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const out = await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in'));

    const service = new TransfersService(db);
    const { proposals } = await service.pending();
    await service.confirm(proposals[0]);

    assert.equal((await db.repo('transaction').get(out.id)).toAccount, icici.id);
  });

  test('and both bank rows are still there', async () => {
    // The guard the whole design turns on. Each row is a bank's own record of
    // one side, with its own narration, reference and running balance. Tidying
    // the total by deleting one would destroy the evidence for it.
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in'));

    const service = new TransfersService(db);
    await service.confirm((await service.pending()).proposals[0]);

    assert.length(await db.repo('transaction').list({}), 2);
  });

  test('and it stops being offered', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in'));

    const service = new TransfersService(db);
    await service.confirm((await service.pending()).proposals[0]);

    assert.length((await service.pending()).proposals, 0);
  });

  test('a question cannot be confirmed, whatever a screen asks for', async () => {
    // The rule has to hold here and not only in the card, or a future screen
    // that forgot to hide the button would be doing the deciding.
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out'));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 4_995_000 }));

    const service = new TransfersService(db);
    const { proposals } = await service.pending();
    assert.equal(proposals[0].confidence, CONFIDENCE.POSSIBLE);

    let threw = false;
    try { await service.confirm(proposals[0]); } catch { threw = true; }
    assert.ok(threw);
    assert.length(await db.repo('transaction').list({ filter: (t) => t.toAccount }), 0);
  });
});

describe('what is left loose', () => {
  test('a leg whose partner has not been imported yet is reported', async () => {
    // Usually it means the other account's statement is still to come, which
    // is a more useful thing to be told than silence.
    const db = await makeDb();
    const { hdfc } = await twoAccounts(db);
    await db.repo('transaction').create(legOf(hdfc, 'out'));

    const { proposals, unmatched } = await new TransfersService(db).pending();
    assert.length(proposals, 0);
    assert.length(unmatched, 1);
    assert.equal(unmatched[0].accountName, 'HDFC Savings');
  });

  test('an empty database is not an error', async () => {
    const { proposals, total } = await new TransfersService(await makeDb()).pending();
    assert.deep(proposals, []);
    assert.equal(total.moved, 0);
  });
});

/**
 * A movement that landed in more than one piece, through the service.
 *
 * `events.test.mjs` covers the rules with plain objects. What only exists once
 * records are stored is the part that matters here: the legs a set accounts for
 * must come **off** the unmatched list, or the same three rows are reported both
 * as "this is one movement" and as "we cannot see where this went".
 */
describe('a movement in pieces, against the database', () => {
  test('the set is proposed, named, and counted once', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const sbi = await makeAccount(db, { name: 'SBI Savings' });

    await db.repo('transaction').create(legOf(hdfc, 'out', { amount: 50_000_00 }));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 30_000_00 }));
    await db.repo('transaction').create(legOf(sbi, 'in', { amount: 20_000_00 }));

    const { sets, setsTotal } = await new TransfersService(db).pending();

    assert.length(sets, 1);
    assert.equal(sets[0].confidence, CONFIDENCE.PROBABLE);
    assert.equal(sets[0].shape, 'split');
    assert.equal(sets[0].anchorName, 'HDFC Savings');
    assert.deep(sets[0].legNames.slice().sort(), ['ICICI Savings', 'SBI Savings']);
    // Three statement rows, one economic event, ₹50,000 — not ₹100,000.
    assert.deep(setsTotal, { movements: 1, moved: 50_000_00, awaiting: 0 });
  });

  test('and its legs stop being reported as having no partner', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const sbi = await makeAccount(db, { name: 'SBI Savings' });

    await db.repo('transaction').create(legOf(hdfc, 'out', { amount: 50_000_00 }));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 30_000_00 }));
    await db.repo('transaction').create(legOf(sbi, 'in', { amount: 20_000_00 }));

    const { unmatched } = await new TransfersService(db).pending();
    assert.length(unmatched, 0);
  });

  test('a leg that belongs to nothing is still reported as loose', async () => {
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const sbi = await makeAccount(db, { name: 'SBI Savings' });

    await db.repo('transaction').create(legOf(hdfc, 'out', { amount: 50_000_00 }));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 30_000_00 }));
    await db.repo('transaction').create(legOf(sbi, 'in', { amount: 20_000_00 }));
    // Nothing accounts for this one, and it must not be hidden by the set.
    const axis = await makeAccount(db, { name: 'Axis Savings' });
    await db.repo('transaction').create(legOf(axis, 'in', { amount: 7_000_00 }));

    const { unmatched } = await new TransfersService(db).pending();
    assert.length(unmatched, 1);
    assert.equal(unmatched[0].accountName, 'Axis Savings');
  });

  test('an ambiguous set does not take its legs off the loose list', async () => {
    // It is a question, not an answer. Hiding the rows behind a proposal
    // nobody has agreed to would lose them.
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);
    const sbi = await makeAccount(db, { name: 'SBI Savings' });
    const axis = await makeAccount(db, { name: 'Axis Savings' });
    const kotak = await makeAccount(db, { name: 'Kotak Savings' });

    await db.repo('transaction').create(legOf(hdfc, 'out', { amount: 50_000_00 }));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 30_000_00 }));
    await db.repo('transaction').create(legOf(sbi, 'in', { amount: 20_000_00 }));
    await db.repo('transaction').create(legOf(axis, 'in', { amount: 25_000_00 }));
    await db.repo('transaction').create(legOf(kotak, 'in', { amount: 25_000_00 }));

    const { sets, setsTotal, unmatched } = await new TransfersService(db).pending();
    assert.equal(sets[0].confidence, CONFIDENCE.POSSIBLE);
    assert.equal(setsTotal.moved, 0);
    // Every row, not merely "some" — the first version asserted `length > 0`,
    // which the two spare ₹25,000 credits satisfied on their own, so the rule
    // it was meant to pin went untested.
    assert.deep(unmatched.map((leg) => leg.accountName).sort(),
      ['Axis Savings', 'HDFC Savings', 'ICICI Savings', 'Kotak Savings', 'SBI Savings']);
  });
});

describe('the near-match sentence, through the service', () => {
  test('the difference is shown in rupees, not in paise', async () => {
    // The service is where the real formatter is passed. Without it the domain
    // default prints "50.00" and the screen loses the rupee sign; before either,
    // it printed "5000" for a ₹50 fee — a hundredfold overstatement in the one
    // sentence that exists to help somebody decide.
    const db = await makeDb();
    const { hdfc, icici } = await twoAccounts(db);

    await db.repo('transaction').create(legOf(hdfc, 'out', { amount: 50_000_00 }));
    await db.repo('transaction').create(legOf(icici, 'in', { amount: 49_950_00 }));
    await db.repo('transaction').create(legOf(hdfc, 'out', {
      amount: 50_00, kind: 'expense', category: 'bank charges', payee: 'NEFT charges',
    }));

    const { proposals } = await new TransfersService(db).pending();
    const near = proposals.find((p) => p.confidence === CONFIDENCE.POSSIBLE);

    assert.ok(near, JSON.stringify(proposals.map((p) => p.confidence)));
    assert.ok(near.why.includes('\u20b950.00'), near.why);
    assert.ok(near.why.includes('NEFT charges'), near.why);
  });
});
