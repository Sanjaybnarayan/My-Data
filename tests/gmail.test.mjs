import { test, describe, assert, setSuite } from './harness.mjs';
import { backend } from './appsscript.mjs';
import { isSenderQuery, searchQuery } from '../js/domain/merchants.js';
import { GmailClient } from '../js/sync/gmail.js';

setSuite('gmail');

const OWNER = 'owner@example.com';
const SPOUSE = 'spouse@example.com';

const tokens = {
  'owner-token': { email: OWNER, aud: 'test-client', exp: 9e9 },
  'spouse-token': { email: SPOUSE, aud: 'test-client', exp: 9e9 },
};

const household = (members = [], mail = []) => backend({
  owner: OWNER,
  tokens,
  mail,
  properties: { members: JSON.stringify(members), workbookId: 'book-1' },
});

const ask = (api, token, query) =>
  api.post('mail', token, { query, limit: 10 }, { deviceId: 'd1' });

/**
 * One table, two implementations.
 *
 * The guard on both mail routes was `query.includes('from:')`. A substring is
 * not a constraint: `from:me OR is:unread` contains `from:` and asks Gmail for
 * the whole mailbox, and so does `(from:a.com) subject:password`. Reading mail
 * needs a scope that can read all of it — Gmail has no per-sender permission —
 * so the query *is* the limit, and the limit could be stepped over by typing
 * four characters.
 *
 * The privacy argument above `searchQuery` in `js/domain/merchants.js` was
 * true of what this application *builds* and was never true of what either
 * route would *accept*. That is the gap: not a query anybody was sending, but
 * a sentence the household is asked to trust which the code did not keep.
 *
 * The grammar is written twice because the two routes share no runtime — one
 * is a browser module, the other is Apps Script loaded as text. So the same
 * table runs through both, and a copy that drifts fails here rather than in a
 * mailbox.
 */
/** @type {[string, boolean][]} */
const QUERIES = [
  // What `searchQuery` builds, which must keep working.
  ['(from:zomato.com OR from:swiggy.in) after:2026/01/01 -in:trash -in:spam', true],
  // What the receipts screen probes a connection with.
  ['from:example.com', true],
  ['(from:shop.co.uk)', true],
  ['(from:bills@shop.com) newer_than:90d', true],

  // `OR` joining a sender to something that is not one — the whole mailbox.
  ['from:me OR is:unread', false],
  ['(from:a.com) OR is:unread', false],
  ['(from:a.com OR is:unread)', false],
  // A term that widens rather than narrows.
  ['(from:a.com) subject:password', false],
  ['(from:a.com) in:trash', false],
  // A bare word in a Gmail query is a body search across everything.
  ['invoice from:a.com', false],
  ['(from:a.com) salary', false],
  // No sender at all.
  ['is:unread', false],
  ['', false],
];

describe('what counts as a mail search for a list of shops', () => {
  test('the browser route accepts exactly the queries it should', () => {
    for (const [query, allowed] of QUERIES) {
      assert.equal(isSenderQuery(query), allowed, `isSenderQuery(${JSON.stringify(query)})`);
    }
  });

  test('the backend route agrees, query for query', () => {
    // Driven through `doPost` rather than by calling the function, so what is
    // measured is what a request reaches — the fault this file exists for was
    // a guard that the dispatch walked past.
    const api = household([], [{ from: 'shop@zomato.com', plainBody: 'Total ₹420' }]);

    for (const [query, allowed] of QUERIES) {
      const body = ask(api, 'owner-token', query);
      assert.equal(body.ok, allowed, `the backend disagreed about ${JSON.stringify(query)}`);
      if (!allowed) assert.equal(body.status, 400);
    }

    // Every refusal stopped before Gmail. A guard that refuses after asking
    // has already read the mailbox, which is the thing being prevented.
    const allowed = QUERIES.filter(([, ok]) => ok).length;
    assert.equal(api.searched.length, allowed,
      'a refused query reached Gmail anyway');
  });

  test('the browser route refuses before it reaches Google', async () => {
    // The browser route holds the household's own Gmail token, so a query it
    // passes on is a query Google answers. Asserting the refusal alone would
    // not show that: a guard that throws after the fetch has already read the
    // mailbox it was there to keep shut.
    const asked = [];
    const client = new GmailClient({
      getToken: async () => 'tok',
      // Cast for the same reason `tests/inbox.test.mjs` casts its own: a stub
      // answering the two shapes this client reads is not a `Response`.
      fetchImpl: /** @type {any} */ (async (/** @type {string} */ url) => {
        asked.push(url);
        return { ok: true, status: 200, text: async () => '', json: async () => ({ messages: [] }) };
      }),
    });

    for (const [query, allowed] of QUERIES) {
      if (allowed) continue;
      await assert.throws(() => client.mail(query), /senders/i);
    }
    assert.equal(asked.length, 0, 'a refused query reached Google anyway');

    // And the shape this application builds still goes through.
    await client.mail('(from:zomato.com) -in:trash');
    assert.equal(asked.length, 1);
  });

  test('the query this application builds passes its own guard', () => {
    // Otherwise the grammar is a rule about a shape nothing produces.
    const built = searchQuery({ since: '2026-01-01' });
    assert.ok(built, 'the merchant registry built no query at all');
    assert.ok(isSenderQuery(built), `searchQuery built a query its own guard refuses: ${built}`);
    assert.ok(household().post('mail', 'owner-token', { query: built, limit: 10 },
      { deviceId: 'd1' }).ok, 'the backend refused the query this application builds');
  });
});

/**
 * Who may ask.
 *
 * `gmailSearch` took a `context` and spent it on a log line — the same fault
 * `driveUpload` had, in the same shape, one file over. So any member the
 * household had ever added, at any role, could search the owner's mailbox: a
 * child, a guest, a member of staff. Nothing in the response would have said
 * so, and the entry in the log names the caller as though it had been checked.
 *
 * `transaction` is the entity this mail becomes, so its ACL decides — the rule
 * `driveAllows` already applies to `document`. Searching is a read and is
 * checked as one, the mapping `driveDownload` uses.
 */
describe('who may search the household mail', () => {
  const QUERY = '(from:zomato.com) -in:trash';

  test('a role that cannot read a transaction cannot read the mail', () => {
    for (const role of ['child', 'guest', 'staff']) {
      const api = household([{ email: SPOUSE, role, personId: 'p-asha' }]);
      const body = ask(api, 'spouse-token', QUERY);
      assert.not(body.ok, `a ${role} searched the owner's mailbox`);
      assert.equal(body.status, 403, `a ${role} was refused for the wrong reason`);
      assert.equal(api.searched.length, 0, `a ${role}'s query reached Gmail anyway`);
    }
  });

  test('an adult files receipts as they did before', () => {
    // The other direction, and the reason the guard is a read rather than a
    // write: an adult may read transactions, and gating this any tighter would
    // take away something that worked.
    const api = household(
      [{ email: SPOUSE, role: 'adult', personId: 'p-asha' }],
      [{ from: 'shop@zomato.com', plainBody: 'Total ₹420' }],
    );

    const body = ask(api, 'spouse-token', QUERY);
    assert.ok(body.ok, body.error);
    assert.equal(body.data.messages.length, 1);
    assert.equal(api.searched[0].query, QUERY);
  });

  test('the owner is not a special case', () => {
    const api = household([], [{ from: 'shop@zomato.com', plainBody: 'Total ₹99' }]);
    assert.ok(ask(api, 'owner-token', QUERY).ok);
  });
});
