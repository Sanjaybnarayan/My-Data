/**
 * Where did this come from?
 *
 * A household looking at a figure is entitled to ask that, and until now the
 * answer lived in pieces: a transaction carries `statement`, a receipt carries
 * `mailbox` and `messageId`, a document carries `driveFileId`, and each is
 * shaped differently and read by different code. Nothing could answer the
 * question generically, which means nothing could *report* on it — and "every
 * important value is traceable to its source" is not a property you have if
 * you cannot enumerate the ones that are not.
 *
 * ## Read, not stored
 *
 * This adds no field and migrates no record. Like `classification.js`, it is a
 * reading of information that already exists — the entity-specific keys above,
 * interpreted through one vocabulary. That matters for a reason beyond
 * tidiness: a stored provenance column can drift from the record it describes,
 * and a derived one cannot.
 *
 * The consequence is a real limit, stated rather than hidden: this can only be
 * as precise as what the record already carries. A transaction knows which
 * *statement* it came from; it does not know which *page*, and this file will
 * not invent one.
 *
 * ## Confidence is not verification
 *
 * The two are kept apart deliberately and never collapsed into one number.
 *
 *   **Confidence** is how sure the machine is. A parser that read an amount
 *   out of a column it recognised is confident; one that guessed from a
 *   running balance is not.
 *
 *   **Verification** is whether a *person* confirmed it.
 *
 * High confidence is not verification and must never be displayed as though it
 * were. A statement that reconciles to the printed closing balance is strong
 * evidence — it is still arithmetic agreeing with arithmetic, and a household
 * that has not looked at it has not verified it.
 */

/** How a value got here. */
export const SOURCES = Object.freeze({
  STATEMENT: 'statement',
  EMAIL: 'email',
  DOCUMENT: 'document',
  MANUAL: 'manual',
  DERIVED: 'derived',
  UNKNOWN: 'unknown',
});

/** What was done to it on the way. */
export const METHODS = Object.freeze({
  PARSED_COLUMNS: 'parsed from statement columns',
  PARSED_TABLE: 'parsed from a table export',
  READ_EMAIL: 'read from an email receipt',
  TYPED: 'typed by a person',
  RULES: 'classified by rules',
  UNKNOWN: 'unknown',
});

/** Whether a person has confirmed it. Never inferred from confidence. */
export const VERIFICATION = Object.freeze({
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified',
  CONTRADICTED: 'contradicted',
});

/**
 * How the source is recorded, per entity.
 *
 * Deliberately a table rather than a chain of `if`s: it is the list of every
 * place in the schema that knows where a record came from, and a new entity
 * that carries provenance should have to appear here to claim it.
 */
const READERS = {
  transaction(record) {
    if (record.statement) {
      return {
        source: SOURCES.STATEMENT,
        sourceId: record.statement,
        method: METHODS.PARSED_COLUMNS,
        // The fingerprint the importer built. It is what makes re-importing
        // the same month harmless, and it is the evidence that this row is
        // the row the bank printed rather than one somebody edited into it.
        evidence: record.importKey || null,
        // `reconciled` on a transaction means its statement's arithmetic
        // closed. That is a property of the *import*, not a person's sign-off.
        confidence: record.reconciled ? 'high' : 'medium',
        note: record.reconciled
          ? null
          : 'the statement it came from did not add up',
      };
    }
    return {
      source: SOURCES.MANUAL,
      method: METHODS.TYPED,
      confidence: 'high',
    };
  },

  receipt(record) {
    if (record.messageId) {
      return {
        source: SOURCES.EMAIL,
        sourceId: record.messageId,
        container: record.mailbox || null,
        method: METHODS.READ_EMAIL,
        // A total read out of prose is the weakest reading this application
        // does — the merchant chose the wording, not a column heading.
        confidence: 'medium',
        note: 'read from the wording of an email rather than a labelled column',
      };
    }
    return { source: SOURCES.MANUAL, method: METHODS.TYPED, confidence: 'high' };
  },

  document(record) {
    if (record.driveFileId) {
      return {
        source: SOURCES.DOCUMENT,
        sourceId: record.driveFileId,
        method: record.ocrText ? METHODS.PARSED_TABLE : METHODS.TYPED,
        confidence: record.ocrText ? 'medium' : 'high',
      };
    }
    return { source: SOURCES.MANUAL, method: METHODS.TYPED, confidence: 'high' };
  },

  bankStatement(record) {
    return {
      source: SOURCES.DOCUMENT,
      sourceId: record.fileName || null,
      method: METHODS.PARSED_COLUMNS,
      // The one place in the codebase where a machine checks its own reading
      // against something the bank wrote. It is still not a person looking.
      confidence: record.reconciled ? 'high' : 'low',
      note: record.reconciled
        ? 'the arithmetic closed against the printed closing balance'
        : 'the arithmetic did not close — rows may be missing or misread',
    };
  },
};

