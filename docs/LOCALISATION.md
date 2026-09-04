# Localisation

FamilyOS is available in English only.

That is the honest headline, and this document exists because the tempting
version of it was not. A `t()` function, a language menu and a few hundred
translated lines look exactly like a translated application right up until
somebody switches language and finds two thirds of their money in English.

## What was built

A locale layer — `js/core/locale.js` — and the plumbing to reach it. What it
does is make a second language *possible* and make an incomplete one
*impossible to hide*. It does not translate anything.

| Piece | What it is |
| --- | --- |
| `js/core/locale.js` | `t()`, catalogue registration, the active language, and the measurements below |
| `js/locale/en.js` | The authoritative catalogue. 876<!--live:localeKeys--> keys today |
| `js/core/labels.js` | The one door the schema's English passes through on its way to a screen |
| `tools/strings.mjs` | Counts the English still written directly into the source |

## The three rules

**A missing translation falls back to English, never to a key.** A screen
reading `record.emptyTitle` where a sentence should be looks broken in a way
that makes people distrust the numbers next to it.

**Coverage is derived, not declared.** A catalogue cannot state how complete it
is; it is measured against the English one and the schema's label inventory
every time it is asked. This repository has now found six places where a
hand-maintained list sat beside a derivable one and drifted — twice inside
checks written to prevent exactly that — so no catalogue gets to describe
itself.

**A translation that loses a placeholder is refused.** `You spent {amount} on
{category}` rendered as a sentence with no `{amount}` in it is not a worse
translation, it is a different statement: the household is told they spent, and
not how much. Rule 57 says every financial event must be explainable, and an
explanation with the number missing explains nothing. Such a line is dropped
back to English, collected by `missing()`, and shown on the language card so
both the household and the translator know which line broke and why.

Because that check is real, it also means a language cannot raise its coverage
with strings the application will never show. A refused line counts as zero.

## What still cannot be translated

**3,033<!--live:unroutedStrings--> English strings, across 157<!--live:unroutedFiles--> files.** That is the measured count from
`node tools/strings.mjs`, and it is the number that matters. They are written
directly into the source, so no catalogue can reach them and no translator will
ever see them.

The count is a ratchet and it may only fall. It does not require anybody to
translate anything; it requires the application to stop growing new English it
cannot hand to a translator.

### The two commits where it rose, and what paying it back cost

It had only ever fallen — 3,501, 3,499, 3,490, 3,476, 3,095, 3,089 — until two
commits raised it by 12 and then 34, both of them adding assistant intents, and
both made to pass by rewriting the record with `--update`. That is not using the
ratchet, it is stepping over it: `check()` fails only when the current count
exceeds the record, so re-recording is the one move that turns a rise into a
pass. `tests/locale.test.mjs` asserts the check *can* fail, on the principle
that a check that cannot is worse than no check; nothing asserted that the
record itself was not being moved to meet the tree.

**Why the assistant's own English was not the thing to route.** The obvious
repair — put `js/ai/intents.js` through `t()` — is the wrong one, and worth
writing down so it is not attempted later. The assistant recognises a question
by matching English regular expressions, so routing its answers and its example
questions would produce an assistant that replies in Hindi and understands only
English, with a help panel suggesting questions its own parser rejects. That is
the failure this document exists to prevent, built deliberately. The intent
layer is translatable only together with multilingual matching, which is a
different piece of work; until then its English is load-bearing.

**So the debt was paid somewhere it could be.** `js/modules/settings/data.js`
held 72 unrouted sentences of ordinary UI prose — the erase confirmation, the
backup and restore dialogs, what a deletion left behind. All but one are now
catalogue keys in `js/locale/en-settings-data.js`, and the count fell to
3,056: below the 3,101 the rise was measured against, and below the 3,089 that
preceded both commits. That figure is history and carries no live marker — it
had one, and the marker rewrote it to the current count the next time the
number moved, turning a record of what one commit achieved into a claim about
the tree today.

Four of those sentences had been concatenated across three and seven source
lines. They are one key each now, because the placeholder check can only guard
a whole sentence and a translator needs the sentence rather than the halves
English happened to break it into. Two things came out of doing it:

- **`Type ERASE to confirm` was a trap.** The word is compared against a
  literal, so a translation that localised it would have told somebody to type
  something the check then rejects. It is `Type {word} to confirm` now, with the
  word passed in from the constant the comparison uses.
