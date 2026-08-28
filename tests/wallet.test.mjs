import { test, describe, assert, setSuite } from './harness.mjs';
import { expiryState, cardFor, wallet, summarise, DEFAULT_LEAD } from '../js/domain/wallet.js';
import { leadFor } from '../js/domain/reminders.js';
import { entities } from '../js/data/schema.js';
import { classify, mask } from '../js/data/classification.js';

setSuite('wallet');

/** A fixed clock, so "expiring soon" means the same thing on every run. */
const NOW = Date.parse('2026-06-01T00:00:00Z');
const AT = { clock: () => NOW, lead: 180 };

const NAMES = new Map([['p1', 'Asha Devi']]);
const nameOf = (id) => NAMES.get(id) ?? null;
const plainly = (value) => `masked:${value}`;

describe('expiry', () => {
  test('a date in the past is expired, not expiring', () => {
    assert.equal(expiryState('2026-05-01', AT).state, 'expired');
  });

  test('a date inside the lead is expiring', () => {
    assert.equal(expiryState('2026-08-01', AT).state, 'soon');
  });

  test('a date beyond the lead is in date', () => {
    assert.equal(expiryState('2030-01-01', AT).state, 'valid');
  });

  test('no date recorded is unknown, which is not the same as valid', () => {
    // The distinction the card exists to draw. A passport nobody has entered
    // an expiry for is not a passport that is fine.
    assert.equal(expiryState(null, AT).state, 'unknown');
    assert.equal(expiryState('', AT).state, 'unknown');
    assert.equal(expiryState('not a date', AT).state, 'unknown');
  });

  test('the lead the schema declares is the lead the domain falls back to', () => {
    // Two numbers meaning one thing drift, and this drift would be silent:
    // the cards would simply start warning at a different time from every
    // other expiry in the application.
    assert.equal(leadFor('identityDocument', 'expiresOn'), DEFAULT_LEAD);
    const field = entities.identityDocument.fields.find((one) => one.expiry);
    assert.equal(field.expiryLead, DEFAULT_LEAD);
  });
});

describe('a card', () => {
  test('never carries the number it was given', () => {
    const one = cardFor(
      { id: 'd1', kind: 'Passport', number: 'Z1234567', person: 'p1' },
      plainly, nameOf, AT,
    );
    assert.equal(one.number, 'masked:Z1234567');
    assert.equal(JSON.stringify(one).includes('"Z1234567"'), false);
  });

  test('and shows nothing rather than an empty mask when there is no number', () => {
    // An empty mask reads as a hidden value; nothing reads as nothing recorded.
    const one = cardFor({ id: 'd1', kind: 'Passport', person: 'p1' }, plainly, nameOf, AT);
    assert.equal(one.number, null);
  });

  test('says when the record was last changed, always', () => {
    const changed = cardFor({ id: 'd1', updatedAt: '2026-02-02T00:00:00Z' }, plainly, nameOf, AT);
    assert.equal(changed.updatedAt, '2026-02-02T00:00:00Z');

    // Falls back to when it was added rather than leaving the card silent —
    // a card that does not say invites a household to read it as current.
    const added = cardFor({ id: 'd2', createdAt: '2026-01-01T00:00:00Z' }, plainly, nameOf, AT);
    assert.equal(added.updatedAt, '2026-01-01T00:00:00Z');
  });

  test('names the holder, or says it is linked to nobody', () => {
    assert.equal(cardFor({ person: 'p1' }, plainly, nameOf, AT).holder, 'Asha Devi');
    assert.equal(cardFor({ person: 'ghost' }, plainly, nameOf, AT).holder, null);
  });

  test('the real mask hides all but the last four characters', () => {
    // Against the actual classification, not a stub: this is the mask a
    // household sees, and the point of the card is that it is not the number.
    const field = entities.identityDocument.fieldMap.number;
    const masked = mask('ABCDE1234F', classify(field, entities.identityDocument));

    assert.equal(masked.includes('ABCDE'), false);
    assert.equal(masked.endsWith('234F'), true);
  });
});

describe('the wallet', () => {
  const ROWS = [
    { id: 'ok', kind: 'PAN', expiresOn: '2031-01-01' },
    { id: 'gone', kind: 'Passport', expiresOn: '2026-01-01' },
    { id: 'none', kind: 'Voter ID' },
    { id: 'soon', kind: 'Driving licence', expiresOn: '2026-07-01' },
    { id: 'dead', kind: 'Ration card', deletedAt: '2026-01-01' },
  ];

  test('leads with what has lapsed, then what is lapsing', () => {
    // A household opens this looking for what has gone wrong. A wallet that
    // led with the documents that are fine would bury the one that is not.
    const cards = wallet(ROWS, plainly, nameOf, AT);
    assert.deep(cards.map((one) => one.id), ['gone', 'soon', 'none', 'ok']);
  });

  test('and leaves out what was deleted', () => {
    const cards = wallet(ROWS, plainly, nameOf, AT);
    assert.equal(cards.some((one) => one.id === 'dead'), false);
  });

  test('counts each state for the line above the cards', () => {
    assert.deep(summarise(wallet(ROWS, plainly, nameOf, AT)),
      { expired: 1, soon: 1, unknown: 1, valid: 1 });
  });

  test('an empty wallet is empty rather than a row of nothings', () => {
    assert.deep(wallet([], plainly, nameOf, AT), []);
    assert.deep(wallet(null, plainly, nameOf, AT), []);
  });
});
