import { test, describe, assert, setSuite } from './harness.mjs';
import {
  t, label, noun, register, forget, coverage, locales, missing,
  keepsPlaceholders, catalogueTags, choose, active, FALLBACK,
} from '../js/core/locale.js';
import { labelKeys, entityKey, fieldKey, moduleKey } from '../js/core/labels.js';
import { strings as english } from '../js/locale/en.js';
import { formatDay, formatInstant, relativeDays } from '../js/core/dates.js';
import { survey, userFacing, check, readInventory } from '../tools/strings.mjs';

setSuite('locale');

// Every test that registers a catalogue puts English back afterwards, because
// the module is shared and a leaked second language would make an unrelated
// suite fail somewhere else entirely.
const withLocale = (tag, catalogue, fn) => {
  try {
    register(tag, catalogue);
    return fn();
  } finally {
    forget();
  }
};

describe('what a missing translation does', () => {
  test('falls back to English rather than showing the key', () => {
    withLocale('xx', { strings: {} }, () => {
      assert.equal(t('record.save', {}, { tag: 'xx' }), 'Save changes');
    });
  });

  test('a key no catalogue has returns the key, which is a bug and looks like one', () => {
    // Deliberately not empty string. A blank label is a screen that looks
    // finished and says nothing; the key is ugly enough to get reported.
    assert.equal(t('nothing.defines.this'), 'nothing.defines.this');
  });

  test('every key the English catalogue defines is non-empty', () => {
    const blank = Object.entries(english).filter(([, v]) => !String(v).trim());
    assert.equal(blank.length, 0);
  });
});

describe('a translation that loses a placeholder', () => {
  // This is the whole reason the module is not a Map lookup. Rule 57 says
  // every financial event must be explainable, and "you spent" without the
  // amount is not an explanation, it is an alarm.
  const dropped = { strings: { 'date.inDays': 'सप्ताह भर में' } };

  test('is refused, and the English is shown instead', () => {
    withLocale('hi', dropped, () => {
      assert.equal(t('date.inDays', { n: 12 }, { tag: 'hi' }), 'in 12 days');
    });
  });

  test('is reported rather than silently swallowed', () => {
    withLocale('hi', dropped, () => {
      t('date.inDays', { n: 12 }, { tag: 'hi' });
      assert.deep(missing('hi'), ['date.inDays']);
    });
  });

  test('does not count towards that language\'s coverage', () => {
    withLocale('hi', dropped, () => {
      // One key supplied, and it is the one the app will never show.
      assert.equal(coverage('hi'), 0);
    });
  });

  test('but a translation that keeps the placeholder is used', () => {
    withLocale('hi', { strings: { 'date.inDays': '{n} दिनों में' } }, () => {
      assert.equal(t('date.inDays', { n: 12 }, { tag: 'hi' }), '12 दिनों में');
      assert.deep(missing('hi'), []);
    });
  });

  test('an extra placeholder is allowed — a language may need a word the English does not', () => {
    assert.ok(keepsPlaceholders('in {n} days', '{n} दिनों {suffix} में'));
    assert.not(keepsPlaceholders('in {n} days', 'दिनों में'));
  });
});

