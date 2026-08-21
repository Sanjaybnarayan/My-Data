import { test, describe, assert, setSuite } from './harness.mjs';
import { served, called, drift } from '../tools/api-contract.mjs';

setSuite('the backend contract');

describe('what each side knows about the other', () => {
  test('every action the application calls is one the backend serves', () => {
    // The failure this prevents is not subtle: the client and the Apps Script
    // backend deploy separately, so a call the deployed backend has never heard
    // of comes back as `unknown action` and a 400, once, in a household's face.
    const { unserved } = drift();
    assert.length(unserved, 0,
      `called but not served: ${unserved.join(', ')}`);
  });

  test('and every action the backend serves is one something calls', () => {
    // The other direction is dead weight rather than a failure, but a backend
    // growing endpoints nobody uses is how a surface stops being reviewable.
    const { uncalled } = drift();
    assert.length(uncalled, 0,
      `served but never called: ${uncalled.join(', ')}`);
  });

  test('the backend really does serve a list, not an empty one', () => {
    // If the dispatch function were renamed, `served()` would return nothing
    // and both checks above would pass vacuously — every call would be
    // "unserved" only if the client list were also empty. This is what stops
    // the pair of them agreeing about nothing.
    assert.ok(served().length > 10, `only ${served().length} actions parsed from Code.gs`);
    assert.includes(served(), 'push');
    assert.includes(served(), 'pull');
  });

  test('and the application really does call them', () => {
    const client = called();
    assert.ok(client.size > 10, `only ${client.size} actions found in the client`);
    assert.ok(client.get('push')?.size > 0, 'nothing was found calling push');
  });

  test('drift is reported in both directions when it exists', () => {
    // Produced on purpose, because a check that cannot fail is worse than none.
    const fake = new Map([['push', new Set(['js/sync/engine.js'])],
      ['invented', new Set(['js/sync/engine.js'])]]);
    const both = drift(['push', 'forgotten'], fake);

    assert.deep(both.unserved, ['invented']);
    assert.deep(both.uncalled, ['forgotten']);
  });
});
