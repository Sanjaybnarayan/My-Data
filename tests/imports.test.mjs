import { test, describe, assert, setSuite } from './harness.mjs';
import { importList, orphanedTransactions, planUndo } from '../js/domain/imports.js';
import { backend } from './appsscript.mjs';

setSuite('imports');

const statement = (over = {}) => ({
  id: 's1', account: 'a1', fileName: 'kotak-may.csv',
  periodFrom: '2026-05-01', periodTo: '2026-05-31',
  importedOn: '2026-06-01', importedCount: 2, reconciled: true,
  ...over,
});

const transaction = (over = {}) => ({
  id: `t${Math.random().toString(36).slice(2, 7)}`,
  date: '2026-05-10', amount: 64_500, direction: 'out', kind: 'expense',
  account: 'a1', statement: 's1', payee: 'ZOMATO', ...over,
});

/* -------------------------------------------------------------- the list */

describe('what was imported', () => {
  test('an import is a file and the rows it created, not just a record', () => {
    const [entry] = importList([statement()], [transaction(), transaction({ direction: 'in', amount: 5_000_000 })]);

    assert.equal(entry.fileName, 'kotak-may.csv');
    assert.equal(entry.count, 2);
    assert.equal(entry.moneyOut, 64_500);
    assert.equal(entry.moneyIn, 5_000_000);
  });

  test('a card export is not listed as having balanced', () => {
    // `reconciled` is a vacuous true on a file with no balances to compare
    // against, and the screen turned it into a green "arithmetic closes"
    // badge. The entry now carries whether the answer meant anything.
    const [card] = importList(
      [statement({ reconciled: true, openingBalance: null, closingBalance: null })],
      [transaction()],
    );
    assert.equal(card.reconciled, true, 'the stored value is unchanged');
    assert.not(card.checkable, 'a file with no balances was reported as checked');

    const [bank] = importList(
      [statement({ reconciled: true, openingBalance: 100, closingBalance: 250 })],
      [transaction()],
    );
    assert.ok(bank.checkable);
  });

  test('rows belonging to another file are not counted against this one', () => {
    const [entry] = importList([statement()], [transaction(), transaction({ statement: 's2' })]);
    assert.equal(entry.count, 1);
  });

  test('a transaction entered by hand belongs to no import', () => {
    const [entry] = importList([statement()], [transaction({ statement: '' })]);
    assert.equal(entry.count, 0);
  });

  test('an older record without a stored direction still lands on a side', () => {
    const [entry] = importList([statement()],
      [transaction({ direction: undefined, kind: 'income', amount: 100 })]);
    assert.equal(entry.moneyIn, 100);
  });

  test('newest import first, because that is the one just made by mistake', () => {
    const list = importList([
      statement({ id: 's1', importedOn: '2026-01-01', fileName: 'january.pdf' }),
      statement({ id: 's2', importedOn: '2026-06-01', fileName: 'may.csv' }),
    ], []);
    assert.equal(list[0].fileName, 'may.csv');
  });

  test('what the file claimed to write is kept beside what is left', () => {
    // They differ once somebody has deleted rows by hand, and a household
    // about to undo an import should see that before they do.
    const [entry] = importList([statement({ importedCount: 5 })], [transaction()]);
    assert.equal(entry.claimed, 5);
    assert.equal(entry.count, 1);
  });
});

/* ------------------------------------------------------------- orphans */

describe('transactions whose file is gone', () => {
  test('a row pointing at a deleted statement is found', () => {
    // This is what deleting a statement used to leave behind: rows still in
    // every total with nothing left to identify them by.
    const orphans = orphanedTransactions([], [transaction(), transaction({ statement: '' })]);
    assert.length(orphans, 1);
  });

  test('a row pointing at a statement that still exists is not an orphan', () => {
    assert.length(orphanedTransactions([statement()], [transaction()]), 0);
  });

  test('a hand-entered row is never an orphan', () => {
    assert.length(orphanedTransactions([], [transaction({ statement: undefined })]), 0);
  });
});

/* ---------------------------------------------------------------- undo */

describe('what removing an import would take', () => {
  test('it names the count, the range and the money before anything happens', () => {
    // "Delete?" is a gamble. "This removes 2 transactions worth ₹645 between
    // 4 and 20 May" is a decision.
    const [entry] = importList([statement()], [
      transaction({ date: '2026-05-20' }),
      transaction({ date: '2026-05-04', amount: 100_000 }),
    ]);
    const plan = planUndo(entry);

    assert.equal(plan.count, 2);
    assert.equal(plan.from, '2026-05-04');
    assert.equal(plan.to, '2026-05-20');
    assert.equal(plan.moneyOut, 164_500);
    assert.length(plan.transactionIds, 2);
    assert.not(plan.onlyTheRecord);
  });

  test('a file whose rows are already gone says so', () => {
    const [entry] = importList([statement()], []);
    const plan = planUndo(entry);
    assert.ok(plan.onlyTheRecord);
    assert.length(plan.transactionIds, 0);
  });

  test('the plan carries the statement id, so both halves go together', () => {
    const [entry] = importList([statement()], [transaction()]);
    assert.equal(planUndo(entry).statementId, 's1');
  });

  test('a file with no dated rows falls back to the period it recorded', () => {
    const [entry] = importList([statement()], []);
    assert.equal(planUndo(entry).from, '2026-05-01');
  });
});

/* ------------------------------------------------------- trashing in Drive */

describe('a deleted document leaves nothing behind in Drive', () => {
  const OWNER = 'owner@example.com';
  const tokens = { 'owner-token': { email: OWNER, expires_in: '3599' } };

  test('the backend refuses a trash with no file id', () => {
    const body = backend({ owner: OWNER, tokens }).post('trash', 'owner-token', {});
    assert.not(body.ok);
    assert.equal(body.status, 400);
  });

  test('a stranger cannot trash this household files', () => {
    const api = backend({
      owner: OWNER,
      tokens: { ...tokens, 'stranger-token': { email: 'nobody@elsewhere.com', expires_in: '3599' } },
      driveFiles: { abc: { name: 'passport.pdf' } },
    });
    const body = api.post('trash', 'stranger-token', { fileId: 'abc' });

    assert.not(body.ok);
    assert.equal(body.status, 403);
    assert.not(api.driveFiles.abc.trashed, 'a refused request trashed the file anyway');
  });

  test('the file is binned, not destroyed', () => {
    // A deletion here is soft and Settings can undo it. A Drive file erased
    // outright would be the one half of that pair which does not come back;
    // Google keeps a binned file for thirty days, which is the same promise.
    const api = backend({ owner: OWNER, tokens, driveFiles: { abc: { name: 'passport.pdf' } } });
    const body = api.post('trash', 'owner-token', { fileId: 'abc' });

    assert.ok(body.ok);
    assert.ok(body.data.trashed);
    assert.equal(body.data.name, 'passport.pdf');
    assert.ok(api.driveFiles.abc.trashed);
  });

  test('a file already gone from Drive is a success, not an error', () => {
    // The caller wanted it absent and it is absent. Failing here would leave
    // the record undeletable for as long as the file stayed missing.
    const api = backend({ owner: OWNER, tokens, driveFiles: {} });
    const body = api.post('trash', 'owner-token', { fileId: 'gone' });

    assert.ok(body.ok);
    assert.ok(body.data.missing);
    assert.not(body.data.trashed);
  });
});
