# Six rows all called "buy"

A holding's **Connected records** card listed six rows, every one of them
reading `buy`, above a subtitle reading `Investment transactions · via Holding`
— which is the group's own description and therefore identical for every row
in it by construction. Nothing on the card told one from another.

The same titles are what the timeline shows, what search returns, and what the
delete-impact dialog names before it asks you to confirm.

## The shape, not the typo

    title: (r) => `${r.kind} ${r.units ?? ''}`.trim()

`kind` is a `pick` of nine values. `units` is optional. So the moment `units`
is absent the title is the bare pick, and every buy on a holding is the same
row. Two other entities had the same shape:

| | title was | records | distinct titles |
| --- | --- | --- | --- |
| `investmentTransaction` | `kind` + optional `units` | 6 | **1** |
| `locationPing` | `zoneName` or a literal | 4 | **1** |
| `vehicleService` | `kind` alone | 3 | 2 |

`locationPing` is the one that reads worst: a literal fallback made every
reading outside a named zone the same row, on a safety screen.

Each of the three has a **required** date, so each now carries it. Measured
again on the same household, `investmentTransaction` went from one distinct
title to six — and the dates say something the six identical rows could not:
the buys are a monthly instalment on the 7th.

    buy · 2026-04-07
    buy · 2026-05-07
    buy · 2026-06-07

## What was left alone, and why

The sweep found nine entities producing duplicate titles. Six are not defects:

- **`transaction`** — 29 of 105 read "Sampige Stores". The ledger shows the
  date and the amount in their own columns, so the payee is the right title
  there; the duplication is the household shopping at the same place.
- **`account`**, **`education`** — the household's own naming. Two records for
  one school is two people at one school.
- **`identityDocument`** — "Passport" repeats because a household has several.
- **`relationship`** — "parent of" needs the two people to be identifiable, and
  a `title` is a pure function of one record with no way to resolve a
  reference. Out of reach from here.
- **`smsMessage`** — the sender is the title, and one bank sends many.

The rule applied is narrower than "make titles unique": **a title should carry
something the record's own required fields can distinguish it by.** Where that
is impossible, or where an adjacent column already carries it, nothing changed.

## What the test measures

Every other field held still, one required field moved. If the titles still
match, the title is not identifying the record.

Guarded two ways: both titles must be non-empty, or "they differ" would be
vacuously interesting; and the distinguishing value must actually appear in
the output, not merely have been available to the function.

Mutation-proven three times — restoring each old title fails its own test and
no other. That mattered here: the first attempt at the mutation missed
`locationPing`, because the source carried `·` where the search expected a
literal `·`, and the test appeared to pass when it had simply never run. The
character is now written the same way in all three.

## A note on where the reasoning lives

None of this is commented in `js/data/schema.js`. `tools/module-size.mjs`
freezes that file deliberately — *"a declarative file nobody wants growing"* —
and eight lines of explanation would have broken the freeze for prose. The
three changes are line-for-line replacements; the reasoning is here.
