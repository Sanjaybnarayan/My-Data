import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import {
  fingerprint, scoreAccount, matchAccount, accountFromStatement,
  categoryFor, methodFor, kindFor, toRecord, planStatement, toStatementRecord, reviewBatch,
} from '../js/domain/import.js';
import { entities } from '../js/data/schema.js';
import {
  config, configure, isConfigured, loadStoredConfig, saveStoredConfig,
} from '../js/core/config.js';

setSuite('import');

/* ---------------------------------------------------------------- fixtures */

const X = { serial: 39, date: 73, description: 119, withdrawal: 391, deposit: 460, balance: 525 };

const header = () => ({
  y: 720,
  cells: [
    { x: 44, text: '#' }, { x: 75, text: 'Date' }, { x: 124, text: 'Description' },
    { x: 355, text: 'Withdrawal (Dr.)' }, { x: 429, text: 'Deposit (Cr.)' },
    { x: 498, text: 'Balance' },
  ],
});

let y = 700;

function row(serial, date, text, { out, into, balance }) {
  const cells = [
    { x: X.serial, text: String(serial) },
    { x: X.date, text: date },
    { x: X.description, text },
  ];
  if (out != null) cells.push({ x: X.withdrawal, text: out });
  if (into != null) cells.push({ x: X.deposit, text: into });
  cells.push({ x: X.balance, text: balance });
  return { y: (y -= 14), cells };
}

/**
 * A statement for one month. `number` lets a test build several accounts, and
 * the balances chain so the parse checks out.
 */
function statement({ number = '1234500000', from = '01 Apr 2025', opening = '10,000.00' } = {}) {
  y = 700;
  return [
    { y: 780, cells: [{ x: 40, text: 'Account Statement' }] },
    { y: 775, cells: [{ x: 40, text: `01 Apr 2025 - 30 Apr 2025` }] },
    { y: 770, cells: [{ x: 40, text: `Account No. ${number}` }] },
    { y: 760, cells: [{ x: 40, text: 'Meera R K' }] },
    { y: 750, cells: [{ x: 40, text: 'IFSC Code KKBK0000123' }] },
    header(),
    { y: 710, cells: [{ x: 119, text: 'Opening Balance' }, { x: X.balance, text: opening }] },
    row(1, from, 'UPI/ZOMATO LIMITED/123/Payment', { out: '500.00', balance: '9,500.00' }),
    row(2, from, 'Recd:IMPS/100000000001/RAMESH T/KKBK/X1/IMPS', { into: '2,000.00', balance: '11,500.00' }),
    row(3, from, 'NACH-10-DR-KOTAKMAHPRIMELTKKBK-RC4-', { out: '1,000.00', balance: '10,500.00' }),
    { y: 600, cells: [{ x: 40, text: 'Account Summary' }] },
    { y: 590, cells: [{ x: 40, text: `Savings Account (SA): ${opening} 10,500.00` }] },
  ];
}

const anAccount = (over = {}) => ({
  id: 'acc_1', name: 'Kotak savings', kind: 'savings', institution: 'Kotak Mahindra Bank',
  accountNumber: '1234500000', ifsc: 'KKBK0000123', holder: 'per_1', archived: false, ...over,
});

/* ------------------------------------------------------------ fingerprints */

describe('fingerprints', () => {
  const line = {
    date: '2025-04-01', amount: 50_000, direction: 'out',
    reference: 'UPI-100000000003', description: 'UPI/ZOMATO',
  };

  test('the same line in two downloads is the same transaction', () => {
    assert.equal(fingerprint('acc_1', line), fingerprint('acc_1', { ...line, serial: 900 }));
  });

  test('the serial number is deliberately not part of it', () => {
    // A serial restarts at 1 in every statement. Including it would make the
    // same transaction look new in every overlapping download.
    assert.equal(fingerprint('acc_1', { ...line, serial: 1 }),
      fingerprint('acc_1', { ...line, serial: 412 }));
  });

  test('the same line on two accounts is two transactions', () => {
    assert.notEqual(fingerprint('acc_1', line), fingerprint('acc_2', line));
  });

  test('a different amount, date or direction is a different transaction', () => {
    const base = fingerprint('acc_1', line);
    assert.notEqual(base, fingerprint('acc_1', { ...line, amount: 50_001 }));
    assert.notEqual(base, fingerprint('acc_1', { ...line, date: '2025-04-02' }));
    assert.notEqual(base, fingerprint('acc_1', { ...line, direction: 'in' }));
  });

  test('two withdrawals a statement prints almost identically stay two', () => {
    // Three ₹10,000 withdrawals at the same machine on the same day differ
    // only in a trailing reference number the parser does not lift out. A
    // fingerprint that truncates the narration merges them, and two real
    // withdrawals vanish — worse than any duplicate.
    const atm = (tail, balance) => ({
      date: '2026-02-10',
      amount: 1_000_000,
      direction: 'out',
      reference: '',
      description: `ATL/6706/800001/+TRUPTHI ULLAL MAIN 6041180077${tail}`,
      printedBalance: balance,
    });

    const keys = new Set([atm('53', 4_060_000), atm('54', 3_060_000), atm('55', 2_060_000)]
      .map((row) => fingerprint('acc_1', row)));
    assert.equal(keys.size, 3);
  });

  test('with no reference the narration stands in, spacing and all', () => {
    const a = { date: '2025-04-01', amount: 100, direction: 'out', description: 'Chrg:  SMS  charges' };
    const b = { ...a, description: 'Chrg: SMS charges' };
    assert.equal(fingerprint('acc_1', a), fingerprint('acc_1', b));
  });
});

