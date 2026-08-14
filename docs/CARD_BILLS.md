# Card bills

## What was measured

A household with a credit card, both billing days filled in on the account
form, and money sitting on the card unpaid:

```
  statement day        : 18 of the month
  payment due day      : 5 of the month
  outstanding on it    : ₹38,000

  upcoming bills found : 0
  dueDay / statementDay read by : nothing
```

`upcomingBills` knew about recurring payments and about loan EMIs. It had never
heard of cards. `account.statementDay` and `account.dueDay` sat on the account
form in a group called *Card*, were validated, stored and synced, and were read
by nothing downstream — the fourth instance of the pattern in
[`FIELD_COVERAGE.md`](FIELD_COVERAGE.md): the data present, structured and
ignored.

A missed card payment is the most expensive thing this application could fail
to mention. Interest runs at around forty per cent a year, it is backdated to
the purchase date so the interest-free period is lost as well, and a late fee
and a credit-record mark come on top. Every other reminder in the app matters
less than this one.

The browser check for it fails in exactly the shape the measurement had. With
the wiring removed, the Finance screen prints **"Nothing due"** with ₹3,000
outstanding on a card whose billing days are recorded.

## The decision that matters: which balance is due

**The statement balance, not the current one.**

A card bills in cycles. What has to be paid by the due day is what was
outstanding when the statement cut; anything bought since belongs to the next
cycle. Reporting the current balance would overstate the bill by whatever has
been spent this month, and a household paying that figure hands the bank an
interest-free loan on the difference — the one mistake that costs money in the
direction nobody notices, because nothing goes wrong.

So `statementBalance` walks the card's rows up to and including the statement
date. Purchases add, payments and refunds subtract, and a card in credit owes
zero rather than a negative amount.

## Which month the due day falls in

`dueDay` is a day *of the month* and does not say which month. Most cards fall
due after the statement, but not always in the same month:

| statement day | due day | statement | due |
| --- | --- | --- | --- |
| 18 | 5 | 18 Jul | **5 Aug** |
| 2 | 20 | 2 Aug | **20 Aug** |

So the due date is the first occurrence of the due day *strictly after* the
statement date, rather than an assumption about which month it lands in.
Assuming "the month after the statement" is a mutation the suite catches.

Both dates clamp to the length of the month: the 31st of February is the 28th,
and a card billing on the 31st does not skip the short months.

## Where it refuses

| Situation | What comes back | Why |
| --- | --- | --- |
| No `dueDay` | nothing at all | A deadline invented from the statement day would be a date this application made up, on the one bill where being wrong is expensive. |
| No `statementDay` | the **date**, with `amount: null` and a `why` | Knowing *when* is most of the value. Inventing the figure would be worse than admitting the gap. |
| Statement balance zero or in credit | nothing | A card cleared every month should not nag every month, or the reminders stop being read. |
| Archived, deleted, or not a card | skipped | |

## What this is not

**It is not the bank's statement.** Interest already accrued on a revolving
balance, a fee charged on the statement date, a refund that landed after the
cut — none of those are knowable from the rows here unless the card's own
statement was imported. So every sentence the module produces ends by saying
the card's own statement is the figure that counts, the same way
[`AMORTISE`](../js/domain/amortise.js) defers to the lender's.

## The null amount, and the totals under it

A card with no statement day reports a due date and `amount: null`. That value
travels through three totals, and `null` added to a running total is silently
zero — which produces the right sum of the wrong list, a figure smaller than
the truth with nothing on screen to say a bill was left out of it.

`fin.billsTotal(bills)` returns `{ total, unknown }` instead, and all three
callers print the count:

- the dashboard's bill card — *"Total due · 1 without an amount"*
- the written summary — *"One more card bill falls due with no statement day
  recorded, so the amount is not known here."*
- the assistant's `bills` intent — *"1 of them is a card bill with no statement
  day recorded, so the amount is not in that total."*

In the lists themselves the value renders as an em dash. A number there would
be one the application invented, on the dearest bill it shows.

## What it does not claim

`autoDebit: false`, always. Whether a standing instruction pays this card is
set up at the bank and is not recorded anywhere in this application. An "auto"
badge on a bill nobody is paying is the single wrong answer that would stop
somebody looking at it.

## Where it lives

- `js/domain/cards.js` — `cycleFor`, `statementBalance`, `cardBills`,
  `describeCardBill`
- `js/domain/finance.js` — `upcomingBills` merges them in when `accounts` and
  `transactions` are passed, and `billsTotal` counts what it cannot add
- `js/modules/finance.js`, `js/modules/dashboard.js`, `js/ai/summary.js`,
  `js/ai/intents.js` — the four readers
- `tests/cards.test.mjs` — 28 tests; every guard above was mutated and the
  mutation caught
