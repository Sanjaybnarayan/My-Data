# Statements the importer could not read

Reported from use, not found by audit: seven real statements were imported and
most of them produced nothing.

## What was measured

Every file run through exactly what the Import screen runs — `data/pdf-read.js`
for the text, then `domain/statement.js` for the rows.

| File | Bank | Before | After |
| --- | --- | --- | --- |
| `Account_14_Jul…XX8963.pdf` | Kotak | 20 | 20 |
| `Account_01_Apr_2026…XX8963.pdf` | Kotak | 149 | 149 |
| `Account_01_Apr_2025…XX8963.pdf` | Kotak | 1,681 | 1,681 |
| `OpTransactionHistory14082026.pdf` | ICICI | **0** | **24** |
| `OpTransactionHistory09082026.pdf` | ICICI | **0** | **595** |
| `AcctStatement_XXX5391.pdf` | Axis | **0** | **3** (all it holds) |
| `Statement_MAR2026_330308584.PDF` | ICICI | **0 pages** | **629** |
| `OpTransactionHistory…xls` | ICICI | rejected | rejected |
| `Statement.xlsx` | — | rejected | rejected |

Text extraction was never the problem: the ICICI file gave up **3,242 rows** of
clean text and produced zero transactions. **The parser knew one bank.**

## Four assumptions, each of them Kotak's

### 1. A date is spelled `15 Jul 2026`

`parseDate` accepted that shape and nothing else — and an earlier test asserted
that `01/04/2025` **must** return null, so the refusal was deliberate and
locked in. ICICI prints `16.07.2026`; Axis prints `18-06-2026`. A row cannot
begin a transaction without a date in it, so both banks produced nothing at
all.

Numeric dates are read **day-first**, which is what Indian banks print. Reading
`07.08.2026` as the seventh of August where the bank meant the eighth of July
would move a transaction by a month for eleven days in every twelve, silently.

### 2. Every row starts with a serial number

Axis has no serial column. Its rows begin with the date:

```
["18-06-2026", "INDDR/KKBK/Payment/", "101.00", "101.00", "6133"]
```

The serial is a convenience for reporting a bad row back to a person. It is not
what identifies a transaction, and requiring one excluded every bank that does
not print it.

### 3. The bank is whoever is named in the first forty lines

A statement's narrations are full of *other people's* banks. An ICICI statement
whose early rows carried `KKBK0008067` inside somebody else's transfer
reference was reported as **Kotak** — and the bank name is what
`domain/import.js` matches an existing account on, so this aimed the import at
the wrong account.

The account's own **labelled** IFSC decides it now, then the letterhead, then a
bare IFSC as a last resort. The account number pattern also had to widen:
`Account No. 5612488963` (Kotak), `Account No: 926010022005391` (Axis),
`Saving Account no. 008401532684` (ICICI) — only the first was found.

### 4. The opening balance says "Opening Balance"

ICICI prints `01-04-2025  B/F  50,087.53`. With the date-first rule added, that
became a transaction with no readable amount, on every statement that opens
with one.

## The one that read as an empty document

`Statement_MAR2026` returned **zero pages** while containing 4,314
text-drawing operators. Its pages said `/Contents 141 0 R`, and object 141 was
not a stream but an array of three:

```
141 0 obj
[ 139 0 R  10 0 R  140 0 R ]
```

`pdf-read.js` handled an inline array and a direct stream reference, and not
the indirection between them. It looked for a stream numbered 141, found none,
and dropped all thirty pages.

## The silence that mattered most

The ICICI statements report **no opening balance**. `assemble` only checks a
row against the printed balance when it has a running one:

```js
if (running !== null) { … }
```

So on a statement that never states an opening balance, **nothing was
verified** — 595 transactions, zero problems reported, whatever the rows
actually said. That is the most confident an importer can be while being wrong.

With a check added, the same file reported **13 problems**. Chasing those 13
found one real bug and one false-alarm class.

### The real bug: a balance wider than its heading

Column boundaries are the **left edge** of each heading, and amounts are
**right-aligned** — so a figure wider than its heading starts to the left of it
and lands in the column before. A balance of `100236.53` began **1.1pt** left
of the `Balance` heading:

```
[[484,"45000.00"],[531,"100236.53"]]     Balance heading at x=532.14
```

