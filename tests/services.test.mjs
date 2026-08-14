/**
 * The domain-service layer.
 *
 * These tests exist because the assembly they cover could previously only be
 * exercised by opening a browser. Every one of them runs against a real
 * in-memory database — real repository, real permissions, real crypto — with
 * no DOM anywhere near it.
 *
 * The guard checked hardest is that **a service reads through the repository
 * and never past it**. The repository is where `assertCan` and `rowFilter`
 * live, so a service that reached `db.adapter` would return rows its caller may
 * not see — silently, because a view model has nowhere to show a permission
 * error.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { Service, NET_WORTH_LOAD } from '../js/services/service.js';
import { PortfolioService } from '../js/services/portfolio.js';
import { RecordsService } from '../js/services/records.js';
import { xirr } from '../js/domain/portfolio.js';

setSuite('services');

const SERVICES_DIR = new URL('../js/services/', import.meta.url).pathname;

describe('the seam', () => {
  test('no service reaches past the repository', () => {
    // Not a style rule. `db.adapter` skips `assertCan` and `rowFilter`, so a
    // service that used it would hand a child their sibling's records with no
    // error anywhere — the view model has no place to put one.
    const offenders = [];
    for (const file of readdirSync(SERVICES_DIR).filter((f) => f.endsWith('.js'))) {
      const source = readFileSync(join(SERVICES_DIR, file), 'utf8');
      for (const [i, line] of source.split('\n').entries()) {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        if (/\.adapter\b/.test(line)) offenders.push(`${file}:${i + 1}`);
      }
    }
    assert.deep(offenders, []);
  });

  test('a misspelt entity names the service and the entity', async () => {
    // An empty list would be indistinguishable from "you have no holdings",
    // and the screen would render a plausible, wrong, empty state forever.
    //
    // Asserting only that *something* threw proved nothing — `db.repo()`
    // throws on an unknown entity by itself, so the test passed with this
    // guard deleted. What the guard adds is a message that names which service
    // asked for what, and that is what is checked.
    const db = await makeDb();
    class Broken extends Service {
      run() { return this.load({ things: ['hoolding'] }); }
    }

    let message = '';
    try { await new Broken(db).run(); } catch (err) { message = err.message; }
    assert.includes(message, 'Broken');
    assert.includes(message, 'hoolding');
  });

  test('a permission refusal is an empty list, not a crash', async () => {
    // A child opening a screen that mentions loans should get a screen without
    // loans. This matches what the repository already does for `list`.
    const db = await makeDb();
    db.setActor({ personId: 'per_kid', role: 'child' });

    const loaded = await new PortfolioService(db).load({ loans: ['loan', { decrypt: false }] });
    assert.deep(loaded.loans, []);
  });

  test('what net worth is made of is declared once', () => {
    // Before this, the investments screen and the dashboard each listed these
    // inline and neither knew about the other, so adding a seventh entity
    // would have produced two different net worths in one application.
    assert.deep(Object.keys(NET_WORTH_LOAD).sort(),
      ['accounts', 'holdings', 'loans', 'properties', 'transactions', 'vehicles']);
  });
});

/** A holding with two dated transactions, so XIRR has something to work on. */
async function aPortfolio(db) {
  const person = await makePerson(db, { name: 'Asha' });
  const holding = await db.repo('holding').create({
    name: 'Index fund', kind: 'mutual fund', owner: person.id,
    units: 100, invested: 100_000, currentValue: 130_000, active: true,
  });
  await db.repo('investmentTransaction').create({
    holding: holding.id, date: '2024-08-01', kind: 'buy', amount: 100_000, units: 100,
  });
  await db.repo('investmentTransaction').create({
    holding: holding.id, date: '2026-08-01', kind: 'dividend', amount: 4000, units: 0,
  });
  return { person, holding };
}

