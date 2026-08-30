# Three days in, everything has fallen

A household that spends the same ₹258 every day, changing nothing, opened the
dashboard on the 2nd of the month and was told its spending was **94% below
last month** — in the colour reserved for good news. On the 10th, 68% below.
On the 21st, 32% below. Only on the 31st did the figure reach the truth, which
was zero.

The assistant said it in a sentence as well: *"Spending is 94% below last
month, at ₹516."*

Nothing had improved. The month had started.

## What it was

`comparePeriods` in `js/domain/finance.js` took the current month and the
previous month and returned the percentage between them:

```js
const thisMonth = totals(inPeriod(transactions, 'month', clock));
const lastMonth = totals(inPeriod(transactions, 'last-month', clock));
return { …, expenseChange: changePercent(lastMonth.expense, thisMonth.expense) };
```

Both figures are correct. The comparison is not, because the two are not the
same length of time until the last day of the month. Three consumers presented
the result as a trend:

| Where | What it did |
| --- | --- |
| `js/modules/dashboard.js` | `metric(…, { goodWhen: 'down', hint: 'vs last month' })` — a fall renders as an improvement |
| `js/modules/finance.js` | the same two metrics on the Finance screen |
| `js/ai/summary.js` | wrote the percentage into a sentence on the dashboard |

The bar charts had the same shape of problem: `monthlySeries` ends with the
month in progress, so the final bar was part of a month drawn to the same
scale as the eleven whole ones beside it.

## The part that makes it a finding rather than an oversight

This repository already knew, and had written it down three times.

`js/domain/unusual.js` states the rule in its header — *"A partial month is not
compared to whole ones. Three days into August, every category is 'down'. The
period being incomplete is stated on the result rather than silently skewing
it"* — and `unusualSpending` takes a `complete` flag so that a month in
progress "is reported but never used to claim a *fall*".

`js/domain/runway.js` drops the month in progress rather than divide by it:
*"it is a partial total, and dividing a partial month by a whole month's days
understates every day of it."*

`js/modules/finance.js` carries the worked example, in the comment above the
CFO screen: *"on the 21st, a partial month showed ₹1,05,000 saved against the
previous month's ₹84,000, and side by side that reads as an improvement rather
than as three missing weeks."* The CFO screen shows the month in progress in
its own card, marked, with a note saying it is not comparable.

So the rule was known, argued for, implemented, and tested — on the screen a
household visits when it wants a considered answer, and not on the two screens
it actually opens. `js/ai/summary.js` is the sharpest version: the branch that
states the comparison had no qualification, and the branch immediately below it
says *"spent so far this month"*. The same function, eight lines apart, hedged
in one place and not the other.

## What it is now

While the month is unfinished, the days elapsed are compared against **the same
days of the previous month**. Two spans of records that exist; nothing is
projected, pro-rated or assumed even in distribution — a household pays rent on
the 1st and is paid at the end, so a month's spending is not one thirtieth per
day and any scaling would have invented a figure.

Once the month is over, the window is the whole of both, which is what the
function returned all along.

`addMonths` already clamps the day of the month to the target month's length,
so the 30th of March asks February for a 30th, gets the 28th, and the base is
the whole of February — the most that month has to offer. The clamp can only
widen the base towards a whole month, never narrow it.

`previous` still reports the whole previous month, because that is a true fact
about last month and callers show it as one. What moved is what the *change* is
measured against, and `partial` says which of the two it was, so a caption can
name the span instead of asserting one it did not use.

`comparedWith()` makes that decision once, in the domain, for both screens.
`spendingBars()` names the unfinished month in the bar's **label** — not its
colour, which the master brief forbids as a sole carrier of meaning, and which
would not survive into the text equivalent `barChart` builds for a screen
reader.

## What is not claimed

The comparison is still imperfect and says so by naming its span rather than by
being called exact. Rent falling on the 1st of one month and the 2nd of the
next moves money across the boundary; a fortnightly salary lands twice in some
windows and once in others. A comparison of two equal spans of real records is
honest about what it is. A comparison of eleven days against thirty-one was
not.

## Held by

`tests/domain.test.mjs` — an unchanged household reads as no change on the 2nd,
10th and 21st; the base is the same days and not the whole month; the last day
of the month compares whole against whole; a shorter previous month is taken
whole rather than invented; the unfinished month is marked in the series and
named in the bar label.

`tests/ai.test.mjs` — the assistant names the span for a real mid-month rise,
drops the qualifier once the month is complete, and says nothing about a fall
for a household that changed nothing. Its fixtures are built from the real
`comparePeriods` rather than from literals, so they cannot pass against a shape
the application no longer produces.

Each was mutated both ways and each mutation was verified to have landed before
its result was believed. One mutation — guarding on the base span's total
beside the threshold — changed no output, which is how a check that could never
independently fail was found and removed rather than kept for reassurance.