48 rows came back with no balance at all, and on a row with no deposit that
balance would have been read **as the deposit** — an inward amount invented out
of a running total.

The fix is not a wider boundary. Midpoint boundaries were measured and are
*worse*: Kotak's headings are wide, and the midpoint pulls narration into the
withdrawal column (0 → 91 breaks). What holds across all three layouts is that
**the balance is the rightmost amount on the row** — every one of them prints
Withdrawal, Deposit, Balance in that order with nothing amount-shaped after it.
Only where there is more than one amount: a lone figure is the transaction, and
treating it as a balance would leave the row with no amount at all.

Measured: ICICI 13 breaks → 2, rows with no balance 48 → 0, **Kotak unchanged**.

### The false alarm: a bank's own row order

The remaining two were not errors. ICICI printed a ₹650 withdrawal **above** the
₹650 deposit that funded it:

```
585  03.03.2026  withdrawal 650.00  → 0.01      printed first
586  03.03.2026  deposit    650.00  → 650.01    logically first
```

Both rows read correctly, both balances correct, the pair in the bank's own
sequence rather than balance order. Checking row against row flags that, and a
warning that cries wolf is one people learn to click past.

So **the unit of the check is a date, not a row.** Across dates the arithmetic
must hold: the previous day's closing plus this day's signed amounts must equal
one of the balances printed inside the day. Which row of the day carried it does
not matter, and is not knowable.

Verified against all six readable statements: **no problems on any of them**, and
an error injected into any single row is still caught on every one of them.

## Verification

- 1,159 unit tests, including retyped ICICI and Axis layouts. The real files
  are somebody's bank statements and do not belong in a repository.
- **15 mutations, all caught** — including *numeric dates read month-first*, *a
  serial is required again*, *a bare IFSC beats a labelled one*, *an indirect
  contents array is not followed*, *the rightmost amount is not the balance*,
  *a lone amount is eaten as a balance*, *only the last balance of a day
  counts*, and *the day's amounts are summed unsigned*.
- The last one survived at first because the mutation run filtered to
  `statement`-named test files and the new PDF test is `pdfread.test.mjs`.
- Typecheck held at budget (198) rather than raised: TypeScript widened a tuple
  array in the new bank table, which was annotated rather than budgeted.

## Still not done

- **`.xls` and `.xlsx` are rejected by the file picker.** Both uploads are
  genuine binary spreadsheets — the ICICI one is an OLE2/BIFF workbook, the
  other a ZIP of XML. Neither is parseable by anything in this repository
  today. XLSX is the tractable one (ZIP inflate plus XML, and
  `DecompressionStream` is already used by the PDF reader); BIFF is a much
  larger piece of work. Both banks also offer CSV, which the importer already
  handles well and prefers — see `loadTable` in `modules/statements.js`.
- **Two rows in the four-row Axis statement are flagged.** Axis prints zero as
  `.00` without a leading digit, which is not amount-shaped, and that file's
  text extraction splits a balance oddly. Both are reported rather than guessed
  — the right outcome for genuinely ambiguous rows, and not worth over-fitting
  a parser to one small file.

---

# The rows were read; the payee was not

A follow-on, measured a phase later, on the very statements the work above made
readable. Making an ICICI statement produce 595 rows is not the same as making
those rows mean anything, and nobody had looked at what the ledger made of them.

## What was measured

The Insights screen exists — Phase 8's roadmap line said *"not started"*, and it
was the eighth such line to go stale on measurement. It runs `insights()` over
`categorise()`d rows, and both had been there for some while.

What it reported, over six months of a salaried household's statement:

```
  [recurring] 2 payments repeat on a schedule, ₹27,500 a cycle.
```

Two. The household had **five**, worth ₹64,329 a cycle, and the largest of them
— ₹35,000 of rent — was not among the two.

## Why

`counterpartyOf` took the payee from the second field of a UPI narration.
**Every UPI fixture in this repository is the shape where that is right**, so
nothing failed. Two shapes that are at least as common are not:

| Narration | Payee read as | What it is |
| --- | --- | --- |
| `UPI/DR/305012345678/Amazon/UTIB/…` | `DR` | a direction indicator |
| `UPI/CR/218765432109/SANJAY NARAYAN/…` | `CR` | the same, incoming |
| `UPI/052012345678/Payment from Ph/SANJAY/…` | `052012345678` | a reference number |