/* --------------------------------------------------------- account routing */

describe('matching an account', () => {
  test('the full number is a certain match', () => {
    const result = matchAccount({ number: '1234500000', ifsc: 'KKBK0000123' }, [anAccount()]);
    assert.equal(result.account.id, 'acc_1');
    assert.ok(result.sure);
  });

  test('a masked number still matches the account it belongs to', () => {
    // Statements routinely print XXXXXX8963 where the record holds the whole
    // number; refusing that would mean answering the same question monthly.
    const result = matchAccount({ number: 'XXXXXX0000' }, [anAccount()]);
    assert.equal(result.account.id, 'acc_1');
  });

  test('an unrelated account is not matched at all', () => {
    const result = matchAccount({ number: '9999911111', bank: 'HDFC Bank' }, [anAccount()]);
    assert.equal(result.account, null);
    assert.not(result.sure);
  });

  test('two accounts at the same bank do not make a confident match', () => {
    const result = matchAccount({ number: '', bank: 'Kotak Mahindra Bank' }, [
      anAccount(),
      anAccount({ id: 'acc_2', accountNumber: '5555500000' }),
    ]);
    assert.not(result.sure, 'the bank name alone must never pick between two accounts');
  });

  test('a live account beats an archived one that scores the same', () => {
    const result = matchAccount({ number: '1234500000' }, [
      anAccount({ id: 'old', archived: true }),
      anAccount({ id: 'live' }),
    ]);
    assert.equal(result.account.id, 'live');
  });

  test('nothing to match against is not a match', () => {
    assert.equal(matchAccount({ number: '1234500000' }, []).account, null);
    assert.equal(scoreAccount({}, anAccount()), 0);
  });

  test('an account can be proposed from the statement head', () => {
    const proposed = accountFromStatement(
      { number: 'XXXXXX8963', bank: 'Kotak Mahindra Bank', ifsc: 'KKBK0000123', type: 'Savings' },
      'per_1',
    );
    assert.equal(proposed.institution, 'Kotak Mahindra Bank');
    assert.equal(proposed.holder, 'per_1');
    assert.equal(proposed.accountNumber, 'XXXXXX8963', 'the mask is kept, not filled in');
  });
});

/* ------------------------------------------------------------ record shape */

describe('records', () => {
  test('every category the categoriser can produce maps to one the schema allows', () => {
    const allowed = new Set(entities.transaction.fields
      .find((field) => field.key === 'category').options);
    const produced = ['restaurant', 'food-delivery', 'quick-commerce', 'e-commerce', 'hotel',
      'emi', 'loan-repayment', 'loan-disbursal', 'p2p-out', 'p2p-in', 'self-transfer',
      'sweep', 'investment-out', 'investment-in', 'payments', 'charges', 'cash',
      'subscription', 'bills', 'salary', 'refund', 'interest', 'other-spend', 'other-income'];

    for (const category of produced) assert.includes(allowed, categoryFor(category));
  });

  test('every rail maps to a method the schema allows', () => {
    const allowed = new Set(entities.transaction.fields
      .find((field) => field.key === 'method').options);
    for (const channel of ['upi', 'imps', 'neft', 'nach', 'card', 'atm', 'sweep', 'other']) {
      assert.includes(allowed, methodFor(channel));
    }
  });

  test('money between people or between your own accounts is a transfer', () => {
    // A friend paying you back is not income, and counting it as income
    // inflates a year's earnings by whatever the household lends out.
    assert.equal(kindFor('p2p-in', 'in'), 'transfer');
    assert.equal(kindFor('p2p-out', 'out'), 'transfer');
    assert.equal(kindFor('self-transfer', 'out'), 'transfer');
    assert.equal(kindFor('sweep', 'in'), 'transfer');
    assert.equal(kindFor('restaurant', 'out'), 'expense');
    assert.equal(kindFor('salary', 'in'), 'income');
  });

  test('a record carries everything needed to find it again', () => {
    const record = toRecord({
      date: '2025-04-01', amount: 50_000, direction: 'out', category: 'food-delivery',
      channel: 'upi', counterparty: 'ZOMATO LIMITED', reference: 'UPI-1', raw: 'UPI/ZOMATO/1',
      balance: 950_000,
    }, { accountId: 'acc_1', statementId: 'stm_1', personId: 'per_1' });

    assert.equal(record.kind, 'expense');
    assert.equal(record.category, 'food delivery');
    assert.equal(record.payee, 'ZOMATO LIMITED');
    assert.equal(record.method, 'UPI');
    assert.equal(record.statement, 'stm_1');
    assert.ok(record.importKey.includes('acc_1'));
  });
});