describe('coverage is measured, never declared', () => {
  test('English covers everything, by being the thing everything is measured against', () => {
    assert.equal(coverage(FALLBACK), 1);
  });

  test('a language that has never been registered covers nothing', () => {
    assert.equal(coverage('fr'), 0);
  });

  test('a half-written catalogue reports half, not complete', () => {
    const half = Object.fromEntries(
      Object.entries(english).slice(0, Math.floor(Object.keys(english).length / 2)));
    withLocale('xx', { strings: half }, () => {
      const c = coverage('xx');
      assert.ok(c > 0.4 && c < 0.6, `expected about half, got ${c}`);
    });
  });

  test('schema labels count towards it, so a language with every UI string is still far from complete', () => {
    withLocale('xx', { strings: english }, () => {
      const labels = labelKeys();
      const strings = Object.keys(english).length;
      const c = coverage('xx', { labelKeys: labels });

      /*
       * Derived, not a hand-tuned constant.
       *
       * This used to assert `c < 0.2`, a number chosen when the UI catalogue
       * held 172 keys. Adding a screen's worth of strings moved the ratio to
       * 0.217 and failed a test that had found nothing wrong — the catalogue
       * growing is the thing this file is *for*. A constant standing in for a
       * ratio is the same shape as a hand-written list standing in for a
       * derived one, and it goes stale the same way.
       *
       * What the test actually means: coverage is the share of *all* keys that
       * are translated, and the schema labels are most of them.
       */
      const expected = strings / (strings + labels.length);
      assert.ok(Math.abs(c - expected) < 0.001,
        `coverage ${c} should be ${expected} — ${strings} strings of ${strings + labels.length} keys`);

      // And the point of it: every UI string is nowhere near a translation.
      assert.ok(c < 0.5, `expected well under half, got ${c}`);
      assert.ok(labels.length > strings,
        `${labels.length} schema labels against ${strings} strings — labels should dominate`);
    });
  });

  test('a catalogue cannot raise its own number', () => {
    // The shape a declared coverage would take, ignored on purpose.
    withLocale('xx', { strings: {}, coverage: 1, complete: true }, () => {
      assert.equal(coverage('xx'), 0);
    });
  });
});