The two failures are opposites from one cause. `counterpartyKey` drops fragments
too short to be a name, so `DR` and `CR` both reduced to **`unknown`** — one
bucket holding every UPI payment on the statement, in both directions. The
reference-number shape gives the reverse: a counterparty per payment, keyed by
twelve digits that never repeat.

## What that fed

Everything that groups by counterparty, which is most of the ledger:
`peopleLedger`, `lendingLedger`, `businessLedger`, `recurring`, and the Insights
screen over all of them. None of it failed. It produced sentences:

- rent, Netflix and a cloud backup plan — three payees, three amounts — read as
  **one charge of ₹1,180 repeating weekly, eighteen times**. The cadence was the
  gaps *between different payees*, and the amount was their median.
- `insights()` then reported those as *"2 payments repeat on a schedule"*, having
  silently lost the largest commitment the household has.

A wrong counterparty does not merely fail to group. It groups two strangers
together and says so confidently, which is the class of defect this project
treats as worse than a gap.

## The fix

The payee is not at a fixed position, so the reader stops assuming one: it walks
the fields and takes the first that could be somebody's name. What cannot be one
is specific and checkable rather than clever — a direction indicator, a bare
reference, and a field that is nothing but the words a narration uses to
describe itself, which `NOISE` already lists because `counterpartyKey` has to
ignore them when grouping.

Where no field reads as a name, a VPA's local part is used — `netflix.payu@…`
is not a name, but it is what the payee calls itself and it groups correctly
across months. A phone-number VPA is refused, because that identifies an account
rather than a person.

Where nothing names anybody, the answer is **`UPI payment`** and not the
least-bad field. That groups unnamed payments together, which is the same merge
`DR` used to make by accident — and the difference is the entire point: this one
is labelled as unnamed, so a household reading *"UPI payment ×12"* is told the
payee is missing rather than shown a stranger's name. **A wrong name is a claim;
a missing one is a gap.**

## After

```
  LANDLORD RENT                35,000  monthly  x6
  ACH DR HDFC HOME LOAN EMI    18,500  monthly  x6
  POS BIG BAZAAR RETAIL         9,000  monthly  x6
  CLOUD BACKUP                  1,180  monthly  x6
  NETFLIX                         649  monthly  x6

  [recurring] 5 payments repeat on a schedule, ₹64,329 a cycle.
```

## Verification

- **8 of 8 mutations caught**, including *a direction indicator accepted as a
  name*, *a reference number accepted as a name*, *a phone-number VPA accepted
  as a payee*, *a dash-separated narration split on slashes*, and *a resolver
  falling through to another rail's pattern*.
- One mutation survived the first run and was a finding about the new code
  rather than a missing test: a defensive `break` that **could not be reached**,
  because the fallback beside it always returned first. Unreachable defensive
  code is dead code, so the contract was made explicit instead — a resolver owns
  the narration it matched — and the mutation is caught.
- Typecheck **lowered 186 → 181**, not raised: the type checker objected to
  `asOf`, which `recurring()` has always accepted and never documented. Three of
  the five findings were the new tests and two were already there.
- The fixtures are retyped layouts, as everywhere else here. Real statements are
  somebody's bank statements and do not belong in a repository.

## Still not done

- **`insights()` and the Finance screen still do not compare notes.** Measured
  on the same household: `committedMonthlyOutflow` reports **₹53,500 a month**
  from the recorded commitments, while the ledger can now see **₹64,329 a month**
  actually leaving on a schedule. The difference is ₹10,829 a month — ₹1,29,948
  a year — of real, repeating outgoings that no record accounts for, and nothing
  puts the two figures side by side. Both are derived, both are honest about
  their own inputs, and they disagree. That is the next tranche, and it is the
  same shape as `docs/COMMITMENTS.md`: a screen making a claim about its own
  contents.
- **A landlord now reads as a person**, so the people ledger offers *"1 people
  have taken more from this account than has come back"* about rent. That is
  `looksLikePerson` doing what it says on a name it could not see before, and it
  is a pre-existing judgement rather than something this change introduced — but
  it is newly visible because of it, and it is worth saying so.
