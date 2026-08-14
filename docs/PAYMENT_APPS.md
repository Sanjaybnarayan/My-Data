# A payment app is not an account

A PhonePe export was imported and produced nothing. Fixing that turned out to
be the smaller half of the problem.

## What was measured

One real export, April to August:

```
  rows in the file           : 1,047
  rows the importer read     :     0
```

Three things stopped it, and a fourth was quietly wrong:

| | |
| --- | --- |
| **Date** | PhonePe writes `Aug 15, 2026`. `readDate` knew ISO, `15-Aug-2026` and `15/08/2026` — **month-first was not among them**, so every row was skipped for having no readable date. |
| **Preamble** | Three lines above the heading row. Already handled. |
| **Amount** | `69`, no decimals. Already handled. |
| **Direction** | An explicit `DEBIT`/`CREDIT` column. Already handled. |
| **Instrument** | `Credit/debit instrument` begins with the word *Credit*, so the deposit pattern claimed it — **a money column holding the text "Paid by XXXXXXXX8177"**. |

## The thing that actually matters

The file spans **four bank accounts**:

```
  XXXXXXXX8177   698 rows   out ₹10,39,527.39   in ₹92,770.72
  XXXXXXXXXX84   284 rows   out  ₹5,33,052.24   in ₹86,156.00
  XXXXXXXX8963    64 rows   out    ₹82,349.55   in ₹24,215.36
  XXXX005391       1 row    out    ₹56,000.00   in      ₹0.00
```

Every one of them is an account the household also has a bank statement for.
The importer matches a statement to **one** account; forcing one here would
file every payment made from any of four banks against whichever account
happened to score highest.

And the deeper point:

> **A payment-app row is not a new economic event. It is a bank row seen from
> the other side.**

Import both without linking them and the household's spending doubles. This is
the hazard [`SETTLEMENT`](../js/domain/settlement.js) names for a card bill paid
from a bank account — here across a thousand rows at once.

## The link is exact

The UTR the app prints appears **verbatim inside the bank's own narration**:

```
  PhonePe : Paid to ZOMATO LIMITED   ₹30   UTR 876987316943
  bank    : UPI/ZOMATO LIM/zomato-order@p/Zomato Pay/YES BANK L/876987316943
```

That is an identity the two records share — no amount tolerance, no date
window, no name matching. Against the household's imported bank statements, 83
of the 1,047 rows matched; the rest are payments from accounts or months the
bank PDFs do not cover.

`fingerprint()` cannot see this: the narrations differ completely, so both
records import as separate transactions. So the UTR is collected from every
narration already on record and used as a second, exact key.

**A row with no UTR is imported, not assumed to be a duplicate.** A missing
field is not evidence, and refusing it would lose a real payment.

**An amount that merely matches is never a duplicate.** ₹30 to Zomato twice in
a week is two payments; only the reference says they are one, and this must not
fall back to amount-and-date.

## What the app knows that the bank does not

The bank writes a debit. The app says what it was for:

```
   915  paid            36  self-transfer    29  received
    22  bill            16  recharge         10  electricity
     8  fastag           7  loan-repayment    2  gas
     1  insurance        1  water
```

Seven loan instalments and a self-transfer are the ones that matter: a transfer
between the household's own accounts is not spending, and a loan repayment is
not a cost — it moves cash into a smaller debt, which
[`AMORTISE`](../js/domain/amortise.js) already says elsewhere.

The app's own verb is stripped from the counterparty. *"Paid to"* is the app
talking, not the merchant's name, and leaving it in puts it in front of every
categorisation rule and every payee.

## What the screen says

> This is a payment app's record, not an account's: 1047 payments across 4
> accounts — XXXXXXXX8177, XXXXXXXXXX84, XXXXXXXX8963, XXXX005391, ₹17,10,929.18
> out. 83 of them are already imported from a bank statement — the same
> movements, seen from the other side — and are marked as duplicates rather than
> counted twice.

And when none matches yet — the dangerous case, because importing this first and
the bank statements later brings every payment back a second time:

> None of them matches a transaction already imported. If the bank statements
> for these accounts are imported later, the same payments will arrive again
> from the other side.

Duplicates are **moved out of `fresh`, not dropped**: the row is real, it is
simply already counted, and somebody comparing the two files should see it named
rather than silently missing.

## Verification

- 1,182 unit tests, 23 in `tests/paymentapp.test.mjs`.
- **11 mutations, all caught** — including *credited-to reads as money out*, *a
  self-transfer is ordinary spending*, *a missing UTR counts as a duplicate*,
  *duplicates are never detected*, and *the instrument is a deposit column
  again*.
- 225 browser checks; four of the five new ones fail when month-first dates are
  refused again.
- Typecheck **194, down from 198**: documenting `parsed` and `references` on
  `planStatement`'s options cleared four pre-existing findings in
  `tests/tabular.test.mjs`.

## Still not done

- **No account is matched per instrument.** The screen names the four accounts
  and refuses to pretend the file belongs to one of them, but does not yet offer
  to file each group against its own account. That is the next piece of work,
  and it needs a decision about what a statement record means when one file
  covers several accounts.
- **A self-transfer is labelled, not paired.** `domain/events.js` pairs the two
  legs of an internal transfer; a payment app names one leg and the bank names
  the other, and the two are not yet joined.
