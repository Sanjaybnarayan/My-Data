# Strings Frozen At Import

`js/core/backgroundlocation.js`, `js/core/screentime.js`, `js/core/scopes.js`,
`js/data/consent.js`, and the two screens that draw them.

## The fault

    export const BLOCKED = Object.freeze({
      UNSUPPORTED: t('trail.blocked.unsupported'),
      …
    });

`t()` at module scope runs **once**, when the file is first imported, and keeps
whatever language was active at that moment. Change language afterwards and the
value never moves. `Object.freeze` made it worse only by advertising the result
as settled.

This repository already knew. `js/modules/finance.js:41` and
`js/modules/calendar.js:44` each carry a note about it, both written while
repairing it. And two files in the same directory as the worst offender had it
right the whole time — `js/core/position.js` and `js/core/smsinbox.js` keep a
plain `'unsupported'` identifier and call `t()` where the text is drawn, which
is what `js/domain/wellbeing.js` does too with its `key:` fields.

## What was actually affected

| file | strings | reaches |
| --- | --- | --- |
| `js/core/backgroundlocation.js` | 4 | Safety, `modules/safety.js:129` |
| `js/data/consent.js` | 4 | Settings, the consent card |
| `js/core/scopes.js` | 3 | Settings, the OAuth scope list |
| `js/core/screentime.js` | 2 | nothing yet |

**Thirteen, not nine.** The first sweep for this searched `js/core`,
`js/domain` and `js/services` and reported nine across three files. `js/data`
was not in it. A count from a sweep is only as wide as the sweep, and the
number was quoted before the limit was.

**And it was not latent.** It was first written up as harmless "while there is
only English". That was wrong: `state.blocked` is rendered directly onto the
Safety screen and a scope's `title` and `why` onto Settings. Those are frozen
sentences on screens a household opens.

## The part that had to be got right

Because these values are rendered, changing them from sentences to keys without
changing the renderers would have printed `trail.blocked.foreground` to a
person. So every reader was traced before a value moved:

- `js/modules/safety.js:129` now draws `t(state.blocked)`.
- `js/modules/settings/privacy.js` translates a scope's title and reason, and a
  purpose's title, what and without.
- `js/data/consent.js` translates a purpose's title into the report it builds.

The migration works one entry at a time because **`t()` returns an unknown key
unchanged** — `text = english ?? key`. The scope registry is mixed: one entry
routed, the rest still English written straight into the file, which the
unrouted ratchet counts. Both kinds pass through `t()` on the way to the screen
and only the routed one changes.

## Two checks that were reading the English

    assert.ok(scope.why?.length > 20, `${scope.id} does not say what it is for`);
    assert.includes(purpose.without.toLowerCase(), 'nothing is read');

`'scope.sendMail.why'` is eighteen characters, so the first failed the moment
the value became a key; the second failed on the key text. Both are asking a
real question — does this scope explain itself, does this purpose say a "no"
stops something — about the sentence somebody reads. So both resolve through
`t()` now, which is the path the screen takes, rather than being relaxed.

## The guard

The general rule is "no `t()` above function scope, anywhere". It cannot be
written as a line regex, because scope needs a parser, and `tools/lint.mjs`
says plainly that a rule whose findings are wrong is worse than no rule —
`js/domain/finance.js` has `export const comparedWith = (compare) => t(...)` on
two lines, which any such regex reports and which is perfectly correct.

So the check is on the property rather than the syntax, and there is one
available: since `t()` returns an unknown key unchanged, **a value that changes
when passed through `t()` is a key.** A registry translated at import holds the
finished sentence, `t()` does not recognise it, and it comes back identical.

Four tests in `tests/locale.test.mjs` assert that of the four registries, each
with a guard that at least one entry is routed — otherwise a registry that
stopped being routed at all would satisfy every "still reads" assertion beneath
it.

Proved by mutation. Putting one sentence back:

    FAIL  the trail says why it is blocked with keys —
          the app needs permission to see where you are is not a key the catalogue knows
    FAIL  the recorded inventory matches what is in the tree —
          3034 unrouted English strings, up from 3033

Three mechanisms caught it: the new guard by name, the unrouted-strings ratchet
by count, and `self-description` by the doc numbers going stale.
