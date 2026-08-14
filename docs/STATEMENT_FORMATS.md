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
