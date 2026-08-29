import { test, describe, assert, setSuite } from './harness.mjs';
import { privacyReport, entityPrivacy, whyPlain, whereData } from '../js/domain/privacy.js';
import { entities } from '../js/data/schema.js';
import { configure, config } from '../js/core/config.js';
import { SyncEngine } from '../js/sync/engine.js';
import { FakeTransport } from '../js/sync/transport.js';

setSuite('privacy');

/* ------------------------------------------------------- what is sealed */

describe('the encryption claim is countable', () => {
  test('every field is either sealed or has a reason it is not', () => {
    // The point of the screen: no field is unaccounted for, so nobody has to
    // take "encrypted on the device" on trust.
    const report = privacyReport();
    assert.equal(report.sealed + report.plain, report.total);
    assert.ok(report.total > 300, `only ${report.total} fields found`);
  });

  test('the readable fields each say why', () => {
    for (const entry of privacyReport().entities) {
      for (const field of entry.plain) {
        assert.ok(field.why?.length > 5, `${entry.name}.${field.key} has no reason`);
      }
    }
  });

  test('a searchable field is named as searchable, not as an oversight', () => {
    // This is the actual trade the schema made, and the honest word for it.
    assert.includes(whyPlain({ key: 'payee', search: true }), 'search index over ciphertext');
    assert.includes(whyPlain({ key: 'amount', type: 'currency' }), 'totalled');
    assert.includes(whyPlain({ key: 'account', type: 'ref' }), 'link to another record');
  });

  test('the vault is sealed where it matters', () => {
    const vault = entityPrivacy('vaultItem');
    const sealed = vault.sealed.map((f) => f.key);
    for (const key of ['password', 'totpSecret', 'recoveryCodes', 'secureNote']) {
      assert.includes(sealed, key, `the vault leaves ${key} readable`);
    }
  });

  test('identity numbers are sealed', () => {
    assert.includes(entityPrivacy('identityDocument').sealed.map((f) => f.key), 'number');
    assert.includes(entityPrivacy('policy').sealed.map((f) => f.key), 'policyNumber');
    assert.includes(entityPrivacy('account').sealed.map((f) => f.key), 'accountNumber');
  });

  test('a bank narration is readable, and the report does not pretend otherwise', () => {
    // The single most surprising thing to somebody who assumed "encrypted"
    // covered everything, so it is worth a check that keeps it visible.
    const plain = entityPrivacy('transaction').plain.map((f) => f.key);
    assert.includes(plain, 'narration');
    assert.includes(plain, 'payee');
    assert.includes(plain, 'amount');
  });

  test('nothing sealed is also searchable, which would silently break search', () => {
    for (const def of Object.values(entities)) {
      for (const field of def.fields) {
        assert.not(field.encrypted && field.search,
          `${def.name}.${field.key} is both sealed and indexed`);
      }
    }
  });

  test('every phone number is sealed except the one that is searchable', () => {
    /*
     * The rule, written down and checked, because there was not one.
     *
     * Nine `type: 'phone'` fields had accreted nine independent decisions —
     * three sealed, six not — and the split resolved into no policy anybody
     * could state. The sharpest pair: an emergency contact's number was sealed
     * on `person` and in the clear on `emergencyContact`, the entity built for
     * exactly that purpose.
     *
     * The rule now is one sentence: **a household member's own number is
     * searchable, everybody else's is sealed.** `person.phone` is the only
     * exception and it is named here, so adding a tenth phone field in the
     * clear breaks the build rather than quietly widening the split again.
     */
    const SEARCHABLE = ['person.phone'];
    for (const def of Object.values(entities)) {
      for (const field of def.fields) {
        if (field.type !== 'phone') continue;
        const name = `${def.name}.${field.key}`;
        if (SEARCHABLE.includes(name)) {
          assert.not(field.encrypted, `${name} is the searchable one and must not be sealed`);
          continue;
        }
        assert.ok(field.encrypted, `${name} is a phone number left in the clear`);
      }
    }
  });

  test('nothing sealed is also a list column, which would print ciphertext', () => {
    for (const def of Object.values(entities)) {
      for (const field of def.fields) {
        if (!field.encrypted || !field.list) continue;
        // One exception is allowed and named: a policy number is the title of
        // its own row, shown to a person who has already unlocked.
        assert.includes(['identityDocument.number', 'policy.policyNumber'],
          `${def.name}.${field.key}`, `${def.name}.${field.key} would render as ciphertext`);
      }
    }
  });

  test('worst first, so the answer is not buried under Appointments', () => {
    const [first, ...rest] = privacyReport().entities;
    assert.ok(first.plain.length >= rest[0].plain.length);
  });
});

/* ------------------------------------------------------------ where it is */

describe('where a household records can be', () => {
  test('local only is one place and says so', () => {
    const map = whereData({ localOnly: true, configured: true, escrowed: true });
    assert.length(map.places, 1);
    assert.ok(map.localOnly);
    assert.includes(map.summary, 'Nothing leaves this device');
  });

  test('a configured install names the Sheet and the Drive', () => {
    const map = whereData({ configured: true });
    const where = map.places.map((p) => p.where);
    assert.includes(where, 'Your Google Sheet');
    assert.includes(where, 'Your Google Drive');
  });

  test('an escrowed key is listed as a warning, not as another copy', () => {
    // It is not a copy of the data. It is the thing that opens all of it,
    // which is worse, and the list should not read as though it were the same.
    const key = whereData({ configured: true, escrowed: true }).places.find((p) => p.warn);
    assert.ok(key);
    assert.includes(key.what.toLowerCase(), 'anyone who can sign in as you');
  });

  test('an unconfigured install is not called safe', () => {
    // Nothing leaving yet is not the same promise as nothing being able to.
    const map = whereData({ configured: false });
    assert.includes(map.summary, 'nothing stops it being');
  });

  test('mailboxes are named as read, never written', () => {
    const mail = whereData({ configured: true, mailboxes: 2 }).places.at(-1);
    assert.includes(mail.where, '2 mailboxes');
    assert.includes(mail.what, 'never written to');
  });
});

/* --------------------------------------------------------- the enforcement */

describe('local-only actually stops the sync', () => {
  test('a configured transport is not used when the switch is on', async () => {
    // The check has to be before the transport, not after: a household that
    // set up Google and later changed their mind must stop syncing without
    // having to unpick the configuration.
    const transport = new FakeTransport({});
    const engine = new SyncEngine({ db: fakeDb(), transport });

    configure({ localOnly: true });
    const result = await engine.run();

    assert.equal(result.skipped, 'local-only');
    assert.length(transport.calls, 0, 'something was sent anyway');
    configure({ localOnly: false });
  });

  test('turning it off lets the sync reach the transport again', async () => {
    const transport = new FakeTransport({});
    const engine = new SyncEngine({ db: fakeDb(), transport });

    configure({ localOnly: false });
    const result = await engine.run();
    assert.not(result.skipped === 'local-only');
  });

  test('it is off by default, because a backup nobody has is how records are lost', () => {
    configure({ localOnly: false });
    assert.not(config().localOnly);
  });
});

/** Just enough database for the engine to decide it has nothing to do. */
function fakeDb() {
  const noop = async () => [];
  return {
    deviceId: 'test',
    meta: async () => null,
    setMeta: async () => {},
    adapter: { query: noop, write: async () => {}, remove: async () => {} },
    repo: () => ({ list: noop }),
    keyring: { key: null },
  };
}
