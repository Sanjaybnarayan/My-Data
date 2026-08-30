import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { Assistant, matchIntent } from '../js/ai/assistant.js';
import { parsePeriod, exampleQuestions } from '../js/ai/intents.js';
import { datedEntities } from '../js/domain/reminders.js';
import { summarise } from '../js/ai/summary.js';
import { comparePeriods } from '../js/domain/finance.js';
import { toMinor } from '../js/core/money.js';
import { PermissionError } from '../js/core/errors.js';

setSuite('assistant');

const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
const rs = (n) => toMinor(String(n));

/** A household with enough in it that every intent has something to say. */
async function household() {
  const db = await makeDb();
  const person = await makePerson(db, { name: 'Asha Narayan', birthday: '1985-06-20' });
  const account = await makeAccount(db, { name: 'HDFC Savings', openingBalance: '250000' });

  const txns = db.repo('transaction');
  await txns.create({ date: '2025-06-02', kind: 'expense', amount: '18000', account: account.id, category: 'groceries' });
  await txns.create({ date: '2025-06-08', kind: 'expense', amount: '6000', account: account.id, category: 'fuel' });
  await txns.create({ date: '2025-06-01', kind: 'income', amount: '150000', account: account.id, category: 'salary' });
  await txns.create({ date: '2025-05-10', kind: 'expense', amount: '9000', account: account.id, category: 'dining' });

  await db.repo('holding').create({
    name: 'Nifty Index Fund', kind: 'mutual fund', owner: person.id,
    invested: '200000', currentValue: '260000', active: true,
  });
  await db.repo('policy').create({
    name: 'Family Floater', kind: 'health', insurer: 'Star Health',
    policyNumber: 'SH123456', premium: '24000', renewsOn: '2025-07-10',
  });
  await db.repo('recurringPayment').create({
    name: 'Broadband', kind: 'bill', amount: '1499', frequency: 'monthly',
    nextDueOn: '2025-06-20', active: true,
  });
  await db.repo('document').create({
    title: 'Passport — Asha', category: 'identity', person: person.id,
    expiresOn: '2029-01-01',
  });
  await db.repo('task').create({ title: 'Renew PUC', status: 'todo', dueOn: '2025-06-01' });

  return { db, person, account };
}

describe('period parsing', () => {
  test('reads the span out of the question', () => {
    assert.equal(parsePeriod('expenses for last month', clock).name, 'last-month');
    assert.equal(parsePeriod('spending this year', clock).name, 'year');
    assert.equal(parsePeriod('total spend ever', clock).name, 'all');
  });

  test('defaults to this month and says that it assumed', () => {
    const period = parsePeriod('how much did we spend', clock);
    assert.equal(period.name, 'month');
    assert.ok(period.assumed, 'an assumption the user did not make must be declared');
  });

  test('a longer phrase beats a shorter one inside it', () => {
    assert.equal(parsePeriod('last month', clock).name, 'last-month');
  });
});

describe('intent matching', () => {
  test('the six questions in the brief all match something', () => {
    const brief = [
      'Show expenses for last month.',
      'Find passport.',
      'Which insurance expires next?',
      'What is our family net worth?',
      'Show investment returns.',
      'List pending bills.',
    ];
    for (const question of brief) {
      assert.ok(matchIntent(question), `no intent matched: ${question}`);
    }
  });

  test('a more specific phrase wins over a word it contains', () => {
    assert.equal(matchIntent('what is our family net worth?').intent.id, 'net-worth');
  });

  test('nonsense matches nothing', () => {
    assert.equal(matchIntent('qwertyuiop asdf'), null);
    assert.equal(matchIntent('   '), null);
  });

  test('every intent has at least one example and one pattern', () => {
    for (const example of exampleQuestions()) {
      assert.ok(matchIntent(example), `an intent's own example does not match it: ${example}`);
    }
  });
});

