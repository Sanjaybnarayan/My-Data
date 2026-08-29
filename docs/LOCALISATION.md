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
| `js/locale/en.js` | The authoritative catalogue. 654<!--live:localeKeys--> keys today |
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

**3,276<!--live:unroutedStrings--> English strings, across 154<!--live:unroutedFiles--> files.** That is the measured count from
`node tools/strings.mjs`, and it is the number that matters. They are written
directly into the source, so no catalogue can reach them and no translator will
ever see them.

The count is a ratchet and it may only fall. It does not require anybody to
translate anything; it requires the application to stop growing new English it
cannot hand to a translator.

What *is* reachable today:

- 654<!--live:localeKeys--> UI message keys — dates, the generic record screens, the language card
- 745<!--live:labelKeys--> schema label keys — 25<!--live:modules--> modules, 53<!--live:entities--> entities in two forms each, 614<!--live:fields--> fields

745<!--live:labelKeys--> of those are derived from the schema by `labelKeys()`, so a new entity is
something a translator is told about rather than something they discover.

## Why no second language ships

Not because the mechanism is not ready. Because nobody has translated anything,
and machine-translating 3,276<!--live:unroutedStrings--> strings of Indian financial and legal vocabulary
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

1. `js/locale/en.js` — 654<!--live:localeKeys--> strings, whole sentences, with `{placeholders}`
   intact. Every placeholder must survive or the line is refused.
2. The 745<!--live:labelKeys--> label keys from `labelKeys()` — entity names, field names, module
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
