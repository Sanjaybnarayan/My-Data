# Financial Reconciliation Audit

**Base:** `1c8d97d` · 22 August 2026. The six cases below were **executed**
against the shipped domain modules, not read.

## The pipeline

```
SOURCE            bank statement · email receipt · SMS text · manual entry
   ↓
INGESTION         js/domain/import.js · js/data/pdf-read.js · js/domain/sms.js
   ↓
RAW DATA          bankStatement · receipt · smsMessage      (source preserved)
   ↓
NORMALIZATION     js/domain/categorise.js — channel, counterparty, category
   ↓
ENTITY RESOLUTION js/domain/categorise.js resolveAliases (truncated payee names)
   ↓
DUPLICATE DETECT  js/domain/import.js · statement-level and row-level
   ↓
MATCHING          js/domain/events.js (transfers) · receiptmatch.js (receipts)
   ↓
RECONCILIATION    js/domain/evidence.js — how many sources, and do they agree
   ↓
ECONOMIC EVENT    `economicEvent` entity + movement links
   ↓
LEDGER            js/domain/ledger.js
   ↓
REPORT            js/modules/finance.js · js/reports/build.js
```

Every stage exists. The model is the one the specification asks for.

## The rule the whole file protects

> **An account transaction is not an economic event.**

`js/domain/events.js:1-42` states it, and `summarise`
(`js/domain/categorise.js:601-621`) enforces it by counting only
`categoryKind === 'spending'` as spending. `internal` and `transfer` are
reported on their own lines.

## Case results

### Case 1 — HDFC −₹50,000, ICICI +₹50,000 → ONE internal transfer · **PASS**

```
proposals=1  confidence=probable  movements=1  moved=₹50,000
```

Not ₹100,000. Both rows survive; neither is merged or deleted.

### Case 2 — same payment from SMS, statement and Gmail → one event, three sources · **PASS**

`js/domain/evidence.js` correlates a receipt, a stored message and a bank row
onto one payment, reports how many sources describe it and whether they agree,
and — the useful part — flags a receipt plus an alert with **no** bank row
between them as a real payment missing from the ledger. 20 tests.

### Case 3 — SMS ₹5,000 vs statement ₹5,500 → `FINANCIAL_DATA_CONFLICT` · **PASS**

```
proposals=0  (₹500 exceeds the ₹100 near-window)
conflicts=1  kind=amount  figures: bank-statement ₹5,500, sms ₹5,000
```

The transfer-pairing path is *right* to decline — two amounts ₹500 apart may be
two unrelated payments, and `events.js` documents that unequal amounts never
match automatically. The specification's case is about the same transaction
seen by two sources, which is the **evidence** path.

**The gap, now closed.** `js/domain/conflict.js` is the single record type,
and it turned out to join four findings rather than two: an amount two sources
disagree about, a corroborated payment with no ledger row, a month of wages
that is not the wages agreed, and — new, because nothing looked — two sources
naming different *days*. `docs/FINANCIAL_CONFLICTS.md` carries the design and
what it refuses. One derived list, one screen, and no figure preferred over
another.

### Case 4 — bank → credit card → `CREDIT_CARD_SETTLEMENT` · **PASS, with a caveat**

`js/domain/settlement.js` distinguishes two households, which is the part a
naive implementation gets wrong:

```
card + bank imported  → settlements=1 doubleCounted=1 total=₹5,000 corrected=₹5,000
  "₹10,000 includes ₹5,000 of card bills on top of the purchases those bills
   paid for, so it counts that money twice. Spending without them is ₹5,000."

bank statement only   → settlements=1 onlyRecord=1   total=₹5,000 corrected=₹0
  "Card bills of ₹5,000 are counted as spending, because Amex has no statement
   imported — the bill is the only record of what was spent."
```

**Caveat.** The headline expense figure is **not** corrected. It stays the
cash-flow number with the explanation printed beside it
(`js/modules/finance.js:665-676`), on the stated reasoning that *"a total that
quietly shrank because a second file was imported would be worse than the double
count, because nobody would know why."* Defensible; a divergence from a literal
reading of the spec; recorded as one.

### Case 5 — bank → broker → `BROKER_FUNDING` · **PASS**

```
"NEFT ZERODHA BROKING LTD"  →  investment-out   kind=internal
summary: expense=₹0  internal=₹50,000
```

Funding a broker is never counted as spending.

### Case 6 — bank → FD → `ASSET_ALLOCATION` · **PASS**

```
"FD BOOKING HDFC DEPOSIT"  →  sweep   kind=internal   isP2P=false
```

**The invariant held and still holds** — `internal` is not `spending`, so an
FD booking was never reported as an expense and is not now.

What failed was worse than the "wrong label" this document used to call it: a
fixed deposit appeared **in the people ledger**, listed among those the
household sends money to, with `counterpartyKind: 'person'` beside it in the
CSV export. The cause was three tables each carrying their own pattern for the
same concept, disagreeing — for `FD BOOKING` the rail table recognised the
deposit while the category table called it a person. There is now one
`DEPOSIT` pattern that all three read, and a test that fails if a fourth copy
appears. `docs/DEPOSITS.md`.

The direction split the specification's `ASSET_ALLOCATION` implies — booking
and maturity as separate events — is deliberately **not** done, and
`docs/DEPOSITS.md` says why.

## Ambiguity — checked because the specification demands it

One debit that could pair with either of two credits:

```
proposals=2  confidences=possible,possible
```

Both offered, neither taken, and `movementTotal` counts only `probable`. **An
ambiguous match is never forced.** This is the behaviour the spec requires and
it is implemented correctly.

## What is not enforced at the database level

Nothing financial. The store is IndexedDB with no constraints; every integrity
rule lives in `js/domain/`. Under the specification's relational requirement
this is a gap — recorded in `docs/PHASE_AUDIT_REPORT.md` §19 as an architectural
risk rather than a defect, because the rules do exist and are tested.