describe('answers', () => {
  test('net worth is stated with both sides of it', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('What is our family net worth?');
    assert.equal(answer.intent, 'net-worth');
    assert.includes(answer.text, 'net worth');
    assert.ok(answer.breakdown.length);
  });

  test('a portfolio valued at cost is flagged in the answer, not hidden', async () => {
    const db = await makeDb();
    await db.repo('holding').create({
      name: 'Gold', kind: 'gold', invested: '100000', active: true,
    });
    const answer = await new Assistant({ db, clock }).answer('net worth');

    // The caveat, not its wording. This pinned the phrase "valued at cost",
    // which stopped being the whole story when `networth.js` started reporting
    // valuations that are *old* as well as missing — the sentence has to cover
    // both, and a test that names one of them fails for the wrong reason.
    assert.includes(answer.text, '1 item is');
    assert.includes(answer.text, 'the real figure may differ');
  });

  test('expenses for last month use last month, not this one', async () => {
    const { db } = await household();
    const assistant = new Assistant({ db, clock });

    const lastMonth = await assistant.answer('Show expenses for last month.');
    assert.includes(lastMonth.text, '9,000');

    const thisMonth = await assistant.answer('Show expenses this month.');
    assert.includes(thisMonth.text, '24,000');
  });

  test('an empty period says so rather than reporting zero', async () => {
    const db = await makeDb();
    const answer = await new Assistant({ db, clock }).answer('expenses last month');
    assert.includes(answer.text, 'No transactions');
  });

  test('finding a document reports where it is', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('Find passport.');
    assert.equal(answer.intent, 'find-document');
    assert.includes(answer.text, 'Passport');
  });

  test('a search with no hits does not invent one', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('Find zzzqqq.');
    assert.includes(answer.text, 'Nothing matching');
  });

  test('an expiring warranty is reported, and used not to be', async () => {
    /*
     * The `expiring` handler named nine entities by hand. The schema declares
     * nineteen with an expiry field and `expiryReminders` reads every one, so
     * the ten it did not name were invisible — and the answer was not "some of
     * these are missing" but a flat "nothing is due to expire in the next
     * year". A warranty, a tenancy, a vaccination, a medication course and a
     * service falling due were all in that silence.
     */
    const db = await makeDb();
    await db.repo('warranty').create({
      cover: 'Refrigerator', expiresOn: '2025-08-01',
    });

    const answer = await new Assistant({ db, clock }).answer('What is expiring soon?');
    assert.includes(answer.text, 'Refrigerator');
    assert.not(/nothing is due to expire/i.test(answer.text), answer.text);
  });

  test('and the handler reads every entity the schema says can expire', async () => {
    // Derived rather than counted, so a twentieth dated entity is covered the
    // day it is added — which is the whole point of not typing the list.
    const asked = [];
    const db = await makeDb();
    const spy = {
      ...db,
      repo: (name) => { asked.push(name); return db.repo(name); },
    };
    await new Assistant({ db: spy, clock }).answer('What is expiring soon?');

    for (const name of datedEntities()) {
      assert.includes(asked, name, `${name} can expire and the assistant never read it`);
    }
  });

  test('asking which insurance expires next answers about insurance only', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('Which insurance expires next?');
    assert.includes(answer.text, 'Family Floater');
    assert.not(answer.text.includes('Passport'), 'a passport is not an insurance policy');
  });

  test('pending bills are totalled and dated', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('List pending bills.');
    assert.equal(answer.intent, 'bills');
    assert.includes(answer.text, 'Broadband');
  });

  test('investment returns report gain and XIRR when it can be computed', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('Show investment returns.');
    assert.equal(answer.intent, 'investment-returns');
    assert.includes(answer.text, '30%');
  });

  test('a question it cannot parse says so and suggests real ones', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('what is the meaning of life');
    assert.ok(answer.unmatched);
    assert.ok(answer.suggestions.length);
    for (const suggestion of answer.suggestions) {
      assert.ok(matchIntent(suggestion), 'a suggested question must actually work');
    }
  });

  test('a role that cannot read an entity gets an answer without it, not an error', async () => {
    const { db } = await household();
    db.setActor({ personId: 'p3', role: 'child' });
    const answer = await new Assistant({ db, clock }).answer('What is our family net worth?');
    assert.ok(answer.text, 'the assistant must not throw for a restricted role');
    assert.not(answer.error);
  });

  test('answers carry the records behind them so a figure can be checked', async () => {
    const { db } = await household();
    const answer = await new Assistant({ db, clock }).answer('expenses this month');
    assert.ok(answer.records?.rows?.length, 'a number with nothing behind it cannot be verified');
  });
});

