import { test, describe, assert, setSuite } from './harness.mjs';
import {
  CONNECTOR_STATUS, PATIENCE, unknown, noteSuccess, noteFailure, afterScan,
  statusOf, healthOf, describe as describeConnector, needingAttention,
} from '../js/domain/connector.js';
import { CONNECTOR_STATUS as FROM_SMS } from '../js/domain/sms.js';
import { makeDb } from './fixture.mjs';
import { health, attempted, attention, DRIVE, CALENDAR } from '../js/data/connectors.js';
import { recent as recentDiagnostics } from '../js/data/diagnostics.js';

setSuite('connector');

const T1 = '2026-08-20T10:00:00.000Z';
const T2 = '2026-08-21T10:00:00.000Z';
const T3 = '2026-08-22T10:00:00.000Z';

/* ------------------------------------------------------------ one vocabulary */

describe('the status vocabulary', () => {
  test('is the same object SMS uses, not a second copy', () => {
    // It lived in `domain/sms.js` where only SMS could reach it. Two copies
    // would drift, and the day they disagreed about EXPIRED nobody would know
    // which screen was right.
    assert.equal(FROM_SMS, CONNECTOR_STATUS);
  });

  test('and still carries the prompt\'s whole list', () => {
    for (const key of ['NOT_CONNECTED', 'AUTH_REQUIRED', 'CONNECTED', 'SYNCING',
      'SYNCED', 'EXPIRED', 'ERROR', 'NOT_SUPPORTED', 'LEGAL_REVIEW_REQUIRED']) {
      assert.equal(CONNECTOR_STATUS[key], key);
    }
  });
});

/* --------------------------------------------------------------- the states */

describe('what a connector is doing', () => {
  test('one nobody has used is not connected, rather than broken', () => {
    assert.equal(statusOf(unknown()), CONNECTOR_STATUS.NOT_CONNECTED);
    assert.equal(statusOf(undefined), CONNECTOR_STATUS.NOT_CONNECTED);
  });

  test('a scan that worked is synced', () => {
    const health = noteSuccess({}, 'mb1', { at: T1 });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.SYNCED);
  });

  test('one failure is not a broken mailbox', () => {
    // A single 429 is a bad minute. Saying otherwise on a screen trains
    // somebody to ignore the screen.
    const health = noteFailure(noteSuccess({}, 'mb1', { at: T1 }), 'mb1',
      { at: T2, status: 429, message: 'slow down' });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.CONNECTED);
  });

  test('but a run of them is', () => {
    let health = noteSuccess({}, 'mb1', { at: T1 });
    for (let i = 0; i < PATIENCE; i += 1) {
      health = noteFailure(health, 'mb1', { at: T2, status: 503, message: 'down' });
    }
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.ERROR);
  });

  test('a revoked grant is EXPIRED immediately, not after patience runs out', () => {
    // The distinction the whole module exists for. A 401 will never fix
    // itself, so waiting for a second one leaves somebody watching a mailbox
    // that is never coming back.
    const health = noteFailure(noteSuccess({}, 'mb1', { at: T1 }), 'mb1',
      { at: T2, status: 401, message: 'invalid_grant' });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.EXPIRED);
  });

  test('and a 403 is treated the same way', () => {
    const health = noteFailure({}, 'mb1', { at: T2, status: 403 });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.EXPIRED);
  });

  test('a 401 does not age into a transient problem', () => {
    // Nothing about waiting fixes a revoked grant, so time must not soften it.
    const health = noteFailure({}, 'mb1', { at: '2020-01-01T00:00:00.000Z', status: 401 });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.EXPIRED);
  });

  test('a later success clears everything, including an expired grant', () => {
    // Signing in again is exactly how somebody fixes this, and the screen has
    // to notice or they will fix it and be told it is still broken.
    let health = noteFailure({}, 'mb1', { at: T2, status: 401 });
    health = noteSuccess(health, 'mb1', { at: T3 });

    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.SYNCED);
    assert.equal(health.mb1.failures, 0);
    assert.equal(health.mb1.status, null);
  });

  test('the status is decided by the code, never by the message', () => {
    // A message is prose and gets reworded. If the wording decided the state,
    // a copy edit would change what the application believes.
    const a = noteFailure({}, 'mb1', { at: T2, status: 401, message: 'invalid_grant' });
    const b = noteFailure({}, 'mb1', { at: T2, status: 401, message: 'something else entirely' });
    assert.equal(healthOf(a, 'mb1'), healthOf(b, 'mb1'));
  });

  test('one mailbox failing does not condemn another', () => {
    let health = noteSuccess({}, 'good', { at: T1 });
    health = noteFailure(health, 'bad', { at: T2, status: 401 });

    assert.equal(healthOf(health, 'good'), CONNECTOR_STATUS.SYNCED);
    assert.equal(healthOf(health, 'bad'), CONNECTOR_STATUS.EXPIRED);
  });
});

