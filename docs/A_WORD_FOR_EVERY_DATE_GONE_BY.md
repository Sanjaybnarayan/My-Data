# One word for twenty-three different things

Phase 11's actionable half. Phase 11 is **BLOCKED** on ABDM participant
status — a government registration, not code, with a refusal probe on that row
so nobody closes the gap by pretending. What follows is the health work that
does not need it, and it turned out not to be health-only.

## What the screen said

A date behind today rendered as a red badge reading **`overdue 9 days ago`**,
from a literal in `dueBadge`:

```js
const label = days < 0 ? `overdue ${relativeDays(day)}` : relativeDays(day);
```

One word, on all **23** expiry fields the schema declares, across 19 entities.

`js/domain/duewords.js` exists because that is the wrong shape. It was written
when the reminder line read *"next dose on expires today"*, and its opening
argument is exactly this one:

> A follow-up date passing is not something *expiring*, and a vaccination's
> next dose does not *expire* — the appointment for it may be missed, which is
> a different claim and not one this application is in a position to make.

Every one of those 23 fields already has a past-tense phrase there. The badge
spoke **none** of them. The fix was applied to one renderer and not the other.

| field | badge said | the phrase that existed |
| --- | --- | --- |
| `medication.endsOn` | overdue 3 days ago | **ended** 3 days ago |
| `appointment.date` | overdue 9 days ago | **was** 9 days ago |
| `holding.maturesOn` | overdue 6 days ago | **matured** 6 days ago |
| `vaccination.nextDoseOn` | overdue 30 days ago | **next dose was due** 30 days ago |
| `healthRecord.followUpOn` | overdue 60 days ago | **follow-up was due** 60 days ago |
| `policy.renewsOn` | overdue 4 days ago | **renewed** 4 days ago |

`holding.maturesOn` shows the shape without any clinical argument attached: a
fixed deposit that matured last week is money the household has, shown in red
and called overdue.

## Why it is worse on this screen than anywhere else

`js/modules/health.js` opens by saying what it will not do:

> a screen that said "overdue" about somebody's medicine would be making a
> claim about their treatment out of a tick box nobody remembered to untick.

The questions card obeys that with some care. It asks *"Did the appointment for
Physiotherapy review happen? It is still marked scheduled and the date has
passed"* — a question, never a verdict, deliberately not the word "missed".

Eight rows below it, the table showed the same appointment with a red
**overdue 9 days ago**.

Both were on screen together, in one screenshot. The card argues at length
that it cannot know whether somebody went; the badge underneath says they are
late.

## The check that could not see it

The browser suite already had this:

```js
for (const word of ['overdue', 'at risk', 'you should', 'urgent']) {
  check(`the health screen never says "${word}"`,
    !new RegExp(word, 'i').test(raised), …);
}
```

Named *the health screen*, given `raised` — the questions card alone. The
variable holding the whole screen was in scope and used two blocks later.

So the guard passed, every day, while the screen said the word it forbids.
`docs/HEALTH.md` reported it as *"the browser suite asserts the same of the
rendered card"*, which was true and was not what the check was named.

**Reading one screen would still not have been enough.** The four health dates
live on four different tabs, and only one of them is drawn at a time. The check
now walks all four.

## The fourth field is not on any tab

Written first as "every health tab draws a badge for a date behind today", the
new check failed on `healthRecord` — correctly. `followUpOn` is `list: false`,
so it never reaches the table; its badge is drawn on the record's own screen by
`crud.js`, the other of `dueBadge`'s two generic call sites.

The check now asserts **three** tabs and opens the record for the fourth, which
is better than the version I meant to write: it exercises both call sites
rather than one.

## The fix

`dueBadge` takes the schema field key and asks `duewords.js` how that field
speaks about a date behind today. A field it has no phrase for gets the bare
distance — `9 days ago` — and no verb at all. The distance is a fact; a word
chosen for a field nobody wrote one for is how *"next dose on expires today"*
happened in the first place.

Ahead of the day nothing changed: the badge sits beside the date itself, so
`in 16 days` is already the whole message.

This is the first import from `ui/` into `domain/` in the repository. The
alternative was four call sites each deciding how a passed date is spoken,
which is the thing a shared component exists to prevent, and `duewords.js` is a
vocabulary table with no imports of its own.

## Two smaller things on the same card

**A raw ISO date.** The *Being taken, and coming up* card pasted `one.date`
straight in, so it read `2026-09-22` directly above a table reading
`22 Sep 2026`. The only two places that date appears on the screen, disagreeing.

**A badge that said nothing.** Every appointment row carried the constant word
`ahead`, under a heading that already says *coming up*.
`HealthService#current` sorts these by `said.days` and then drops the number;
the table below was rendering `in 16 days` from the same date all along. The
badge now says the distance, and the `health.current.ahead` key is gone —
which the live-doc ratchet caught immediately, 917 locale keys to 916.

## Tests, and what each would miss alone

The unit checks are driven off the schema rather than a list written beside
them, so a new expiry field is covered the day it is declared:

| check | fails when |
| --- | --- |
| the schema declares expiry fields for this to walk | the walk enumerates nothing |
| every one of them has a phrase | a new field would fall back to a bare number |
| the badge says that phrase rather than "overdue" | the literal comes back |
| ended / matured / was / next dose was due | the phrases are wrong rather than absent |
| a date ahead is the distance alone | a verb leaks into the future tense |
| an unknown field gets the bare distance | a fallback word is invented |

The fourth row exists because the third would pass on phrases nobody had read.
The sixth exists because the third would pass on a generic word applied
everywhere.

Mutations, all caught, each verified with `grep -c` **before** the run rather
than assumed to have applied:

| mutation | caught by |
| --- | --- |
| back to the `overdue` literal | the sweep, the named four, and the unknown-field check |
| invent "lapsed" for an unknown field | the unknown-field check alone |
| revert the fix, browser | three tabs and the record screen |

That last one is the one worth keeping: it is the same code the old guard
passed on.

## A mistake in the test, not the code

The first version of the unit helper read `el.children[0]` to get the badge's
words. The DOM stub wraps text in `{ nodeType: 3, textContent }`, so every
label came back as the string `[object Object]` — which contains no "overdue",
and would have passed a check written as `!/overdue/.test(said)`. It failed
only because four of the checks assert the exact words instead.

## What this does not touch

Phase 11 stays **BLOCKED**. ABDM is a registration this repository cannot
write, and none of the above moves it. Nothing here has been read by a doctor
or a pharmacist, and the findings are still arithmetic on dates.