describe('written summary', () => {
  const base = {
    reminders: [], bills: [], budget: [], transaction: [],
    compare: {
      current: { expense: 0, income: 0 },
      previous: { expense: 0 },
      previousToDate: { expense: 0 },
      partial: false,
      expenseChange: null,
    },
  };

  test('says nothing needs attention when nothing does', () => {
    assert.includes(summarise(base), 'Nothing needs attention');
  });

  test('leads with what has already lapsed', () => {
    const text = summarise({
      ...base,
      reminders: [{ group: 'expiry', title: 'KA01AB1234', field: 'pucExpiresOn', label: 'PUC expiry', days: -12 }],
    });
    assert.ok(text.startsWith('KA01AB1234'), 'the lapsed item should come first');
    assert.includes(text, '12 days ago');
  });

  test('stops at three sentences', () => {
    const text = summarise({
      ...base,
      reminders: [
        { group: 'expiry', title: 'A', label: 'x', days: -1 },
        { group: 'expiry', title: 'B', label: 'y', days: 3 },
        { group: 'date', title: 'C birthday', days: 2, date: '2025-06-17' },
      ],
      bills: [{ amount: rs(5000), dueOn: '2025-06-16', overdue: true }],
      compare: {
        current: { expense: rs(50000) },
        previous: { expense: rs(20000) },
        previousToDate: { expense: rs(20000) },
        partial: false,
        expenseChange: 150,
      },
    });
    assert.ok(text.split('. ').length <= 3, 'a dashboard paragraph nobody reads is not a summary');
  });
});

/*
 * A refusal and a failure are not the same empty list.
 *
 * `load` used to swallow both. A role that may not read transactions
 * legitimately contributes nothing and the answer is computed without it —
 * that is the design. A decryption failure, a corrupt row or IndexedDB
 * refusing is not an absence of records; it is an inability to read the ones
 * that exist. Computing over `[]` then turns a read error into a statement
 * about the household's money:
 *
 *   "No transactions are recorded between 1 Jan 2026 and 31 Dec 2026."
 *
 * — which is false, confident, and indistinguishable from the truth.
 */
describe('when the records cannot be read', () => {
  const db = (list) => ({
    repo: () => ({ list }),
    search: async () => [],
    actor: { role: 'owner' },
  });

  const ask = (fake) => new Assistant({ db: fake, clock })
    .answer('How much did we spend this year?');

  test('a read failure is refused, not answered', async () => {
    const answer = await ask(db(async () => {
      throw new Error('decryption failed for transaction txn_9');
    }));
    assert.not(/No transactions are recorded/.test(answer.text),
      'a read error was reported as an absence of records');
    assert.ok(/could not read/i.test(answer.text), answer.text);
  });

  test('and says which records it could not read', async () => {
    const answer = await ask(db(async () => { throw new Error('boom'); }));
    assert.deep(answer.unreadable, ['transaction']);
  });

  test('and says so is not the same as having none', async () => {
    // The distinction is the whole point: a household reading "none" acts on
    // it. One reading "I could not read them" does not.
    const answer = await ask(db(async () => { throw new Error('boom'); }));
    assert.ok(/not the same as having none/i.test(answer.text), answer.text);
  });

  /*
   * The other direction, twice. Without these the guard is satisfied by
   * refusing every question — which would break the design this file exists
   * to protect, where a restricted role still gets an answer from what it
   * may see.
   */
  test('a permission refusal still answers, because that empty is real', async () => {
    const answer = await ask(db(async () => {
      throw new PermissionError('read', 'transaction', 'child');
    }));
    assert.ok(/No transactions are recorded/.test(answer.text), answer.text);
    assert.equal(answer.unreadable, undefined);
  });

  test('and a household with genuinely no records is told so', async () => {
    const answer = await ask(db(async () => []));
    assert.ok(/No transactions are recorded/.test(answer.text), answer.text);
  });
});

