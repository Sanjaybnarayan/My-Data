/**
 * Data classification.
 *
 * Most of these are invariants over the *whole* schema rather than assertions
 * about particular fields, because the derivation is the thing under test and
 * a rule that is right about six hand-picked fields proves very little about
 * the other four hundred and twenty.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  LEVELS, MEANING, atLeast, classify, classificationOf, isKnownField,
  classified, census, mask, assertSound, maskableField, maskable,
} from '../js/data/classification.js';
import { entities } from '../js/data/schema.js';

setSuite('classification');

describe('the scale', () => {
  test('least sensitive first, because the order is the comparison', () => {
    assert.ok(atLeast('CRITICAL_SECRET', 'PUBLIC'));
    assert.ok(atLeast('SENSITIVE', 'SENSITIVE'));
    assert.not(atLeast('PRIVATE', 'HIGHLY_SENSITIVE'));
  });

  test('every level says what it means', () => {
    for (const level of LEVELS) {
      assert.ok(MEANING[level], `${level} has no explanation`);
    }
  });
});

describe('every field is classified', () => {
  test('all 426 of them, with nothing left over', () => {
    const rows = classified();
    const total = Object.values(entities)
      .reduce((n, e) => n + e.fields.length, 0);
    assert.equal(rows.length, total);
    assert.ok(rows.every((r) => LEVELS.includes(r.level)));
  });

  test('the census adds up to the schema', () => {
    const counts = census();
    const summed = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(summed, classified().length);
  });

  test('nothing is PUBLIC, and that is the honest answer', () => {
    // The level exists so the scale matches the one policies are written
    // against. Finding a reason to use it would be worse than leaving it at
    // zero — nothing in a household record keeper is safe to show anyone.
    assert.equal(census().PUBLIC, 0);
  });
});

describe('the invariants that keep derivation honest', () => {
  test('the schema is sound', () => {
    const problems = assertSound();
    assert.deep(problems, [], `\n  ${problems.join('\n  ')}`);
  });

  test('no encrypted field is classified below HIGHLY_SENSITIVE', () => {
    // Somebody paid the cost of ciphertext for these. That decision is
    // evidence, and a rule that contradicts it is a broken rule.
    for (const row of classified()) {
      if (!row.encrypted) continue;
      assert.ok(atLeast(row.level, 'HIGHLY_SENSITIVE'),
        `${row.entity}.${row.key} is encrypted but ${row.level}`);
    }
  });

  test('every CRITICAL_SECRET is actually encrypted', () => {
    // A secret that opens something else must not sit in the clear — not in
    // IndexedDB, and not in the backup spreadsheet.
    for (const row of classified()) {
      if (row.level !== 'CRITICAL_SECRET') continue;
      assert.ok(row.encrypted, `${row.entity}.${row.key} is a secret in the clear`);
    }
  });

  test('no secret is in the search index', () => {
    // Searchable means plaintext by construction — the index holds prefixes of
    // the value. A field cannot be both findable and secret.
    for (const row of classified()) {
      if (row.level !== 'CRITICAL_SECRET') continue;
      assert.not(row.searchable, `${row.entity}.${row.key} is indexed`);
    }
  });
});

describe('the rules, on fields that exist', () => {
  test('a password is a secret, not merely sensitive', () => {
    // It does not identify anybody. It opens something, which is a different
    // and worse kind of loss.
    assert.equal(classificationOf('vaultItem', 'password'), 'CRITICAL_SECRET');
    assert.equal(classificationOf('vaultItem', 'totpSecret'), 'CRITICAL_SECRET');
    assert.equal(classificationOf('digitalAsset', 'licenceKey'), 'CRITICAL_SECRET');
  });

  test('an identity document number is highly sensitive', () => {
    // A leaked PAN or passport number is not recoverable by changing it.
    assert.equal(classificationOf('identityDocument', 'number'), 'HIGHLY_SENSITIVE');
  });

  test('health is highly sensitive whatever the field holds', () => {
    // A date in isolation is nothing; attached to a named person and a
    // medicine it is a medical record.
    assert.equal(classificationOf('healthRecord', 'notes'), 'HIGHLY_SENSITIVE');
    assert.equal(classificationOf('medication', 'name'), 'HIGHLY_SENSITIVE');
  });

  test('money is sensitive even where the whole household can read it', () => {
    assert.ok(atLeast(classificationOf('account', 'openingBalance'), 'SENSITIVE'));
    assert.ok(atLeast(classificationOf('transaction', 'amount'), 'SENSITIVE'));
  });

  test('ordinary household detail is PRIVATE, not higher', () => {
    // Erring upward everywhere would make the scale useless — if everything is
    // highly sensitive then nothing is.
    assert.equal(classificationOf('note', 'title'), 'PRIVATE');
    assert.equal(classificationOf('task', 'title'), 'PRIVATE');
  });

  test('a declared classification beats the derived one', () => {
    const derived = classify({ key: 'x', type: 'text' }, null);
    const declared = classify({ key: 'x', type: 'text', classification: 'CRITICAL_SECRET' }, null);
    assert.equal(derived, 'PRIVATE');
    assert.equal(declared, 'CRITICAL_SECRET');
  });
});

describe('a field nobody can find', () => {
  test('is treated as the most secret thing there is', () => {
    // The first draft returned PRIVATE here, which meant a misspelt key came
    // back as "safe to display" — an invisible failure in the one direction
    // this module must never fail in. Masking everything is a visible bug.
    assert.equal(classificationOf('account', 'balance'), 'CRITICAL_SECRET');
    assert.equal(classificationOf('nonsense', 'whatever'), 'CRITICAL_SECRET');
  });

  test('and can be told apart from a real secret', () => {
    assert.not(isKnownField('account', 'balance'));
    assert.ok(isKnownField('account', 'accountNumber'));
    assert.ok(isKnownField('vaultItem', 'password'));
  });
});

describe('projections must not leak what fields hide', () => {
  test('no title or subtitle prints a maskable field', () => {
    // The bug this exists for. `identityDocument.subtitle` returned the
    // passport number, so it appeared in full in the record header, in list
    // subtitles, in search results and in reference pickers — every one of
    // which renders a string the schema hands it, without ever passing
    // through the field renderer that masks an identifier.
    //
    // Masking at the field is therefore necessary and not sufficient: a
    // projection is a second path to the screen, and it has to be checked
    // separately. Probed rather than eyeballed, so a new entity is covered
    // the day it is added.
    const leaks = [];

    for (const owner of Object.values(entities)) {
      const record = {};
      const sentinels = {};

      for (const f of owner.fields) {
        if (maskableField(owner.name, f.key)) {
          sentinels[f.key] = `SENTINEL_${f.key}`;
          record[f.key] = sentinels[f.key];
        } else {
          record[f.key] = 'x';
        }
      }

      for (const which of ['title', 'subtitle']) {
        if (typeof owner[which] !== 'function') continue;
        let out = '';
        try {
          out = String(owner[which](record) ?? '');
        } catch {
          // A projection that throws on a synthetic record is not a leak.
          continue;
        }
        for (const [key, sentinel] of Object.entries(sentinels)) {
          if (out.includes(sentinel)) leaks.push(`${owner.name}.${which} prints ${key}`);
        }
      }
    }

    assert.deep(leaks, [], `\n  ${leaks.join('\n  ')}`);
  });
});

describe('masking', () => {
  test('a secret has no partial form', () => {
    // Showing the last four characters of a password narrows it for whoever is
    // reading over a shoulder and helps nobody remember which one it is.
    assert.equal(mask('hunter2', 'CRITICAL_SECRET'), '••••••••');
    assert.equal(mask('hunter2', 'CRITICAL_SECRET', { reveal: true }), '••••••••',
      'reveal must not open a secret');
  });

  test('highly sensitive keeps the last four, like a statement does', () => {
    assert.equal(mask('123456789012', 'HIGHLY_SENSITIVE'), 'XXXXXXXX 9012');
  });

  test('and can be revealed deliberately', () => {
    assert.equal(mask('123456789012', 'HIGHLY_SENSITIVE', { reveal: true }), '123456789012');
  });

  test('below that, masking would be theatre', () => {
    assert.equal(mask('Groceries', 'SENSITIVE'), 'Groceries');
    assert.equal(mask('Groceries', 'PRIVATE'), 'Groceries');
  });

  test('an empty value stays empty rather than becoming dots', () => {
    // Masking nothing into "••••••••" invents the impression of a stored
    // secret where the field is simply blank.
    assert.equal(mask('', 'CRITICAL_SECRET'), '');
    assert.equal(mask(null, 'HIGHLY_SENSITIVE'), '');
    assert.equal(mask(undefined, 'HIGHLY_SENSITIVE'), '');
  });
});
