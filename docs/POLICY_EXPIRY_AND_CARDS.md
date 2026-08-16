# Two Rules That Were Confident Where The Document Was Not

Both items carried forward from `docs/DOCUMENT_FORMATS.md`, and both turn out
to be the same failure in different clothes.

## A policy that states two expiry dates

`readPolicy` knew `expiry date` and did **not** know `date of expiry`, which is
what an Indian insurer actually writes. So two real motor policies yielded no
expiry at all — the field the whole reminder machinery turns on.

The obvious fix is to add the label. Measured first, it would have been wrong.

**The Tata AIG schedule states `Date of Expiry` twice, with different dates:**
`09/07/2026` and `05/07/2027`. It is a standalone own-damage policy, and it
prints the third-party cover it sits beside. One of those two is not this
policy's expiry, and nothing in the text says which without knowing what OD and
TP mean. A naive `readLabelledDate` returns the first one it finds — a
confident, wrong renewal date.

**The Acko policy's period reads `18 May 25 12:00 AM to 17`** — the end date
lost to column interleaving in the PDF. A range with no second date is not a
range, and its start is emphatically not an expiry: filing it would put a
renewal reminder a year in the past.

So `expiryOf` collects every date under an expiry label, and every *second*
date under a period label:

- one date → `expiresOn`
- two or more that disagree → **`expiresOn` is absent**, and `expiryConflict`
  carries them so a screen can say *which* dates the document gave rather than
  going quiet
- a range missing its end → skipped, not read as a point

This is the rule `readEitherSide` already follows, applied to the field where
guessing costs most. A reminder on the wrong date is worse than no reminder,
because it stops anybody looking for the right one.

### What it does and does not deliver

Honestly: **neither of the household's two motor policies gains an expiry
date.** One is truncated in the file and one genuinely says two things. What
changes is that a common label is now understood, so an ordinary policy that
states its expiry once will be read — and that the ambiguous one is reported as
ambiguous instead of being answered wrongly the moment the label was added.

## Sixteen digits are not a card

The `Card` rule matched any sixteen digits with no label required, and its own
comment defended that: *"there is no benign reason for sixteen digits in that
shape to sit in a searchable field."* Measured against a real statement, a
Google Workspace payment reference inside a UPI narration matched, was stripped
from the household's own searchable text, and was handed back as a card number.

Now: if a word **beside** the digits names a card, they go whatever they add up
to — a mis-scanned card number is still a card number, and that is not the case
to be clever about. Otherwise they must pass **Luhn**, which every real card
satisfies by construction and which roughly nine in ten arbitrary sixteen-digit
strings fail.

This is not a loosening in the direction that matters. Nothing that was
correctly protected loses protection: real cards pass Luhn, and anything a
document calls a card is redacted regardless.

### I got it wrong the first time, in a way the tests would not have caught

The first version asked whether the word "card" appeared **anywhere in the
document**. A bank statement always says it somewhere — an annual fee, a card
network's name in a narration — so the check passed globally, the Luhn test
never ran, and the false positive survived completely unchanged.

It was caught by re-running the measurement against the real statement rather
than by the tests, which all passed. The rule now reads a **40-character window
around the match**, and a test puts the word "card" thirty lines away and
asserts the digits survive.

Presence is not proximity. That is the same lesson the `at`-anchored chassis and
engine rules were built on, one tranche earlier, and I repeated the mistake
anyway.

## What mutation testing found

Seven mutations. **Six caught, one equivalent** — making the second date of a
period range optional changes no behaviour, because the code only ever reads
the second group and an absent group is skipped either way. Recorded as
equivalent rather than counted as caught.

| Mutation | Caught by |
| --- | --- |
| Luhn removed | *fails Luhn and has nothing naming it is left alone* |
| The card word no longer overrides Luhn | *a word beside it naming a card wins* |
| Context widened to the whole document | *must be beside it, not merely somewhere* |
| A conflict picks the earliest date | two tests, including the reminder one |
| A range takes its first date | *the expiry is its second date* |
| `date of expiry` unknown again | two tests |
| Range's second date made optional | **equivalent — no behaviour change** |

## What is still not built

**A `certificate` kind**, for the blood donation certificate.

**One file, two documents** — a dealer's GST invoice and an RTO tax receipt in
one PDF. A missing concept, not a missing pattern.

**Spacing.** `con rm ation` still. Needs glyph widths this reader does not
parse.

`expiryConflict` **is now on screen** — see the section below, written after
this and in answer to the paragraph that used to be here.

## The conflict had to reach a screen, or it was not worth computing

`expiryConflict` was returned by `readPolicy`, asserted by tests, and read by
nothing. That is the headless-engine pattern this repository has found five
times now, and it matters more here than usual: a policy whose expiry is
ambiguous has no `expiresOn`, so it is **absent from the documents screen's
Expiring list** — which reads exactly like a policy with nothing to renew.
Refusing to guess had made the document quieter than guessing would have.

Three pieces close it:

- `document.expiryConflict` on the schema, hidden from the form. Hidden
  because it is not a field anybody fills in; it is a note the reader left.
- `suggestions` carries the dates onto the record — but **never over a date a
  person already set**. Once somebody has decided, the disagreement is settled,
  and repeating it on their own record is noise. A test asserts it, and the
  mutation removing the guard fails.
- An **Expiry unclear** card on the documents screen, beside Expiring, naming
  the dates the document gave: *"states 2026-07-09, 2027-07-05"*, with a line
  saying to open it and set the one it should renew on.

The architecture document gained `wired:js/modules/documents.js#expiryConflict`,
verified by deleting the render and watching it fail with the row named —
because twice before a screen panel was built and nothing in the repository
would have noticed its absence.
