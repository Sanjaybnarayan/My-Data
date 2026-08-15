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

## Recurrence — the second half of the same defect

The tranche above fixed the **renewals** half of this grid and recorded
recurrence as still open. The **money** half had the same defect for a
different reason, and it was larger.

`upcomingBills` answers *"what is due soon?"*, so it returns the **next**
occurrence of each bill. That is exactly right for a dashboard — a household
does not want the next twelve rents on it — and exactly wrong for a calendar,
which asks *"what falls in November?"*. The rent is due in November whether or
not it is the next one.

Measured on a household paying **₹80,239 every month** — rent, a home loan
EMI, broadband and one subscription — over a full year the calendar drew:

```
  2026-09   ₹80,239
  2026-10   — nothing due
  2026-11   — nothing due
  ... eleven of twelve months, all reading nothing due
```

Every one of those squares was wrong, under a subtitle that promises money due.

`billsInRange` is the money-side counterpart of `datesInRange`, and the two are
kept apart for the same reason `datesInRange` was kept apart from
`expiryReminders`: **both behaviours are correct for their own question**, and a
test pins the difference so neither drifts into the other.

### Indexed from the anchor, not stepped

`addMonths` clamps to the end of a short month. Stepping one result into the
next walks a rent due on the 31st down to 28 February and **leaves it there for
ever** — every later month reads 28, because the 31 has been thrown away. Each
occurrence is therefore computed from the original anchor, which is what
`nextEmiDate` and the card cycle already do by recomputing from the day number.
Pinned by a test that runs a 31st across February and back out again.

### What recurs, and what deliberately does not

| Source | Recurs? | Why |
| --- | --- | --- |
| Recurring payment | yes | it carries a frequency and a next-due date |
| Loan EMI | yes | an EMI day, and an end date that stops it |
| Subscription, `autoRenew` | yes | it will charge again |
| Subscription, not auto-renewing | **no** | it *stops* on that date; twelve renewals would invent eleven charges |
| Digital asset | **no** | it has no `autoRenew` field at all — the same reading of the same absence that `commitments.js` takes |
| Credit card bill | **no** | see below |

**The card refusal.** A card bill is the statement balance, derived from the
rows that landed inside a cycle that has **closed**. Next month's cycle has not
happened, so there is no balance to state, and projecting one would put a figure
on a calendar square that nothing supports. So the next bill appears and the
ones after it do not — and `cardBillsStopAt` reports where that boundary falls,
so the screen can say *"credit card bills are not shown this far ahead"* rather
than leaving a household to read an empty square as "nothing due". The
difference between *nothing due* and *nothing knowable* is the whole point.

### What the mutation testing caught here

**11 of 12 mutations of the rules were caught by the node suite.** The twelfth
was the screen's notice, which no node test can reach, and it is now a browser
check.

**One mutation of my own was wrong, and that mattered.** Making the loop emit
only its first occurrence *survived* the browser suite — because `collect` is
called once per month with that month's window, so "first occurrence in the
window" still lands one entry on each month. It does not reproduce the old
behaviour at all. The mutation that does is emitting only the **stored**
`nextDueOn`, and that one fails the check, printing an entirely empty October.
A mutation that survives is only evidence when it is the mutation you meant.

## Still not done

- **Google Calendar sync.** There is no Calendar integration anywhere in the
  codebase — no client, no Apps Script, no scope. The screen is entirely local.
  That is the real remaining Phase 4 work and this tranche does not start it.
- **A calendar entry has no stable id.** Entries carry `source`, `date`,
  `title`, `subtitle`, `amount` and `href` and nothing identifying the
  occurrence — bills now do, the rest do not. Any sync needs one, or it pushes
  duplicates on every run.
- **`event.endTime` and `event.remindMinutesBefore`** remain in the unread-field
  inventory: a two-hour event draws as a point.