/* --------------------------------------------------------- one call site */

describe('recording a scan, whichever way it went', () => {
  // One entry point rather than a success call on one branch and a failure
  // call on another. Two call sites meant the success one could be deleted
  // and nothing would notice: a browser check can drive a *failing* scan but
  // not a succeeding one, because succeeding needs a real Google token.

  test('no error means the connector is working', () => {
    const health = afterScan({}, 'mb1', null);
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.SYNCED);
  });

  test('and it clears a grant that had expired', () => {
    // Signing in again is exactly how somebody fixes this. If the screen did
    // not notice, they would fix it and be told it was still broken.
    let health = afterScan({}, 'mb1', { status: 401, message: 'invalid_grant' });
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.EXPIRED);

    health = afterScan(health, 'mb1', null);
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.SYNCED);
  });

  test('an error carries its status through, not its wording', () => {
    const health = afterScan({}, 'mb1', { status: 401, message: 'anything at all' });
    assert.equal(health.mb1.status, 401);
    assert.equal(healthOf(health, 'mb1'), CONNECTOR_STATUS.EXPIRED);
  });

  test('an error with no status is still recorded, not dropped', () => {
    // A network failure has no HTTP status. Treating that as "nothing
    // happened" would lose the commonest failure of all.
    const health = afterScan({}, 'mb1', { message: 'could not reach Gmail' });
    assert.equal(health.mb1.failures, 1);
    assert.equal(health.mb1.status, null);
  });
});

/* -------------------------------------------------------------- redaction */

describe('what gets stored', () => {
  test('a message with an address in it does not keep the address', () => {
    // This lives in `meta`, which is not encrypted. A mailbox error quietly
    // accumulating somebody's email address would be a leak with a helpful
    // face.
    const health = noteFailure({}, 'mb1', {
      at: T2, status: 500, message: 'could not read mail for asha@example.com',
    });
    assert.not(/asha@example.com/.test(health.mb1.message), health.mb1.message);
  });

  test('and what is left still says what happened', () => {
    const health = noteFailure({}, 'mb1', {
      at: T2, status: 500, message: 'Gmail refused the request',
    });
    assert.includes(health.mb1.message, 'refused');
  });
});

/* --------------------------------------------------------- what to tell them */

describe('what a person is told', () => {
  test('every unhappy state names something to do', () => {
    // A status with no next step makes somebody feel bad and leaves them
    // where they were.
    const expired = describeConnector(noteFailure({}, 'm', { status: 401, at: T2 }).m);
    assert.equal(expired.status, CONNECTOR_STATUS.EXPIRED);
    assert.ok(expired.action, 'an expired grant with no action');
    assert.includes(expired.why, 'no longer letting');

    let broken = {};
    for (let i = 0; i < PATIENCE; i += 1) {
      broken = noteFailure(broken, 'm', { status: 503, at: T2, message: 'down' });
    }
    const error = describeConnector(broken.m);
    assert.equal(error.status, CONNECTOR_STATUS.ERROR);
    assert.ok(error.action);
  });

  test('a working one is not given a chore', () => {
    const ok = describeConnector(noteSuccess({}, 'm', { at: T1 }).m);
    assert.equal(ok.status, CONNECTOR_STATUS.SYNCED);
    assert.equal(ok.action, null);
  });

  test('and an expired one does not blame the household for it', () => {
    // It is usually a password change or a sign-out everywhere, not a mistake.
    const expired = describeConnector(noteFailure({}, 'm', { status: 401, at: T2 }).m);
    assert.not(/you (did|should have|failed)/i.test(expired.why), expired.why);
  });
});

describe('which ones need attention', () => {
  test('only the ones that will not fix themselves, or have stopped trying', () => {
    let health = noteSuccess({}, 'fine', { at: T1 });
    health = noteFailure(health, 'expired', { at: T2, status: 401 });
    health = noteFailure(health, 'blip', { at: T2, status: 429 });

    const need = needingAttention(health).map((c) => c.id).sort();
    assert.deep(need, ['expired']);
  });

  test('and nothing at all when everything is working', () => {
    assert.length(needingAttention(noteSuccess({}, 'mb1', { at: T1 })), 0);
    assert.length(needingAttention({}), 0);
    assert.length(needingAttention(undefined), 0);
  });
});


/* --------------------------------------------------- through the database */

