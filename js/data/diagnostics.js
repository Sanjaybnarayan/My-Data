/**
 * How this device is doing.
 *
 * ## What was measured before this was written
 *
 *     a write failed         : true
 *     is it recorded anywhere: false
 *
 * A refused write threw, the screen showed a message, and the moment somebody
 * dismissed it the fact that anything had gone wrong was gone. Nothing counted
 * failures, nothing noticed a sync that had been failing for a week, and
 * nothing knew the disk was nearly full until a write failed for that reason.
 *
 * ## This is not telemetry, and it is not monitoring
 *
 * Both words are wrong for what this is, and using either would be a claim
 * this application cannot support.
 *
 * **Not telemetry.** Nothing here leaves the device. There is no reporter, no
 * endpoint, no sampling, no "anonymous usage data". An application whose whole
 * premise is *encrypted, on this device* does not get to ship an exception to
 * that premise and call it observability.
 *
 * **Not monitoring.** SOC 2's CC7 assumes somebody is watching — an operator,
 * a pager, an on-call rotation. There is no operator here. The household is
 * the only party who can see this, and only when they open the screen. Nothing
 * alerts, nothing escalates, and nothing aggregates across devices. That is a
 * real limitation and `docs/OBSERVABILITY.md` states it rather than letting
 * the word "observability" imply otherwise.
 *
 * What this *is*: a bounded, redacted, local record of things that went wrong,
 * so a household can answer "has this been failing for a while?" — which
 * previously nothing could.
 *
 * ## Redaction is the whole safety argument
 *
 * An error log is the classic accidental leak. Messages and stack traces carry
 * the values that caused them: amounts, names, account numbers, the very
 * fields encrypted everywhere else in this database. A diagnostics store that
 * quietly accumulated those would be a plaintext copy of the household's
 * records wearing a different hat.
 *
 * So nothing is recorded raw. `redact()` runs on every string before it is
 * stored, and it works by **removing anything that looks like a value** rather
 * than by trying to recognise the sensitive ones — the safe direction, because
 * a pattern nobody thought of then becomes unreadable rather than retained.
 *
 * `tests/diagnostics.test.mjs` drives real failures through the real
 * repository and then walks the store, failing if any value from the record
 * that caused them appears.
 */

const STORE = 'diagnostics';

/** How many events are kept. Oldest are dropped, and the count is reported. */
export const LIMIT = 200;

export const KIND = Object.freeze({
  /** A write, read or parse that threw. */
  error: 'error',
  /** A rule refused something. Not a fault — but a run of them is a signal. */
  refusal: 'refusal',
  /** A sync attempt that did not complete. */
  sync: 'sync',
  /**
   * A connector — Gmail, Drive, Calendar — that could not be read.
   *
   * Its own kind rather than folded into `sync`, because they fail for
   * different reasons and are fixed by different people. A failing sync is
   * usually the backend; a failing connector is usually an authorisation the
   * household has to renew, and the summary groups by kind.
   */
  connector: 'connector',
  /** The device is running out of room. */
  storage: 'storage',
  /**
   * A record arrived from another device pointing at something this one does
   * not have.
   *
   * Its own kind because it is the one entry here that is not a failure. The
   * write path enforces referential integrity and `applyRemote` is exempt on
   * purpose — a pull arrives in whatever order the backend hands rows over, so
   * a transaction can legitimately land before the account it names, and
   * refusing it would drop a row the household really has. `integrity.js` says
   * so and calls it a real weakening.
   *
   * What was missing was anybody finding out. The audit that exists for this
   * runs when somebody presses "Check for broken links" in Settings, which
   * means it runs when they already suspect. This is the same audit, run at
   * the one moment the ordering excuse has expired — after a pull has finished
   * — so the household is told rather than discovering it on a screen that
   * says "unknown".
   */
  reference: 'reference',
});

/* ---------------------------------------------------------------- redaction */

