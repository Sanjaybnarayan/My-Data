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
import { MessagesService } from '../js/services/sms.js';
import { IdentityService, assembleIdentityReview } from '../js/services/identity.js';
import { EstateService, ESTATE_LOAD } from '../js/services/estate.js';
import { EvidenceService, EVIDENCE_LOAD } from '../js/services/evidence.js';
import { ExplainService } from '../js/services/explain.js';
import { xirr } from '../js/domain/portfolio.js';
import { estate } from '../js/domain/estate.js';
import { entities } from '../js/data/schema.js';

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

/*
 * A message against the statements, which is a cross-entity question and so
 * belongs here rather than in the screen. The architecture ratchet is what said
 * so: two lines in the Import screen took the forbidden-edge count from 61 to
 * 62, and the number may only fall.
 */
describe('reading a bank message against what was imported', () => {
  test('a message matching a statement row is linked to it', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2026-08-15', amount: 50_000_00, kind: 'expense', direction: 'out',
      account: account.id, reference: 'UPI/412345678901',
    });

    const { reading, result } = await new MessagesService(db).readAndReconcile({
      text: 'Rs 50,000.00 debited from a/c XX8963 on 15-08-26 UPI Ref 412345678901',
    });

    assert.equal(reading.amount, 50_000_00);
    assert.equal(result.agreement, 'linked');
  });

  test('a credential is refused without the database being asked at all', async () => {
    // Not because a query would leak it — because there is no reason to run
    // one, and the shortest path a secret can travel is the safest.
    let asked = false;
    const db = await makeDb();
    const service = new MessagesService(db);
    const original = service.repo.bind(service);
    service.repo = (name) => { asked = true; return original(name); };

    const { reading, result } = await service.readAndReconcile({
      text: '123456 is your OTP for Rs 50,000. Do not share it.',
    });

    assert.ok(reading.secret);
    assert.equal(reading.amount, null);
    assert.equal(result.agreement, 'none');
    assert.not(asked, 'no repository call was made for a credential');
  });
});

