/**
 * Consent — what a household actually agreed to.
 *
 * The guard checked hardest here is that **an absent record is not a yes.** An
 * application that already works has a strong pull toward reading existing
 * configuration as agreement, because that is the reading under which nothing
 * has to change. It is also the reading that manufactures a consent record for
 * a conversation that never happened.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import {
  PURPOSES, PROCESSORS, DECISIONS,
  record, grant, withdraw, history, stateOf, hasConsent, refused,
  processorsFor, report, assertSound, egressing,
} from '../js/data/consent.js';
import { SyncEngine } from '../js/sync/engine.js';
import { FakeTransport } from '../js/sync/transport.js';
import { DocumentStore } from '../js/sync/drive.js';

setSuite('consent');

describe('an absent record', () => {
  test('is unrecorded, which is not consent', async () => {
    const db = await makeDb();
    assert.equal((await stateOf(db, 'backup')).decision, DECISIONS.UNRECORDED);
    assert.not(await hasConsent(db, 'backup'),
      'nobody was asked, so the answer to "did they agree" is no');
  });

  test('cannot be written as if it were a decision', async () => {
    // A record saying "unrecorded" is a record, which is the opposite of what
    // the word means.
    const db = await makeDb();
    let threw = false;
    try {
      await record(db, { purpose: 'backup', decision: DECISIONS.UNRECORDED });
    } catch { threw = true; }
    assert.ok(threw);
  });

  test('a denial is not the same absence', async () => {
    const db = await makeDb();
    await record(db, { purpose: 'backup', decision: DECISIONS.DENIED });
    assert.equal((await stateOf(db, 'backup')).decision, DECISIONS.DENIED);
    assert.not(await hasConsent(db, 'backup'));
  });
});

describe('the latest decision wins', () => {
  test('a withdrawal after a grant', async () => {
    const db = await makeDb();
    await grant(db, 'escrow', { at: '2026-08-01T00:00:00.000Z' });
    await withdraw(db, 'escrow', { at: '2026-08-09T00:00:00.000Z' });
    assert.not(await hasConsent(db, 'escrow'));
  });

  test('and a grant after a withdrawal', async () => {
    // Somebody turns a thing off and later turns it back on. Scanning for the
    // first grant, or for any grant, gets this backwards.
    const db = await makeDb();
    await grant(db, 'escrow', { at: '2026-08-01T00:00:00.000Z' });
    await withdraw(db, 'escrow', { at: '2026-08-09T00:00:00.000Z' });
    await grant(db, 'escrow', { at: '2026-08-12T00:00:00.000Z' });
    assert.ok(await hasConsent(db, 'escrow'));
  });

  test('by time, not by the order rows were appended', async () => {
    const db = await makeDb();
    await withdraw(db, 'escrow', { at: '2026-08-09T00:00:00.000Z' });
    await grant(db, 'escrow', { at: '2026-08-01T00:00:00.000Z' });
    assert.not(await hasConsent(db, 'escrow'),
      'the withdrawal is later in time even though it was written first');
  });

  test('withdrawing does not erase what was agreed', async () => {
    // "This was agreed on the 1st and withdrawn on the 9th" is the answer
    // somebody needs, and it is unavailable from a log that keeps only the
    // current state.
    const db = await makeDb();
    await grant(db, 'escrow', { at: '2026-08-01T00:00:00.000Z' });
    await withdraw(db, 'escrow', { at: '2026-08-09T00:00:00.000Z' });

    const log = await history(db, { purpose: 'escrow' });
    assert.length(log, 2);
    assert.equal(log[0].decision, DECISIONS.GRANTED);
    assert.equal(log[0].at, '2026-08-01T00:00:00.000Z');
  });
});

describe('one mailbox is not another', () => {
  test('consent for one address says nothing about a second', async () => {
    // The failure this exists to prevent: agreeing that one mailbox may be
    // read, and having a second one read on the strength of it.
    const db = await makeDb();
    await grant(db, 'mail', { subject: 'a@example.com' });

    assert.ok(await hasConsent(db, 'mail', 'a@example.com'));
    assert.not(await hasConsent(db, 'mail', 'b@example.com'));
  });

  test('withdrawing one leaves the other alone', async () => {
    const db = await makeDb();
    await grant(db, 'mail', { subject: 'a@example.com', at: '2026-08-01T00:00:00.000Z' });
    await grant(db, 'mail', { subject: 'b@example.com', at: '2026-08-01T00:00:00.000Z' });
    await withdraw(db, 'mail', { subject: 'a@example.com', at: '2026-08-09T00:00:00.000Z' });

    assert.not(await hasConsent(db, 'mail', 'a@example.com'));
    assert.ok(await hasConsent(db, 'mail', 'b@example.com'));
  });

  test('a per-subject purpose refuses to be recorded without one', async () => {
    const db = await makeDb();
    let threw = false;
    try { await grant(db, 'mail'); } catch { threw = true; }
    assert.ok(threw, 'a mail grant with no mailbox would apply to all of them');
  });

  test('an unknown purpose is refused rather than stored', async () => {
    const db = await makeDb();
    let threw = false;
    try { await grant(db, 'telemetry'); } catch { threw = true; }
    assert.ok(threw);
  });
});

describe('what leaves the device', () => {
  test('the assistant needs no consent because nothing leaves', async () => {
    const db = await makeDb();
    assert.ok(await hasConsent(db, 'assistant'),
      'there is nothing to agree to — the answer is computed here');
    assert.length(PURPOSES.assistant.processors, 0);
  });

  test('every other purpose names who else sees it', () => {
    for (const name of egressing()) {
      assert.ok(processorsFor(name).length, `${name} sends data and names nobody`);
    }
  });

  test('every processor says how to revoke it', () => {
    for (const key of Object.keys(PROCESSORS)) {
      assert.ok(PROCESSORS[key].revoke, `${key} cannot be revoked`);
      assert.ok(PROCESSORS[key].relationship, `${key} does not say what it is`);
    }
  });

  test('the host is listed, though it never sees a record', () => {
    // The one that usually goes unmentioned. A static host sees the request,
    // the address and the time, and that is worth saying out loud.
    assert.includes(PROCESSORS.host.sees.toLowerCase(), 'no records');
  });

  test('scopes and processors both resolve', () => {
    assert.deep(assertSound(), []);
  });
});

describe('the report', () => {
  const configured = { configured: true, escrowed: false, mailboxes: [] };

  test('names what is happening with nobody’s agreement', async () => {
    const db = await makeDb();
    const r = await report(db, configured);

    const gaps = r.gaps.map((g) => g.purpose).sort();
    assert.deep(gaps, ['backup', 'documents', 'identity']);
  });

  test('a granted purpose drops out of the gaps', async () => {
    const db = await makeDb();
    await grant(db, 'backup');
    const r = await report(db, configured);
    assert.not(r.gaps.some((g) => g.purpose === 'backup'));
  });

  test('backup and documents are marked as never asked anywhere', async () => {
    // Not "asked and declined", and not "asked and not yet answered". The
    // application contains no point at which anybody is asked at all, and the
    // report says so rather than letting it read as an unanswered prompt.
    const db = await makeDb();
    const r = await report(db, configured);
    const backup = r.purposes.find((p) => p.purpose === 'backup');
    assert.ok(backup.neverAsked);
    assert.ok(r.purposes.find((p) => p.purpose === 'escrow').neverAsked === false);
  });

  test('local-only leaves nothing active but the assistant', async () => {
    const db = await makeDb();
    const r = await report(db, { localOnly: true, configured: true });
    assert.deep(r.purposes.filter((p) => p.active).map((p) => p.purpose), ['assistant']);
    assert.length(r.gaps, 0);
  });

  test('an unconfigured install has no gaps, because nothing is happening', async () => {
    const db = await makeDb();
    assert.length((await report(db, {})).gaps, 0);
  });

  test('a mailbox that is attached but unrecorded shows as a gap', async () => {
    const db = await makeDb();
    const r = await report(db, { ...configured, mailboxes: ['a@example.com'] });
    const mail = r.gaps.find((g) => g.purpose === 'mail');
    assert.ok(mail);
    assert.equal(mail.subject, 'a@example.com');
  });

  test('escrow is flagged as consequential wherever it appears', async () => {
    // It is the one that hands over the key to everything else, and a list
    // that renders it identically to the rest is a list that hides it.
    const db = await makeDb();
    const r = await report(db, { ...configured, escrowed: true });
    assert.ok(r.purposes.find((p) => p.purpose === 'escrow').consequential);
  });
});

describe('the gate: an explicit no stops it, an absent record does not', () => {
  /** A transport that answers everything, so nothing but consent can stop it. */
  const willing = () => new FakeTransport({
    bootstrap: () => ({ ok: true }),
    schema: () => ({ ok: true }),
    push: ({ changes }) => ({ applied: changes.map((c) => ({ id: c.id, rev: c.rev })) }),
    pull: (payload) => ({ records: {}, cursors: payload.cursors ?? {}, more: false }),
    audit: () => ({ ok: true }),
  });

  test('a household that was never asked keeps its backup', async () => {
    // The failure this is here to prevent. Gating on "has not consented"
    // rather than "has refused" would stop the backups of every household
    // that upgraded, over a question nobody ever put to them — and they would
    // find out when they needed the backup.
    const db = await makeDb();
    await makePerson(db);

    const transport = willing();
    const result = await new SyncEngine({ db, transport }).run();
    assert.not(result.skipped, 'an unrecorded purpose must not stop a sync');
    assert.includes(transport.calls.map((c) => c.action), 'push');
  });

  test('a withdrawal stops the next run', async () => {
    const db = await makeDb();
    await makePerson(db);
    await withdraw(db, 'backup');

    const engine = new SyncEngine({ db, transport: willing() });
    assert.equal((await engine.run()).skipped, 'consent-withdrawn');
  });

  test('and nothing was sent before it noticed', async () => {
    const db = await makeDb();
    await makePerson(db);
    await withdraw(db, 'backup');

    const transport = willing();
    await new SyncEngine({ db, transport }).run();
    assert.length(transport.calls, 0, 'refused, before the first request');
  });

  test('granting again lets it run', async () => {
    const db = await makeDb();
    await makePerson(db);
    await withdraw(db, 'backup', { at: '2026-08-01T00:00:00.000Z' });
    await grant(db, 'backup', { at: '2026-08-09T00:00:00.000Z' });

    const transport = willing();
    assert.not((await new SyncEngine({ db, transport }).run()).skipped);
    assert.includes(transport.calls.map((c) => c.action), 'push');
  });

  test('a denial gates the same as a withdrawal', async () => {
    const db = await makeDb();
    await record(db, { purpose: 'backup', decision: DECISIONS.DENIED });
    assert.ok(await refused(db, 'backup'));
  });

  test('backup and documents are refused separately', async () => {
    // A household may well want the ledger backed up and the passport scans
    // kept off Drive. One switch cannot say that.
    const db = await makeDb();
    await withdraw(db, 'documents');

    assert.ok(await refused(db, 'documents'));
    assert.not(await refused(db, 'backup'));
  });

  test('a withdrawn document upload never reads the file off disk', async () => {
    // Asserting `refused()` returns true would prove only that the helper
    // works. This drives the real uploader: a passport scan is the most
    // sensitive thing here, so the check has to sit before the bytes are
    // read, not merely before the request goes out.
    const db = await makeDb();
    let uploads = 0;
    const transport = {
      configured: true,
      async upload() {
        uploads += 1;
        return { fileId: 'drv_1', folderId: 'fld_1', versionCount: 1, text: '' };
      },
    };

    const store = new DocumentStore({ db, transport });
    await store.capture(
      {
        name: 'passport.jpg',
        type: 'image/jpeg',
        size: 3,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      },
      { title: 'Passport', category: 'identity' },
    );

    await withdraw(db, 'documents');
    assert.equal((await store.flush()).skipped, 'consent-withdrawn');
    assert.equal(uploads, 0);
  });
});

