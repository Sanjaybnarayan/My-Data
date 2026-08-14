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

Consecutive printed balances are enough on their own: whatever the account held
before, each row's balance must follow from the one above it. With that check
the same file reports **13 problems** — rows that do not chain, now visible
instead of silently imported. They are still imported, flagged: a row the
household can see and correct beats one silently missing.

## Verification

- 1,155 unit tests, including retyped ICICI and Axis layouts. The real files
  are somebody's bank statements and do not belong in a repository.
- **9 mutations, all caught** — including *numeric dates read month-first*, *a
  serial is required again*, *a bare IFSC beats a labelled one*, *consecutive
  balances unchecked*, and *an indirect contents array is not followed*.
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
- **13 rows in one ICICI statement do not chain**, and are now reported rather
  than hidden. Their column layout needs looking at against the file; this
  tranche made the problem visible rather than fixing it.
- One Axis row is flagged for the same reason.
