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

## Verification

- `npm test` **1508**, browser **253**, typecheck **181/181**
- architecture 49 claims, field-coverage 83, policy, lint, UI→database 61/61

## Still not done

- **Nothing yet says "truncated" on a screen.** `transactionsTruncated` exists
  and the Finance service does not call it. That is a gap of exactly the kind
  this repository keeps finding, and it is recorded rather than glossed —
  the honest fix needs a sentence on each screen that shows a balance, which is
  more than one tranche's work.
- **50,000 is a number, not a principle.** A household with more history than
  that still gets a wrong balance, quietly, until the sentence above exists.
- **Pagination would remove the question**, and the repository has no cursor API.
