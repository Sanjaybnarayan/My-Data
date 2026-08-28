import { test, describe, assert, setSuite } from './harness.mjs';
import { allReminders, moneyReminders, mergeReminders } from '../js/domain/reminders.js';
import { attentionFrom, AttentionService } from '../js/services/attention.js';
import { entities } from '../js/data/schema.js';
import { makeDb } from './fixture.mjs';

setSuite('merge');

const clock = () => Date.parse('2026-06-15T12:00:00Z');

describe('one record, one date, said once', () => {
  const netflix = { id: 's1', name: 'Netflix', renewsOn: '2026-06-18', amount: 64_900 };

  test('a subscription really is in both lists', () => {
    /*
     * The premise, checked rather than assumed. If `upcomingBills` stopped
     * reading subscriptions, or `renewsOn` stopped being an expiry field, the
     * merge below would be doing nothing and every check here would still
     * pass on the empty case.
     */
    assert.ok(entities.subscription.fields.some((f) => f.key === 'renewsOn' && f.expiry));
    assert.length(allReminders({ subscription: [netflix] }, { clock }), 1);
    assert.length(moneyReminders({ subscription: [netflix] }, { clock, days: 45 }), 1);
  });

  test('and after merging there is one of it', () => {
    const merged = mergeReminders(
      allReminders({ subscription: [netflix] }, { clock }),
      moneyReminders({ subscription: [netflix] }, { clock, days: 45 }),
    );
    assert.length(merged, 1);
  });

  test('and the one kept is the one carrying the amount', () => {
    // The amount is the reason a renewal is worth interrupting somebody for.
    const merged = mergeReminders(
      allReminders({ subscription: [netflix] }, { clock }),
      moneyReminders({ subscription: [netflix] }, { clock, days: 45 }),
    );
    assert.equal(merged[0].group, 'money');
    assert.equal(merged[0].amount, 64_900);
  });

  test('the Notifications tab counts it once', () => {
    // The live path, and the badge with it.
    const out = attentionFrom({ subscription: [netflix] }, { clock });
    assert.length(out.items, 1);
    assert.equal(out.pressing, 1);
  });

  test('a digital asset is the same case', () => {
    const domain = { id: 'd1', name: 'example.in', renewsOn: '2026-06-20', amount: 120_000 };
    assert.length(attentionFrom({ digitalAsset: [domain] }, { clock }).items, 1);
  });
});

describe('what the merge must not swallow', () => {
  test('two dates on one record stay two reminders', () => {
    // A policy can carry a renewal *and* a separate expiry, and those are two
    // things to know. Matching on the record alone would have lost one.
    const kept = mergeReminders(
      [
        { entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'expiry', field: 'renewsOn' },
        { entity: 'policy', recordId: 'p1', date: '2026-09-01', group: 'expiry', field: 'expiresOn' },
      ],
      [{ entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
    assert.deep(kept.map((one) => one.group).sort(), ['expiry', 'money']);
    assert.equal(kept.find((one) => one.group === 'expiry').date, '2026-09-01');
  });

  test('a different record with the same date stays', () => {
    const kept = mergeReminders(
      [{ entity: 'policy', recordId: 'p2', date: '2026-06-18', group: 'expiry' }],
      [{ entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('a different entity with the same id stays', () => {
    const kept = mergeReminders(
      [{ entity: 'vehicle', recordId: 'x', date: '2026-06-18', group: 'expiry' }],
      [{ entity: 'policy', recordId: 'x', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('a money row with no record behind it hides nothing', () => {
    // A card bill assembled from statements has no single record. Treating a
    // missing id as a match would have silently swallowed every expiry.
    const kept = mergeReminders(
      [{ entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'expiry' }],
      [{ entity: 'policy', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('two rows that both lack a record id do not match each other', () => {
    /*
     * What the `recordId && date` guard is actually for, and the case the
     * first version of these checks missed entirely — removing the guard
     * passed every one of them.
     *
     * Without it both rows key as `policy:undefined:2026-06-18`, which is one
     * key, so an unrelated expiry disappears because a card bill assembled
     * from statements happened to fall on the same day.
     */
    const kept = mergeReminders(
      [{ entity: 'policy', date: '2026-06-18', group: 'expiry', field: 'expiresOn' }],
      [{ entity: 'policy', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('and neither do two that both lack a date', () => {
    const kept = mergeReminders(
      [{ entity: 'policy', recordId: 'p1', group: 'expiry' }],
      [{ entity: 'policy', recordId: 'p1', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('an expiry row with no date of its own survives', () => {
    const kept = mergeReminders(
      [{ entity: 'policy', recordId: 'p1', group: 'expiry' }],
      [{ entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'money' }],
    );
    assert.length(kept, 2);
  });

  test('and nothing at all is nothing, not a throw', () => {
    assert.length(mergeReminders(), 0);
    assert.length(mergeReminders([], []), 0);
  });

  test('money rows are never dropped, whatever they collide with', () => {
    const money = [
      { entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'money' },
      { entity: 'policy', recordId: 'p1', date: '2026-06-18', group: 'money' },
    ];
    assert.length(mergeReminders([], money), 2);
  });
});

describe('the service the Notifications tab actually calls', () => {
  test('everything() runs, and reads what it says it reads', async () => {
    /*
     * There was no test for this method at all, and it showed.
     *
     * Moving `datedEntities` and `BY_NAME` down to the domain and
     * re-exporting them from here left `everything()` calling two names that
     * were no longer bound in its own module — `export … from` forwards a name
     * without binding it. The whole suite stayed green, because nothing ever
     * called the method the Notifications tab is built on.
     */
    const db = await makeDb();
    const out = await new AttentionService(db).everything();
    assert.ok(out && Array.isArray(out.items), JSON.stringify(out));
    assert.ok(typeof out.pressing === 'number');
  });

  test('and it finds a real one', async () => {
    // Not just "did not throw". An empty database returns an empty list, and
    // a method that always returned one would satisfy the check above.
    const db = await makeDb();
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    await db.repo('digitalAsset').create({
      name: 'example.in', kind: 'domain', renewsOn: soon.toISOString().slice(0, 10),
    });

    const out = await new AttentionService(db).everything();
    assert.equal(out.items.length, 1, JSON.stringify(out.items));
    assert.includes(out.items[0].line, 'example.in');
  });
});
