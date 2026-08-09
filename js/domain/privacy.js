/**
 * What is actually encrypted, counted from the schema rather than claimed.
 *
 * ## Why this exists
 *
 * "Encrypted on the device" is true and it is not the whole truth, and the
 * gap between those two is where somebody gets a surprise. A field is
 * ciphertext only if the schema says `encrypted: true`. Everything else — a
 * payee, a bank narration, an amount, a date, a category, the text read out of
 * a document — is stored as it reads, and travels to the household's Google
 * Sheet as it reads.
 *
 * That is a deliberate design, not an oversight: a search index over
 * ciphertext finds nothing, and a list cannot sort a column it cannot read. It
 * is still a design somebody is entitled to see before they decide how much to
 * put in.
 *
 * So this counts it. Per entity, which fields are sealed and which are not, so
 * the answer to "is my data safe" is a screen a household can read rather than
 * a sentence in a README asking to be believed.
 *
 * ## What "sealed" means precisely
 *
 * The field's value is AES-256-GCM ciphertext bound to the entity, the record
 * and the field name, under a key wrapped by a PIN, a fingerprint or a
 * recovery phrase. It is unreadable in IndexedDB, unreadable in the Google
 * Sheet, and unreadable to anyone who has the file but not one of those three.
 */

import { entities } from '../data/schema.js';

/** Fields that exist for the machinery rather than the household. */
const PLUMBING = new Set(['id', 'rev', 'createdAt', 'updatedAt', 'createdBy',
  'updatedBy', 'deletedAt', 'origin', 'schemaVersion', 'syncState']);

/**
 * Why a field cannot be sealed, in words rather than as a shrug.
 *
 * Each of these is a real trade the schema made, and naming it is the
 * difference between "we did not bother" and "sealing this would break the
 * thing you use it for".
 */
export function whyPlain(field) {
  if (field.search) return 'searchable — a search index over ciphertext finds nothing';
  if (field.list) return 'a column in the list — a table cannot sort what it cannot read';
  if (field.type === 'ref' || field.type === 'multiref') return 'a link to another record';
  if (field.expiry || field.anniversary) return 'drives a reminder';
  if (field.type === 'currency' || field.type === 'number') return 'totalled and charted';
  return 'not marked sensitive';
}

/** One entity's fields, split. */
export function entityPrivacy(name) {
  const def = entities[name];
  const fields = def.fields.filter((field) => !PLUMBING.has(field.key));

  const sealed = fields.filter((field) => field.encrypted);
  const plain = fields.filter((field) => !field.encrypted);

  return {
    name,
    label: def.labels.many,
    module: def.module,
    icon: def.icon,
    sealed: sealed.map((field) => ({ key: field.key, label: field.label ?? field.key })),
    plain: plain.map((field) => ({
      key: field.key,
      label: field.label ?? field.key,
      why: whyPlain(field),
    })),
    total: fields.length,
  };
}

/**
 * The whole picture, worst first.
 *
 * Ordered by how much of an entity is readable rather than alphabetically,
 * because the useful question is "where is the most exposed" and an
 * alphabetical list buries the answer under Appointments.
 */
export function privacyReport() {
  const rows = Object.keys(entities).map(entityPrivacy);

  return {
    entities: rows.sort((a, b) => b.plain.length - a.plain.length),
    sealed: rows.reduce((sum, row) => sum + row.sealed.length, 0),
    plain: rows.reduce((sum, row) => sum + row.plain.length, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  };
}

/**
 * Where a household's records can be, given how it is set up.
 *
 * Written as a list of places rather than a yes/no, because "is it safe" is
 * really "who else has a copy", and that has more than one answer at once.
 *
 * @param {{localOnly?: boolean, configured?: boolean, escrowed?: boolean,
 *          mailboxes?: number}} state
 */
export function whereData(state = {}) {
  const places = [{
    where: 'This device',
    what: 'Everything, in IndexedDB. Sensitive fields as ciphertext, the rest as written.',
    always: true,
  }];

  if (state.localOnly) {
    return {
      places,
      localOnly: true,
      summary: 'Nothing leaves this device. No sync, no uploads, no mail, and the '
        + 'unlock key is not escrowed anywhere.',
    };
  }

  if (state.configured) {
    places.push({
      where: 'Your Google Sheet',
      what: 'Every record. Sealed fields stay ciphertext in the cell; everything else '
        + 'is readable — which is what makes the backup useful if you stop using this app.',
    });
    places.push({
      where: 'Your Google Drive',
      what: 'Documents you uploaded, encrypted on this device before they went up.',
    });
  }

  if (state.escrowed) {
    places.push({
      where: 'Your Drive app folder',
      what: 'The key that unlocks everything. Anyone who can sign in as you can use it.',
      warn: true,
    });
  }

  if (state.mailboxes) {
    places.push({
      where: `${state.mailboxes} ${state.mailboxes === 1 ? 'mailbox' : 'mailboxes'}`,
      what: 'Read, never written to. Only the extracted fields are kept here — no message bodies.',
    });
  }

  return {
    places,
    localOnly: false,
    summary: state.configured
      ? 'A copy is in your own Google account. Nobody else has one — not the people '
        + 'who wrote this application, and not whoever hosts it.'
      : 'Nothing is configured to leave this device, but nothing stops it being '
        + 'configured either. Local-only makes that a decision rather than an accident.',
  };
}
