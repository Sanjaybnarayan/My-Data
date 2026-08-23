import { test, describe, assert, setSuite } from './harness.mjs';
import {
  STEP, WHAT_IT_DOES_NOT_DO, addressLooksSendable, codeLooksComplete,
  advance, start, canSubmit,
} from '../js/domain/otp.js';
import { PUBLIC_ACTIONS } from '../js/sync/transport.js';
import { strings } from '../js/locale/en.js';

setSuite('otpflow');

describe('the two lists of public actions', () => {
  test('the client will not send anything else without a token', () => {
    /*
     * The server has its own list, in `Otp.gs`. Both exist on purpose: a
     * client that could ask for any action unauthenticated is a client that
     * invites the server to be wrong about which ones are safe.
     */
    assert.deep([...PUBLIC_ACTIONS], ['otp.request', 'otp.verify']);
  });
});

describe('what a screen is made to say', () => {
  test('every limitation has a line in the catalogue', () => {
    // The sentences are named here so a screen renders these rather than
    // writing something shorter and warmer that implies a code is a lock.
    for (const key of WHAT_IT_DOES_NOT_DO) {
      assert.equal(typeof strings[key], 'string', `${key} is missing`);
      assert.equal(strings[key].length > 20, true, `${key} is too short to say anything`);
    }
  });

  test('and one of them says plainly that it unlocks nothing', () => {
    const said = WHAT_IT_DOES_NOT_DO.map((key) => strings[key]).join(' ');
    assert.equal(/does not unlock|unlocks nothing|not what protects/i.test(said), true, said);
  });
});

describe('an address worth sending to', () => {
  test('an email needs a shape an email has', () => {
    assert.equal(addressLooksSendable('asha@example.com', 'email'), true);
    assert.equal(addressLooksSendable('asha@example', 'email'), false);
    assert.equal(addressLooksSendable('asha', 'email'), false);
    assert.equal(addressLooksSendable('', 'email'), false);
  });

  test('a number is judged on digits, because people type spaces and plus signs', () => {
    assert.equal(addressLooksSendable('+91 98765 00000', 'sms'), true);
    assert.equal(addressLooksSendable('98765', 'sms'), false);
    assert.equal(addressLooksSendable('1'.repeat(16), 'sms'), false);
  });

  test('this only catches the typo a person can see', () => {
    // Whether an address belongs to anybody is the server's question, and it
    // answers the same either way. A client that decided would be leaking the
    // household's directory to whoever opened the console.
    assert.equal(addressLooksSendable('stranger@example.com', 'email'), true);
  });
});

describe('a code', () => {
  test('is six digits and nothing else', () => {
    assert.equal(codeLooksComplete('123456'), true);
    assert.equal(codeLooksComplete('12345'), false);
    assert.equal(codeLooksComplete('1234567'), false);
    assert.equal(codeLooksComplete('12345a'), false);
    assert.equal(codeLooksComplete(''), false);
  });
});

describe('the flow', () => {
  test('starts on the address step with nothing filled in', () => {
    const state = start();
    assert.equal(state.step, STEP.address);
    assert.equal(state.address, '');
    assert.equal(state.personId, null);
  });

  test('changing channel clears the address', () => {
    // A phone number left in the box after switching to email is a code
    // nobody receives and ten minutes of somebody waiting for it.
    const typed = advance(start(), { type: 'address', address: '+919876500000' });
    const switched = advance(typed, { type: 'channel', channel: 'email' });
    assert.equal(switched.address, '');
    assert.equal(switched.channel, 'email');
  });

  test('a failure does not advance, and does not throw the step away either', () => {
    /*
     * Dropping back to the address step on a wrong code would discard a code
     * that is still valid and charge the rate limit for another — which is
     * the failure mode that makes people give up on a sign-in.
     */
    const waiting = advance(advance(start(),
      { type: 'address', address: 'asha@example.com' }), { type: 'sent' });

    const failed = advance(waiting, { type: 'failed', error: 'that code is not right' });
    assert.equal(failed.step, STEP.code, 'a wrong code sent the person back to the start');
    assert.equal(failed.error, 'that code is not right');
  });

  test('verifying takes the person from the answer, not from the address', () => {
    // A screen that filled this in from what it already had would be trusting
    // itself about the one fact the server is there to establish.
    const waiting = advance(start(), { type: 'sent' });
    const done = advance(waiting, { type: 'verified', personId: 'p1' });

    assert.equal(done.step, STEP.done);
    assert.equal(done.personId, 'p1');

    const anonymous = advance(waiting, { type: 'verified' });
    assert.equal(anonymous.personId, null, 'a person was invented from nothing');
  });

  test('restarting keeps the channel and forgets everything else', () => {
    const messy = /** @type {any} */ (
      { step: STEP.code, channel: 'sms', address: '+91', error: 'no', personId: 'p1' });
    const again = advance(messy, { type: 'restart' });
    assert.equal(again.channel, 'sms');
    assert.equal(again.address, '');
    assert.equal(again.personId, null);
    assert.equal(again.error, null);
  });

  test('an event nothing knows about changes nothing', () => {
    const state = start();
    assert.deep(advance(state, { type: 'nonsense' }), state);
  });
});

describe('when the button works', () => {
  test('not until the address could be sent to', () => {
    const state = start();
    assert.equal(canSubmit(state), false);
    assert.equal(canSubmit({ ...state, address: 'asha@example.com' }), true);
  });

  test('and not until the code is complete', () => {
    const waiting = { ...start(), step: STEP.code };
    assert.equal(canSubmit(waiting, '12345'), false);
    assert.equal(canSubmit(waiting, '123456'), true);
  });

  test('and never once it is done', () => {
    assert.equal(canSubmit({ ...start(), step: STEP.done }, '123456'), false);
  });
});
