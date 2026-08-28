import { test, describe, assert, setSuite } from './harness.mjs';
import {
  KINDS, emptyFlags, readFlags, setFlag, isGroup, visibleThreads, filterCounts, FILTERS,
} from '../js/domain/chatstate.js';

setSuite('chatstate');

const thread = (id, title, { last = null, people = 2 } = {}) => ({
  conversation: { id, title, participants: Array.from({ length: people }, (_, i) => `p${i}`) },
  last,
  at: '2026-08-01T10:00:00Z',
});

const THREADS = [
  thread('a', 'Household', { last: { text: 'Rent is paid' } }),
  thread('b', 'Parents', { last: { text: 'Call on Sunday' }, people: 3 }),
  thread('c', 'Plumber', { last: { why: 'sentBefore' } }),
  thread('d', 'Receipts', { last: { file: { name: 'invoice.pdf' } } }),
];

describe('the three flags', () => {
  test('are one list, not three copies of it', () => {
    // The guard that replaced a runtime throw: if somebody adds a fourth kind
    // to `KINDS` and not to the shape, or the other way round, this fails.
    assert.deep(Object.keys(emptyFlags()).sort(), [...KINDS].sort());
    assert.deep(Object.keys(readFlags(null)).sort(), [...KINDS].sort());
  });

  test('survive whatever was in storage', () => {
    // `meta` is free-form. A value from an older build must not take the chat
    // screen down.
    assert.deep(readFlags(undefined), emptyFlags());
    assert.deep(readFlags('nonsense'), emptyFlags());
    assert.deep(readFlags({ starred: 'not a list' }), emptyFlags());
    assert.deep(readFlags({ starred: ['m1', 7, null] }).starred, ['m1']);
  });

  test('toggle, and set explicitly', () => {
    const once = setFlag(emptyFlags(), 'pinned', 'a');
    assert.deep(once.pinned, ['a']);
    assert.deep(setFlag(once, 'pinned', 'a').pinned, []);

    // Explicit `on` is idempotent, which is what a checkbox needs.
    assert.deep(setFlag(once, 'pinned', 'a', true).pinned, ['a']);
    assert.deep(setFlag(once, 'pinned', 'a', false).pinned, []);
  });

  test('and do not disturb each other', () => {
    const flags = setFlag(setFlag(emptyFlags(), 'pinned', 'a'), 'archived', 'b');
    assert.deep(flags.pinned, ['a']);
    assert.deep(flags.archived, ['b']);
    assert.deep(flags.starred, []);
  });
});

describe('what a group is', () => {
  test('more than two people, because nothing else can say', () => {
    assert.equal(isGroup({ participants: ['p0', 'p1', 'p2'] }), true);
    assert.equal(isGroup({ participants: ['p0', 'p1'] }), false);
    assert.equal(isGroup({}), false);
  });
});

describe('which conversations show', () => {
  test('archived ones are hidden everywhere except the archive', () => {
    const flags = setFlag(emptyFlags(), 'archived', 'a');

    const all = visibleThreads(THREADS, flags).map((one) => one.conversation.id);
    assert.equal(all.includes('a'), false, 'an archived conversation was still listed');

    const archived = visibleThreads(THREADS, flags, { filter: 'archived' })
      .map((one) => one.conversation.id);
    assert.deep(archived, ['a']);
  });

  test('pinned ones come first, and the rest keep their order', () => {
    const flags = setFlag(emptyFlags(), 'pinned', 'c');
    assert.deep(visibleThreads(THREADS, flags).map((one) => one.conversation.id),
      ['c', 'a', 'b', 'd']);
  });

  test('groups are the ones with more than two people', () => {
    assert.deep(visibleThreads(THREADS, emptyFlags(), { filter: 'groups' })
      .map((one) => one.conversation.id), ['b']);
  });

  test('search matches a title', () => {
    assert.deep(visibleThreads(THREADS, emptyFlags(), { term: 'plumb' })
      .map((one) => one.conversation.id), ['c']);
  });

  test('and the last message, when this device could open it', () => {
    // Not "rent": that is also inside "Parents", and the check would have been
    // passing on a title match while claiming to prove a body match.
    assert.deep(visibleThreads(THREADS, emptyFlags(), { term: 'paid' })
      .map((one) => one.conversation.id), ['a']);
  });

  test('and a term inside a title matches that title', () => {
    assert.deep(visibleThreads(THREADS, emptyFlags(), { term: 'rent' })
      .map((one) => one.conversation.id), ['a', 'b']);
  });

  test('and a filename, because that is what the row shows', () => {
    assert.deep(visibleThreads(THREADS, emptyFlags(), { term: 'invoice' })
      .map((one) => one.conversation.id), ['d']);
  });

  test('a message this device cannot open is not searchable, and stays quiet', () => {
    /*
     * `last` for a sealed message is `{why}` with no text. An earlier version
     * read the whole object as a string, so every search matched nothing and
     * said so as though the household had no such conversation.
     */
    const sealed = visibleThreads(THREADS, emptyFlags(), { term: 'sentBefore' });
    assert.length(sealed, 0, 'the reason a message could not be opened was searchable');
  });

  test('an empty term matches everything rather than nothing', () => {
    assert.length(visibleThreads(THREADS, emptyFlags(), { term: '   ' }), 4);
  });
});

describe('the chip counts', () => {
  test('are produced by the same function that does the filtering', () => {
    // A chip promising a number the list then fails to produce is the screen
    // disagreeing with itself.
    const flags = setFlag(setFlag(emptyFlags(), 'archived', 'a'), 'pinned', 'b');
    const counts = filterCounts(THREADS, flags);

    for (const one of FILTERS) {
      assert.equal(counts[one.id], visibleThreads(THREADS, flags, { filter: one.id }).length,
        one.id);
    }
    assert.equal(counts.archived, 1);
    assert.equal(counts.all, 3, 'the archived one was counted in All');
  });

  test('there is no unread filter, because there is no read state', () => {
    // `message.readBy` is declared in the schema and written by nothing. A
    // chip for it would be a promise made out of an empty field.
    assert.equal(FILTERS.some((one) => /unread/i.test(one.id)), false);
  });
});