/* ------------------------------------------------------------------ plans */

describe('planning an import', () => {
  test('a statement is matched, categorised and counted without writing anything', () => {
    const plan = planStatement(statement(), { file: 'april.pdf', accounts: [anAccount()] });
    assert.equal(plan.match.account.id, 'acc_1');
    assert.length(plan.transactions, 3);
    assert.length(plan.fresh, 3);
    assert.length(plan.duplicates, 0);
    assert.ok(plan.check.balanced);
    assert.ok(plan.ready);
  });

  test('rows already imported are not offered again', () => {
    const first = planStatement(statement(), { accounts: [anAccount()] });
    const keys = new Set(first.fresh.map((row) => fingerprint('acc_1', row)));

    const second = planStatement(statement(), { accounts: [anAccount()], existingKeys: keys });
    assert.length(second.fresh, 0, 'the same month uploaded twice adds nothing');
    assert.length(second.duplicates, 3);
  });

  test('an unmatched statement is never ready', () => {
    const plan = planStatement(statement({ number: '9999900000' }), { accounts: [anAccount()] });
    assert.equal(plan.match.account, null);
    assert.not(plan.ready);
    assert.ok(plan.transactions.length, 'it is still parsed, so an account can be created for it');
  });

  test('a statement whose arithmetic does not close is not ready', () => {
    const rows = statement();
    // Break the closing balance the summary states.
    rows.at(-1).cells[0].text = 'Savings Account (SA): 10,000.00 99,999.00';
    const plan = planStatement(rows, { accounts: [anAccount()] });
    assert.not(plan.check.balanced);
    assert.not(plan.ready);
  });

  test('the statement record records both balances and the problems', () => {
    const plan = planStatement(statement(), { file: 'april.pdf', accounts: [anAccount()] });
    const record = toStatementRecord(plan, {
      accountId: 'acc_1', importedCount: 3, today: '2025-05-01',
    });
    assert.equal(record.account, 'acc_1');
    assert.equal(record.openingBalance, 1_000_000);
    assert.equal(record.closingBalance, 1_050_000);
    assert.equal(record.importedCount, 3);
    assert.ok(record.reconciled);
    assert.equal(record.problems, '');
  });
});

describe('a month of statements together', () => {
  test('files are grouped by the account they belong to', () => {
    const review = reviewBatch([
      planStatement(statement(), { file: 'a.pdf', accounts: [anAccount()] }),
      planStatement(statement({ number: '5555500000' }), {
        file: 'b.pdf',
        accounts: [anAccount(), anAccount({ id: 'acc_2', accountNumber: '5555500000' })],
      }),
    ]);
    assert.length(review.accounts, 2);
    assert.equal(review.unmatched, 0);
  });

  test('a missing month shows up as a break in the balances', () => {
    // The second statement opens ₹40,000 above where the first closed. That
    // money moved in a statement nobody uploaded, and no single file can show
    // it — only the two together can.
    const april = planStatement(statement(), { file: 'april.pdf', accounts: [anAccount()] });
    const june = planStatement(
      statement({ from: '01 Jun 2025', opening: '50,000.00' }),
      { file: 'june.pdf', accounts: [anAccount()] },
    );

    const review = reviewBatch([april, june]);
    assert.length(review.gaps, 1);
    assert.equal(review.gaps[0].difference, 3_950_000);
  });

  test('consecutive statements that follow on are not reported as a gap', () => {
    const april = planStatement(statement(), { file: 'april.pdf', accounts: [anAccount()] });
    const may = planStatement(
      statement({ from: '01 May 2025', opening: '10,500.00' }),
      { file: 'may.pdf', accounts: [anAccount()] },
    );
    assert.length(reviewBatch([april, may]).gaps, 0);
  });

  test('a file for an account nobody has is counted, not silently dropped', () => {
    const review = reviewBatch([
      planStatement(statement({ number: '9999900000' }), { file: 'x.pdf', accounts: [anAccount()] }),
    ]);
    assert.equal(review.unmatched, 1);
    assert.equal(review.unready, 1);
  });
});

