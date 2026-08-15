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
import {
  Service, NET_WORTH_LOAD, TRANSACTION_LIMIT, transactionsTruncated,
} from '../js/services/service.js';
import { PortfolioService } from '../js/services/portfolio.js';
import { RecordsService } from '../js/services/records.js';
import { FinanceService, assembleOverview } from '../js/services/finance.js';
import { DocumentsService } from '../js/services/documents.js';
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
    // ₹30,000 of growth plus the ₹4,000 dividend already paid out. This used
    // to be 30,000: the gain read `holding.invested` against `currentValue`
    // and ignored money that had come back. See `domain/costbasis.js`.
    assert.equal(view.rows[0].gain, 34_000);
    assert.equal(view.rows[0].income, 4_000);
    // Derived from the two transactions rather than lifted off the form.
    assert.equal(view.rows[0].basis.from, 'transactions');
    assert.equal(view.rows[0].invested, 100_000);
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

  test('a stale deposit does not report 0% on a rate it is actually earning', async () => {
    // The closing flow decides an XIRR almost single-handedly, so a value
    // typed once and never revisited does not make the rate slightly wrong —
    // it makes it meaningless. Measured before this: 0% on a deposit paying
    // 7.1%. That is a wrong number, not a missing one.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha' });
    const fd = await db.repo('holding').create({
      name: 'SBI deposit', kind: 'fixed deposit', owner: person.id,
      invested: 50_000_000, currentValue: 50_000_000, interestRate: 7.1,
      valuedOn: '2024-08-01', active: true,
    });
    await db.repo('investmentTransaction').create({
      holding: fd.id, date: '2024-08-01', kind: 'buy', amount: 50_000_000,
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-01' });
    const row = view.rows.find((r) => r.id === fd.id);

    assert.ok(row.rate > 6.5 && row.rate < 8,
      `expected a rate near the 7.1% recorded, got ${row.rate}`);
    // And it says so. A rate from an estimate and a rate from a figure
    // somebody typed are different claims; rendering them identically would be
    // the silent substitution this is careful not to make.
    assert.ok(row.rateEstimated, 'the row must say the rate came from an estimate');
  });

  test('and a holding nothing can re-value keeps the rate from what was typed', async () => {
    // A share whose price nobody updated has a stale rate too, and accrual
    // cannot help. Marking it as an estimate would be a claim about a figure
    // this never touched.
    const db = await makeDb();
    const { person } = await aPortfolio(db);
    const stock = await db.repo('holding').create({
      name: 'Some share', kind: 'stock', owner: person.id,
      invested: 100_000, currentValue: 130_000, active: true,
    });
    await db.repo('investmentTransaction').create({
      holding: stock.id, date: '2024-08-01', kind: 'buy', amount: 100_000,
    });

    const view = await new PortfolioService(db).overview({ asOf: '2026-08-01' });
    const row = view.rows.find((r) => r.id === stock.id);

    assert.not(row.rateEstimated, 'nothing re-valued it, so nothing may claim to have');
    assert.ok(row.rate > 0, 'and the rate is still computed from what was typed');
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

/*
 * The Finance overview, which used to be assembled inline in the screen.
 *
 * None of these could be written before: the arithmetic lived in a closure
 * inside a render function, reachable only by driving a browser. Wiring a new
 * finding into that screen family failed three times in a row, silently, for
 * exactly that reason.
 */
describe('the finance overview, assembled where it can be reached', () => {
  const clock = () => Date.parse('2026-07-20T00:00:00Z');

  const records = () => ({
    accounts: [{ id: 'a1', name: 'HDFC', kind: 'savings', openingBalance: 50_000_00, deletedAt: null }],
    transactions: [
      { id: 't1', date: '2026-07-05', amount: 35_000_00, kind: 'expense', direction: 'out',
        category: 'rent', account: 'a1', narration: 'UPI/DR/1/LANDLORD/ICIC/l@ok/Rent', deletedAt: null },
      { id: 't2', date: '2026-07-02', amount: 120_000_00, kind: 'income', direction: 'in',
        category: 'salary', account: 'a1', narration: 'NEFT CR ACME SALARY', deletedAt: null },
    ],
    budgets: [], recurring: [], loans: [], subscriptions: [], digitalAssets: [], people: [],
  });

  test('the balance is the opening figure plus what moved', () => {
    const view = assembleOverview(records(), { clock });
    assert.equal(view.balances[0].balance, 50_000_00 + 120_000_00 - 35_000_00);
  });

  test('this month is counted from the clock it is given, not the wall clock', () => {
    // The screen never passed a clock, so every figure here silently used the
    // real date and no test could pin any of them to a month.
    const july = assembleOverview(records(), { clock });
    const september = assembleOverview(records(), { clock: () => Date.parse('2026-09-20T00:00:00Z') });

    assert.ok(july.categories.length > 0, 'July has spending, or this test proves nothing');
    assert.equal(september.categories.length, 0, 'July is not September');
  });

  test('a missing entity yields an empty view rather than throwing', () => {
    const view = assembleOverview({}, { clock });
    assert.equal(view.balances.length, 0);
    assert.equal(view.bills.length, 0);
    assert.equal(view.commitment.total, 0);
  });

  test('the commitment figure carries what the statements show repeating', () => {
    // The seam that took two tranches to build and had no test above the
    // domain layer: the detector runs on the ledger, the figure comes from the
    // records, and the screen is where they meet.
    const data = records();
    for (const m of ['03', '04', '05', '06', '07']) {
      data.transactions.push({
        id: `n${m}`, date: `2026-${m}-14`, amount: 649_00, kind: 'expense', direction: 'out',
        category: 'subscription', account: 'a1',
        narration: 'UPI/DR/412345678901/NETFLIX/HDFC/n@hdfcbank/Pay', deletedAt: null,
      });
    }
    const view = assembleOverview(data, { clock });

    assert.ok(view.detected.some((charge) => /NETFLIX/i.test(charge.name)),
      'the ledger sees the repeating charge');
    assert.equal(view.commitment.unaccounted, 649_00,
      'and nothing records it, so it is named beside the committed figure');
  });

  test('the load names every entity the overview reads', async () => {
    // A screen that quietly adds a ninth `db.repo` call is the drift this whole
    // layer exists to stop, and the architecture ratchet counts it.
    const db = await makeDb();
    const view = await new FinanceService(db).overview({ clock });
    assert.ok(Array.isArray(view.bills));
    assert.ok(Array.isArray(view.transfers.proposals));
  });
});

/*
 * What a document does to the records around it.
 *
 * Both of these begin with a document and end by changing a *different*
 * entity, which is the second thing `services/service.js` says this layer is
 * for. Neither could be exercised without a browser before, and both are
 * writes where being wrong matters: one files evidence against a payment, the
 * other creates a record holding a document number.
 */
describe('cross-entity writes a document causes', () => {
  const probable = (transaction) => ({
    transaction, confidence: 'probable', days: 0, ambiguous: false, why: '',
  });

  test('a clear match files the receipt against the payment', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const txn = await db.repo('transaction').create({
      date: '2026-07-05', amount: 48_500_00, kind: 'expense', direction: 'out',
      account: account.id, payee: 'School',
    });

    const result = await new DocumentsService(db).fileReceipt(probable(txn), 'doc-1');
    assert.ok(result.filed);

    const after = await db.repo('transaction').get(txn.id);
    assert.equal((after.documents ?? []).join(), 'doc-1');
  });

  test('a receipt is appended, never substituted for what is already filed', async () => {
    // A transaction may have a receipt and an invoice and a warranty. Filing
    // one by losing the others would be worse than not filing at all.
    const db = await makeDb();
    const account = await makeAccount(db);
    const txn = await db.repo('transaction').create({
      date: '2026-07-05', amount: 48_500_00, kind: 'expense', direction: 'out',
      account: account.id, documents: ['invoice-9'],
    });

    await new DocumentsService(db).fileReceipt(probable(txn), 'doc-1');
    const after = await db.repo('transaction').get(txn.id);
    assert.equal((after.documents ?? []).sort().join(), 'doc-1,invoice-9');
  });

  test('an uncertain match is an answer, not an exception, and writes nothing', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const txn = await db.repo('transaction').create({
      date: '2026-07-05', amount: 48_500_00, kind: 'expense', direction: 'out',
      account: account.id,
    });

    const result = await new DocumentsService(db).fileReceipt(
      { transaction: txn, confidence: 'possible', ambiguous: true }, 'doc-1',
    );

    assert.not(result.filed);
    assert.includes(result.why, 'clear match');
    const after = await db.repo('transaction').get(txn.id);
    assert.equal((after.documents ?? []).length, 0, 'an uncertain match writes nothing at all');
  });

  test('filing the same receipt twice does not list it twice', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const txn = await db.repo('transaction').create({
      date: '2026-07-05', amount: 48_500_00, kind: 'expense', direction: 'out',
      account: account.id, documents: ['doc-1'],
    });

    const result = await new DocumentsService(db).fileReceipt(probable(txn), 'doc-1');
    assert.not(result.filed, 'a decision already made is not offered again');
  });

  test('an identifier a scan found is written as its own record', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    const created = await new DocumentsService(db).recordIdentifier({
      kind: 'PAN', number: 'ABCDE1234F', person: person.id,
    });

    assert.ok(created.id);
    const back = await db.repo('identityDocument').get(created.id);
    assert.equal(back.kind, 'PAN');
  });
});

