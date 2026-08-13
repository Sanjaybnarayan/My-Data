/**
 * The chain a record arrived by.
 *
 * `provenance.js` answers one hop — this transaction came from that statement.
 * Lineage answers the whole question: an email arrived, a receipt was read out
 * of it, that receipt was matched to a row on a bank statement, and the
 * statement came from a PDF somebody uploaded. Four hops, one story.
 *
 * ## Origin edges are declared, not inferred
 *
 * The schema has 47 reference edges and **most of them are not lineage.**
 * `transaction.person` says who a payment was *about*; `transaction.account`
 * says where it sits. Neither says where the record came from. Walking every
 * `ref` would produce a plausible-looking graph that answers a different
 * question than the one asked, which is worse than answering nothing.
 *
 * So the origin edges are listed below, by hand, and there are far fewer of
 * them than the reference graph suggests. That short list is the honest shape
 * of this schema: a household record keeper mostly stores things people typed,
 * and the derived chains run through the importer and the mail reader.
 *
 * ## Where a chain stops
 *
 * At something outside the application that can be *named* but not fetched — a
 * Gmail message id, a Drive file id, a file name. The chain ends by pointing at
 * it rather than pretending to reach into it, because this application cannot
 * re-read that email to prove the figure, and saying so is the difference
 * between a trail and a decoration.
 */

import { provenanceOf, SOURCES } from './provenance.js';

/**
 * Which reference means "came from".
 *
 * Deliberately tiny. Adding an entry is a claim that one record was *derived*
 * from another, and that claim should be made deliberately rather than fall
 * out of a field happening to be a `ref`.
 */
const ORIGIN_EDGES = {
  // A row on a statement was parsed out of that statement.
  transaction: [{ field: 'statement', entity: 'bankStatement', relation: 'parsed from' }],
  // A receipt read out of an email is matched to the bank row that paid for it.
  receipt: [{ field: 'transaction', entity: 'transaction', relation: 'matched to' }],
  // A trade belongs to the holding it moved.
  investmentTransaction: [{ field: 'holding', entity: 'holding', relation: 'recorded against' }],
};

/** Guard against a schema edit that introduces a loop. Ten is generous. */
const MAX_HOPS = 10;

/**
 * Walk from a record back to where it came from.
 *
 * @param {object} db
 * @param {string} entityName
 * @param {string} id
 * @returns {Promise<{chain: object[], origin: object, truncated: boolean}>}
 */
export async function lineageOf(db, entityName, id) {
  const chain = [];
  const seen = new Set();

  let name = entityName;
  let record = await db.repo(name).get(id).catch(() => null);
  let truncated = false;

  while (record) {
    const key = `${name}:${record.id}`;
    // A cycle would hang the screen rather than fail it, which is the worst
    // way for this to go wrong. No cycle exists in the schema today; this is
    // here so that a future edge cannot introduce one silently.
    if (seen.has(key)) { truncated = true; break; }
    seen.add(key);

    const step = { entity: name, id: record.id, provenance: provenanceOf(name, record) };
    chain.push(step);

    if (chain.length >= MAX_HOPS) { truncated = true; break; }

    const edge = (ORIGIN_EDGES[name] ?? []).find((e) => record[e.field]);
    if (!edge) break;

    step.relation = edge.relation;
    const next = await db.repo(edge.entity).get(record[edge.field]).catch(() => null);

    // A reference pointing at a record that is gone. Reported rather than
    // silently ending the chain, because "the statement this came from was
    // deleted" is a different and more interesting answer than "this is where
    // it started".
    if (!next) {
      chain.push({
        entity: edge.entity,
        id: record[edge.field],
        missing: true,
        relation: edge.relation,
      });
      break;
    }

    name = edge.entity;
    record = next;
  }

  return { chain, origin: originOf(chain), truncated };
}

/**
 * Where the chain ends — the thing outside this application it points at.
 *
 * Named, never fetched. The application cannot re-open that email to prove the
 * figure, and a trail that implies it can is worse than one that admits it
 * cannot.
 */
function originOf(chain) {
  const last = chain.at(-1);
  if (!last) return { kind: SOURCES.UNKNOWN, label: 'nothing' };

  if (last.missing) {
    return {
      kind: SOURCES.UNKNOWN,
      label: `a ${last.entity} that has since been deleted`,
      broken: true,
    };
  }

  const p = last.provenance;
  const label = {
    [SOURCES.STATEMENT]: 'an imported statement',
    [SOURCES.EMAIL]: p.container ? `an email in ${p.container}` : 'an email',
    [SOURCES.DOCUMENT]: p.sourceId ? `the file ${p.sourceId}` : 'an uploaded file',
    [SOURCES.MANUAL]: 'somebody typing it in',
    [SOURCES.DERIVED]: 'a calculation',
    [SOURCES.UNKNOWN]: 'something not recorded',
  }[p.source];

  return {
    kind: p.source,
    label,
    reference: p.sourceId ?? null,
    // Whether the thing named is outside the application. A statement row's
    // origin is a PDF this application never keeps; a typed row's origin is a
    // person, and there is nothing external to point at.
    external: p.source === SOURCES.EMAIL || p.source === SOURCES.DOCUMENT,
  };
}

/**
 * The chain as a sentence.
 *
 * Reads back to front — the way somebody asks it. "Where did this come from"
 * wants the origin first, not the record they are already looking at.
 */
export function describe(lineage) {
  const chain = lineage?.chain ?? [];
  if (!chain.length) return 'Nothing is recorded about where this came from.';

  // A record with no origin edge has a chain of one. There is no story to
  // tell, so it says the one true thing instead of narrating a single hop.
  if (chain.length === 1) {
    const only = chain[0];
    return `This ${humanise(only.entity)} came from ${lineage.origin.label}.`;
  }

  // Each step's `relation` describes how *it* relates to the step above it —
  // a receipt is "matched to" a transaction, a transaction is "parsed from" a
  // statement. So the sentence has to pair a relation with both ends, not
  // print it beside one name: the first draft read "matched to a receipt,
  // parsed from a transaction", which attaches every relation to the wrong
  // entity and describes a chain that does not exist.
  const sentences = [`Started as ${lineage.origin.label}.`];

  for (let i = chain.length - 2; i >= 0; i--) {
    const child = chain[i];
    const parent = chain[i + 1];
    if (child.missing || !child.relation) continue;

    const subject = i === 0
      ? `This ${humanise(child.entity)}`
      : `A ${humanise(child.entity)}`;
    const object = i + 1 === chain.length - 1
      ? 'it'
      : `that ${humanise(parent.entity)}`;

    sentences.push(`${subject} was ${child.relation} ${object}.`);
  }

  if (lineage.origin.broken) sentences.push('Part of the trail has been deleted.');
  if (lineage.truncated) sentences.push('The trail continues further back than this.');

  return sentences.join(' ');
}

const humanise = (name) => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/**
 * How many records in a set can be traced past their own row.
 *
 * The number that says whether lineage is worth showing at all: a household
 * whose ledger is entirely hand-typed has no chains, and that is a fact about
 * them rather than a failure of this file.
 */
export function depth(lineage) {
  return lineage?.chain?.filter((s) => !s.missing).length ?? 0;
}

/** Entities this file can follow a chain from. */
export function chainable() {
  return Object.keys(ORIGIN_EDGES).sort();
}