describe('what the assistant may never be handed', () => {
  /*
   * Rule 52 of the build brief: an OTP or security message must not be
   * retained unnecessarily **or sent to AI**. `docs/PHASE_STATUS.md` claims
   * both halves of it hold — "the security gate runs before any field is
   * parsed and no AI intent loads `smsMessage`".
   *
   * The first half is tested in `tests/sms.test.mjs`: an OTP naming an amount
   * yields no amount. The second half was true and checked by nothing.
   *
   * Three ways an entity reaches the assistant, and only one of them is
   * something a person would think to look at:
   *
   *   1. named literally in `js/ai/*` — visible in a diff;
   *   2. `BY_NAME` in `domain/reminders.js` — a list, so also visible;
   *   3. `datedEntities()` — **derived**, and this is the one. It returns
   *      every entity carrying a field marked `expiry`. Adding a date to
   *      `smsMessage` that somebody wanted a reminder for would put SMS text
   *      in front of the assistant, in a schema edit that mentions neither
   *      the assistant nor rule 52, and nothing would have said so.
   *
   * `vaultItem` is held to the same rule. The brief names the SMS case
   * because that is where the temptation is, but a password vault reaching a
   * model is the same mistake with a worse ending, and the assistant is
   * offline precisely so that neither can happen.
   */
  const FORBIDDEN = ['smsMessage', 'vaultItem'];

  test('is not named anywhere in the AI layer', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../js/ai/', import.meta.url).pathname;
    const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));

    // The sweep is worth what it read.
    assert.ok(files.length >= 3, `only ${files.length} AI modules were read`);

    const named = [];
    for (const file of files) {
      const text = await readFile(`${dir}${file}`, 'utf8');
      for (const entity of FORBIDDEN) {
        if (new RegExp(`\\b${entity}\\b`).test(text)) named.push(`${file} names ${entity}`);
      }
    }
    assert.deep(named, []);
  });

  test('and cannot arrive through the derived dated list either', () => {
    /*
     * The path a schema edit opens without meaning to. This fails the moment
     * somebody marks a field on one of these `expiry: true` — which is the
     * point: the decision then has to be made deliberately, here, rather than
     * by a field that looked like a reminder.
     */
    const dated = datedEntities();
    assert.ok(dated.length > 10, `only ${dated.length} dated entities, so this proves nothing`);

    for (const entity of FORBIDDEN) {
      assert.not(dated.includes(entity),
        `${entity} carries an expiry field, so the assistant now loads it`);
    }
  });

  test('nor through the list named beside it', async () => {
    const { BY_NAME } = await import('../js/domain/reminders.js');
    assert.ok(BY_NAME.length > 0, 'BY_NAME is empty, so this proves nothing');
    for (const entity of FORBIDDEN) assert.not(BY_NAME.includes(entity));
  });
});

describe('the assistant says which span it compared', () => {
  /*
   * The written summary asserted "Spending is 94% below last month" on the 2nd
   * of the month for a household that had spent its usual amount on both days.
   * The branch below it in the same function already knew to hedge — "spent so
   * far this month" — so the partiality was understood when this was written
   * and the comparison sentence was simply not held to it.
   *
   * `comparePeriods` now measures against the same days of the previous month.
   * The wording has to follow it: a sentence naming a comparison a reader
   * cannot see is the assistant claiming more than it checked.
   *
   * Built from the real `comparePeriods` rather than a literal, so this cannot
   * pass against a shape the application no longer produces.
   */
  const spend = (from, to, each) => {
    const rows = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)) {
      rows.push({
        id: `s${rows.length}`, kind: 'expense', amount: each, account: 'a',
        category: 'food', date: d.toISOString().slice(0, 10), deletedAt: null,
      });
    }
    return rows;
  };
  const summaryFor = (rows, day) => summarise({
    reminders: [], bills: [], budget: [], transaction: rows,
    compare: comparePeriods(rows, fakeClock(Date.parse(`${day}T10:00:00Z`))),
  });

  test('a real rise mid-month is named against the days it was measured on', () => {
    // Half of July at ₹100 a day, then two days of August at ₹1,000 — a real
    // rise, and one the household should hear about.
    const rows = [...spend('2025-07-01', '2025-07-31', rs(100)),
      ...spend('2025-08-01', '2025-08-02', rs(1000))];
    const text = summaryFor(rows, '2025-08-02');
    assert.includes(text, 'above the same days of last month');
    assert.not(text.includes('above last month,'),
      'an unqualified "last month" is the claim that was wrong');
  });

  test('and drops the qualifier once the month is complete', () => {
    const rows = [...spend('2025-06-01', '2025-06-30', rs(100)),
      ...spend('2025-07-01', '2025-07-31', rs(1000))];
    const text = summaryFor(rows, '2025-07-31');
    assert.includes(text, 'above last month,');
    assert.not(text.includes('same days'), 'July is over; the whole month is the comparison');
  });

  test('an unchanged household is told nothing about a fall', () => {
    const rows = spend('2025-07-01', '2025-08-02', rs(258));
    const text = summaryFor(rows, '2025-08-02');
    assert.not(text.includes('below'), 'nothing fell — the month started');
  });
});
