# Three screens, three balances

`js/services/service.js`, tested in `tests/services.test.mjs`.

## What was measured

`services/service.js` has warned about this in its own docstring since the layer
was built:

> Two screens showing net worth can disagree about what net worth is made of,
> and nothing would catch it.

Nothing did catch it. Every screen that shows money chose its own transaction
limit, and there were **four different ones**. Measured on a household with
25,000 transactions:

| Screen | Limit | Balance shown |
| --- | --- | --- |
| Dashboard | 10,000 | **₹2,00,000** |
| Finance | 20,000 | **₹4,00,000** |
| Ledgers, Imports | 50,000 | **₹5,00,000** |

The same account, the same day, one application, three answers. A household
opening two screens would find their savings had changed by ₹3,00,000 on the way
between them.

## The deeper problem, which one number does not fix

**A balance computed from a truncated list is not a balance.** `accountBalances`
sums transactions; summing *the most recent N* gives the account's real balance
only while N exceeds the household's history. Past that it silently reports a
figure that is not the account's, and no shared constant makes that true — it
only makes every screen wrong in the same way.

So there are two changes, not one:

1. **One limit**, `TRANSACTION_LIMIT`, used by every screen and service that
   computes a money figure. Set to 50,000 — the largest of the four, because a
   figure computed from more rows is nearer the truth and the cost is a read
   this application already performs on two screens.
2. **`transactionsTruncated`**, so a screen can say when a figure was computed
   from a slice. It is *returned*, not warned about: a number that is not the
   balance should say so, and only the caller knows where the sentence goes.

## The guard

A shared constant that nothing enforces drifts apart again the first time
somebody types a number, so a test scans every module and service for a
hard-coded limit on a transaction read and names the file.

It was verified by putting one back: the suite fails with
`js/modules/reports.js: decrypt: false, limit: 20_000`. A guard that has never
fired is a guard nobody should trust.

## The same fault, in the entity the guard did not watch

That scan matches `repo('transaction')` reads. Holdings were therefore free to
drift, and had — into **three** limits:

| Read by | Limit |
| --- | --- |
| CFO position, goals review | 500 |
| Estate | 1,000 |
| Portfolio, `NET_WORTH_LOAD` | 2,000 |

Measured on 600 holdings of ₹1,000 each:

| Screen | Net worth |
| --- | --- |
| CFO position | **₹5,00,000** |
| Portfolio | **₹6,00,000** |

The same household, the same day, a lakh apart — the table at the top of this
document, written about a different noun. `HOLDING_LIMIT` is now 2,000 for the
reason given above: a figure computed from more rows is nearer the truth.

The other entities net worth is assembled from had the same split in a quieter
form — `NET_WORTH_LOAD` read accounts, properties, vehicles and loans without a
limit while `CFO_LOAD` and `ESTATE_LOAD` capped them at 500 or 200. No
household reaches those thresholds, which is why nothing was measurable there;
two answers to one question is still not a thing to keep, so they now read
without a limit like the load they disagreed with.

## Two guards, because they fail on different things

The scan above reads source, so it cannot tell a shared constant from a
*correct* one. Lowering `HOLDING_LIMIT` to 500 leaves one limit everywhere and
the scan passes — the figure is simply wrong on every screen at once, which is
what this document warns a shared number does not fix.

So there is a second test that reads net worth off two screens built from 600
holdings and insists they agree. Both were checked in both directions:
splitting the limit fails both, lowering the shared constant fails only the
behavioural one.

Scoped to the six entities net worth is made of. Every other entity is read at
whatever suits the screen asking — people at 200 here and 500 there — and
unifying those would be a rule about picker lists rather than about money.

## Verification

- `npm test` **1508**, browser **253**, typecheck **181/181**
- architecture 49 claims, field-coverage 83, policy, lint, UI→database 61/61

## It now says so, on the screen with the balances

Recorded as a gap in the commit that created the signal, and closed in the next
one rather than left to be discovered. The Finance overview carries `truncated`
through the view model, and where it is true the Cash & accounts card says:

> Only the most recent 50,000 transactions were read, so these balances are
> computed from part of your history rather than all of it.

It is rendered as a **negative**, not as a `faint` aside, because unlike the
forecast's "nothing here runs you out" this is not a neutral observation — it
says a figure on the same card is not what it appears to be.

**The sentence itself has no browser check**, and that is worth stating plainly
rather than leaving to be assumed: reaching it needs 50,000 transactions in
IndexedDB, which is minutes of a suite that runs in five. The signal is tested
where it is decided — `assembleOverview` reports it, and a service test pins
both directions. Making the limit injectable purely to make the sentence
reachable would put a seam in production code whose only purpose is to be
smaller in a test, and that seam is how the real constant stops being tested.

## Both screens that show a balance now say it

The dashboard was the other one, and it is the screen a household looks at
first: net worth is built on those same balances, so a partial history makes the
headline figure partial too. It carries the same signal and the same sentence.

Neither screen has a browser check for the sentence, for the reason above, and
that is the same limitation on both rather than a new one.

## Still not done
- **50,000 is a number, not a principle.** A household with more history than
  that still gets a wrong balance, quietly, until the sentence above exists.
- **Pagination would remove the question**, and the repository has no cursor API.
