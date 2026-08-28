import { test, describe, assert, setSuite } from './harness.mjs';
import { PHRASES, SHARED, TENSE, phraseKey, tenseFor } from '../js/domain/duewords.js';
import { describeReminder } from '../js/domain/reminders.js';
import { entities } from '../js/data/schema.js';
import { strings } from '../js/locale/en.js';

setSuite('duewords');

/** Every `expiry: true` field in the schema, as `{entity, key, label}`. */
function datedFields() {
  const out = [];
  for (const [entity, def] of Object.entries(entities)) {
    for (const field of def.fields) {
      if (field.expiry) out.push({ entity, key: field.key, label: field.label ?? field.key });
    }
  }
  return out;
}

describe('every dated field says how it is spoken', () => {
  test('there are enough of them for that to mean something', () => {
    assert.equal(datedFields().length > 15, true, `${datedFields().length} dated fields`);
  });

  test('every field the schema marks as an expiry has phrases', () => {
    // The fault this file exists for. A new dated field with no phrases used
    // to render as "whatever on expires today"; now it fails here first.
    const missing = datedFields()
      .filter((one) => !Object.prototype.hasOwnProperty.call(PHRASES, one.key))
      .map((one) => `${one.entity}.${one.key}`);
    assert.deep(missing, []);
  });

  test('and every phrase here belongs to a field the schema still has', () => {
    const known = new Set(datedFields().map((one) => one.key));
    assert.deep(Object.keys(PHRASES).filter((key) => !known.has(key)), []);
  });

  test('every phrase has English in all three tenses', () => {
    const gaps = [];
    for (const key of Object.keys(PHRASES)) {
      for (const tense of Object.keys(TENSE)) {
        const at = phraseKey(key, tense);
        if (!at || !strings[at]) gaps.push(`${key}.${tense}`);
      }
    }
    assert.deep(gaps, []);
  });

  test('a key shared by several entities is shared on purpose', () => {
    /*
     * The phrases are keyed by field alone, which is sound only while a key
     * means the same thing wherever it appears. This does not try to judge
     * that — no test can — it makes sharing *declared*, so a key picked up by
     * a new entity fails here and somebody decides whether one phrase still
     * fits both.
     *
     * Comparing labels instead was the first attempt and it was worse than
     * useless: it flagged `Expires On` against `Expires on` and `Renewal date`
     * against `Renews On`, which are the same idea spelled differently, while
     * it could never have caught a key that genuinely acquired a second
     * meaning under a matching label.
     */
    const actual = {};
    for (const one of datedFields()) (actual[one.key] ??= []).push(one.entity);

    const reallyShared = Object.fromEntries(
      Object.entries(actual).filter(([, list]) => list.length > 1),
    );
    assert.deep(
      Object.fromEntries(Object.entries(reallyShared).map(([k, v]) => [k, [...v].sort()])),
      Object.fromEntries(Object.entries(SHARED).map(([k, v]) => [k, [...v].sort()])),
    );
  });
});

describe('the sentence a household reads', () => {
  const say = (key, days, title = 'X') =>
    describeReminder({ group: 'expiry', title, field: key, label: 'Label', days });

  test('no sentence pastes the field label in front of a verb', () => {
    /*
     * The exact shape of the bug. `describeReminder` used to build
     * `${title}: ${label.toLowerCase()} expires today`, and an expiry label is
     * already a phrase — "Expires on", "Next due on" — so every dated entity
     * produced at least one line reading "X: expires on expires today".
     */
    const wrong = [];
    for (const key of Object.keys(PHRASES)) {
      for (const days of [5, 0, -3]) {
        const line = say(key, days);
        if (/\b(on|till|until|date)\s+(expires|expired|is|was|due)\b/i.test(line)) {
          wrong.push(line);
        }
        if (/\bLabel\b/.test(line)) wrong.push(`label leaked: ${line}`);
      }
    }
    assert.deep(wrong, []);
  });

  test('and none of them says a date expired when it did not', () => {
    // A vaccination's next dose does not expire, and neither does a
    // follow-up. Both used to say so, which is a claim about somebody's care
    // that this application is in no position to make.
    for (const key of ['nextDoseOn', 'followUpOn', 'date', 'nextServiceOn', 'nextFeeDueOn']) {
      for (const days of [5, 0, -3]) {
        assert.not(/expir/i.test(say(key, days)), `${key} at ${days}: ${say(key, days)}`);
      }
    }
  });

  test('a passport still says it expires, because it does', () => {
    assert.equal(say('expiresOn', 5, 'Passport'), 'Passport expires in 5 days');
    assert.equal(say('expiresOn', 0, 'Passport'), 'Passport expires today');
    assert.equal(say('expiresOn', -3, 'Passport'), 'Passport expired 3 days ago');
  });

  test('a next dose says it was due, not that it lapsed', () => {
    assert.equal(say('nextDoseOn', -3, 'Tetanus'), 'Tetanus next dose was due 3 days ago');
  });

  test('one day is a day, not "1 days"', () => {
    assert.equal(say('expiresOn', 1, 'Passport'), 'Passport expires in 1 day');
    assert.equal(say('expiresOn', -1, 'Passport'), 'Passport expired 1 day ago');
  });

  test('every field, every tense, produces a sentence with no gaps in it', () => {
    const bad = [];
    for (const key of Object.keys(PHRASES)) {
      for (const days of [5, 1, 0, -1, -3]) {
        const line = say(key, days);
        if (!line || /undefined|null|\{\w+\}|\s\s/.test(line)) bad.push(`${key}@${days}: ${line}`);
      }
    }
    assert.deep(bad, []);
  });
});

describe('a field with no phrase names the date rather than guessing', () => {
  test('it does not invent a verb', () => {
    const line = describeReminder({
      group: 'expiry', title: 'Something', field: 'inventedField', label: 'Some day', days: -3,
    });
    assert.includes(line, 'Some day');
    assert.not(/expir/i.test(line), line);
    assert.includes(line, '3 days ago');
  });

  test('and a reminder with no usable date says so rather than printing NaN', () => {
    const line = describeReminder({
      group: 'expiry', title: 'Something', field: 'inventedField', label: 'Some day', days: NaN,
    });
    assert.not(/NaN|undefined/.test(line), line);
  });
});

describe('tense', () => {
  test('is decided by the sign, with today its own case', () => {
    assert.equal(tenseFor(5), TENSE.ahead);
    assert.equal(tenseFor(0), TENSE.today);
    assert.equal(tenseFor(-1), TENSE.past);
  });

  test('and nonsense has no tense at all', () => {
    assert.equal(tenseFor(NaN), null);
    assert.equal(tenseFor(undefined), null);
  });

  test('an unknown field or tense has no key', () => {
    assert.equal(phraseKey('nothingLikeThis', 'ahead'), null);
    assert.equal(phraseKey('expiresOn', 'sideways'), null);
    assert.equal(phraseKey('constructor', 'ahead'), null);
  });
});
