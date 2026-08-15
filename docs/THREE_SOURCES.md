# Three Things Say This Happened

Rule 52 in its fullest form. `js/domain/evidence.js`, tested in
`tests/evidence.test.mjs`.

## What each half already did

A receipt read out of an email points at the bank row it matched
(`domain/receiptmatch.js`). A stored message points at the bank row it matched
(`docs/SMS_STORAGE.md`). Both links are correct, and neither knows the other
exists.

So with all three sitting in one database, the application still could not say:

```
transaction  trn_…  ₹2,499
receipt      rcp_…  -> transaction trn_…
sms          sms_…  -> transaction trn_…   | linked

Question: how many sources describe this one event?   -> nothing answers it
Question: do they agree?                              -> nothing answers it
Question: is anything here double-counted?            -> nothing answers it
```

## What it says now

```
3 sources say this happened — the bank statement, an email receipt, a bank
message — and they agree on the amount. None of them is a person having
checked it.

₹8,750.00 to Metro Cash on 2026-08-20: an email receipt and a bank alert agree
about this payment, and no imported statement row matches it. Nothing has been
added to the ledger.
```

The second sentence is the one worth building this for. A household with an
email receipt for ₹8,750 and a bank alert for ₹8,750 on the same day, and no
imported row between them, has **a real payment missing from its ledger** — and
until now the two halves of that proof sat in different tables with nothing
looking across.

## Corroboration is not verification

Three sources agreeing is three machines agreeing. `data/provenance.js` keeps
confidence and verification apart for exactly this reason, and nothing here
collapses them: `corroboration` is a count, never a score, and every sentence
ends by saying that none of the sources is a person having checked it. A test
reads what the module produces and fails on *verified*, *confirmed*, *proven*
and *certain*.

**A payment with one source is not a fault.** Most statement rows have only the
statement. `bySources` counts them; nothing calls them a problem.

## What it refuses

**It never creates a transaction.** An orphan pair is offered and left for a
person. Inventing a row from two notifications is how a ledger fills with
events nobody can trace to a statement — rule 51 read the other way round.

**It never picks the right amount.** Where sources disagree, every figure is
named beside its source and none is preferred. The statement outranks the
others under `SOURCE_PRIORITY`, and outranking is a reason to *believe* it, not
a licence to overwrite anything with it. A test asserts both figures survive the
call.

## `false` is not the same as "nothing to compare"

The first version computed agreement as *"one distinct amount, and more than one
source"*. For a lone statement row that returns **`false`** — which reads as
*the sources disagree* about a payment that has one source.

It is `null` where fewer than two sources carry an amount. A figure cannot
agree with itself, and calling that agreement would flatter it; calling it
disagreement would be worse. Three tests failed on the first run and named it,
which is the version of this file's own rule applied to itself.

## The survivor

Seven mutations; one survived. Deleting the check that an **orphan receipt is
not already matched to a row** changed nothing — because the test that was
supposed to cover it passes a receipt *and* a message that are both matched, so
the message-side filter alone satisfies it.

In a household that mutation reports a payment already sitting in the ledger as
one the ledger had never seen: a receipt correctly matched to its statement row,
beside an alert that failed to match for any reason, paired into a
"missing" spend. The remedy is a test where only the receipt is matched.

The six caught: dropping the statement as a source, counting another payment's
evidence, counting deleted evidence, calling a lone source agreement, letting
two receipts claim one message, and ignoring the date window entirely.

## One type finding, fixed rather than budgeted

The `sources` array starts with a statement literal, so the checker narrowed
`kind` to `'bank-statement'` and refused the receipt pushed in two lines later.
A `Source` typedef says what the array actually holds. Typecheck holds at 181.

## What is still not built

No screen. `evidenceSummary` is a function with tests, and the orphan finding —
the most useful thing here — reaches nobody yet. The Gmail half of the
three-way link is `receipt.messageId`, which names a message this application
cannot re-open; `data/lineage.js` already says so and this does not pretend
otherwise.
