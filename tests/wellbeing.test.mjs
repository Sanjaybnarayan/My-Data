import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import {
  saidAs, summarise, packageTail, whyBlocked, BLOCKED, CANNOT_SHOW,
} from '../js/domain/wellbeing.js';
import { STATE } from '../js/services/screentime.js';
import { strings } from '../js/locale/en.js';

setSuite('wellbeing');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('a duration, said', () => {
  test('minutes become hours and minutes', () => {
    assert.deep(saidAs(135), { hours: 2, minutes: 15, total: 135 });
  });

  test('under an hour keeps the hours at zero rather than dropping them', () => {
    // A screen that printed nothing for the hours would render "20m" in one
    // row and "2h 15m" in the next, and the columns would stop lining up.
    assert.deep(saidAs(20), { hours: 0, minutes: 20, total: 20 });
  });

  test('nonsense is nothing, not NaN on a screen', () => {
    assert.deep(saidAs(undefined), { hours: 0, minutes: 0, total: 0 });
    assert.deep(saidAs('rubbish'), { hours: 0, minutes: 0, total: 0 });
    assert.deep(saidAs(-90), { hours: 0, minutes: 0, total: 0 });
  });
});

describe('a week of usage', () => {
  const week = [
    { app: 'com.whatsapp', minutes: 300 },
    { app: 'com.google.android.youtube', minutes: 180 },
    { app: 'com.android.chrome', minutes: 120 },
  ];

  test('is ordered longest first whatever order it arrived in', () => {
    const out = summarise([...week].reverse());
    assert.deep(out.apps.map((one) => one.app), week.map((one) => one.app));
    assert.equal(out.busiest.app, 'com.whatsapp');
  });

  test('totals what it was given', () => {
    assert.equal(summarise(week).total, 600);
  });

  test('shares are of the whole week, not of the rows shown', () => {
    // `top` cuts the list. If the shares were computed after the cut they
    // would sum to 100% of six applications and describe a week that did not
    // happen.
    const many = Array.from({ length: 10 }, (_, i) => ({ app: `a.b.n${i}`, minutes: 10 }));
    const out = summarise(many, { top: 3 });
    assert.equal(out.total, 100);
    assert.length(out.apps, 3);
    assert.equal(out.hidden, 7);
    for (const one of out.apps) assert.close(one.share, 0.1);
  });

  test('an application with no foreground time is not a row', () => {
    const out = summarise([...week, { app: 'com.never.opened', minutes: 0 }]);
    assert.length(out.apps, 3);
    assert.equal(out.hidden, 0);
  });

  test('an empty week divides nothing by nothing', () => {
    const out = summarise([]);
    assert.equal(out.total, 0);
    assert.length(out.apps, 0);
    assert.equal(out.busiest, null);
    assert.equal(out.hidden, 0);
  });

  test('and neither does a week where everything is zero', () => {
    const out = summarise([{ app: 'com.a', minutes: 0 }, { app: 'com.b', minutes: 0 }]);
    assert.equal(out.total, 0);
    assert.length(out.apps, 0);
  });

  test('nothing at all is a week of nothing, not a throw', () => {
    assert.equal(summarise(undefined).total, 0);
    assert.equal(summarise(null).busiest, null);
  });

  test('there is no daily average, deliberately', () => {
    // A phone switched off for three days still reports seven. Dividing by
    // seven produces a number that reads like a habit and is an artefact, so
    // this function must not start offering one.
    const out = summarise(week);
    for (const key of ['average', 'daily', 'perDay', 'mean']) {
      assert.not(Object.prototype.hasOwnProperty.call(out, key), `summarise grew ${key}`);
    }
  });
});

describe('naming an application', () => {
  test('the package tail is the closest thing to a name', () => {
    assert.equal(packageTail('com.google.android.youtube'), 'youtube');
    assert.equal(packageTail('com.whatsapp'), 'whatsapp');
  });

  test('a package with no dots is itself', () => {
    assert.equal(packageTail('camera'), 'camera');
  });

  test('and nothing is not "undefined" printed on a screen', () => {
    assert.equal(packageTail(undefined), '');
    assert.equal(packageTail(null), '');
    assert.equal(packageTail(''), '');
  });

  test('a package that is all separators is shown as the device said it', () => {
    // Not blanked. Whatever Android reported is what a household sees, even
    // when it is nonsense — a row with an empty name and a duration beside it
    // would look like this screen had lost something.
    assert.equal(packageTail('...'), '...');
  });
});

