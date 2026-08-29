# `t()` Paints the Key When the Catalogue Has None

`js/core/locale.js`, `js/modules/settings/privacy.js`, `tests/browser.mjs`,
`docs/LOCALISATION.md`.

## What was found

Phase 25's failure mode is silent by construction. `js/core/locale.js`:

```js
let text = english ?? key;
```

A key with no entry is not an error and not an empty string — it is the key,
painted onto the screen. A household reads `profile.lockNowHint` where a
sentence belongs, and nothing logs, throws, or turns red.

The same file's `interpolate` leaves a placeholder alone when its variable was
not passed, so a caller that forgets one ships `{count}` to a screen.

**Nothing compared the two lists.** 375 `t('...')` literals in the tree
against 580 keys in `js/locale/en.js`, and no check that every one of the 375
resolves.

## What the measurement found: nothing, and that is the answer

Every literal key resolves — checked by extracting them from source with
comments stripped and comparing against the catalogue. **Zero missing.**
Reported as a non-finding rather than dressed up as one.

But a static scan cannot see a **computed** key, and this application builds
plenty: `phraseKey(field, tense)` in `js/domain/duewords.js`, `t(group.title)`
in Profile, `t(mod.labelKey)` in the shell. So the reading is taken from what
is actually painted, on every screen the accessibility walk already opens —
about fifty of them, for free.

## The one thing it flagged, which was not a fault

Four strings on Settings: `drive.file`, `drive.appdata`, `gmail.readonly`,
`calendar.app.created`. Those are **OAuth scope names** — strings Google
defines, shown deliberately so a household can compare this list against the
consent screen character by character.

The fix is not to exempt four strings by name. They are machine identifiers,
so they are marked as machine identifiers: `<code class="scope-name">`, which
is also how a filename or a version is treated, and reads better for somebody
checking them against Google's own screen. The walk skips `code`, `pre` and
`.mono` — exactly the places this application puts an identifier on purpose.

## How it is checked

One line added to the walk that already visits every module, every entity
list, Profile, Settings, Notifications, Wellbeing, the timeline, an open chat
conversation and the statement importer:

> no screen shows a locale key or an unfilled placeholder

Text nodes only, drawn only, with filenames, domains and versions excluded by
suffix and identifiers excluded by their container.

Mutation-tested twice, and the first attempt is worth recording. Deleting
`profile.lockNow` was caught — by the *lock row* check, which matches on the
text "Lock now" and could no longer find it, and which then ended the run
before the walk reported. Detection, but not by the check being tested.

Deleting `profile.lockNowHint`, a subtitle nothing else asserts on:

```
692/693
  FAIL  no screen shows a locale key or an unfilled placeholder
        — #/profile: key "profile.lockNowHint"
```

The screen and the key, named.

## What this does not establish

**Phase 25 is not closer to done.** 3,490 strings are still written into the
source rather than routed through the catalogue, and nothing has been
translated into anything. This changes neither number.

What it changes is the consequence of routing a string wrongly: that used to
reach a household as a dotted identifier on a screen, and now reaches a
developer as a failing check. It makes the remaining 3,490 safer to move,
which is the work that would actually advance the phase — and that work needs
a translator, not a build machine.