/* -------------------------------------------------------- the round trip */

describe('writing them', () => {
  test('an imported statement becomes transactions that survive a read back', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Meera R K' });
    const account = await db.repo('account').create({
      name: 'Kotak savings', kind: 'savings', institution: 'Kotak Mahindra Bank',
      accountNumber: '1234500000', ifsc: 'KKBK0000123', holder: person.id,
    });

    const accounts = await db.repo('account').list();
    const plan = planStatement(statement(), { file: 'april.pdf', accounts });
    assert.equal(plan.match.account.id, account.id, 'the encrypted number still matched');

    const record = await db.repo('bankStatement').create(
      toStatementRecord(plan, { accountId: account.id, importedCount: plan.fresh.length, today: '2025-05-01' }),
    );
    for (const row of plan.fresh) {
      await db.repo('transaction').create(
        toRecord(row, { accountId: account.id, statementId: record.id, personId: person.id }),
      );
    }

    const saved = await db.repo('transaction').list();
    assert.length(saved, 3);
    assert.ok(saved.every((t) => t.account === account.id));
    assert.ok(saved.every((t) => t.statement === record.id));
    assert.ok(saved.every((t) => t.importKey));
  });

  test('re-importing the same file adds nothing', async () => {
    const db = await makeDb();
    const account = await db.repo('account').create({
      name: 'Kotak savings', kind: 'savings', accountNumber: '1234500000', ifsc: 'KKBK0000123',
    });
    const accounts = await db.repo('account').list();

    const first = planStatement(statement(), { accounts });
    for (const row of first.fresh) {
      await db.repo('transaction').create(toRecord(row, { accountId: account.id }));
    }

    const existing = await db.repo('transaction').list({ decrypt: false });
    const keys = new Set(existing.map((t) => t.importKey));

    const second = planStatement(statement(), { accounts, existingKeys: keys });
    assert.length(second.fresh, 0);
    assert.length(second.duplicates, 3);
  });

  test('the same transaction on two accounts is kept twice', async () => {
    // A transfer between two of the household's own accounts appears in both
    // statements, and both are real rows of their own account.
    const db = await makeDb();
    const one = await db.repo('account').create({ name: 'A', kind: 'savings', accountNumber: '1234500000', ifsc: 'KKBK0000123' });
    const two = await db.repo('account').create({ name: 'B', kind: 'savings', accountNumber: '5555500000', ifsc: 'KKBK0000123' });
    const accounts = await db.repo('account').list();

    const keys = new Set();
    for (const [account, rows] of [[one, statement()], [two, statement({ number: '5555500000' })]]) {
      const plan = planStatement(rows, { accounts, existingKeys: keys });
      assert.equal(plan.match.account.id, account.id);
      for (const row of plan.fresh) {
        const written = toRecord(row, { accountId: account.id });
        keys.add(written.importKey);
        await db.repo('transaction').create(written);
      }
    }

    assert.length(await db.repo('transaction').list(), 6);
  });
});

/* ------------------------------------------------------- hosted deployment */

describe('configuring a hosted copy', () => {
  test('a deployment entered in the app survives a restart', async () => {
    // `familyos.config.json` is not in version control, so a copy served from
    // a static host arrives with no way to be told which Google project to
    // use. Without this, a published install could never sync at all.
    const db = await makeDb();
    configure({ googleClientId: '', apiUrl: '' });
    assert.not(isConfigured(), 'a fresh hosted copy is unconnected');

    await saveStoredConfig(db, {
      googleClientId: 'abc.apps.googleusercontent.com',
      apiUrl: 'https://script.google.com/macros/s/AK/exec',
    });
    assert.ok(isConfigured());

    // What a reload looks like: the file gives nothing, the store gives both.
    configure({ googleClientId: '', apiUrl: '' });
    await loadStoredConfig(db);
    assert.equal(config().googleClientId, 'abc.apps.googleusercontent.com');
    assert.equal(config().apiUrl, 'https://script.google.com/macros/s/AK/exec');
  });

  test('nothing stored leaves the app exactly as the file left it', async () => {
    const db = await makeDb();
    configure({ googleClientId: 'from-file', apiUrl: 'https://example.test/exec' });
    await loadStoredConfig(db);
    assert.equal(config().googleClientId, 'from-file', 'an empty store must not blank the file');
  });

  test('only the two deployment values can be set this way', async () => {
    const db = await makeDb();
    const before = config().pbkdf2Iterations;
    await saveStoredConfig(db, {
      googleClientId: 'a', apiUrl: 'b', pbkdf2Iterations: 1, scopes: [],
    });
    assert.equal(config().pbkdf2Iterations, before,
      'a stored deployment must not be able to weaken the key derivation');
  });
});
