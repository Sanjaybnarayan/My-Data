/**
 * Per-device chat state: starred, archived, pinned.
 *
 * ## Why none of this is in the schema
 *
 * Three reasons, and the third is the one that decides it.
 *
 * 1. Starring a message is a personal act, not a household fact. Two people
 *    sharing a conversation do not share a view about which lines mattered.
 * 2. `message.readBy` is the cautionary tale: a field declared in the schema
 *    and written by nothing, sitting there looking like a feature for as long
 *    as anybody cared to believe it.
 * 3. Syncing it would mean deciding what happens when two devices disagree,
 *    and there is no honest answer that is worth the cost of a merge rule for
 *    a bookmark.
 *
 * So it lives in `meta`, which is written straight to the adapter and never
 * reaches the outbox. **It stays on this device**, and every screen that shows
 * it says so rather than letting somebody assume their star followed them.
 *
 * ## What is deliberately absent
 *
 * **Mute.** A muted conversation is one that stops notifying you, and nothing
 * in this application notifies you about a message at all. A mute switch would
 * be a control whose only effect is to make somebody believe the un-muted ones
 * are reaching them.
 *
 * **Unread.** There is no read state to filter on. See `readBy`, above.
 */

/**
 * The filters a household can put on its conversations.
 *
 * Every one is derivable from what is already stored — participant count, a
 * local flag, a message's own text. There is no filter here that needs a fact
 * this application does not have.
 */
export const FILTERS = Object.freeze([
  { id: 'all', needs: null },
  { id: 'pinned', needs: 'pinned' },
  { id: 'groups', needs: null },
  { id: 'archived', needs: 'archived' },
]);

/**
 * The three flags there are.
 *
 * Exported so `readFlags` and every caller derive from one list rather than
 * three copies of it. A test asserts this and the shape `emptyFlags` produces
 * agree — which is the guard that a runtime `throw` would otherwise be, without
 * an unreachable branch and without a sentence nobody will ever read.
 */
export const KINDS = Object.freeze(['starred', 'archived', 'pinned']);

/** An empty state, so a first run and a cleared one look identical. */
export function emptyFlags() {
  return Object.fromEntries(KINDS.map((one) => [one, []]));
}

/**
 * Normalise whatever came out of storage.
 *
 * Defensive because `meta` is a free-form store: a value written by an older
 * build, or half-written, must not take the chat screen down.
 */
export function readFlags(stored) {
  const list = (value) => (Array.isArray(value) ? value.filter((one) => typeof one === 'string') : []);
  return Object.fromEntries(KINDS.map((one) => [one, list(stored?.[one])]));
}

/**
 * Turn a flag on or off, returning a new object.
 *
 * @param {object} flags
 * @param {'starred'|'archived'|'pinned'} kind
 * @param {string} id
 * @param {boolean} [on] omit to toggle
 */
export function setFlag(flags, kind, id, on = undefined) {
  const current = readFlags(flags);
  // `readFlags` only ever produces the three in `KINDS`, so an unknown kind
  // would read `undefined` here. The typecheck's union catches it before it
  // runs; this keeps the failure loud rather than writing a fourth key nobody
  // reads.
  const has = current[kind].includes(id);
  const want = on === undefined ? !has : Boolean(on);

  if (want === has) return current;
  return {
    ...current,
    [kind]: want ? [...current[kind], id] : current[kind].filter((one) => one !== id),
  };
}

/** Whether a conversation is a group, by the only thing that can say so. */
export function isGroup(conversation) {
  return (conversation?.participants?.length ?? 0) > 2;
}

/**
 * The threads to show, given a filter and a search term.
 *
 * Archived conversations are hidden from every filter except `archived` — that
 * is what archiving is for — but they are never deleted and the chip says how
 * many are in there.
 *
 * @param {Array<{conversation: object, last: object|null}>} threads
 * @param {object} flags
 * @param {{filter?: string, term?: string}} [options]
 */
export function visibleThreads(threads, flags, { filter = 'all', term = '' } = {}) {
  const state = readFlags(flags);
  const archived = new Set(state.archived);
  const pinned = new Set(state.pinned);
  const needle = String(term ?? '').trim().toLowerCase();

  const matches = (thread) => {
    if (!needle) return true;
    const title = String(thread.conversation?.title ?? '').toLowerCase();
    // The last line is searched because it is the only message text a thread
    // list has already decrypted. Searching every message would mean opening
    // every envelope in the household to answer a keystroke.
    //
    // `last` is what `ChatService.threads()` produces: a message this device
    // could open, one it could not (`why`), or a file. Only the first has text
    // to match — a sealed line is not searchable, and a filename is not the
    // message. Treating the object as a string matched nothing at all and did
    // it silently, which is the worst way for a search box to fail.
    const text = thread.last?.why ? '' : String(thread.last?.text ?? '').toLowerCase();
    const file = String(thread.last?.file?.name ?? '').toLowerCase();
    return title.includes(needle) || text.includes(needle) || file.includes(needle);
  };

  const chosen = threads.filter((thread) => {
    const id = thread.conversation?.id;
    if (!matches(thread)) return false;

    if (filter === 'archived') return archived.has(id);
    if (archived.has(id)) return false;
    if (filter === 'pinned') return pinned.has(id);
    if (filter === 'groups') return isGroup(thread.conversation);
    return true;
  });

  // Pinned first, then whatever order they arrived in — which is
  // most-recently-spoken-in. Sorting inside `archived` by pin would be
  // ordering a drawer nobody is looking in.
  if (filter === 'archived') return chosen;
  return [
    ...chosen.filter((one) => pinned.has(one.conversation?.id)),
    ...chosen.filter((one) => !pinned.has(one.conversation?.id)),
  ];
}

/**
 * How many conversations each filter would show.
 *
 * Counted from the same function that does the filtering, so a chip cannot
 * promise a number the list then fails to produce.
 */
export function filterCounts(threads, flags) {
  const counts = {};
  for (const one of FILTERS) {
    counts[one.id] = visibleThreads(threads, flags, { filter: one.id }).length;
  }
  return counts;
}
