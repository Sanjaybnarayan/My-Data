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
records import as separate transactions. So the reference is collected from
every narration already on record and used as a second, exact key.

### The reference alone is not the identity

**A transfer between two of the household's own accounts puts the same
reference on both legs**, and each bank records its own side. Measured across
these statements: **128 references appear with both directions.**

```
  509123045459   Kotak  in   ₹8,000        ICICI  out  ₹8,000
  024990352165   Kotak  out  ₹250          ICICI  in   ₹250
```

Keyed on the reference by itself, a payment-app row is matched against
whichever leg happened to be imported first — so an outgoing payment is
silently deleted because money *arriving somewhere else* carried the same
number. A real row, gone, with nothing on screen to say so.

The identity is the **leg**: one reference, on one account, in one direction.
That is also why the split by account runs *before* the duplicate check — until
a row is filed to an account there is nothing to compare it as. A row that
could not be filed is never a duplicate, because a gap is not evidence.

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

- 1,205 unit tests, 46 in `tests/paymentapp.test.mjs`.
- **28 mutations, all caught** — including *credited-to reads as money out*, *a
  self-transfer is ordinary spending*, *a missing UTR counts as a duplicate*,
  *duplicates are never detected*, *the instrument is a deposit column again*,
  *a two-digit tail is matched anyway*, *an ambiguous tail picks the first*, and
  *unfiled groups are silently dropped*.
- One survived at first: *the tail is matched anywhere, not at the end*. No
  fixture had an account whose number **contains** the digits without ending in
  them, so the rule was untested. `50100081779999` is now one of them.
- 229 browser checks; the new ones fail when month-first dates are refused, and
  when a mask too short to identify an account is matched anyway.
- Typecheck **194, down from 198**: documenting `parsed` and `references` on
  `planStatement`'s options cleared four pre-existing findings in
  `tests/tabular.test.mjs`.

## One file, several statement records

**The decision:** a `bankStatement` record per *(file, account)*.

That record states an account, a row count and an imported count. One record
covering four accounts would have to be wrong about all three, and the question
a household asks — *"what has been imported for this account?"* — is answered
per account. The file name repeats across the records, which is true: one file
produced them all.

### Matching an instrument to an account

A mask leaves only a tail. `XXXXXXXX8177` says the account ends 8177 and
nothing else — a payment app prints no IFSC, no holder and no bank, so
`scoreAccount`'s evidence simply is not there. The test is that the recorded
number **ends with** those digits; containing them somewhere in the middle is a
different account.

Three refusals, and each one files nothing rather than guessing:

| | |
| --- | --- |
| **Fewer than four digits** | `XXXXXXXXXX84` leaves two. Two digits match one account in a hundred by chance. |
| **More than one account ends the same way** | The file cannot say which, and neither can this. |
| **No account on record ends that way** | Nothing to file against. |

A payment filed against the wrong account is invisible afterwards and wrong in
two places at once — it inflates one balance and deflates another. So those
rows are kept, counted, and named on screen:

> 3 to HDFC Savings, 1 to Kotak Savings. 2 rows moved on XXXXXXXXXX84 and
> cannot be imported: the app masks this one down to "XXXXXXXXXX84", and 2
> digits is not enough to tell which account it is.

### The fingerprint is rebuilt per group

`fingerprint()` is keyed on the account id. Computed once against a file that
has no single account, every row would carry the same empty id — and a
re-import of the same file would not recognise itself. Each group's rows are
re-fingerprinted against the account they were filed to.

## A self-transfer names both of its ends

`Transfer to XXXXXXXX8177`, paid by `XXXXXXXX8963`, is the app stating **both
ends of one movement outright**. That is stronger evidence than anything
`domain/events.js` can offer: it pairs two bank legs by amount and date and
calls the result *probable*, because a bank statement names only its own side.
Here the record names both, so no window and no tolerance apply.

A resolved transfer gets `toAccount` on its outgoing leg — the shape
`domain/finance.js` already reads and `linkFor` already writes — plus
`kind: 'transfer'` and the `own account` category, because money moving between
the household's own accounts is not spending and the categoriser cannot know
that from `Transfer to XXXX8177`.

The destination is matched by the same rule as the source, and refuses on the
same grounds. **A transfer this cannot name is left as money out.** That
overstates spending, which is the safe direction: inventing a destination would
move money into an account the household never touched. An account cannot
transfer to itself either — a row saying so is a misread mask, and setting
`toAccount` to the source would credit and debit one balance.

A destination that is **not a mask is not an account**. `Withdrawn from Bandhan
ELSS Tax saver Fund` is a redemption from a mutual fund; calling it an internal
transfer would invent an account and take a real investment sale out of the
picture.

On the real file, against the three accounts the bank statements identify:

> 4 are transfers between the household's own accounts, joined to the account
> each went to and counted as movement rather than spending, and 31 more say
> they went to another account the app masks too heavily to name, so they stay
> counted as money out.

### A counter that could disagree with its own data

`linked` was first tallied alongside the loop that sets `toAccount`. A mutation
that stopped setting the field **survived every browser check** — the sentence
still said a transfer had been joined while the row carried no destination. The
count is now taken from the rows themselves (`out.filter((row) => row.toAccount)`),
so the sentence cannot be right about data that is wrong. The same mutation now
fails the browser suite.

## Still not done

- **Balances are safe by construction, not by check.** A payment-app row
  carries a `direction`, and `accountBalances` lets direction win over
  `toAccount` — so the destination is credited once, by its own incoming row,
  and never twice. That is the existing rule and this relies on it; nothing
  asserts it for payment-app rows specifically.
- **`.xls` and `.xlsx` remain rejected**, as `docs/STATEMENT_FORMATS.md` says.
