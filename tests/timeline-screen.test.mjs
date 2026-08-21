import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { TimelineService } from '../js/services/timeline.js';

setSuite('timeline · the whole history');

/** A household that has been using this for a while. */
async function used(db) {
  for (let i = 0; i < 12; i++) await makePerson(db, { name: `Person ${i}` });
  for (let i = 0; i < 12; i++) await makeAccount(db, { name: `Account ${i}` });
  for (const a of (await db.repo('account').list({})).slice(0, 10)) {
    await db.repo('account').update(a.id, { name: `${a.name} renamed` });
  }
}

describe('what the dashboard could not reach', () => {
  test('history returns every story, not the eight the card shows', async () => {
    // The service was already building all of them and the card sliced eight
    // off the front. The history existed and was unreachable, which is the
    // same shape as a field collected and read by nothing.
    const db = await makeDb();
    await used(db);

    const history = await (new TimelineService(db)).history();
    assert.ok(history.stories.length > 8,
      `only ${history.stories.length} stories — the fixture is not exercising this`);
  });

  test('and keeps returning them after everything has been seen', async () => {
    // `recent()` answers "since you last looked", and collapses to the latest
    // when that is nothing. A history that emptied itself the moment somebody
    // acknowledged it would be answering the wrong question.
    const db = await makeDb();
    await used(db);
    const timeline = new TimelineService(db);

    const before = await timeline.history();
    await timeline.markSeen();
    const after = await timeline.history();

    assert.equal(after.stories.length, before.stories.length);
  });

  test('offers only the kinds of record that actually appear', async () => {
    // Forty-three filters, forty-one of which return nothing, is worse than no
    // filter at all.
    const db = await makeDb();
    await used(db);

    const { present } = await (new TimelineService(db)).history();
    assert.includes(present, 'person');
    assert.includes(present, 'account');
    assert.not(present.includes('vehicle'), 'offered a filter for records that do not appear');
  });

  test('filters to one kind of record', async () => {
    const db = await makeDb();
    await used(db);

    const accounts = await (new TimelineService(db)).history({ entityName: 'account' });
    assert.ok(accounts.stories.length > 0);
    const wrong = accounts.stories.filter((s) => s.entity && s.entity !== 'account');
    assert.length(wrong, 0, wrong.map((s) => s.entity).join(', '));
  });

  test('says when it is showing the newest rather than all of it', async () => {
    // A screen that silently shows the first page of a long history is a screen
    // telling somebody their records have less past than they do.
    const db = await makeDb();
    await used(db);

    const capped = await (new TimelineService(db)).history({ limit: 5 });
    assert.ok(capped.truncated, 'a capped read did not say it was capped');

    const whole = await (new TimelineService(db)).history({ limit: 5000 });
    assert.not(whole.truncated, 'an uncapped read claimed to be capped');
  });

  test('describes a story in words rather than as a row', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    const history = await (new TimelineService(db)).history();
    const said = history.describe(history.stories[0]);

    assert.ok(typeof said === 'string' && said.length > 0, JSON.stringify(said));
    assert.not(/^\s*create\s*$/.test(said), `said "${said}" rather than a sentence`);
  });
});
