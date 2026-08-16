/**
 * An afternoon of tidying up, as one line instead of eight.
 *
 * ## What the activity feed said
 *
 * Measured against six edits to one account and one to another, which is a
 * perfectly ordinary afternoon:
 *
 *     Sanjay changed name on an account
 *     Sanjay added an account
 *     Sanjay changed notes on an account
 *     Sanjay changed dueDay on an account
 *     Sanjay changed statementDay on an account
 *     Sanjay changed upiId on an account
 *     Sanjay changed ifsc on an account
 *     Sanjay changed name on an account
 *
 * Eight lines, seven of them the same person and the same record — and **not
 * one of them says which account**. `data/audit.js`'s `describe` knows the
 * entity's label and has no way to reach the record's title, so a household
 * reading their own activity feed learns that an account changed and never
 * which one. Both screens that show the feed have said this since Phase 0.5.
 *
 * ## What a story is
 *
 * One person, one record, one sitting. Six edits to an account between 11:02
 * and 11:09 are one thing that happened, and the fields they touched are the
 * detail. Splitting them into six lines is not more information; it is the
 * same information spread until it stops being readable.
 *
 * A `create` is never folded into an `update` story. "Added, then changed six
 * things" and "changed six things" are different events, and the first is
 * where a record came from.
 *
 * ## What it will not do
 *
 * **It will not say what a value became.** The log records which fields
 * changed and never their values, deliberately — a before-and-after log is a
 * second, unencrypted copy of every sensitive field in the system. A story
 * names the fields and stops there.
 *
 * **It will not claim you have seen something.** `since` takes a mark the
 * caller stored; where there is none, the answer is *recent*, not *new*, and
 * the caller is expected to say which it is showing.
 */

/** Edits by one person to one record inside this window are one sitting. */
export const SITTING_MINUTES = 30;

const at = (entry) => Date.parse(entry?.at ?? '') || 0;

/**
 * Entries after a mark, newest first.
 *
 * A missing mark returns everything rather than nothing: a household opening
 * this for the first time should see their history, not an empty screen
 * claiming nothing has happened.
 */
export function since(entries, mark) {
  const rows = [...(entries ?? [])].sort((a, b) => at(b) - at(a));
  if (!mark) return rows;
  const from = Date.parse(mark) || 0;
  return rows.filter((entry) => at(entry) > from);
}

/**
 * The log, grouped into things that happened.
 *
 * @param {object[]} entries
 * @param {{windowMinutes?: number}} [options]
 */
export function stories(entries, { windowMinutes = SITTING_MINUTES } = {}) {
  const rows = [...(entries ?? [])].sort((a, b) => at(b) - at(a));
  const out = [];

  for (const entry of rows) {
    const last = out.at(-1);

    const sameSitting = last
      && last.action === entry.action
      && last.action === 'update'
      && last.actorId === entry.actorId
      && last.entity === entry.entity
      && last.recordId === entry.recordId
      && last.recordId
      && (at(last.oldest) - at(entry)) <= windowMinutes * 60_000;

    if (sameSitting) {
      last.count += 1;
      last.oldest = entry;
      for (const field of entry.fields ?? []) {
        if (!last.fields.includes(field)) last.fields.push(field);
      }
      continue;
    }

    out.push({
      action: entry.action,
      actorId: entry.actorId,
      entity: entry.entity,
      recordId: entry.recordId,
      at: entry.at,
      oldest: entry,
      count: 1,
      fields: [...(entry.fields ?? [])],
      detail: entry.detail ?? {},
    });
  }

  // `oldest` is the grouping's own bookkeeping and not something a screen
  // should read — it is the entry the window is measured from, which is a
  // different thing from "when this happened".
  return out.map(({ oldest, ...story }) => ({ ...story, from: oldest.at }));
}

const list = (items) => (items.length === 1 ? items[0]
  : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * A story as a sentence, naming the record.
 *
 * `titleOf` resolves a record to what a person calls it. Where it cannot — a
 * record since deleted — the entity's own label stands in, because "an
 * account" is still true and a blank is not.
 */
export function describeStory(story, {
  nameOf = /** @type {(id: string) => string} */ ((id) => id),
  titleOf = /** @type {(entity: string, id: string) => string|null} */ (() => null),
  labelOf = /** @type {(entity: string) => string} */ (() => 'record'),
} = {}) {
  if (!story) return null;

  const who = story.actorId ? nameOf(story.actorId) : 'Someone';
  const label = labelOf(story.entity);
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  const what = titleOf(story.entity, story.recordId) ?? `${article} ${label}`;

  switch (story.action) {
    case 'create': return `${who} added ${what}`;
    case 'delete': return `${who} deleted ${what}`;
    case 'restore': return `${who} restored ${what}`;
    case 'read': return `${who} opened ${what}`;
    case 'update': {
      if (!story.fields.length) return `${who} updated ${what}`;
      // Three names, then a count. A list of eleven field names is a list
      // nobody reads, and the count is the part that says "a lot happened".
      const named = story.fields.slice(0, 3);
      const rest = story.fields.length - named.length;
      const fields = rest ? `${list(named)} and ${rest} more` : list(named);
      return `${who} changed ${fields} on ${what}`;
    }
    default: return `${who} did something to ${what}`;
  }
}
