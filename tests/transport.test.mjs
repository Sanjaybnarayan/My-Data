/**
 * The request the backend actually receives.
 *
 * `FakeTransport` was tested and `AppsScriptTransport` was not, so the shape of
 * the body — the contract between the browser and `apps-script/Code.gs` — was
 * pinned nowhere. A mutation that stopped sending the device label survived the
 * whole suite, which is how this file came to exist.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { AppsScriptTransport } from '../js/sync/transport.js';

setSuite('transport');

/** A fetch that records the request and answers with the backend's envelope. */
function recorder(reply = { ok: true, data: {} }) {
  const sent = [];
  const impl = async (url, options = {}) => {
    sent.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return {
      ok: true,
      status: 200,
      json: async () => reply,
      text: async () => JSON.stringify(reply),
    };
  };
  return { sent, impl: /** @type {any} */ (impl) };
}

const make = (over = {}) => {
  const rec = recorder();
  const transport = new AppsScriptTransport({
    url: 'https://script.example/exec',
    getToken: async () => 'tok',
    fetchImpl: rec.impl,
    deviceId: 'dev_phone',
    deviceLabel: 'iPhone · Safari',
    clientVersion: '4.1',
    ...over,
  });
  return { rec, transport };
};

describe('what every request carries', () => {
  test('the device it came from, and what to call it', async () => {
    // The backend registers the device on every request and shows the label to
    // whoever is deciding which phone to sign out. Not sending it leaves them
    // choosing between opaque ids.
    const { rec, transport } = make();
    await transport.verify();

    assert.length(rec.sent, 1);
    assert.equal(rec.sent[0].body.deviceId, 'dev_phone');
    assert.equal(rec.sent[0].body.deviceLabel, 'iPhone · Safari');
    assert.equal(rec.sent[0].body.clientVersion, '4.1');
  });

  test('the action and the token', async () => {
    const { rec, transport } = make();
    await transport.verify();
    assert.equal(rec.sent[0].body.action, 'verify');
    assert.equal(rec.sent[0].body.token, 'tok');
  });

  test('with no label configured it sends an empty one, not undefined', async () => {
    // `String(undefined)` on the far side is the word "undefined", which would
    // be shown to a household as the name of their phone.
    const { rec, transport } = make({ deviceLabel: undefined });
    await transport.verify();
    assert.equal(rec.sent[0].body.deviceLabel, '');
  });
});

describe('the device actions', () => {
  test('listing asks for the list', async () => {
    const { rec, transport } = make();
    await transport.devices();
    assert.equal(rec.sent[0].body.action, 'devices');
    assert.deep(rec.sent[0].body.payload, { op: 'list' });
  });

  test('an email is only sent when one is given', async () => {
    // Sending `email: undefined` would make every request look like a request
    // about somebody else, which the backend refuses unless you are the owner.
    const { rec, transport } = make();
    await transport.devices();
    assert.not('email' in rec.sent[0].body.payload, JSON.stringify(rec.sent[0].body.payload));

    await transport.devices('spouse@example.com');
    assert.equal(rec.sent[1].body.payload.email, 'spouse@example.com');
  });

  test('ping actually asks the backend, which is where the count comes from', () => {
    // A `ping` that resolved locally would report no unrecognised devices for
    // ever, and the notice at boot would go quiet rather than wrong — the
    // failure mode nobody notices.
    const { rec, transport } = make();
    return transport.ping().then(() => {
      assert.length(rec.sent, 1);
      assert.equal(rec.sent[0].body.action, 'ping');
    });
  });

  test('revoke, restore and rename each name themselves', async () => {
    const { rec, transport } = make();
    await transport.revokeDevice('dev_old');
    await transport.restoreDevice('dev_old');
    await transport.nameDevice('dev_old', 'the one in the study');

    await transport.acknowledgeDevice('dev_old');

    assert.deep(rec.sent.map((call) => call.body.payload.op),
      ['revoke', 'restore', 'name', 'acknowledge']);
    assert.equal(rec.sent[2].body.payload.label, 'the one in the study');
  });
});
