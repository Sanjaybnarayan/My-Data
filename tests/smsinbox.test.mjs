import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { entities, systemStores } from '../js/data/schema.js';
import { MessagesService } from '../js/services/sms.js';
import * as inbox from '../js/core/smsinbox.js';

setSuite('smsinbox');

/* ------------------------------------------------------------- a fake phone */

/**
 * A stand-in for the Android plugin.
 *
 * Answers the way the real one does — including refusing, which is the case
 * that has to work and is the hardest to reach with a real device.
 */
function phone({ messages = [], permission = 'granted', calls = [] } = {}) {
  return (name) => {
    if (name !== 'SmsInbox') return null;
    return {
      checkPermissions: async () => ({ sms: permission }),
      requestPermissions: async () => ({ sms: permission }),
      read: async ({ since = 0, limit = 200 } = {}) => {
        calls.push({ since, limit });
        if (permission !== 'granted') {
          // The shape Capacitor gives a rejected call: a message plus a code.
          throw Object.assign(new Error('SMS permission has not been granted'),
            { code: 'DENIED' });
        }
        return {
          messages: messages
            // A row with no usable date still comes back from a real
            // provider — the column exists and the value is junk. Filtering
            // it here would have hidden the case this models.
            .filter((m) => !Number.isFinite(m.receivedAt) || m.receivedAt > since)
            .sort((a, b) => b.receivedAt - a.receivedAt)
            .slice(0, limit),
        };
      },
    };
  };
}

const AUG_15 = Date.UTC(2026, 7, 15, 10, 31);
const AUG_16 = Date.UTC(2026, 7, 16, 9, 0);

const DEBIT = {
  id: '1', sender: 'HDFCBK', receivedAt: AUG_15,
  text: 'Rs 50,000.00 debited from a/c XX8963 on 15-08-26 to VPA landlord@okicici '
    + 'UPI Ref 412345678901. Avl Bal Rs 1,40,500.00',
};
const OTP = {
  id: '2', sender: 'HDFCBK', receivedAt: AUG_16,
  text: '481923 is your OTP for Rs 50,000 to a/c XX8963. Do not share it.',
};

/* ------------------------------------------------------------ the bridge */

describe('reading an SMS inbox off a device', () => {
  test('is unavailable when there is no plugin, which is every browser', () => {
    assert.not(inbox.available({ plugin: () => null }));
  });

  test('and asking anyway is a reason rather than a crash', async () => {
    const result = await inbox.read({ plugin: () => null });
    assert.not(result.ok);
    assert.equal(result.why, inbox.UNSUPPORTED);
  });

  test('a refusal is DENIED, told apart from an empty inbox', async () => {
    // The distinction the whole screen rests on: "you said no" and "your bank
    // sends no alerts" must not produce the same sentence.
    const denied = await inbox.read({ plugin: phone({ permission: 'denied' }) });
    assert.not(denied.ok);
    assert.equal(denied.why, inbox.DENIED);

    const empty = await inbox.read({ plugin: phone({ messages: [] }) });
    assert.ok(empty.ok, 'an empty inbox is a successful read');
    assert.length(empty.messages, 0);
  });

  test('milliseconds become the ISO time everything downstream speaks', async () => {
    const result = await inbox.read({ plugin: phone({ messages: [DEBIT] }) });
    assert.equal(result.messages[0].receivedAt, new Date(AUG_15).toISOString());
    assert.equal(result.messages[0].receivedAtMillis, AUG_15);
  });

  test('a message with an unusable timestamp gets null, not 1970', async () => {
    // `new Date(0).toISOString()` is 1970, which would file a figure under a
    // date fifty years wrong rather than admitting it does not know.
    const result = await inbox.read({
      plugin: phone({ messages: [{ ...DEBIT, receivedAt: NaN }] }),
    });
    assert.equal(result.messages[0].receivedAt, null);
    assert.equal(result.messages[0].receivedAtMillis, null);
  });

  test('the permission can be checked without being asked for', async () => {
    // Android shows the dialog once. A screen that wants to say "not allowed"
    // must be able to find that out without burning the one prompt there is.
    assert.equal(await inbox.permission({ plugin: phone({ permission: 'prompt' }) }), 'prompt');
    assert.equal(await inbox.permission({ plugin: () => null }), inbox.UNSUPPORTED);
  });
});

/* ---------------------------------------------------------- the ingestion */