/**
 * What is known about where this record came from.
 *
 * @param {string} entityName
 * @param {object} record
 * @returns {{source: string, sourceId: string|null, container: string|null,
 *            method: string, confidence: string, verification: string,
 *            evidence: string|null, note: string|null, at: string|null}}
 */
export function provenanceOf(entityName, record) {
  const read = READERS[entityName]?.(record ?? {}) ?? {
    // An entity nobody taught this file about. Saying "unknown" is the honest
    // answer and is what makes the gap countable — guessing `MANUAL` would
    // quietly assert that a person typed something nobody typed.
    source: SOURCES.UNKNOWN,
    method: METHODS.UNKNOWN,
    confidence: 'unknown',
  };

  return {
    source: read.source,
    sourceId: read.sourceId ?? null,
    container: read.container ?? null,
    method: read.method,
    confidence: read.confidence,
    evidence: read.evidence ?? null,
    note: read.note ?? null,
    at: record?.createdAt ?? null,
    // Nothing in the schema records a human sign-off yet, so nothing may claim
    // one. This is deliberately constant until there is a field behind it —
    // returning anything else here would be the exact confusion the header
    // warns about.
    verification: VERIFICATION.UNVERIFIED,
  };
}

/** Does this record say where it came from at all? */
export function traceable(entityName, record) {
  return provenanceOf(entityName, record).source !== SOURCES.UNKNOWN;
}

/**
 * Whether provenance is *understood* for an entity — as opposed to a
 * particular record happening to be traceable.
 *
 * Lets a report distinguish "this row is missing its source" from "nothing
 * here knows how to read a source for this kind of record", which are
 * different problems with different fixes.
 */
export function isUnderstood(entityName) {
  return Object.hasOwn(READERS, entityName);
}

/** Every entity whose provenance this file can read. */
export function understood() {
  return Object.keys(READERS).sort();
}

/**
 * A plain sentence, for a screen.
 *
 * Written to be readable next to a figure — "where did this ₹450 come from" —
 * and to never imply a person checked it when nobody has.
 */
export function explain(entityName, record) {
  const p = provenanceOf(entityName, record);

  const opening = {
    [SOURCES.STATEMENT]: 'Read from an imported bank statement',
    [SOURCES.EMAIL]: 'Read from an email receipt',
    [SOURCES.DOCUMENT]: 'Read from an uploaded document',
    [SOURCES.MANUAL]: 'Entered by hand',
    [SOURCES.DERIVED]: 'Calculated from other records',
    [SOURCES.UNKNOWN]: 'Source not recorded',
  }[p.source];

  // The reason comes from whichever reader produced it, never from the
  // confidence alone. A generic sentence keyed off "medium" told a statement
  // row it had been "read from wording rather than a labelled column" — which
  // is why a *receipt* is uncertain, not why that row was. A wrong explanation
  // attached to a real figure is worse than no explanation.
  const parts = [opening];
  if (p.note) parts.push(p.note);

  // Said on every explanation that is not hand-entered, because it is the
  // sentence people assume the opposite of.
  if (p.source !== SOURCES.MANUAL && p.source !== SOURCES.UNKNOWN) {
    parts.push('not checked by anyone');
  }

  return `${parts.join(' — ')}.`;
}

/**
 * How much of a set of records can say where it came from.
 *
 * The point of the whole file. "Every important value is traceable to its
 * source" is not a property you have until you can count the ones that are
 * not, and this is the count.
 *
 * @param {string} entityName
 * @param {object[]} records
 */
export function coverage(entityName, records = []) {
  const rows = records.map((record) => provenanceOf(entityName, record));

  const bySource = {};
  for (const row of rows) bySource[row.source] = (bySource[row.source] ?? 0) + 1;

  return {
    entity: entityName,
    understood: isUnderstood(entityName),
    total: rows.length,
    traceable: rows.filter((r) => r.source !== SOURCES.UNKNOWN).length,
    // Counted apart from the rest, because a hand-typed figure *is* traceable
    // — to a person — and lumping it in with a parsed one would overstate how
    // much of the ledger came off a bank's own paper.
    manual: rows.filter((r) => r.source === SOURCES.MANUAL).length,
    unverified: rows.filter((r) => r.verification === VERIFICATION.UNVERIFIED).length,
    bySource,
    // The number rule 26 is about: a figure nobody can trace at all.
    untraceable: rows.filter((r) => r.source === SOURCES.UNKNOWN).length,
  };
}