- **The one string left unrouted is the backup's filename**, `FamilyOS backup
  {day}.familyos`. The placeholder check guards `{day}` and cannot guard the
  extension, so a translation that dropped `.familyos` would produce a file that
  will not reopen. A filename is not prose and is better left in one language.

### And again, for the assistant's coverage

Phase 18 raised it by 105 — 88 answer sentences in `js/ai/intents-household.js`
and 17 refusal reasons in `js/ai/coverage.js` — and the same argument applies to
the first group for the same reason: an assistant that replies in Hindi and
parses only English is worse than one that does neither.

The reasons in `coverage.js` are a different case and are counted anyway. They
are read by a test and shown to nobody, so a translator handed them would be
translating text that never renders. Excusing them would mean a rule saying
which files hold prose for people and which hold prose for tests, and this
repository has now found eight hand-maintained lists that drifted from a
derivable one. Being over-counted by seventeen is the cheaper mistake.

So the debt was paid on `js/modules/finance.js`, whose 79 strings were screen
labels and figure captions — the kind that route cleanly. They are
`js/locale/en-finance-screen.js` now, whole sentences with named placeholders
rather than the fragments the template literals had been assembled from. Two
things came out of doing it:

- **A `t()` call in a module-level constant resolves once.** The tab labels are
  built when the module loads, so a key looked up there would keep whichever
  language was active at import and never follow a change. That tab carries a
  `labelKey` and is resolved at render instead. `js/modules/calendar.js:45` still
  has the original shape.
- **The file went over the 800-line cap** the module-size ratchet holds it to,
  because a routed call site is taller than the literal it replaced. The
  transfers card moved to `js/modules/finance-transfers.js` rather than the cap
  moving.

Routing 54 keys in also made the UI catalogue larger than the schema's label
set for the first time, which failed two assertions in `tests/locale.test.mjs`
that had been written when labels were the larger half — `c < 0.5` and
`labels.length > strings`. Neither had found a fault. They were constants
standing in for a relationship, which is the same shape as the hand-maintained
list this repository keeps replacing, and they are now stated as the
relationship: the untranslated remainder is exactly the schema labels.

What *is* reachable today:

- 876<!--live:localeKeys--> UI message keys — dates, the generic record screens, the language card
- 748<!--live:labelKeys--> schema label keys — 25<!--live:modules--> modules, 53<!--live:entities--> entities in two forms each, 617<!--live:fields--> fields

748<!--live:labelKeys--> of those are derived from the schema by `labelKeys()`, so a new entity is
something a translator is told about rather than something they discover.

## Why no second language ships

Not because the mechanism is not ready. Because nobody has translated anything,
and machine-translating 3,033<!--live:unroutedStrings--> strings of Indian financial and legal vocabulary
would have produced something worse than English.

The application says things like *a credit-card settlement is not an expense*,
*this account transaction is not an economic event*, and *the recovery phrase
restores a key, not data*. Those sentences are load-bearing — they are the
difference between a household understanding their own records and
misreading them. A guessed translation of one of them is not a rough edge, it
is a false statement about somebody's money, delivered with the same confidence
as the true one. And the household cannot check it, which is precisely why it
would be the wrong thing to ship.

So the position is: the door is built and unlocked, and it stays honest about
being empty.

## What a translator would need

1. `js/locale/en.js` — 876<!--live:localeKeys--> strings, whole sentences, with `{placeholders}`
   intact. Every placeholder must survive or the line is refused.
2. The 748<!--live:labelKeys--> label keys from `labelKeys()` — entity names, field names, module
   names.
3. A decision on `midSentence`: `'lower'` if the language lowercases nouns
   inside a sentence the way English does, `'preserve'` otherwise. German
   capitalises every noun; Hindi has no letter case for the rule to apply to.
   English used to make this decision in nine places by calling
   `.toLowerCase()` at the call site, which is nine copies of an assumption
   about English buried in the UI layer.
4. `dir: 'rtl'` where it applies. The layer sets `lang` and `dir` on the root
   element; the stylesheet has **not** been audited for right-to-left, and
   claiming otherwise without testing it would be the same failure this
   document is about.

## What none of this can tell you

Whether a translation is any good, or even in the right language. The layer
compares placeholders and counts keys. A catalogue full of nonsense that keeps
its `{amount}` intact scores exactly the same as a careful one.

`tools/strings.mjs` is also blind to a sentence assembled at runtime from two
routed halves. Concatenation is the fault this work exists to fix and the one
thing a string counter cannot see, which is why the catalogue holds whole
sentences and why the review has to be a human one.

And nothing here has been tested with a real second language in a real browser,
because there is no real second language. The pieces are covered by
`tests/locale.test.mjs`, including a catalogue that reorders a date and one
that drops a placeholder; that is not the same as a household using the
application in Hindi for a week.

## A missing key reaches the screen, not the log

`t()` returns the key itself when the catalogue has no entry, so routing a
string wrongly used to ship `profile.lockNowHint` to a household silently.
The browser suite now reads every screen it walks for text shaped like a key
or an unfilled `{placeholder}`. See `docs/LOCALE_KEY_LEAKS.md`, including the
four OAuth scope names it flagged that are not faults.