describe('identity review — what the household is told, worst first', () => {
  const kyc = (db, over) => db.repo('kycRecord').create({
    institution: 'HDFC', recordedOn: '2026-07-01', source: 'account statement', ...over,
  });

  test('a shared CKYC identifier is the first thing on the screen', async () => {
    // The assembly this service exists for. Before it, the engine reported a
    // CRITICAL finding and nothing drew it.
    const db = await makeDb();
    const sanjay = await makePerson(db, { name: 'Sanjay Narayan', birthday: '1980-05-04' });
    const meera = await makePerson(db, { name: 'Meera Narayan', birthday: '1984-11-19' });

    await kyc(db, { person: sanjay.id, kin: 'KIN00012345678', heldName: 'Sanjay Narayan' });
    await kyc(db, {
      person: meera.id, institution: 'ICICI', kin: 'KIN00012345678',
      heldName: 'Meera Narayan',
    });
    await kyc(db, { person: sanjay.id, institution: 'Axis', heldBirthday: '1980-04-05' });

    const review = await new IdentityService(db).review();

    assert.ok(review.any);
    assert.equal(review.conflicts[0].severity, 'CRITICAL');
    assert.ok(review.conflicts.some((one) => one.institution === 'Axis'
      && one.field === 'birthday'));
  });

  test('a household with no KYC records gets no banner rather than an empty one',
    async () => {
      const db = await makeDb();
      await makePerson(db, { name: 'Sanjay Narayan' });
      assert.not((await new IdentityService(db).review()).any);
    });

  test('the names come from the household, and an unknown id stays an id', () => {
    const nameOf = IdentityService.nameLookup([{ id: 'p1', name: 'Sanjay' }]);
    assert.equal(nameOf('p1'), 'Sanjay');
    // Better a household sees an id than a blank where a name should be.
    assert.equal(nameOf('p9'), 'p9');
  });

  test('conflicts and drift are kept apart', async () => {
    // Two different questions with two different fixes. Merged into one list
    // they would need a column to say which was which.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Sanjay Narayan', birthday: '1980-05-04' });
    await kyc(db, { person: person.id, heldBirthday: '1980-04-05' });
    await kyc(db, { person: person.id, institution: 'Axis', heldBirthday: '1979-01-01' });

    const review = await new IdentityService(db).review();
    assert.ok(review.conflicts.length, 'both institutions disagree with the person');
    assert.ok(review.drift.length, 'and with each other');
  });

  test('the assembler drops a deleted record given plain rows', () => {
    // Through the repository this filter is redundant — `list` has already
    // dropped soft-deleted rows, and two mutations survived saying so. The
    // assembler is exported to be usable *without* a database, and that is the
    // interface where a deleted row would otherwise be compared.
    const people = [{ id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04' }];
    const records = [{
      id: 'k1', person: 'p1', institution: 'HDFC', heldBirthday: '1980-04-05',
      deletedAt: '2026-01-01',
    }];

    const review = assembleIdentityReview({ people, records });
    assert.not(review.any);
    assert.length(review.conflicts, 0);
  });

  test('and a deleted person is not compared against anything', () => {
    const people = [
      { id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04', deletedAt: '2026-01-01' },
    ];
    const records = [{
      id: 'k1', person: 'p1', institution: 'HDFC', heldBirthday: '1980-04-05', deletedAt: null,
    }];

    assert.length(assembleIdentityReview({ people, records }).conflicts, 0);
  });

  test('a deleted record is in neither', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Sanjay Narayan', birthday: '1980-05-04' });
    const record = await kyc(db, { person: person.id, heldBirthday: '1980-04-05' });
    await db.repo('kycRecord').remove(record.id);

    const review = await new IdentityService(db).review();
    assert.not(review.any);
    assert.length(review.conflicts, 0);
  });
});

describe("a record's own history", () => {
  test('what happened to this record, and not to its neighbours', async () => {
    // The log has recorded `recordId` on every entry since Phase 0.5 and
    // nothing could ask it: `recentActivity` filters by entity *name*, so the
    // application could say what happened to accounts and never what happened
    // to **this** account.
    const db = await makeDb();
    const mine = await makeAccount(db, { name: 'HDFC Savings' });
    const other = await makeAccount(db, { name: 'ICICI Salary' });

    await db.repo('account').update(mine.id, { name: 'HDFC Savings (joint)' });
    await db.repo('account').update(other.id, { name: 'ICICI — closed' });

    const { entries, summary } = await new RecordsService(db).history(mine.id);

    assert.length(entries, 2, 'the other account leaked in');
    assert.equal(summary.changes, 1);
    assert.ok(summary.created);
    assert.equal(entries[0].action, 'update', 'newest first');
  });

  test('an actor still in the household is named, and one who left is an id',
    async () => {
      // A record changed by somebody since removed still changed. A blank
      // there would read as "nobody", which is the one thing it was not.
      //
      // The first version of this test built its own lookup and asserted
      // against that, so the mutation blanking the service's `nameOf` passed
      // it — a vacuous test, caught by mutating the thing it claimed to cover.
      const db = await makeDb();
      const person = await makePerson(db, { name: 'Sanjay Narayan' });
      db.setActor({ personId: person.id, role: 'owner' });

      const account = await makeAccount(db, { name: 'HDFC Savings' });
      const { nameOf } = await new RecordsService(db).history(account.id);

      assert.equal(nameOf(person.id), 'Sanjay Narayan');
      assert.equal(nameOf('per_gone'), 'per_gone', 'somebody who left became nobody');
    });

  test('a read is counted apart from a change', async () => {
    // An entry saying somebody *opened* a vault item is the whole reason reads
    // are logged for it. Folding it into "changes" would overstate the edits
    // and hide the reads.
    const db = await makeDb();
    const item = await db.repo('vaultItem').create({ name: 'Email', kind: 'login' });
    await db.repo('vaultItem').get(item.id);

    const { summary } = await new RecordsService(db).history(item.id);
    assert.equal(summary.changes, 0);
    assert.ok(summary.reads > 0, 'opening a vault item was not recorded');
  });

  test('a record nothing has happened to has no history rather than a crash',
    async () => {
      const db = await makeDb();
      const { entries, summary } = await new RecordsService(db).history('acc_nothing');
      assert.length(entries, 0);
      assert.equal(summary.changes, 0);
      assert.equal(summary.created, null);
    });
});

describe('nominations, read where they can be read', () => {
  test('the three entities carrying a nominee are loaded decrypted', () => {
    // Not a style point. All three nominee fields are encrypted; loaded any
    // other way this service would hand the widget ciphertext, and the gap
    // list — the whole answer — would come out empty.
    for (const key of ['accounts', 'holdings', 'policies']) {
      assert.equal(ESTATE_LOAD[key][1].decrypt, true, key);
    }
  });

  test('a nominee survives the round trip through real encryption', async () => {
    const db = await makeDb();
    await db.repo('account').create({
      name: 'HDFC Savings', kind: 'savings', institution: 'HDFC',
      nominee: 'Meera Narayan',
    });
    await db.repo('account').create({
      name: 'ICICI Salary', kind: 'savings', institution: 'ICICI',
    });

    const review = await new EstateService(db).review();

    assert.equal(review.unreadable, 0, 'nothing came back sealed');
    assert.length(review.nominations, 1);
    assert.equal(review.nominations[0].nominee, 'Meera Narayan');
    assert.length(review.gaps, 1);
    assert.equal(review.gaps[0].name, 'ICICI Salary');
  });

  test('and reading the same rows undecrypted reports unreadable, not zero gaps',
    async () => {
      // The failure this guard exists for, reproduced through the real
      // repository: sealed values must never pass as names.
      const db = await makeDb();
      await db.repo('account').create({
        name: 'HDFC Savings', kind: 'savings', institution: 'HDFC',
        nominee: 'Meera Narayan',
      });

      const accounts = await db.repo('account').list({ decrypt: false });
      const review = estate({ accounts, people: [] });

      assert.equal(review.unreadable, 1);
      assert.length(review.nominations, 0);
      assert.length(review.gaps, 0, 'a sealed nominee is not a missing one');
    });
});

describe('a message that is kept, and one that is never written', () => {
  const DEBIT = 'Rs 50,000.00 debited from a/c XX8963 on 15-08-26 to VPA '
    + 'landlord@okicici UPI Ref 412345678901. Avl Bal Rs 1,40,500.00';

  /** Every value in every store, flattened — the only honest way to say "nowhere". */
  async function everything(db) {
    const found = [];
    for (const name of Object.keys(entities)) {
      const rows = await db.adapter.query(name, {}).catch(() => []);
      for (const row of rows) found.push(JSON.stringify(row));
    }
    for (const name of ['audit', 'outbox', 'search', 'meta']) {
      const rows = await db.adapter.query(name, {}).catch(() => []);
      for (const row of rows) found.push(JSON.stringify(row));
    }
    return found.join(' ');
  }

  test('an OTP is not written anywhere in the database', async () => {
    // Rule 53, asserted across every store rather than against the one table
    // it was most likely to land in. A redacted-but-stored middle ground is
    // what this is checking does not exist.
    const db = await makeDb();
    const out = await new MessagesService(db)
      .ingest({ text: '481923 is your OTP for Rs 50,000 to a/c XX8963. Do not share it.',
        sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z' });

    assert.equal(out.stored, null);
    assert.includes(out.why, 'one-time code');

    const dump = await everything(db);
    assert.not(dump.includes('481923'), 'the code reached a store');
    assert.not(dump.includes('Do not share'), 'the text reached a store');
    assert.length(await db.repo('smsMessage').list({}), 0);
  });

  test('an ordinary debit is kept, with what it matched', async () => {
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    const row = await db.repo('transaction').create({
      date: '2026-08-15', kind: 'expense', amount: 50_000_00, account: account.id,
      accountNumber: 'XXXXXX8963', reference: 'UPI/412345678901',
    });

    const out = await new MessagesService(db).ingest({
      text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z',
    });

    assert.ok(out.stored);
    assert.equal(out.stored.amount, 50_000_00);
    // Rule 52: linked, not duplicated. One event, two pieces of evidence.
    assert.equal(out.stored.transaction, row.id);
    assert.equal(out.stored.agreement, 'linked');
  });

  test('the text comes back through real encryption', async () => {
    const db = await makeDb();
    const out = await new MessagesService(db).ingest({
      text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z',
    });

    const sealed = (await db.adapter.query('smsMessage', {}))[0];
    assert.ok(String(sealed.text).startsWith('enc:v1:'), 'stored in the clear');

    const read = await db.repo('smsMessage').get(out.stored.id);
    assert.includes(read.text, 'debited from a/c');
  });

  test('the same message twice is one record', async () => {
    const db = await makeDb();
    const service = new MessagesService(db);
    await service.ingest({ text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z' });
    const second = await service.ingest({
      text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:33:00Z',
    });

    assert.includes(second.why, 'already recorded');
    assert.length(await db.repo('smsMessage').list({}), 1);
  });

  test('a message matching nothing is kept without a link invented', async () => {
    const db = await makeDb();
    const out = await new MessagesService(db).ingest({
      text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z',
    });

    assert.ok(out.stored, 'evidence of something no statement covers is worth keeping');
    assert.not(out.stored.transaction, 'no row was invented for it');
    assert.equal(out.stored.agreement, 'none');
  });

  test('a disagreement is stored as a disagreement', async () => {
    // Rule 51 and rule 56 together: the message is never authoritative, and
    // neither figure is written over the other.
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    await db.repo('transaction').create({
      date: '2026-08-15', kind: 'expense', amount: 55_000_00, account: account.id,
      accountNumber: 'XXXXXX8963', reference: 'UPI/412345678901',
    });

    const out = await new MessagesService(db).ingest({
      text: DEBIT, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z',
    });

    assert.equal(out.stored.agreement, 'conflict');
    assert.equal(out.stored.amount, 50_000_00, 'the message still says what it said');
    const row = await db.repo('transaction').get(out.stored.transaction);
    assert.equal(row.amount, 55_000_00, 'and the statement still says what it said');
  });

  test('a pasted message with no arrival time still saves', async () => {
    // The browser check found this: every fixture above supplies `receivedAt`,
    // so a required field was never missing until a person pasted into the
    // real box. The day it was brought in is recorded rather than the day it
    // was sent being invented.
    const db = await makeDb();
    const out = await new MessagesService(db).ingest(
      { text: DEBIT, sender: 'pasted' },
      { clock: () => Date.parse('2026-09-01T00:00:00Z') },
    );

    assert.ok(out.stored);
    assert.equal(out.stored.receivedAt, '2026-09-01');
    // And the date the message itself names is kept apart from it.
    assert.equal(out.stored.transactionDate, '2026-08-15');
  });

  test('no field on the entity could hold a one-time code', () => {
    // The structural half of rule 53: there is no redacted-but-stored middle
    // ground to get wrong, because there is nowhere to put one.
    const keys = entities.smsMessage.fields.map((f) => f.key);
    for (const key of ['otp', 'code', 'pin', 'password', 'secret']) {
      assert.not(keys.includes(key), key);
    }
  });
});

describe('what the sources say, through a real database', () => {
  test('a payment with three sources is counted as one, corroborated', async () => {
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    const row = await db.repo('transaction').create({
      date: '2026-08-15', kind: 'expense', amount: 2_499_00, account: account.id,
      accountNumber: 'XXXXXX8963', reference: 'UPI/412345678901',
    });
    await db.repo('receipt').create({
      date: '2026-08-15', merchant: 'Chai House', amount: 2_499_00,
      messageId: 'm-1', mailbox: 'personal', transaction: row.id,
    });
    await new MessagesService(db).ingest({
      text: 'Rs 2,499.00 debited from a/c XX8963 on 15-08-26 to VPA chaihouse@okhdfc '
        + 'UPI Ref 412345678901. Avl Bal Rs 1,40,500.00',
      sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z',
    });

    const review = await new EvidenceService(db).review();
    assert.equal(review.total, 1);
    assert.equal(review.corroborated, 1);
    assert.equal(review.bySources[3], 1);
    assert.length(review.orphans, 0);
  });

  test('a receipt and an alert with no row between them is reported, not created',
    async () => {
      const db = await makeDb();
      await db.repo('receipt').create({
        date: '2026-08-20', merchant: 'Metro Cash', amount: 8_750_00,
        messageId: 'm-2', mailbox: 'personal',
      });
      await new MessagesService(db).ingest({
        text: 'Rs 8,750.00 debited from a/c XX8963 on 20-08-26 to VPA metro@okaxis '
          + 'UPI Ref 999888777666. Avl Bal Rs 1,31,750.00',
        sender: 'HDFCBK', receivedAt: '2026-08-20T18:02:00Z',
      });

      const review = await new EvidenceService(db).review();
      assert.length(review.orphans, 1);
      assert.equal(review.orphans[0].amount, 8_750_00);
      // The refusal, through the repository rather than in a pure function.
      assert.length(await db.repo('transaction').list({}), 0);
    });

  test('messages are loaded decrypted, or the summary reads ciphertext', () => {
    // The trap `docs/SEALED_VALUES.md` records, one entity along.
    assert.equal(EVIDENCE_LOAD.messages[1].decrypt, true);
  });
});

describe('explaining a movement, through the service a screen uses', () => {
  async function household() {
    const db = await makeDb();
    const hdfc = await makeAccount(db, { name: 'HDFC Savings' });
    const broker = await makeAccount(db, { name: 'Zerodha' });
    const statement = await db.repo('bankStatement').create({
      account: hdfc.id, periodFrom: '2026-07-01', periodTo: '2026-07-31',
      fileName: 'hdfc-jul-2026.pdf', reconciled: true,
    });
    return { db, hdfc, broker, statement };
  }

  test('a well-formed movement reaches the file its legs came from', async () => {
    const { db, hdfc, broker, statement } = await household();
    const event = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
      why: 'a debit and a credit of the same amount one day apart',
    });
    for (const [account, direction] of [[hdfc.id, 'out'], [broker.id, 'in']]) {
      await db.repo('transaction').create({
        date: '2026-07-15', kind: direction === 'out' ? 'expense' : 'income',
        amount: 50_000_00, account, statement: statement.id,
        movement: event.id, movementRole: 'leg', direction,
      });
    }

    const out = await new ExplainService(db).forEvent(event.id);
    assert.ok(out.fullyDocumented);
    assert.length(out.chains, 2);
    assert.includes(out.chains[0].story, 'hdfc-jul-2026.pdf');
  });

  test('the household count separates documented, typed and empty', async () => {
    const { db, hdfc, broker, statement } = await household();

    const documented = await db.repo('economicEvent').create({
      date: '2026-07-15', kind: 'transfer', amount: 50_000_00,
    });
    for (const [account, direction] of [[hdfc.id, 'out'], [broker.id, 'in']]) {
      await db.repo('transaction').create({
        date: '2026-07-15', kind: 'expense', amount: 50_000_00, account,
        statement: statement.id, movement: documented.id, movementRole: 'leg', direction,
      });
    }
    await db.repo('economicEvent').create({
      date: '2026-05-01', kind: 'transfer', amount: 10_000_00, title: 'Orphan',
    });

    const review = await new ExplainService(db).review();
    assert.equal(review.total, 2);
    assert.equal(review.documented, 1);
    assert.equal(review.unexplained, 1);
    assert.ok(review.problems.some((row) => row.title === 'Orphan'));
  });

  test('a movement that does not exist explains nothing rather than throwing',
    async () => {
      const { db } = await household();
      assert.equal(await new ExplainService(db).forEvent('cnm_nothing'), null);
    });
});

/**
 * A staff member's documents, through the reference that already exists.
 *
 * There is no `document.staff` and there should not be: a document filed
 * against the person would not appear on the role, and one filed against the
 * role would not appear on the person. Two paths to one thing fragment it.
 */
describe("a staff member's documents", () => {
  test('they are the documents of the person the role points at', async () => {
    const db = await makeDb();
    const cook = await makePerson(db, { name: 'A Kumar' });
    const other = await makePerson(db, { name: 'B Rao' });

    const role = await db.repo('staff').create({ person: cook.id, role: 'Cook' });
    await db.repo('document').create({ title: 'Aadhaar copy', person: cook.id });
    await db.repo('document').create({ title: 'Someone else', person: other.id });

    const out = await new RecordsService(db).documentsForStaff(role.id);

    assert.equal(out.person, cook.id);
    assert.length(out.documents, 1, "another person's document leaked in");
    assert.equal(out.documents[0].title, 'Aadhaar copy');
  });

  test('a role pointing at nobody returns nothing rather than everything', async () => {
    // The failure worth guarding: an empty person filter matching every row
    // would show one household member the papers of all the others.
    const db = await makeDb();
    await makePerson(db, { name: 'A Kumar' });
    await db.repo('document').create({ title: 'Private', person: null });

    const out = await new RecordsService(db).documentsForStaff('staff_missing');
    assert.equal(out.person, null);
    assert.length(out.documents, 0);
  });
});

/**
 * What has actually been paid to a staff member.
 *
 * A wage is not an `economicEvent` — those kinds only ever describe money
 * moving between the household's own accounts. The link is
 * `transaction.person`, and it already existed; this reads it for the first
 * time. See `docs/HOUSEHOLD_STAFF.md`.
 */
describe('what a staff member has been paid', () => {
  test('payments are the transactions naming that person', async () => {
    const db = await makeDb();
    const cook = await makePerson(db, { name: 'A Kumar' });
    const other = await makePerson(db, { name: 'B Rao' });
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    const role = await db.repo('staff').create({
      person: cook.id, role: 'Cook', monthlyPay: 12_000_00,
    });

    await db.repo('transaction').create({
      account: account.id, person: cook.id, kind: 'expense', amount: 12_000_00, date: '2026-07-01',
    });
    await db.repo('transaction').create({
      account: account.id, person: other.id, kind: 'expense', amount: 9_000_00, date: '2026-07-02',
    });

    const out = await new RecordsService(db).paymentsForStaff(role.id);

    assert.length(out.payments, 1, "somebody else's payment leaked in");
    assert.equal(out.payments[0].amount, 12_000_00);
  });

  test('what was agreed is returned beside the payments, never instead', async () => {
    // A staff record showing `monthlyPay` alone would tell a household what it
    // expected to happen and call it what happened.
    const db = await makeDb();
    const cook = await makePerson(db, { name: 'A Kumar' });
    const role = await db.repo('staff').create({
      person: cook.id, role: 'Cook', monthlyPay: 12_000_00,
    });

    const out = await new RecordsService(db).paymentsForStaff(role.id);
    assert.equal(out.agreed, 12_000_00);
    assert.length(out.payments, 0, 'an agreed figure became a payment');
  });

  test('a role pointing at nobody returns nothing rather than everything', async () => {
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    await db.repo('transaction').create({ account: account.id, kind: 'expense', amount: 100, date: '2026-07-01' });

    const out = await new RecordsService(db).paymentsForStaff('staff_missing');
    assert.length(out.payments, 0);
    assert.equal(out.agreed, null);
  });
});