describe('keeping what arrived, and dropping what must not be kept', () => {
  /** Every value in every store, flattened — the only honest way to say "nowhere". */
  async function everything(db) {
    const found = [];
    for (const name of [...Object.keys(entities), ...Object.keys(systemStores)]) {
      const rows = await db.adapter.query(name, {}).catch(() => []);
      for (const row of rows) found.push(JSON.stringify(row));
    }
    return found.join(' ');
  }

  test('an OTP read off the device reaches no store at all', async () => {
    // Rule 53, at the point where it is newly under pressure. Pasting a
    // message was deliberate; reading the inbox is a sweep, and every OTP the
    // household has ever received now passes through this code. That it is
    // classified and dropped is the entire safety argument, so it is asserted
    // against every store rather than the one table it would land in.
    const db = await makeDb();
    const out = await new MessagesService(db)
      .ingestFromDevice({ plugin: phone({ messages: [DEBIT, OTP] }) });

    assert.equal(out.read, 2);
    assert.equal(out.secrets, 1, 'the OTP was not recognised');
    assert.equal(out.kept, 1);

    const dump = await everything(db);
    assert.not(dump.includes('481923'), 'the code reached a store');
    assert.not(dump.includes('Do not share'), 'the text reached a store');
  });

  test('what is kept is marked as having come from the device', async () => {
    const db = await makeDb();
    await new MessagesService(db).ingestFromDevice({ plugin: phone({ messages: [DEBIT] }) });

    const [row] = await db.repo('smsMessage').list({});
    assert.equal(row.source, 'native');
  });

  test('the body is kept, encrypted, so a figure can be traced to its words', async () => {
    const db = await makeDb();
    await new MessagesService(db).ingestFromDevice({ plugin: phone({ messages: [DEBIT] }) });

    const [row] = await db.repo('smsMessage').list({});
    assert.includes(row.text, 'debited');
    assert.equal(row.amount, 50_000_00);

    // And what is on disk is not what is in the row.
    const [raw] = await db.adapter.query('smsMessage', {});
    assert.not(JSON.stringify(raw).includes('landlord@okicici'),
      'the message body was stored in the clear');
  });
});

/* ----------------------------------------------------------- the watermark */

describe('not reading the same inbox twice', () => {
  test('a second sweep asks only for what arrived after the first', async () => {
    const calls = [];
    const db = await makeDb();
    const service = new MessagesService(db);
    const plugin = phone({ messages: [DEBIT], calls });

    await service.ingestFromDevice({ plugin });
    await service.ingestFromDevice({ plugin });

    assert.equal(calls[0].since, 0, 'the first sweep asked from the beginning');
    assert.equal(calls[1].since, AUG_15, 'the second re-read the whole inbox');
  });

  test('and the second sweep keeps nothing new', async () => {
    const db = await makeDb();
    const service = new MessagesService(db);
    const plugin = phone({ messages: [DEBIT] });

    await service.ingestFromDevice({ plugin });
    const again = await service.ingestFromDevice({ plugin });

    assert.equal(again.read, 0);
    assert.equal(again.kept, 0);
    assert.length(await db.repo('smsMessage').list({}), 1);
  });

  test('the same message arriving twice is one record, not two', async () => {
    // The watermark is exclusive, so a resend with a *later* timestamp gets
    // past it. The fingerprint is what stops it becoming a second event —
    // belt and braces here is correct, because the two guard different things.
    const db = await makeDb();
    const service = new MessagesService(db);

    await service.ingestFromDevice({ plugin: phone({ messages: [DEBIT] }) });
    const resend = await service.ingestFromDevice({
      plugin: phone({ messages: [{ ...DEBIT, id: '9', receivedAt: AUG_16 }] }),
    });

    assert.equal(resend.already, 1);
    assert.equal(resend.kept, 0);
    assert.length(await db.repo('smsMessage').list({}), 1);
  });

  test('a refused sweep does not move the watermark past unread messages', async () => {
    // The failure that would lose messages silently. If a denied read advanced
    // the mark, the next granted read would start after messages nobody saw.
    const db = await makeDb();
    const service = new MessagesService(db);

    const refused = await service.ingestFromDevice({
      plugin: phone({ messages: [DEBIT], permission: 'denied' }),
    });
    assert.not(refused.ok);
    assert.equal(refused.why, inbox.DENIED);

    const after = await service.ingestFromDevice({ plugin: phone({ messages: [DEBIT] }) });
    assert.equal(after.kept, 1, 'a message was lost behind a refused read');
  });

  test('a build with no inbox says so instead of reporting an empty sweep', async () => {
    const db = await makeDb();
    const out = await new MessagesService(db).ingestFromDevice({ plugin: () => null });
    assert.not(out.ok);
    assert.equal(out.why, inbox.UNSUPPORTED);
    assert.equal(out.read, 0);
  });
});