describe('why there is no reading', () => {
  test('every state the service can report has a case here', () => {
    // The pair this repository keeps getting wrong is a hand-written list
    // beside a derivable one. `STATE` is the service's list; a state added
    // there and forgotten here would fall to `unknown` and tell a household
    // nothing.
    for (const state of Object.values(STATE)) {
      if (state === STATE.READY) continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(BLOCKED, state),
        `the service can report ${state} and the screen has no case for it`,
      );
    }
  });

  test('and every case here is a state the service can report', () => {
    // `Set<string>`, not the literal union `STATE` infers. The whole point
    // is to ask about a key the union may not contain.
    /** @type {Set<string>} */
    const known = new Set(Object.values(STATE));
    for (const key of Object.keys(BLOCKED)) {
      if (key === 'unknown') continue;
      assert.ok(known.has(key), `the screen has a case for ${key} and nothing reports it`);
    }
  });

  test('only the two device cases offer the settings page', () => {
    // Usage access is the only thing a settings page can fix. Offering it for
    // a consent answer would send somebody to a screen that cannot help.
    assert.ok(whyBlocked('noAccess').settings);
    assert.ok(whyBlocked('deviceRefused').settings);
    for (const state of ['noPerson', 'unasked', 'refused', 'noPlugin', 'unknown']) {
      assert.not(whyBlocked(state).settings, `${state} offered a settings button`);
    }
  });

  test('only "not asked yet" offers the consent screen', () => {
    // A person who said no is not shown a way to be asked again.
    assert.ok(whyBlocked('unasked').consent);
    for (const state of ['refused', 'noPerson', 'noPlugin', 'noAccess', 'deviceRefused', 'unknown']) {
      assert.not(whyBlocked(state).consent, `${state} offered to ask again`);
    }
  });

  test('a state nobody recognises claims no cause and offers no control', () => {
    const out = whyBlocked('something-new');
    assert.equal(out, BLOCKED.unknown);
    assert.not(out.settings);
    assert.not(out.consent);
  });

  test('a state that collides with Object.prototype is still unknown', () => {
    assert.equal(whyBlocked('constructor'), BLOCKED.unknown);
    assert.equal(whyBlocked('toString'), BLOCKED.unknown);
    assert.equal(whyBlocked(undefined), BLOCKED.unknown);
  });

  test('each case says something different', () => {
    const said = Object.values(BLOCKED).map((one) => strings[one.key]);
    assert.equal(new Set(said).size, said.length, 'two blocked states share a sentence');
    for (const one of said) assert.ok(one && one.length > 20, 'a blocked state has no sentence');
  });

  test('and none of them says "unavailable"', () => {
    // The whole point of keeping six cases apart is that two of them are
    // things a household can act on.
    for (const one of Object.values(BLOCKED)) {
      assert.not(/unavailable|not available/i.test(strings[one.key]), one.key);
    }
  });
});

describe('what the screen admits it cannot show', () => {
  test('every absence has a sentence', () => {
    for (const key of CANNOT_SHOW) {
      assert.ok(strings[key], `${key} has no English`);
    }
  });

  test('and the list covers what a phone shows and this does not', () => {
    const said = CANNOT_SHOW.map((key) => strings[key]).join(' ').toLowerCase();
    for (const absent of ['categor', 'walking', 'hearing', 'timer']) {
      assert.includes(said, absent, `nothing tells a household there is no ${absent}`);
    }
  });
});

describe('the screen draws the stack that was built', () => {
  const module = readFileSync(join(ROOT, 'js/modules/wellbeing.js'), 'utf8');

  test('it imports the service rather than the device', () => {
    // `js/core/screentime.js` will take the reading without asking anybody.
    // The service is what refuses without a recorded consent decision, and a
    // screen that reached past it would be the gate removed.
    assert.includes(module, "from '../services/screentime.js'");
    assert.not(/import \{[^}]*\busage\b[^}]*\} from '\.\.\/core\/screentime\.js'/.test(module),
      'the screen reads the device directly, past the consent gate');
  });

  test('it uses a share bar and not the budget progress bar', () => {
    // `progress` paints a full bar danger-red. A share of screen time is not
    // a budget, and red would be this screen calling somebody's most-used
    // application a problem.
    assert.not(/\bprogress\(/.test(module), 'the screen paints a share as a budget');
    assert.includes(module, 'wellbeing-bar');
  });

  test('and the bar is never the only signal', () => {
    assert.includes(module, 'aria-label');
    assert.includes(module, "t('wellbeing.hoursMinutes'");
  });
});
