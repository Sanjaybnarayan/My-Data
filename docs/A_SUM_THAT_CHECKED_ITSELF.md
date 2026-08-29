# A sum that checked itself

*A credit-card statement was imported, nothing about it could be verified, and
the household was told "the arithmetic closed against the printed closing
balance" — on a record whose own closing balance is null. The module that knew
better computed the answer, wrote a comment explaining exactly why it
mattered, and was read by nothing.*

## The check that cannot fail

`domain/statement.js` reconciles a parsed statement against the balances the
bank printed:

```js
const expected = (openingBalance ?? 0) + inflow - outflow;
const difference = (closingBalance ?? expected) - expected;
```

With no closing balance, `difference` is `expected - expected`. Zero. Always.
So `balanced` is `true` for any file that carries no balances, **however wrong
the rows are**. The file says so itself, in the field right underneath:

```js
// Whether that answer means anything. With no closing balance to compare
// against, `difference` is the sum of the rows minus the sum of the same
// rows — zero however wrong they are, so `balanced` would be a confident
// yes backed by nothing. A credit card export is exactly that case: no
// running balance per row, and nothing to reconcile against.
checkable: openingBalance !== null && closingBalance !== null,
```

`tests/tabular.test.mjs` has always asserted precisely this:

```js
assert.not(check.checkable);
assert.ok(check.balanced, 'nothing to compare against still reads as no discrepancy');
```

The vacuity was known, documented and tested.

## And `checkable` was read by nothing

```
$ grep -rn checkable js/ tests/
js/domain/statement.js   the definition
tests/tabular.test.mjs   two assertions
```

No screen, no record, no import gate. `toStatementRecord` stored `balanced`
alone:

```js
reconciled: plan.check.balanced,
```

into a field the schema labels **"Arithmetic closes"**, `list: true`, shown in
the Imported files list. Measured on the card CSV from the repository's own
fixture:

```
check.balanced  : true
check.checkable : false
openingBalance  : null
closingBalance  : null
reconciled stored ("Arithmetic closes"): true
```

## Three readers, three false statements

**`js/modules/imports.js`** — a green success badge, `arithmetic closes`.

**`js/data/provenance.js`**, the statement reading:

```js
confidence: record.reconciled ? 'high' : 'low',
note: record.reconciled
  ? 'the arithmetic closed against the printed closing balance'
  : '…',
```

`explain()` renders that note into the sentence a household reads:

> "Read from an uploaded document — **the arithmetic closed against the printed
> closing balance** — not checked by anyone."

There was no printed closing balance. The same record stores `closingBalance:
null`. The comment directly above the line calls this *"the one place in the
codebase where a machine checks its own reading against something the bank
wrote"* — and for a card statement it checked its reading against nothing.

## The second fault, which is larger

`provenance.js` also reads `reconciled` on the **transaction**:

```js
// `reconciled` on a transaction means its statement's arithmetic
// closed. That is a property of the *import*, not a person's sign-off.
confidence: record.reconciled ? 'high' : 'medium',
note: record.reconciled ? null : 'the statement it came from did not add up',
```

It does not mean that. `toRecord` wrote it as a literal:

```js
reconciled: true,
```

Unconditionally, on every row, whatever the statement's arithmetic did — and
`grep` finds no other writer of the field anywhere. So **every** imported
transaction was reported as high confidence, including rows out of a statement
that demonstrably did not add up, and the `'medium'` branch with its note was
unreachable code. A comment claiming a meaning, with nothing checking it.

## The fix

Checkability is **derivable from what is already stored**. A statement record
carries `openingBalance` and `closingBalance`; whether there was anything to
check is those two fields, not a third one free to disagree with them.

```js
export function wasCheckable(record) {
  return record?.openingBalance !== null && record?.openingBalance !== undefined
    && record?.closingBalance !== null && record?.closingBalance !== undefined;
}
```

No schema change, no new field, **no migration** — and because it is derived,
every card statement already in a household's database is described correctly
from the moment this ships, without a record being touched.

Three states where there were two:

| | confidence | what the household is told |
| --- | --- | --- |
| balances present, closed | `high` | the arithmetic closed against the printed closing balance |
| balances present, did not close | `low` | the arithmetic did not close — rows may be missing or misread |
| no balances | `medium` | this file carries no opening or closing balance, so the arithmetic could not be checked at all — a credit-card export is the usual reason |

`medium` because nothing contradicts the rows and nothing confirms them —
which is what `medium` already means at the transaction reading two functions
above.

And `toRecord` now takes the statement's real answer, defaulting to `false`
because a caller that does not know cannot be claiming that it closed. The
call site passes `balanced && checkable`, since `balanced` alone is the vacuous
half.

For a transaction the reading says only that the statement was not reconciled,
and points at it — the row cannot tell which of the two reasons applied, and
naming one would be right half the time.

## Not changed

`reconcile()` itself. No arithmetic is different; the same sums are computed
from the same rows. What changed is what gets stored and said about them.
`reconciled` on existing records keeps its stored value — the derivation sits
beside it in the reading, never overwrites it.

## Tests

Nine across four files. The ones that matter:

- A card statement is not told its arithmetic closed, and is not told it
  *failed* either — nothing failed; there was nothing to do.
- An older import that recorded no balances is described correctly too, which
  is the migration this did not need.
- A bank statement with both balances still reads `high`, and a zero-balance
  month is still checkable — `!balance` would have broken that.
- A row does not claim its statement reconciled unless it did, and the reading
  of that row follows it.
- **The screen that writes rows actually passes it.** A source check, said
  plainly as one.

## Mutations

| Mutation | Caught by |
| --- | --- |
| `wasCheckable` always true — the original behaviour | 3 tests |
| `wasCheckable` always false — over-tightening | 3 tests |
| `toRecord` defaults `reconciled` back to `true` | 1 |
| The screen passes `balanced` without `checkable` | **escaped**, then caught |
| The imports entry hardcodes `checkable: true` | **escaped**, then caught |

Two escaped on the first pass, and both in the same place: the join between a
function that was tested and a caller that was not. Both ends covered, the
wiring between them not — for the fourth time this month, and the reason the
two tests that now cover those call sites exist at all.

## Fixtures that were wrong rather than tests that were

Three existing provenance tests failed on the fix. Each built a statement
record with no balances:

```js
provenanceOf('bankStatement', { fileName: 'april.pdf', reconciled: true })
```

A real bank statement always has both — the importer writes them. The fixtures
were describing a record the application never stores, so they were corrected
rather than the code being bent back to fit them. The same lesson as the
unassigned-task fixture a change earlier: build the record the way the
application builds it, or the test is about something else.