/** @type {[RegExp, string][]} */
const RULES = [
  // Longest and most specific first: an email inside quotes should become one
  // marker, not a quoted marker inside another.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '«address»'],
  [/\b[\w.-]+@(?:okicici|okhdfcbank|oksbi|okaxis|ybl|paytm|upi|apl|ibl)\b/gi, '«address»'],
  // Anything somebody put in quotes is a value by definition — it is the bit
  // of the message that came from the data.
  //
  // One rule for all three quote characters rather than three rules. It is
  // simpler, and it keeps the count of each quote character in this file even
  // — which matters more than it should: `tools/field-coverage.mjs` strips
  // comments with a scanner that tracks quotes and knows nothing about regex
  // literals, so an odd apostrophe here leaves it convinced it is inside a
  // string and it stops stripping comments for the rest of the file. That
  // makes prose count as code and marks schema fields as read when nothing
  // reads them — a ratchet failing open, which is the worst way for one to
  // fail. The scanner is fixed too; this rule no longer depends on it.
  [/["'`][^"'`]*["'`]/g, '«value»'],
  // A record id keeps its type and loses which record. `per_` is a fact about
  // the shape of the problem; the rest is a pointer at a person.
  //
  // Three characters, not the twenty-six a real ULID has. A test caught the
  // longer threshold letting `acc_gone` through, and the lesson is the general
  // one: a redaction rule that only fires on well-formed input is not a
  // redaction rule. The prefixes are not derivable — they come from `newId`
  // call sites, not the schema — so the pattern has to be shape-based.
  //
  // The cost is that a snake_case word in a message gets masked too
  // (`not_found` becomes `not_«id»`). That is a real loss of readability,
  // accepted knowingly: `where` and `code` are never redacted and carry the
  // the detail, so the message losing a word costs less than an id surviving.
  [/\b([a-z]{2,6})_[A-Za-z0-9]{3,}\b/g, '$1_«id»'],
  // Long opaque strings: hashes, tokens, base64.
  [/\b[A-Fa-f0-9]{16,}\b/g, '«opaque»'],
  [/\b[A-Za-z0-9+/]{24,}={0,2}\b/g, '«opaque»'],
  // Any run of digits long enough to be a figure, an account tail, a phone
  // number or a date. Two digits and under are kept, because "2 of 5 failed"
  // tells somebody what happened, and is not data.
  [/\d{3,}/g, '«number»'],
  // Currency, however it was written, including the small amounts the rule
  // above deliberately leaves alone.
  [/(?:₹|Rs\.?|INR)\s*[\d,.]+/gi, '«amount»'],
];

/**
 * A message with the values taken out.
 *
 * Deliberately aggressive. Losing a detail makes a fault slightly harder to
 * work out;
 * keeping one costs a plaintext copy of something the rest of this database
 * goes to considerable trouble to encrypt. Those are not comparable.
 */
export function redact(text) {
  let out = String(text ?? '');
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  // Bounded, because a stack trace or a parser error can be enormous and this
  // store is meant to stay small enough that nobody has to manage it.
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/* ------------------------------------------------------------------ events */

/**
 * What `where`, `code` and `entity` are allowed to look like.
 *
 * Those three are **not** redacted, and must not be: `redact` turns any run
 * of three digits into `«number»`, so running it over `code` would file every
 * `http-500`, `http-404` and `http-503` under one heading and take grouping —
 * the entire point of these two fields — away. The comment on the digit rule
 * says as much, and trades readability in the message for exactly that.
 *
 * So they are held to a shape instead. A label is what this codebase writes:
 * `repository.update`, `sync.pull`, `drive.upload`, `http-501`, `transport`,
 * `QuotaExceededError`, a schema entity name. It starts with a letter and
 * carries no spaces, quotes, `@`, slashes or padding characters, which is what
 * an address, a name, a sentence, a token or an amount all need.
 *
 * This is a **structural** guard, not a cleaning one. Nothing is rewritten:
 * a value of the right shape passes through untouched, and one of the wrong
 * shape is replaced whole, because a label that is not a label is not partly
 * salvageable — it is something that came out of a record.
 */
const LABEL = /^[A-Za-z][A-Za-z0-9]*(?:[.\-_:][A-Za-z0-9]+)*$/;

/**
 * The one thing shaped like a label that is still a pointer at somebody: a
 * record id. `per_01JAKPQ2` passes `LABEL`, and `sync.pull` already had to
 * avoid writing one by hand — its comment says why, and a comment is not a
 * guard.
 *
 * The type is kept and the id is dropped, the same trade `redact` makes for
 * messages: `per_` is a fact about the shape of the problem, the rest is a
 * person. A digit is what separates an id from a code, so `not_found` and
 * `acc_gone` survive where `per_01JAKPQ2` does not — the collision `redact`
 * accepts knowingly in a message is not accepted here, because here the code
 * is the whole of what the field carries.
 */
const ID_IN_LABEL = /\b([a-z]{2,6})_[A-Za-z0-9]*\d[A-Za-z0-9]*\b/g;

function label(value, max) {
  const text = String(value ?? '').slice(0, max);
  if (!text) return '';
  if (!LABEL.test(text)) return '«unlabelled»';
  return text.replace(ID_IN_LABEL, '$1_«id»');
}

/**
 * One thing that went wrong, in the shape it is stored.
 *
 * `where`, `code` and `entity` are the diagnosable parts and are not
 * redacted — they are labels this codebase writes, and `LABEL` above is what
 * keeps that true rather than a comment saying it is. Every free-text field
 * is redacted.
 */
export function event({
  kind, where = '', code = '', message = '', entity = '', at = new Date().toISOString(),
}) {
  return {
    // Time-ordered id, so `recent` reads off the key without an index and two
    // events in the same millisecond still have an order.
    id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    kind,
    where: label(where, 60),
    code: label(code, 60),
    entity: label(entity, 40),
    message: redact(message),
  };
}

/**
 * Record one, and drop the oldest if the store is full.
 *
 * Never throws. A diagnostics write that could break the operation it is
 * describing would be worse than no diagnostics at all — the failure it
 * reports would become two failures, and the second would be this module's
 * fault.
 */
export async function record(adapter, input, { limit = LIMIT } = {}) {
  try {
    const row = event(input);
    await adapter.write(STORE, row);

    const all = await adapter.query(STORE, {});
    if (all.length > limit) {
      const sorted = [...all].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      for (const old of sorted.slice(0, all.length - limit)) {
        await adapter.remove(STORE, old.id).catch(() => {});
      }
    }
    return row;
  } catch {
    return null;
  }
}

/** Newest first. */
export async function recent(adapter, { limit = 50 } = {}) {
  const all = await adapter.query(STORE, {}).catch(() => []);
  return [...all]
    .sort((a, b) => String(b.id).localeCompare(String(a.id)))
    .slice(0, limit);
}

/**
 * What the record adds up to.
 *
 * The question this exists to answer is not "what happened" but "has this been
 * happening" — a single failed sync is a bad minute, and the same failure
 * every day for a week is something a household should be told about.
 */
export function summarise(events, { now = new Date().toISOString(), days = 7 } = {}) {
  const since = new Date(new Date(now).getTime() - days * 86_400_000).toISOString();
  const window = (events ?? []).filter((e) => e.at >= since);

  const byKind = {};
  const byCode = new Map();
  for (const e of window) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const key = `${e.kind}:${e.code || e.where || 'unknown'}`;
    byCode.set(key, (byCode.get(key) ?? 0) + 1);
  }

  const repeated = [...byCode.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({ key, count: n }));

  return {
    total: window.length,
    days,
    byKind,
    repeated,
    // The oldest event still held, so a person can tell whether "nothing in
    // the last week" means nothing went wrong or the store only goes back a
    // day because a great deal did.
    oldest: window.length ? window.reduce((a, b) => (a.at < b.at ? a : b)).at : null,
    // Deliberately part of the answer: an empty record and a record that has
    // been trimmed are different situations.
    held: (events ?? []).length,
    full: (events ?? []).length >= LIMIT,
  };
}

export { STORE };
