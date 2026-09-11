/**
 * The harness, which judges every other check and was judged by nothing.
 *
 * `assert.throws` was `async`, so it always returned a promise. A synchronous
 * test body calling it without `await` returned `undefined`, `runAll`'s
 * `await item.fn()` resolved, and the check was recorded as **passing** — then
 * the rejected promise surfaced unhandled and ended the process before any
 * tally printed.
 *
 * Five checks sat in that state and every one asserted a *refusal*: the
 * keyring handing out a key while locked, `assertCan` on a child's write, the
 * backend admitting a non-member twice over, and the unlock limiter locking
 * out. Disabling the limiter and swallowing the rejection, the suite said:
 *
 *     [swallowed unhandled rejection] expected a throw
 *     FAIL  security › attempt limiting › the lockout doubles each round
 *     FAIL  security › attempt limiting › the lockout survives a reload
 *
 * The test named for that break passed. Its neighbours, which use
 * `assert.equal`, were the only things that noticed.
 *
 * These are the checks that would have said so.
 */

import {
  test, describe, assert, setSuite, AssertionError, settlePending, runCheck,
} from './harness.mjs';

setSuite('harness');

/** Whether `fn` threw synchronously — the property the five call sites need. */
function threwNow(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('an assertion about a synchronous refusal', () => {
  test('fails the moment the refusal does not happen', () => {
    // The whole defect in one line. Before, this returned a rejected promise
    // and the calling test was recorded as passing.
    const err = threwNow(() => assert.throws(() => 'no refusal here'));

    assert.ok(err instanceof AssertionError, 'the failure did not arrive synchronously');
    assert.includes(err.message, 'no error thrown');
  });

  test('and does not hand back a promise for anyone to forget', () => {
    // A returned promise is what made the failure invisible, so the sync path
    // must not produce one even when it succeeds.
    const back = assert.throws(() => { throw new Error('refused'); });
    assert.not(typeof back?.then === 'function', 'the sync path still returns a thenable');
    assert.equal(back.message, 'refused');
  });

  test('a refusal with the wrong reason still fails, and still now', () => {
    const err = threwNow(() => assert.throws(() => { throw new Error('some other fault'); }, 'locked'));
    assert.ok(err instanceof AssertionError);
    assert.includes(err.message, 'wrong error');
  });

  test('and one with the right reason passes', () => {
    assert.equal(threwNow(() => assert.throws(() => { throw new Error('locked out'); }, 'locked')), null);
  });
});

describe('an assertion about a refusal that has not happened yet', () => {
  test('is still a promise, because nothing can know synchronously', async () => {
    const back = assert.throws(async () => { throw new Error('refused later'); });
    assert.ok(typeof back?.then === 'function', 'an async subject cannot be judged now');
    assert.equal((await back).message, 'refused later');
  });

  test('and one nobody awaited is reported against the test that forgot', async () => {
    /*
     * The half the synchronous fix cannot reach. Fixing five call sites fixes
     * five tests and nothing about the sixth; this is what makes the sixth
     * fail loudly instead of ending the run.
     *
     * Deliberately not awaited — that is the fault being reproduced.
     */
    assert.throws(async () => 'this one does not refuse anything');

    const forgotten = await settlePending();
    assert.ok(forgotten instanceof AssertionError, 'a forgotten assertion was lost');
    assert.includes(forgotten.message, 'no error thrown');
  });

  test('and a satisfied one leaves nothing behind', async () => {
    assert.throws(async () => { throw new Error('refused'); });
    assert.equal(await settlePending(), null);
  });
});

describe('the runner asking what a forgotten assertion decided', () => {
  /*
   * `settlePending` working and the runner *calling* it are two things, and
   * only the second one saves a run. Driving the function directly proves the
   * function; the mutation ratchet refused to call the control held until a
   * check drove `runCheck`, which is the wiring.
   */
  test('turns a forgotten assertion into a failure of the test that forgot', async () => {
    const outcome = await runCheck({
      suite: 'pretend',
      name: 'forgets to await a refusal that never comes',
      fn: () => { assert.throws(async () => 'nothing is refused here'); },
    });

    assert.not(outcome.ok, 'the runner recorded a pass for a check that failed');
    assert.ok(outcome.err instanceof AssertionError);
    assert.includes(outcome.err.message, 'no error thrown');
    assert.includes(outcome.label, 'forgets to await');
  });

  test('and leaves a satisfied one alone', async () => {
    const outcome = await runCheck({
      suite: 'pretend',
      name: 'awaits nothing but asserts a real refusal',
      fn: () => { assert.throws(async () => { throw new Error('refused'); }); },
    });
    assert.ok(outcome.ok, outcome.err?.message);
  });

  test('and does not carry one test\'s leftovers into the next', async () => {
    // Without the drain on the failure path, the next check inherits a
    // rejection it did not cause and is failed for somebody else's fault.
    await runCheck({
      suite: 'pretend',
      name: 'fails outright and leaves an assertion outstanding',
      fn: () => {
        assert.throws(async () => 'nothing is refused here');
        throw new Error('and then fails for its own reasons');
      },
    });

    const next = await runCheck({ suite: 'pretend', name: 'innocent', fn: () => {} });
    assert.ok(next.ok, `the next check inherited: ${next.err?.message}`);
  });
});