/*
 * One limit, because three screens gave three balances.
 *
 * Measured on a household with 25,000 transactions: the dashboard read 10,000
 * of them and said ₹2,00,000, the Finance screen read 20,000 and said
 * ₹4,00,000, the ledgers read 50,000 and said ₹5,00,000. The same account, the
 * same day, one application.
 */
describe('one limit for every money figure', () => {
  test('no screen or service invents a transaction limit of its own', () => {
    // The guard, not the fix. A shared constant that nothing enforces drifts
    // back apart the first time somebody types a number.
    const offenders = [];
    for (const dir of ['js/modules', 'js/services']) {
      const base = new URL(`../${dir}/`, import.meta.url).pathname;
      for (const file of readdirSync(base).filter((f) => f.endsWith('.js'))) {
        const text = readFileSync(join(base, file), 'utf8');
        // A literal limit on a transaction read — the shape that drifted.
        const found = text.match(/repo\('transaction'\)[\s\S]{0,80}?limit:\s*\d[\d_]*/g)
          ?? text.match(/transactions:\s*\['transaction',[^\]]*limit:\s*\d[\d_]*/g);
        if (found) offenders.push(`${dir}/${file}: ${found[0].slice(-30)}`);
      }
    }

    assert.equal(offenders.join('\n'), '',
      'these read transactions with a hard-coded limit; use TRANSACTION_LIMIT');
  });

  test('the overview reports whether its figures saw the whole history', () => {
    // The half that was missing when the shared limit landed: the signal
    // existed and no view model carried it.
    const whole = assembleOverview({ transactions: [] }, { clock: () => Date.parse('2026-07-20') });
    assert.not(whole.truncated);

    const sliced = assembleOverview(
      { transactions: new Array(TRANSACTION_LIMIT).fill(null).map((_, i) => ({
        id: `t${i}`, date: '2026-07-01', amount: 100, kind: 'expense', direction: 'out',
      })) },
      { clock: () => Date.parse('2026-07-20') },
    );
    assert.ok(sliced.truncated, 'a full slice means there is probably more history');
  });

  test('a figure computed from a full slice says it was truncated', () => {
    // A balance summed from "the most recent N" is not the balance once a
    // household has more than N. Saying so is the only honest option, since
    // the number cannot be made right without reading the rest.
    assert.ok(transactionsTruncated(new Array(TRANSACTION_LIMIT).fill({})));
    assert.not(transactionsTruncated(new Array(TRANSACTION_LIMIT - 1).fill({})));
    assert.not(transactionsTruncated([]));
    assert.not(transactionsTruncated(null));
  });
});