describe('the portfolio question', () => {
  test('an empty portfolio is an answer, not zeroes', async () => {
    const view = await new PortfolioService(await makeDb()).overview();
    assert.ok(view.empty);
    assert.length(view.rows, 0);
  });

  test('a holding is reported with its gain and its owner', async () => {
    const db = await makeDb();
    await aPortfolio(db);

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });
    assert.not(view.empty);
    assert.length(view.rows, 1);
    assert.equal(view.rows[0].ownerName, 'Asha');
    assert.equal(view.rows[0].gain, 30_000);
  });

  test('a rate needs two dated flows, and says nothing rather than zero', async () => {
    // The distinction that a rendering test cannot see: `0` reads as "this
    // investment is flat", `null` as "nothing here can say".
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha' });
    await db.repo('holding').create({
      name: 'Gold', kind: 'gold', owner: person.id,
      units: 10, invested: 50_000, currentValue: 60_000, active: true,
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });
    assert.equal(view.rows[0].rate, null, 'no transactions means no rate, not a flat one');
    assert.equal(view.pooled, null);
  });

  test('and the solver agrees, so the two cannot drift apart', () => {
    // The service guards on `flows.length >= 2`; `xirr` independently returns
    // null for one flow. Mutation-testing showed the guard is unreachable
    // today *because* of this, so the redundancy is only safe while both halves
    // hold — which is what this locks. A holding with no transactions still
    // produces one flow, its own current value.
    assert.equal(xirr([{ date: '2026-08-14', amount: 130_000 }]), null);
    assert.ok(xirr([
      { date: '2024-08-01', amount: -100_000 },
      { date: '2026-08-14', amount: 130_000 },
    ]) > 0, 'two dated flows do give a rate');
  });

  test('a closed holding leaves the rows and the summary together', async () => {
    // Both, not one. A closed fixed deposit is not part of what a portfolio is
    // worth today, so counting it in the summary while hiding it from the rows
    // would make the total disagree with the list under it — the shape of bug
    // that gets reported as "the numbers do not add up".
    const db = await makeDb();
    const { person } = await aPortfolio(db);
    await db.repo('holding').create({
      name: 'Closed FD', kind: 'fixed deposit', owner: person.id,
      units: 1, invested: 10_000, currentValue: 11_000, active: false,
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });
    assert.length(view.rows, 1);
    assert.equal(view.summary.count, 1);
    assert.equal(view.summary.value, 130_000, 'the closed holding is not current value');
  });

  test('share of assets is null with nothing to be a share of', async () => {
    // Dividing by zero assets produced `0%`, which reads as "your investments
    // are a negligible part of your assets" rather than "no assets recorded".
    const db = await makeDb();
    const person = await makePerson(db, { name: 'B' });
    await db.repo('holding').create({
      name: 'Worthless', kind: 'other', owner: person.id,
      units: 0, invested: 0, currentValue: 0, active: true,
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });
    assert.equal(view.netWorth.assets, 0);
    assert.equal(view.shareOfAssets, null);
  });

  test('a recurring deposit is valued from the instalments the service loaded', async () => {
    // The seam this closes: `accrualReport` is right in a unit test whether or
    // not anybody passes it transactions, and an RD with none comes back
    // "unchecked" rather than wrong — quiet, plausible, and exactly what the
    // screen showed before. Dropping `{ transactions }` from the service fails
    // here and nowhere else.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha' });
    const rd = await db.repo('holding').create({
      name: 'RD', kind: 'recurring deposit', owner: person.id,
      // Paise, like everything else here: twelve instalments of ₹5,000.
      invested: 6_000_000, currentValue: 6_000_000, interestRate: 6.8,
      valuedOn: '2024-08-05', active: true,
    });

    for (let i = 0; i < 12; i++) {
      await db.repo('investmentTransaction').create({
        holding: rd.id,
        date: new Date(Date.UTC(2024, 7 + i, 5)).toISOString().slice(0, 10),
        kind: 'contribution', amount: 500_000,
      });
    }

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });

    assert.length(view.accrual.unchecked, 0, 'the instalments reached the report');
    assert.length(view.accrual.drifted, 1);
    assert.ok(view.accrual.understated > 0, 'and it is worth more than was recorded');
  });

  test('net worth is computed from the same six entities the constant names', async () => {
    const db = await makeDb();
    await aPortfolio(db);
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2026-08-01', kind: 'income', amount: 500_000, account: account.id,
      category: 'salary', payee: 'Employer', tags: [],
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-14' });
    assert.ok(view.netWorth.assets > 500_000, 'the bank balance is in there');
    assert.ok(view.shareOfAssets < 50, 'and the holding is only part of it');
  });
});

describe('what deleting a record would break', () => {
  test('nothing pointing at it says so plainly', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Alone' });

    const impact = await new RecordsService(db).impactOfDeleting('person', person.id);
    assert.equal(impact.total, 0);
    assert.includes(new RecordsService(db).describeImpact(impact), 'Nothing else refers');
  });

  test('a required reference is counted separately from an optional one', async () => {
    // The distinction the old warning could not make. A transaction must have
    // an account; a transaction's person is optional. Deleting an account and
    // deleting a person are different acts.
    const db = await makeDb();
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2026-08-01', kind: 'expense', amount: 100, account: account.id,
      category: 'other', payee: 'Shop', tags: [],
    });

    const impact = await new RecordsService(db).impactOfDeleting('account', account.id);
    assert.equal(impact.total, 1);
    assert.equal(impact.breaking, 1, 'a transaction cannot exist without its account');
    assert.ok(impact.byEntity[0].required);
  });

  test('an optional reference is reported without claiming it breaks anything', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Referenced' });
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2026-08-01', kind: 'expense', amount: 100, account: account.id,
      category: 'other', payee: 'Shop', person: person.id, tags: [],
    });

    const service = new RecordsService(db);
    const impact = await service.impactOfDeleting('person', person.id);
    assert.equal(impact.total, 1);
    assert.equal(impact.breaking, 0);
    assert.includes(service.describeImpact(impact), 'pointing at nothing');
    assert.not(/will not pass validation/.test(service.describeImpact(impact)));
  });

  test('breaking references are listed first', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Busy' });
    const account = await makeAccount(db, { owner: person.id });
    await db.repo('transaction').create({
      date: '2026-08-01', kind: 'expense', amount: 100, account: account.id,
      category: 'other', payee: 'Shop', person: person.id, tags: [],
    });

    const impact = await new RecordsService(db).impactOfDeleting('person', person.id);
    if (impact.byEntity.some((g) => g.required)) {
      assert.ok(impact.byEntity[0].required, 'the consequence that invalidates records comes first');
    }
  });

  test('the sentence counts in the singular when there is one', async () => {
    // "1 records refer" is the classic way wording like this goes wrong, and
    // it goes wrong in a dialog somebody is reading before a destructive act.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'One' });
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2026-08-01', kind: 'expense', amount: 100, account: account.id,
      category: 'other', payee: 'Shop', person: person.id, tags: [],
    });

    const service = new RecordsService(db);
    const said = service.describeImpact(await service.impactOfDeleting('person', person.id));
    assert.includes(said, '1 record refers');
    assert.not(/1 records/.test(said), said);
  });

  test('an unknown entity throws rather than reporting no impact', async () => {
    const db = await makeDb();
    let threw = false;
    try { await new RecordsService(db).impactOfDeleting('nonsense', 'x'); } catch { threw = true; }
    assert.ok(threw, 'reporting "nothing refers to it" would be a licence to delete');
  });
});
