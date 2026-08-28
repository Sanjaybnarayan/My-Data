# Records, Not A Second Opinion

`js/domain/health.js`, `js/services/health.js`, `js/modules/health.js`.
Tested in `tests/health.test.mjs` and the browser suite.

## What this module holds

Four kinds of record — `healthRecord`, `medication`, `vaccination`,
`appointment` — and every one of them is something a person wrote down after
being told it. Nothing here is measured by this application and nothing is
checked by anybody.

That sentence is the whole design. A wrong figure on the finance screen costs
somebody an afternoon with a statement. A wrong inference about a medicine
could cost more than that, and the honest answer to almost every clinical
question is that this application does not know.

## What the screen adds, and what it does not

Before this, `health` was the generic CRUD module: four tabs, four tables. It
still is — the tabs and lists are unchanged and nothing was removed. What is
added above them is the one thing four separate lists cannot show: **where the
records contradict each other, and where a date they set has gone by.**

Five findings, and each is phrased as a question:

| finding | what it says |
| --- | --- |
| `stillTaking` | ongoing is ticked and the end date has passed |
| `stoppedWhen` | not ongoing, and no end date |
| `didTheyGo` | still marked scheduled, and the date has passed |
| `nextDose` | the next-dose date has passed and no later dose is recorded |
| `followedUp` | the follow-up date has passed and nothing says either way |

A question, not a verdict. `ongoing` defaults to true and nothing ever unticks
it, so a screen that said "overdue" about somebody's tablets would be making a
claim about their treatment out of a tick box nobody remembered to untick. Only
the household can settle these, and `didTheyGo` deliberately does **not** say
"missed" — that is a value a person can choose on the record, and deriving it
would be this screen deciding somebody did not turn up.

A unit test asserts none of the five sentences contains *overdue*, *at risk*,
*you should*, *dangerous* or *urgent*, and the browser suite asserts the same
of the rendered card.

### The next dose is answered from the records, not from the date

A vaccination whose `nextDoseOn` was in March is not outstanding if a later
dose of the same vaccine, for the same person, was recorded in April. Asking
only "is the date in the past" would keep raising a question the household had
already answered, and a screen that keeps asking answered questions is one
people stop reading.

Vaccine names are compared trimmed and case-folded, and no further. `Hep B` and
`Hepatitis B` are **not** matched: they may well be the same jab, but deciding
that is a clinical judgement, and getting it wrong would silently mark a dose
as given.

### Ordering is by how long, not by kind

Longest unanswered first, across all four kinds, with the record id as a stable
tie-break. Grouping by entity would bury a prescription that ran out in January
under whichever kind happened to be listed first.

## "Being taken" is derived, never read from the tick box

The current-medications list comes from `medicationState`, not from `ongoing`.
A list built from that field alone shows a course that finished months ago,
which is precisely the record the questions card is asking about — the screen
would have contradicted itself on the same page. A browser check seeds two
records with `ongoing: true`, only one of them still running, and fails if the
finished one appears.

## The one schema change

`medication.endsOn` now carries `expiry: true` with a seven-day lead.

Three of the four health dates already reached the reminders — a follow-up
(lead 7), a next dose (21), an appointment (3). The tablets running out did
not, and that is the one a household has to act on *before* the day arrives
rather than after it. A browser check creates a course ending in four days and
requires it to appear on the Notifications tab.

That check took three attempts to make honest. Reading the whole dashboard
passed with the flag removed, because creating the record writes an audit entry
and the activity widget prints the name. The `Expiring & due` card is the right
kind of place but is off by default (`wallet` and `attention` cover the same
records better on a phone). Notifications is where the list actually lives.

The reasoning lives in `js/domain/health.js` rather than beside the field,
because `js/data/schema.js` is at the ceiling `tools/module-size.mjs` freezes:
three lines of comment there fail the gate, and the rule is to move prose out
rather than raise the number.

### And two stale entries it exposed on the dashboard

`WIDGETS_NEED` in `js/modules/dashboard.js` is the hand-written list of
entities the dashboard's own widgets need for reasons other than a date. Making
`medication` dated made it derivable, and a name in both lists is how the two
begin to disagree — a test already existed for that and caught it.

Removing it turned up a second: `investmentTransaction` was in the list and
read by **nothing**. Not a widget, not `allReminders` (it carries no date), not
`attentionFrom`. Every dashboard paint read up to the transaction limit of them
and dropped them, on the first screen a household opens. A new test now
requires every name left in that list to appear somewhere else in the file.

That test needed a second attempt too: the first version searched the whole
file, and the comment explaining why `investmentTransaction` had been removed
contained the word `investmentTransaction`, so putting it back passed. It reads
the code with comments stripped now.

## What this cannot show, said on the screen

Six statements, drawn from `CANNOT_SHOW` rather than left in a comment where a
household would never see them:

- **No steps, exercise, sleep or activity.** Those need a phone's sensors or a
  wearable, and this application reads neither.
- **No heart rate, blood pressure, blood oxygen, temperature or body
  composition.** Nothing here is measured.
- **No cycle tracking or predictions.** A prediction is a clinical claim.
- **Nothing checks these medicines against each other.** There is no drug
  database here, and two medicines appearing side by side might otherwise look
  as though something had checked them. This is the most important one on the
  list.
- **No adherence figure.** Nothing records a dose being taken, so any
  percentage would be arithmetic on data that does not exist.
- **No advice, no diagnosis and no score.** There is no honest way to turn four
  kinds of record into a number about somebody's health, and a number is what
  people remember.

The empty state is worded to match. It says *nothing in these records
contradicts itself* and then says, in the same breath, that this is a statement
about the records and not about anybody's health. A test asserts it never says
*healthy*, *all well*, *in good health* or *fine* — a household reading a green
badge as reassurance about their health would have been misled by it.

## Not run on a device, and not reviewed by a clinician

The findings are arithmetic on dates and one string comparison. Nothing here
has been read by a doctor or a pharmacist, and nothing in it should be treated
as though it had been.
