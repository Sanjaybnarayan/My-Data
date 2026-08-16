/**
 * The activity feed, as things that happened rather than log lines.
 *
 * Measured first: six edits to one account and one to another produced eight
 * lines, seven of them the same person and the same record, and not one of
 * them said which account.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { stories, since, describeStory, SITTING_MINUTES } from '../js/domain/timeline.js';
import { TimelineService, SEEN_KEY } from '../js/services/timeline.js';

setSuite('timeline');

const entry = (over = {}) => ({
  action: 'update', actorId: 'p1', entity: 'account', recordId: 'a1',
  at: '2026-08-16T11:00:00Z', fields: ['name'], detail: {}, ...over,
});

describe('one sitting is one thing that happened', () => {
  test('six edits to one account in nine minutes are one story', () => {
    const rows = ['11:09', '11:07', '11:05', '11:04', '11:03', '11:02'].map((time, i) =>
      entry({ at: `2026-08-16T${time}:00Z`, fields: [`f${i}`] }));

    const [story] = stories(rows);
    assert.length(stories(rows), 1);
    assert.equal(story.count, 6);
    assert.length(story.fields, 6);
    assert.equal(story.at, '2026-08-16T11:09:00Z', 'the story is dated by its newest edit');
    assert.equal(story.from, '2026-08-16T11:02:00Z');
  });

  test('the same record a day later is a second story', () => {
    const rows = [entry({ at: '2026-08-16T11:00:00Z' }), entry({ at: '2026-08-15T11:00:00Z' })];
    assert.length(stories(rows), 2);
  });

  test('two people editing the same record are two stories', () => {
    // "Sanjay and Meera changed it" is a sentence this cannot support, and
    // merging them would attribute one person's edit to the other.
    const rows = [entry({ actorId: 'p1' }), entry({ actorId: 'p2', at: '2026-08-16T10:59:00Z' })];
    assert.length(stories(rows), 2);
  });

  test('one person editing two records is two stories', () => {
    const rows = [entry({ recordId: 'a1' }),
      entry({ recordId: 'a2', at: '2026-08-16T10:59:00Z' })];
    assert.length(stories(rows), 2);
  });

  test('adding is never folded into changing', () => {
    // "Added, then changed six things" and "changed six things" are different
    // events, and the first says where a record came from.
    const rows = [entry({ at: '2026-08-16T11:05:00Z' }),
      entry({ action: 'create', at: '2026-08-16T11:00:00Z' })];
    const out = stories(rows);
    assert.length(out, 2);
    assert.equal(out[1].action, 'create');
  });

  test('the window is a window, not a day', () => {
    const rows = [entry({ at: '2026-08-16T12:00:00Z' }),
      entry({ at: `2026-08-16T${11 - 0}:00:00Z` })];
    assert.length(stories(rows), 2, `${SITTING_MINUTES} minutes apart at most`);
  });

  test('an empty log is no stories rather than a crash', () => {
    assert.length(stories([]), 0);
    assert.length(stories(undefined), 0);
  });
});

describe('what a story says', () => {
  const titleOf = (name, id) => (id === 'a1' ? 'HDFC Savings' : null);
  const labelOf = () => 'account';
  const nameOf = (id) => ({ p1: 'Sanjay' })[id] ?? id;

  test('it names the record, which the log never could', () => {
    const [story] = stories([entry({ fields: ['name', 'ifsc'] })]);
    assert.equal(describeStory(story, { nameOf, titleOf, labelOf }),
      'Sanjay changed name and ifsc on HDFC Savings');
  });

  test('a record since deleted falls back to what it was', () => {
    const [story] = stories([entry({ recordId: 'gone' })]);
    // "an account" is still true, and a blank is not.
    assert.equal(describeStory(story, { nameOf, titleOf, labelOf }),
      'Sanjay changed name on an account');
  });

  test('three fields are named and the rest are counted', () => {
    // A list of eleven field names is a list nobody reads.
    const [story] = stories([entry({ fields: ['a', 'b', 'c', 'd', 'e'] })]);
    assert.includes(describeStory(story, { nameOf, titleOf, labelOf }), 'and 2 more');
  });

  test('it never says what a value became', () => {
    // The log records which fields changed and never their values — a
    // before-and-after log is a second, unencrypted copy of every sensitive
    // field in the system.
    const [story] = stories([entry({ fields: ['accountNumber'], detail: { to: '50100128177' } })]);
    assert.not(describeStory(story, { nameOf, titleOf, labelOf }).includes('50100128177'));
  });
});

describe('since I last looked', () => {
  test('a mark filters the log', () => {
    const rows = [entry({ at: '2026-08-16T12:00:00Z' }), entry({ at: '2026-08-14T12:00:00Z' })];
    assert.length(since(rows, '2026-08-15T00:00:00Z'), 1);
  });

  test('no mark is everything, not nothing', () => {
    // A household opening this for the first time should see their history,
    // not an empty screen claiming nothing has happened.
    const rows = [entry(), entry({ at: '2026-08-14T12:00:00Z' })];
    assert.length(since(rows, null), 2);
  });

  test('the service says whether these are unseen or merely recent', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Sanjay Narayan' });
    db.setActor({ personId: person.id, role: 'owner' });
    await makeAccount(db, { name: 'HDFC Savings' });

    const first = await new TimelineService(db).recent();
    assert.not(first.unseen, 'a first run claimed to know what had been seen');
    assert.ok(first.stories.length);

    await new TimelineService(db).markSeen();
    assert.ok(await db.meta(SEEN_KEY));
  });

  test('the mark is read, and never written by the reading', async () => {
    // Writing it while answering would clear the answer in the act of asking
    // for it: a household would open the screen and be told nothing had
    // happened, every time.
    const db = await makeDb();
    await makeAccount(db, { name: 'HDFC Savings' });

    await new TimelineService(db).recent();
    assert.equal(await db.meta(SEEN_KEY), null, 'reading marked it seen');
  });

  test('the story names the record, through the real database', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Sanjay Narayan' });
    db.setActor({ personId: person.id, role: 'owner' });
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    await db.repo('account').update(account.id, { ifsc: 'HDFC0000123' });

    const { stories: rows, describe } = await new TimelineService(db).recent();
    const said = rows.map((story) => describe(story)).join(' | ');

    assert.includes(said, 'HDFC Savings');
    assert.includes(said, 'Sanjay Narayan');
  });
});

/**
 * Two entries in the same millisecond.
 *
 * Not a rare case: a record created and corrected in one breath, or a CSV
 * import writing a hundred rows, all land on one timestamp. Sorting on `at`
 * alone left those in whatever order the index returned, which surfaced as a
 * test in `tests/services.test.mjs` failing about half the time. The flake was
 * the symptom; the defect is a record's history saying it was changed before
 * it was added.
 *
 * These assert the tie-break itself. The test that found it now passes either
 * way once its entries stop tying, and a check that only fails on unlucky days
 * is not a check.
 */
describe('two entries in the same millisecond', () => {
  const tied = (id, over = {}) => entry({ id, at: '2026-08-16T11:00:00Z', ...over });

  test('the newer id is the newer entry, whichever order they arrive in', () => {
    // ULIDs: within one millisecond the later write has the greater id.
    const rows = [tied('aud_02'), tied('aud_03'), tied('aud_01')];
    assert.equal(since(rows).map((row) => row.id).join(','), 'aud_03,aud_02,aud_01');
  });

  test('a create is not sorted above the updates that followed it', () => {
    const rows = [
      tied('aud_01', { action: 'create', fields: [] }),
      tied('aud_02'),
      tied('aud_03'),
    ];
    const [newest] = stories(rows);
    assert.equal(newest.action, 'update', 'the record was changed before it was added');
  });

  test('a sitting is not split by a create landing in the middle of it', () => {
    // With an unstable order the create can arrive between two updates, which
    // ends one story and starts another — two lines for one afternoon.
    const rows = [
      tied('aud_02'),
      tied('aud_01', { action: 'create', fields: [] }),
      tied('aud_03'),
    ];
    assert.length(stories(rows), 2, 'one create and one sitting, not three lines');
  });
});
