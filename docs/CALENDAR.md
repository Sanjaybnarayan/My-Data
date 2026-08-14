# What the calendar shows

Phase 4. The roadmap said *"Gmail + Drive exist; Calendar new"*. A calendar
module already existed — 321 lines, a month grid drawing from four sources.
That is the **fourth** stale line in that table, so measuring the screen came
before anything else.

## What was measured

Its own subtitle promised *"Events, tasks, appointments and every renewal
date"*. On a household with nine dated things spread across four months:

```
  the calendar asks for a 400-day horizon. What it gets:

    2026-08   2 entries   Netflix, Rent
    2026-09   1 entries   Maruti

  dated things the household actually has  : 9
  of which the calendar shows              : 3

  on a date, and not on the calendar:
    2026-09-03  ( 20 days out)  Broadband        — recurring payment
    2026-09-28  ( 45 days out)  School fees      — recurring payment
    2026-10-03  ( 50 days out)  Star Health      — policy renewal
    2026-10-13  ( 60 days out)  Amazon Prime     — subscription
    2026-11-12  ( 90 days out)  Vehicle insurance
    2026-12-12  (120 days out)  ICICI motor policy
```

**Paging one month forward showed one entry.**

## Why the 400-day horizon did nothing

`expiryReminders` treats each field's own lead as the ceiling and
`horizonDays` only as a fallback for fields that have none:

```js
const lead = field.expiryLead ?? horizonDays;
if (days > lead || days < -30) continue;
```

`recurringPayment.nextDueOn` has `expiryLead: 7`. So it left the grid **eight
days out**, whatever horizon the caller asked for. A policy (45) went at
forty-six, a subscription (14) at fifteen.

Nothing was broken — the two callers want different things and only one of them
was being served:

| Question | Right answer |
| --- | --- |
| *"How long before this should I be nagged?"* | the field's lead — 7 days for a broadband bill |
| *"What falls in September?"* | everything in September, whatever anybody's lead is |

So `datesInRange(recordsByEntity, { from, to })` answers the second, and
`expiryReminders` is left alone to answer the first. A test pins both, so
neither drifts into the other.

## Money due was never on it at all

```
  bills due in the next 60 days : 6  (₹1,30,238.00)
    2026-08-17       ₹649.00  Netflix          on the calendar
    2026-08-18    ₹35,000.00  Rent             on the calendar
    2026-09-03     ₹1,199.00  Broadband        NOT on the calendar
    2026-09-05    ₹43,391.00  Home loan EMI    NOT on the calendar
    2026-09-28    ₹48,500.00  School fees      NOT on the calendar
    2026-10-13     ₹1,499.00  Amazon Prime     NOT on the calendar

  calendar entries carrying an amount : 0 of 3
```

Most of what a household owes is **derived, not stored**. A card bill comes off
the statement day and the rows on the card; an EMI off the loan's payment day.
Neither has a date field, so neither could ever appear on a square — including
the home loan EMI, usually the largest single amount a household pays.

And no entry carried an amount. A calendar saying *"Rent"* without ₹35,000 is
the same half-fact as the subscription reminder that said *"Netflix renews in
3 days"* with no money attached.

`upcomingBills` — four sources since the card and subscription tranches — now
feeds a **Money due** row on the grid, with the amount as the entry's subtitle.
A card with no statement day carries its `why` instead of an invented figure.

### The double count, keyed exactly

A recurring payment is both a dated record *and* a bill, so it would draw
twice. The key is `entity:recordId:date` — exact, from fields both sides
already carry, not a name or amount heuristic. The **bill wins**, because it is
the one carrying the amount.

## Two things the mutation testing caught

**The browser check verified the wrong half.** Deleting `datesInRange`
entirely left all 213 checks passing: the fixture was a *recurring payment*,
which now reaches the grid through `upcomingBills`. A policy renewal is not a
bill, so it can only arrive through `datesInRange` — a second check with one
sixty days out, against a lead of forty-five, is what actually pins the
renewal fix.

**A mutation landed on the wrong function and found a real gap.** Changing the
reminder id from `entity:record:field` to `entity:record` survived — because
`.replace(..., 1)` hit the identical line in `expiryReminders` first. Nothing
had ever pinned that a vehicle whose insurance and PUC expire on different days
produces two reminders with **different ids**. Now pinned in both functions.

## A side effect worth naming

The typecheck budget fell **202 → 198**. `allReminders` returns a union of two
shapes, and reading `.entity` and `.label` off it produced four findings in
`calendar.js`. `datesInRange` returns one shape, so they went away. Locked in
rather than left as headroom.

## Still not done

- **Google Calendar sync.** There is no Calendar integration anywhere in the
  codebase — no client, no Apps Script, no scope. The screen is entirely local.
  That is the real remaining Phase 4 work and this tranche does not start it.
- **Recurrence.** A monthly rent shows on its `nextDueOn` and nowhere else, so
  a month paged forward shows the payment once its date has advanced, not as a
  standing monthly entry. `advanceRecurring` exists and is not used for this.
- **`event.endTime` and `event.remindMinutesBefore`** remain in the unread-field
  inventory: a two-hour event draws as a point.
