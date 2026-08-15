# The Empty List That Would Have Meant Nothing Is Wrong

`js/services/estate.js`, the `nominations` dashboard widget, and a guard in
`js/domain/estate.js`. Tested in `tests/estate.test.mjs`,
`tests/services.test.mjs` and the browser suite.

## The trap this tranche walked into

`docs/NOMINATIONS.md` closed the way the two tranches around it did — *no
screen* — and putting one on the dashboard is where the two halves of the
previous work collided.

That tranche made all three nominee fields `encrypted: true`, correcting an
inconsistency where the same fact was sealed on `account` and plaintext on
`holding` and `policy`. Meanwhile `modules/dashboard.js` loads **twenty-two
entities in one pass with `decrypt: false`**, because nine widgets each
decrypting the same rows is exactly the cost that loader exists to avoid.

A nominations widget built from that data would have read ciphertext where a
name should be. And the failure runs in the worst possible direction:

- `enc:v1:…` is a non-empty string, so **every record looks as though it has a
  nominee**
- therefore the gap list comes out **empty**
- therefore the one screen built to say *"these have nobody named on them"*
  says nothing at all

An empty list on that screen does not read as an error. It reads as good news.

## What was done about it

**`domain/estate.js` refuses to read a sealed value.** It is neither a nominee
nor a gap: it is counted as `unreadable` and named on screen as a record that
could not be read here. That is a bug report, not a finding, and it is the
shape this repository already uses for *"a wrong value is a claim; a missing one
is a gap"*.

**`EstateService` asks for the three entities decrypted** and leaves the other
nineteen alone. Three decrypted lists is the cost of an answer that is true; the
dashboard's single pass is preserved for everything else. The `decrypt: true` is
written out explicitly in `ESTATE_LOAD` rather than left to the default, so
changing it is a decision rather than a typo — and a test asserts it.

**A browser check fills a nominee through the real form** and asserts that
`enc:v1:` appears nowhere on the dashboard, that the account carrying a nominee
is absent from the gap list, and that the ones without are in it. The round trip
through real AES-GCM is the only way to know the guard is not merely tidy.

## What the widget shows

```
Nobody nominated                                                        [2]

  A nominee is who an institution may pay, not who inherits. That is settled by
  a will or by succession law, and the two often differ. Nothing here decides
  who is entitled to anything.

  ICICI Salary          ICICI              ₹62,000
  Family health         Star                     —

  Known value at stake · 1 without one recorded            ₹62,000
```

Not ranked by money — an unnominated account becomes an unclaimed deposit
whatever its balance. The total sits *beside* the count rather than in place of
it, and a record whose value this screen does not know shows a dash, the same
way a card bill with no statement day does. Never a zero.

The widget draws nothing when there are no gaps and nothing unreadable.

## A redundant guard, found by mutation

Four mutations; one survived. Removing `sealed(...)` from the **gap** filter
changed no assertion — and could not have, because ciphertext is a non-empty
string and `plain(row.nominee)` already excluded it. The guard had been written
twice and the second copy was unreachable.

It is deleted rather than tested. Dead code that looks like a safety check is
worse than no check: the next reader trusts it.

The other three were caught: reading a sealed value as a nominee, never counting
one as unreadable, and loading the accounts undecrypted in the service.

## What is still not built

`explainability()` from `docs/EXPLAINABILITY.md` is still headless. Nothing
draws the nominee **groups**, the possible matches, or the *"what carries no
nominee field at all"* answer — the widget shows the gaps, which is the part a
household can act on, and the rest waits for a screen of its own.
