# A figure that left out the rent

*The Family CFO page reported the household's upcoming obligations under a
label naming recurring payments, EMIs and subscriptions. It counted the
subscriptions. Rent, utilities and every EMI were loaded from the database,
passed into the function, and dropped on the floor.*

## The line

`domain/cfo.js` builds one line per figure. This one:

```js
line('obligations', 'Upcoming obligations', commitments.total,
  'recurring payments, EMIs and subscriptions',
  { billsAhead: bills.length }),
```

The source string is the claim: three kinds of outgoing, in one number. The
number came from here:

```js
// before
const commitments = commitmentSummary({ recurring, loans, subscriptions, digitalAssets });
```

## What `commitmentSummary` actually adds up

```js
export function commitmentSummary({
  recurring = [], loans = [], subscriptions = [], digitalAssets = [], base = 0,
  detected = [],
} = {}) {
  const subs = subscriptionOutflow(subscriptions, digitalAssets);
  ...
  total: base + subs.committed,
```

It computes the subscription half itself. The other half — the bills and the
EMIs — arrives in `base`, already summed, and `base` defaults to `0`. The
`recurring` and `loans` arrays are taken for two other purposes: finding
commitments recorded twice, and counting loans. Their **money** is never read.

`domain/finance.js` has the caller that fills `base` in:

```js
export function committed({ recurring = [], loans = [], ... } = {}) {
  return commitmentSummary({
    ...
    base: committedMonthlyOutflow(recurring, loans),
  });
}
```

`cfo.js` did not call it. It called `commitmentSummary` directly, and the one
parameter carrying two of the three things its own label named was left at
its default.

## Measured

Four records — ₹35,000 rent, ₹2,800 electricity, an ₹18,500 car-loan EMI, and
a ₹499 streaming subscription:

```
cfo obligations value : 49900          (₹499)
cfo obligations source: recurring payments, EMIs and subscriptions
finance.committed total: 5679900       (₹56,799)
```

The page said ₹499 where the household's monthly floor was ₹56,799. Not a
rounding difference and not a definitional one: two of the three named
categories were absent entirely, and the largest of them was the rent.

## Why nothing caught it

`services/cfo.js` loads `recurringPayment` and `loan` and hands them over, so
the data was there. The type checker was satisfied — `base` is optional and
defaulted, which is what made the omission silent rather than a crash.

And `tests/cfo.test.mjs` covered this line twice without ever looking at it:

```js
assert.deep(out.lines.map((row) => row.id), [..., 'obligations', ...]);
```

```js
assert.ok(row.source, `${row.id} has no source`);
assert.ok(row.value !== null || row.why, ...);
```

The line existed. It had a source. It had a value. Nothing asked whether the
value was the one the source described. This is the same shape as the picker
whose choice the server discarded: both ends tested, the join between them
not — except here the discarded value was a number on a financial summary.

## The fix

```js
// `commitmentSummary` carries the recurring bills and EMIs in `base`, and
// adds only subscriptions itself. Calling it directly without `base` left
// this line reporting subscriptions alone under a label naming all three:
// rent, utilities and every EMI were loaded, passed in, and dropped.
// `fin.committed` is the one caller that fills `base` in.
const commitments = fin.committed({ recurring, loans, subscriptions, digitalAssets });
```

`cfo.js` already imports `* as fin`. The `commitmentSummary` import is gone;
nothing else in the file used it. `committed()` returns the same shape, so
`commitments.duplicates` — read by the risks list — is unchanged.

This adds no arithmetic, which the file's own header promises it never does.
It routes the line through the module that already defines the household's
monthly floor, so the CFO page and the finance screen can no longer disagree
about what a month costs.

## Tests

Three, in `tests/cfo.test.mjs`:

1. Rent, electricity, EMI and subscription are all in the figure — ₹56,799.
2. The figure equals `finance.committed(...).total` for the same inputs. A
   page that invents no arithmetic should be checkable against the module it
   points at.
3. Subscriptions alone are ₹499, and the real figure is larger. This one
   guards the *shape* of the fault rather than a constant, so a future change
   that quietly drops `base` again fails here whatever the amounts are.

## Mutations

| Mutation | Caught by |
| --- | --- |
| Restore the original `commitmentSummary` call without `base` | all three |
| `loans: []` — the EMI dropped | tests 1 and 2 |
| `recurring: []` — rent and utilities dropped | tests 1 and 2 |

Test 3 correctly stays green under the last two: recurring outgoings still
exceed the subscription, which is what it claims and all it claims.

## What this does not fix

`position()` receives no ledger, so it passes no `detected` rows and
`commitments.unaccounted` is always zero there. That is a boundary, not a
bug — the CFO page makes no claim about commitments the statements show and
the records do not, so nothing there is overstated. It is written down here so
the next reader does not mistake the zero for a measurement.