describe('recording an attempt', () => {
  // One function, three connectors. The Gmail scan did all four steps inline;
  // adding Drive and Calendar would have made three copies, and the last time
  // this repository had two copies of one decision a mutation showed one could
  // be deleted with nothing noticing.

  test('a failure is remembered and recorded in diagnostics', async () => {
    const db = await makeDb();
    await attempted(db, DRIVE, {
      error: Object.assign(new Error('invalid_grant'), { status: 401 }),
      where: 'drive.upload',
    });

    assert.equal(healthOf(await health(db), DRIVE), CONNECTOR_STATUS.EXPIRED);

    const [event] = await recentDiagnostics(db.adapter);
    assert.equal(event.kind, 'connector');
    assert.equal(event.where, 'drive.upload');
    assert.includes(event.code, '401');
  });

  test('a success is remembered and records nothing', async () => {
    // A log that fills up when everything works is a log nobody reads.
    const db = await makeDb();
    await attempted(db, CALENDAR, { where: 'calendar.push' });

    assert.equal(healthOf(await health(db), CALENDAR), CONNECTOR_STATUS.SYNCED);
    assert.length(await recentDiagnostics(db.adapter), 0);
  });

  test('and a success clears a connector that had expired', async () => {
    const db = await makeDb();
    await attempted(db, CALENDAR, {
      error: Object.assign(new Error('gone'), { status: 401 }), where: 'calendar.push',
    });
    assert.equal(healthOf(await health(db), CALENDAR), CONNECTOR_STATUS.EXPIRED);

    await attempted(db, CALENDAR, { where: 'calendar.push' });
    assert.equal(healthOf(await health(db), CALENDAR), CONNECTOR_STATUS.SYNCED);
  });

  test('one connector failing does not mark the others', async () => {
    const db = await makeDb();
    await attempted(db, DRIVE, { where: 'drive.upload' });
    await attempted(db, CALENDAR, {
      error: Object.assign(new Error('gone'), { status: 403 }), where: 'calendar.push',
    });

    const need = await attention(db);
    assert.deep(need.map((c) => c.id), [CALENDAR]);
  });

  test('the message reaching diagnostics is redacted', async () => {
    // `meta` is not encrypted and neither is the diagnostics store. A
    // connector error can carry an address.
    const db = await makeDb();
    await attempted(db, DRIVE, {
      error: new Error('could not upload for asha@example.com'), where: 'drive.upload',
    });

    const dump = JSON.stringify(await recentDiagnostics(db.adapter))
      + JSON.stringify(await health(db));
    assert.not(dump.includes('asha@example.com'), dump.slice(0, 200));
  });

  test('nothing needs attention when nothing has been tried', async () => {
    assert.length(await attention(await makeDb()), 0);
  });
});


describe('the Drive flush reports its own health', () => {
  test('a failed upload marks Drive, once for the run', async () => {
    // Once for the flush, not once per file. Five documents failing because
    // one grant expired is one problem, and counting it five times would make
    // a single revoked authorisation look like a crisis.
    const db = await makeDb();
    const { DocumentStore } = await import('../js/sync/drive.js');

    const document = await db.repo('document').create({
      title: 'Passport', category: 'identity', fileName: 'p.pdf',
      mimeType: 'application/pdf', sizeBytes: 10, versionCount: 1,
    });
    // Sealed the way the store seals them, so the flush reaches the upload
    // rather than failing at decryption — which would have made this test
    // measure a broken fixture instead of a revoked grant.
    const { encryptBytes } = await import('../js/security/crypto.js');
    for (const n of [1, 2, 3]) {
      const sealed = await encryptBytes(
        db.keyring.key, new TextEncoder().encode('pretend pdf'),
        `familyos:blob:${document.id}`,
      );
      await db.adapter.write('blobs', {
        id: `blb_${n}`, documentId: document.id, iv: sealed.iv, data: sealed.data,
        uploaded: false, createdAt: new Date().toISOString(),
      });
    }

    const store = new DocumentStore({
      db,
      transport: {
        configured: true,
        upload: async () => {
          throw Object.assign(new Error('invalid_grant'), { status: 401 });
        },
      },
    });
    await store.flush({ limit: 5 }).catch(() => {});

    assert.equal(healthOf(await health(db), DRIVE), CONNECTOR_STATUS.EXPIRED);

    const events = (await recentDiagnostics(db.adapter, { limit: 50 }))
      .filter((e) => e.where === 'drive.upload');
    assert.length(events, 1, `${events.length} events for one flush`);
  });

  test('a flush with nothing to upload says nothing about the connector', async () => {
    // Not a success and not a failure. Recording it as a success would clear
    // a genuinely expired grant the next time somebody opened the app.
    const db = await makeDb();
    const { DocumentStore } = await import('../js/sync/drive.js');

    await attempted(db, DRIVE, {
      error: Object.assign(new Error('gone'), { status: 401 }), where: 'drive.upload',
    });

    const store = new DocumentStore({ db, transport: { configured: true } });
    await store.flush({ limit: 5 }).catch(() => {});

    assert.equal(healthOf(await health(db), DRIVE), CONNECTOR_STATUS.EXPIRED,
      'an empty flush cleared an expired grant');
  });
});
