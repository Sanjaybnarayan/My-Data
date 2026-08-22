import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import { ChatService } from '../js/services/chat.js';
import {
  createIdentity, seal, open, safetyNumber, sealedTo, addressedTo,
  SEALED_VERSION, ESCROW_ID,
} from '../js/security/e2ee.js';

setSuite('chat');

/* ------------------------------------------------------------- the crypto */

describe('sealing a message', () => {
  test('the intended device reads it back', async () => {
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const sealed = await seal('the spare key is under the pot', asha,
      [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    assert.equal(await open(sealed, { id: 'dev-ravi', ...ravi }),
      'the spare key is under the pot');
  });

  test('and nobody else does — this is the whole phase', async () => {
    // If this test can be made to pass while a stranger reads the message,
    // nothing else in this file matters.
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const stranger = await createIdentity();
    const sealed = await seal('private', asha, [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    let code;
    try { await open(sealed, { id: 'dev-x', ...stranger }); } catch (e) { code = e.code; }
    assert.equal(code, 'notARecipient');
  });

  test('a device with the right id and the wrong key is refused by the cipher', async () => {
    // Claiming somebody's device id must not be enough. The wrap is bound to
    // the key, and AES-GCM's tag is what says so.
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const impostor = await createIdentity();
    const sealed = await seal('private', asha, [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    let threw = false;
    try { await open(sealed, { id: 'dev-ravi', ...impostor }); } catch { threw = true; }
    assert.ok(threw, 'an impostor opened a message by using the right device id');
  });

  test('the ciphertext does not contain the message', async () => {
    // Obvious, and worth asserting: an envelope that accidentally carried the
    // plaintext alongside it would pass every other test here.
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const sealed = await seal('under the flowerpot', asha,
      [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    assert.not(JSON.stringify(sealed).includes('flowerpot'));
  });

  test('two seals of the same text differ', async () => {
    // A fresh content key and iv each time. Identical ciphertexts would leak
    // that the same thing was said twice.
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const to = [{ id: 'dev-ravi', publicKey: ravi.publicKey }];
    const a = await seal('same', asha, to);
    const b = await seal('same', asha, to);

    assert.notEqual(a.body, b.body);
    assert.notEqual(a.keys[0].key, b.keys[0].key);
  });

  test('every recipient device gets its own wrap', async () => {
    const asha = await createIdentity();
    const phone = await createIdentity();
    const tablet = await createIdentity();
    const sealed = await seal('hello', asha, [
      { id: 'dev-phone', publicKey: phone.publicKey },
      { id: 'dev-tablet', publicKey: tablet.publicKey },
    ]);

    assert.equal(await open(sealed, { id: 'dev-phone', ...phone }), 'hello');
    assert.equal(await open(sealed, { id: 'dev-tablet', ...tablet }), 'hello');
    assert.deep(sealedTo(sealed).devices, ['dev-phone', 'dev-tablet']);
  });

  test('sealing to nobody is refused, because that is a lost message not a private one', async () => {
    const asha = await createIdentity();
    let code;
    try { await seal('into the void', asha, []); } catch (e) { code = e.code; }
    assert.equal(code, 'noRecipients');
  });

  test('a newer envelope version is refused rather than misread', async () => {
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const sealed = await seal('hello', asha, [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    let code;
    try {
      await open({ ...sealed, v: SEALED_VERSION + 1 }, { id: 'dev-ravi', ...ravi });
    } catch (e) { code = e.code; }
    assert.equal(code, 'sealedVersion');
  });
});

describe('escrow', () => {
  test('the recovery phrase key opens a message it was never a recipient of', async () => {
    // The household's choice, working. Also the largest hole in the property
    // above, which is why docs/CHAT_AND_E2EE.md leads with it.
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const escrow = await createIdentity();
    const sealed = await seal('meet me at six', asha,
      [{ id: 'dev-ravi', publicKey: ravi.publicKey }],
      { escrowPublicKey: escrow.publicKey });

    assert.equal(await open(sealed, { id: 'nobody' }, { escrow }), 'meet me at six');
    assert.ok(sealedTo(sealed).escrowed);
  });

  test('a different escrow key does not open it', async () => {
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const escrow = await createIdentity();
    const other = await createIdentity();
    const sealed = await seal('hello', asha, [{ id: 'dev-ravi', publicKey: ravi.publicKey }],
      { escrowPublicKey: escrow.publicKey });

    let threw = false;
    try { await open(sealed, { id: 'nobody' }, { escrow: other }); } catch { threw = true; }
    assert.ok(threw);
  });

  test('without escrow, nothing but the devices can open it', async () => {
    const asha = await createIdentity();
    const ravi = await createIdentity();
    const escrow = await createIdentity();
    const sealed = await seal('hello', asha, [{ id: 'dev-ravi', publicKey: ravi.publicKey }]);

    assert.not(sealedTo(sealed).escrowed);
    assert.not(addressedTo(sealed, ESCROW_ID));
    let threw = false;
    try { await open(sealed, { id: 'nobody' }, { escrow }); } catch { threw = true; }
    assert.ok(threw, 'an escrow key opened a message that was never escrowed');
  });
});

describe('safety numbers', () => {
  test('both ends compute the same number', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    assert.equal(await safetyNumber(a.publicKey, b.publicKey),
      await safetyNumber(b.publicKey, a.publicKey));
  });

  test('a different key gives a different number', async () => {
    // The point of reading it aloud: a substituted key has to show up.
    const a = await createIdentity();
    const b = await createIdentity();
    const impostor = await createIdentity();
    assert.notEqual(await safetyNumber(a.publicKey, b.publicKey),
      await safetyNumber(a.publicKey, impostor.publicKey));
  });

  test('it is digits in groups, because it is read over a phone call', async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const number = await safetyNumber(a.publicKey, b.publicKey);
    assert.equal(number.split(' ').length, 12);
    assert.ok(/^[\d ]+$/.test(number), number);
  });
});

/* ------------------------------------------------------------ the service */

const household = async () => {
  const db = await makeDb();
  const asha = await makePerson(db, { name: 'Asha' });
  const ravi = await makePerson(db, { name: 'Ravi' });
  const kid = await makePerson(db, { name: 'Kiran' });
  const chat = new ChatService(db);
  return { db, chat, asha, ravi, kid };
};

describe('enrolling a device', () => {
  test('makes an identity and publishes only the public half', async () => {
    const { db, chat, asha } = await household();
    const { device } = await chat.enrol(asha.id, { label: 'Asha phone' });

    assert.ok(device.publicKey);
    // The row that syncs must not carry the private key. A private key in a
    // spreadsheet is not a private key.
    assert.not(JSON.stringify(device).includes('privateKey'));
    const identity = await chat.identity();
    assert.ok(identity.privateKey, 'the device kept its own private half');
    assert.not(JSON.stringify(await db.repo('deviceKey').list({ limit: 10 }))
      .includes(identity.privateKey));
  });

  test('enrolling twice does not make a second key', async () => {
    // Two public keys for one device means half the household sealing to a key
    // this device no longer holds.
    const { db, chat, asha } = await household();
    await chat.enrol(asha.id);
    await chat.enrol(asha.id);
    assert.length(await db.repo('deviceKey').list({ limit: 10 }), 1);
  });
});

describe('a conversation', () => {
  const conversationWith = async (db, participants) => db.repo('conversation').create({
    title: 'Household', participants, startedAt: new Date().toISOString(),
  });

  test('a participant reads what was sent', async () => {
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);

    await chat.send(conversation.id, asha.id, 'bring milk');
    const read = await chat.read(conversation.id);

    assert.length(read, 1);
    assert.equal(read[0].text, 'bring milk');
  });

  test('the stored row does not contain the message', async () => {
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);
    await chat.send(conversation.id, asha.id, 'the safe code is 4417');

    const rows = await db.repo('message').list({ limit: 10 });
    assert.not(JSON.stringify(rows).includes('4417'),
      'the plaintext reached the table');
  });

  test('a message is not sealed to a revoked device', async () => {
    const { db, chat, asha, ravi } = await household();
    const mine = await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);

    await chat.revoke(mine.device.id);
    let code;
    try { await chat.send(conversation.id, asha.id, 'hello'); } catch (e) { code = e.code; }
    assert.equal(code, 'noRecipients',
      'a revoked device was still treated as somewhere to send');
  });

  test('sending to a conversation whose people have no devices says why', async () => {
    const { db, chat, asha, ravi, kid } = await household();
    await chat.enrol(asha.id);
    // A conversation Asha is not in, so her device is not a recipient either.
    const conversation = await conversationWith(db, [ravi.id, kid.id]);

    let error;
    try { await chat.send(conversation.id, asha.id, 'hello'); } catch (e) { error = e; }
    assert.equal(error?.code, 'noRecipients');
    assert.ok(/enrol/.test(error.message), error?.message);
  });

  test('a message sent before this device existed is named, not blank', async () => {
    // The common case, and the one that reads as data loss if the screen just
    // leaves a gap. Reproduced honestly: the message is sealed only to Ravi's
    // phone, which is a different device id, so this device holds no wrap at
    // all — rather than faking it by swapping a key under the same id, which
    // is a different situation with a different answer.
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const ravisPhone = await createIdentity();
    await db.repo('deviceKey').create({
      person: ravi.id, deviceId: 'dev-ravi-phone', label: 'Ravi phone',
      publicKey: ravisPhone.publicKey, addedAt: new Date().toISOString(),
    });
    const conversation = await conversationWith(db, [ravi.id]);
    await chat.send(conversation.id, ravi.id, 'before');

    const read = await chat.read(conversation.id);
    assert.equal(read[0].text, null);
    assert.equal(read[0].why, 'sentBefore');
  });

  test('a device that kept its id but changed its key is told which it is', async () => {
    // Re-installing the app makes a new keypair under the same device id. The
    // wrap is addressed to this device and will not open, and "you were never
    // a recipient" would be the wrong sentence for it.
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);
    await chat.send(conversation.id, asha.id, 'before the reinstall');

    await db.setMeta('chat.deviceIdentity', await createIdentity());

    const read = await chat.read(conversation.id);
    assert.equal(read[0].why, 'keyChanged');
  });

  test('an unreadable row does not take the conversation down', async () => {
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);
    await chat.send(conversation.id, asha.id, 'good');
    await db.repo('message').create({
      conversation: conversation.id, sender: asha.id,
      sentAt: new Date().toISOString(), body: 'not json at all',
    });

    const read = await chat.read(conversation.id);
    assert.length(read, 2);
    assert.equal(read[0].text, 'good');
    assert.equal(read[1].why, 'unreadable');
  });

  test('a withdrawn message says so and keeps no body', async () => {
    const { db, chat, asha, ravi } = await household();
    await chat.enrol(asha.id);
    const conversation = await conversationWith(db, [asha.id, ravi.id]);
    const sent = await chat.send(conversation.id, asha.id, 'sent in error');

    await chat.withdraw(sent.id);
    const read = await chat.read(conversation.id);
    assert.equal(read[0].why, 'withdrawn');
    assert.equal(read[0].text, null);
    const row = await db.repo('message').get(sent.id);
    assert.not(String(row.body).includes('keys'));
  });
});

describe('escrow through the service', () => {
  test('the private half of the escrow key is never stored', async () => {
    // It is handed back once, to be wrapped under the recovery phrase. If it
    // were kept in `meta` then anything that can unlock the app could read
    // every conversation — which is exactly who escrow excludes.
    const { db, chat } = await household();
    const created = await chat.createEscrow();

    assert.ok(created.privateKey, 'the caller was given the private half once');
    const stored = await db.meta('chat.escrowIdentity');
    assert.ok(stored.publicKey);
    assert.not(stored.privateKey, 'the escrow private key was stored');
  });

  test('and a second call does not replace it', async () => {
    const { chat } = await household();
    const first = await chat.createEscrow();
    const again = await chat.createEscrow();
    assert.equal(again.publicKey, first.publicKey);
    assert.not(again.privateKey, 'a second call handed out a private key again');
  });

  test('messages sealed with escrow open with the escrow key', async () => {
    const { db, chat, asha, ravi } = await household();
    const escrow = await chat.createEscrow();
    await chat.enrol(asha.id);
    const conversation = await db.repo('conversation').create({
      title: 'Household', participants: [asha.id, ravi.id], startedAt: new Date().toISOString(),
    });
    await chat.send(conversation.id, asha.id, 'escrowed');

    // A device that was never a recipient, holding the recovery-phrase key.
    await db.setMeta('chat.deviceIdentity', await createIdentity());
    const read = await chat.read(conversation.id, { escrow });
    assert.equal(read[0].text, 'escrowed');
  });
});