describe('evidence is kept beside the decision, not mistaken for it', () => {
  test('what Google granted is recorded with the grant', async () => {
    const db = await makeDb();
    await grant(db, 'escrow', {
      grantedScopes: ['openid', 'https://www.googleapis.com/auth/drive.file'],
      deviceId: 'dev_1',
    });

    const [entry] = await history(db, { purpose: 'escrow' });
    assert.includes(entry.grantedScopes, 'openid');
    assert.equal(entry.deviceId, 'dev_1');
  });

  test('a grant at Google is not itself a recorded decision', async () => {
    // Scopes coming back from an OAuth response say what Google may do. They
    // are not somebody agreeing to what this application does with it.
    const db = await makeDb();
    assert.not(await hasConsent(db, 'escrow'),
      'no record was written, whatever Google returned');
  });
});

/* ------------------------------------------- people who are not the household */

describe('consent about a person, rather than about Google', () => {
  test('the two person purposes name no processor, because nothing leaves', async () => {
    for (const name of ['staffRecords', 'childRecords']) {
      assert.length(PURPOSES[name].processors, 0);
      assert.ok(PURPOSES[name].localOnly);
      assert.ok(PURPOSES[name].aboutAPerson);
    }
    assert.length(assertSound(), 0, 'the new purposes broke the shape check');
  });

  test('but local-only does NOT make them agreed', async () => {
    // The whole point. A local-only purpose is true without a record because
    // nothing leaves the device — there is nobody to have agreed with. When
    // the third party is a person, there is somebody, and reading "granted"
    // off an empty log manufactures a conversation that never happened.
    const db = await makeDb();
    assert.not(await hasConsent(db, 'staffRecords', 'per_someone'));
    assert.not(await hasConsent(db, 'childRecords', 'per_someone'));

    // Whereas an ordinary local-only purpose still is.
    assert.ok(await hasConsent(db, 'assistant'));
  });

  test('a record with nobody named is refused', async () => {
    // A consent record naming no subject is a record about nobody.
    const db = await makeDb();
    let threw = false;
    try { await grant(db, 'staffRecords'); } catch { threw = true; }
    assert.ok(threw, 'a consent record was written naming nobody');
  });

  test('recorded, it is granted for that person and nobody else', async () => {
    const db = await makeDb();
    await grant(db, 'staffRecords', { subject: 'per_cook' });

    assert.ok(await hasConsent(db, 'staffRecords', 'per_cook'));
    assert.not(await hasConsent(db, 'staffRecords', 'per_gardener'),
      'one person agreeing was read as everybody agreeing');
  });

  test('and withdrawing it is honoured', async () => {
    const db = await makeDb();
    await grant(db, 'childRecords', { subject: 'per_kid' });
    await withdraw(db, 'childRecords', { subject: 'per_kid' });

    assert.not(await hasConsent(db, 'childRecords', 'per_kid'));
    assert.ok(await refused(db, 'childRecords', 'per_kid'));
  });

  test('the report lists people, not mailboxes, for these', async () => {
    // Reading a person purpose off `state.mailboxes` would have reported every
    // staff consent as belonging to a Gmail account.
    const db = await makeDb();
    await grant(db, 'staffRecords', { subject: 'per_cook' });

    const { purposes } = await report(db, { people: ['per_cook'], mailboxes: ['gm_a@b.c'] });
    const staff = purposes.filter((r) => r.purpose === 'staffRecords');

    assert.length(staff, 1);
    assert.equal(staff[0].subject, 'per_cook');
  });

  test('and somebody with no recorded decision is reported as a gap', async () => {
    // `gaps` skips local-only purposes because nothing leaves the device and
    // there is nobody to ask. These are local *and* have somebody, so
    // excluding them would make the one gap this pair exists to surface
    // permanently invisible.
    const db = await makeDb();
    const { gaps } = await report(db, { people: ['per_cook'] });

    assert.ok(gaps.some((g) => g.purpose === 'staffRecords' && g.subject === 'per_cook'),
      JSON.stringify(gaps));
  });

  test('and stops being a gap once it is recorded', async () => {
    const db = await makeDb();
    await grant(db, 'staffRecords', { subject: 'per_cook' });

    const { gaps } = await report(db, { people: ['per_cook'] });
    assert.not(gaps.some((g) => g.purpose === 'staffRecords'), JSON.stringify(gaps));
  });

  test('who consent is owed to is derived from the records, not a list', async () => {
    // A stored flag would start disagreeing with the records it describes the
    // first time somebody added a staff member without ticking it.
    const { peopleWithRecordsAbout } = await import('../js/data/consent.js');
    const db = await makeDb();

    const cook = await makePerson(db, { name: 'Cook' });
    const child = await makePerson(db, { name: 'Kiran', role: 'child' });
    await makePerson(db, { name: 'Adult' });
    await db.repo('staff').create({ person: cook.id, role: 'Cook', startedOn: '2026-01-01' });

    const owed = (await peopleWithRecordsAbout(db)).sort();
    assert.deep(owed, [cook.id, child.id].sort());
  });

  test('and a household with neither owes nothing', async () => {
    const { peopleWithRecordsAbout } = await import('../js/data/consent.js');
    const db = await makeDb();
    await makePerson(db, { name: 'Adult' });
    assert.length(await peopleWithRecordsAbout(db), 0);
  });

  test('nothing is gated by any of it, and that is still true', async () => {
    // The module has always said it gates nothing. Adding a purpose about a
    // person is exactly the moment somebody would assume otherwise.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Cook' });

    // No consent recorded, and the record is still writable.
    const staff = await db.repo('staff').create({
      person: person.id, role: 'Cook', startedOn: '2026-01-01',
    });
    assert.ok(staff.id, 'a staff record was refused for want of consent');
    assert.not(await hasConsent(db, 'staffRecords', person.id));
  });
});
