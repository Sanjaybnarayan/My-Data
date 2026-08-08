import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { Assistant, matchIntent } from '../js/ai/assistant.js';
import { parsePeriod, exampleQuestions } from '../js/ai/intents.js';
import { summarise } from '../js/ai/summary.js';
import { toMinor } from '../js/core/money.js';

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
    assert.includes(answer.text, 'valued at cost');
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
    compare: { current: { expense: 0, income: 0 }, previous: { expense: 0 }, expenseChange: null },
  };

  test('says nothing needs attention when nothing does', () => {
    assert.includes(summarise(base), 'Nothing needs attention');
  });

  test('leads with what has already lapsed', () => {
    const text = summarise({
      ...base,
      reminders: [{ group: 'expiry', title: 'KA01AB1234', label: 'PUC expiry', days: -12 }],
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
      compare: { current: { expense: rs(50000) }, previous: { expense: rs(20000) }, expenseChange: 150 },
    });
    assert.ok(text.split('. ').length <= 3, 'a dashboard paragraph nobody reads is not a summary');
  });
});