describe('the label door', () => {
  test('falls through to the schema English when a language says nothing', () => {
    assert.equal(label(entityKey('person', 'one'), 'Person'), 'Person');
  });

  test('and is replaced when it does', () => {
    withLocale('xx', { strings: {}, labels: { [entityKey('person', 'one')]: 'Persona' } }, () => {
      assert.equal(label(entityKey('person', 'one'), 'Person', { tag: 'xx' }), 'Persona');
    });
  });

  test('the key inventory is derived from the schema, so a new entity is never forgotten', () => {
    const keys = labelKeys();
    assert.ok(keys.includes(entityKey('purchase', 'many')));
    assert.ok(keys.includes(fieldKey('trip', 'destination')));
    assert.ok(keys.includes(moduleKey('travel')));
    // No duplicates — a duplicated key would inflate the denominator and make
    // every language look less complete than it is.
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('mid-sentence case belongs to the language', () => {
  test('English lowercases a noun inside a sentence', () => {
    assert.equal(noun('Person'), 'person');
    assert.equal(t('record.add', { one: noun('Person') }), 'Add person');
  });

  test('a language that does not is left alone', () => {
    withLocale('de', { strings: {}, midSentence: 'preserve' }, () => {
      assert.equal(noun('Person', { tag: 'de' }), 'Person');
    });
  });
});

describe('dates go through the catalogue and English is unchanged', () => {
  const clock = () => new Date('2025-03-09T00:00:00').getTime();

  test('a day still reads the way it always did', () => {
    assert.equal(formatDay('2025-03-09'), '9 Mar 2025');
    assert.equal(formatDay('2025-03-09', { withYear: false }), '9 Mar');
  });

  test('an instant still reads the way it always did', () => {
    assert.equal(formatInstant('2025-03-09T14:05:00'), '9 Mar 2025, 14:05');
  });

  test('and so do relative days', () => {
    assert.equal(relativeDays('2025-03-09', clock), 'today');
    assert.equal(relativeDays('2025-03-10', clock), 'tomorrow');
    assert.equal(relativeDays('2025-03-08', clock), 'yesterday');
    assert.equal(relativeDays('2025-03-21', clock), 'in 12 days');
    assert.equal(relativeDays('2025-03-06', clock), '3 days ago');
  });

  test('a catalogue can move the year to the front without dates.js knowing', () => {
    // The point of putting the order in the string rather than in the code, so
    // it has to actually be the active language — asserting the English output
    // of a language nobody selected would prove nothing at all.
    withLocale('xx', {
      strings: { 'date.dayWithYear': '{year}/{month}/{d}', 'month.3': '03' },
    }, () => {
      choose('xx', { storage: null, root: null });
      assert.equal(formatDay('2025-03-09'), '2025/03/9');
      assert.equal(active(), 'xx');
    });
  });

  test('every relative day really goes through the catalogue', () => {
    // Asserting the English output cannot tell a routed string from a
    // hard-coded one — both read "in 12 days". Putting `in ${n} days` straight
    // back into dates.js passed every other check in this file, so the only
    // check that can see the difference is one that changes the catalogue and
    // requires the output to follow.
    withLocale('xx', {
      strings: {
        'date.today': 'T', 'date.tomorrow': 'M', 'date.yesterday': 'Y',
        'date.inDays': 'F{n}', 'date.daysAgo': 'P{n}',
      },
    }, () => {
      choose('xx', { storage: null, root: null });
      assert.equal(relativeDays('2025-03-09', clock), 'T');
      assert.equal(relativeDays('2025-03-10', clock), 'M');
      assert.equal(relativeDays('2025-03-08', clock), 'Y');
      assert.equal(relativeDays('2025-03-21', clock), 'F12');
      assert.equal(relativeDays('2025-03-06', clock), 'P3');
    });
  });

  test('and so does the instant, month name included', () => {
    withLocale('xx', {
      strings: { 'date.instant': '{hh}:{mm} on {day}', 'month.3': 'III', 'date.dayWithYear': '{d}-{month}-{year}' },
    }, () => {
      choose('xx', { storage: null, root: null });
      assert.equal(formatInstant('2025-03-09T14:05:00'), '14:05 on 9-III-2025');
    });
  });

  test('every month has a name', () => {
    for (let m = 1; m <= 12; m++) {
      assert.ok(String(english[`month.${m}`] ?? '').length >= 3, `month.${m}`);
    }
  });
});

describe('registration', () => {
  test('English is present without anybody starting the application', () => {
    // Domain code formats dates in tests with no app around it. If English had
    // to be bootstrapped, every suite would depend on remembering to do it.
    assert.ok(catalogueTags().includes(FALLBACK));
  });

  test('forget puts English back rather than leaving nothing', () => {
    register('xx', { strings: {} });
    forget();
    assert.deep(catalogueTags(), [FALLBACK]);
    assert.equal(t('record.save'), 'Save changes');
  });

  test('locales lists English first even when another scores higher on nothing', () => {
    withLocale('xx', { strings: {} }, () => {
      assert.equal(locales()[0].tag, FALLBACK);
    });
  });
});

setSuite('strings');

describe('what counts as a user-facing string', () => {
  test('a sentence does', () => {
    assert.ok(userFacing('Nothing has been recorded here.'));
    assert.ok(userFacing('Connect a Google account in Settings to sync.'));
  });

  test('machinery does not', () => {
    assert.not(userFacing('./js/core/locale.js'));
    assert.not(userFacing('application/pdf'));
    assert.not(userFacing('https://example.com/a b'));
    assert.not(userFacing('data:changed'));
    assert.not(userFacing('list-item muted'));
    assert.not(userFacing('household_${id} x'));
  });

  test('a single word does not, because it cannot be told from an identifier', () => {
    assert.not(userFacing('Saved'));
  });
});

describe('the unrouted ratchet', () => {
  test('the recorded inventory matches what is in the tree', () => {
    const current = survey();
    const result = check(current, readInventory());
    assert.ok(result.ok, result.why ?? '');
  });

  test('and it can actually fail — a file that grows English is caught', () => {
    // A check that cannot fail is worse than no check. This proves the
    // comparison is real by handing it a count larger than the record.
    const recorded = { unrouted: 10, byFile: { 'js/app.js': 1 } };
    const grown = { total: 11, byFile: { 'js/app.js': [{ text: 'a b', line: 1 }, { text: 'c d', line: 2 }] } };
    const result = check(grown, recorded);
    assert.not(result.ok);
    assert.ok(result.grew.some((line) => line.startsWith('js/app.js')));
  });

  test('falling below the record is allowed and reported', () => {
    const result = check({ total: 3, byFile: {} }, { unrouted: 10, byFile: {} });
    assert.ok(result.ok);
  });

  test('no inventory is a failure, not a pass', () => {
    // The tempting bug: treat a missing file as "nothing to compare against"
    // and return ok, which makes deleting the inventory a way to silence it.
    assert.not(check({ total: 999, byFile: {} }, null).ok);
  });
});
