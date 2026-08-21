# One Payment, One Receipt

`js/domain/rentreceipt.js`, drawn in `js/modules/reports.js`. Tested in
`tests/docx.test.mjs` and in the browser.

Phase 10, and it began as a correction rather than a feature.

## The claim that was wrong

`docs/COMPLIANCE/PROPERTY.md` — written and merged an hour earlier — said the
application *"cannot say which months were actually paid"*, and listed a rent
ledger among the things that did not exist.

**That was false.** `rentReceived` already read the credits, reported each month
as received or not, and produced no document for a month with no matching
payment. The error was found by going to build the missing thing and discovering
it was there.

It is corrected in place rather than quietly overwritten, because a compliance
document that misdescribes a control is worse than one that omits it — somebody
may act on either, and only one looks authoritative.

## The defect that was real

Not the existence of rent tracking. Its **attribution**.

```
one credit of ₹35,000 · two flats both let at ₹35,000
  Flat A says received: true · txn t1
  Flat B says received: true · txn t1
```

The matcher keyed on amount and direction alone. A household letting two flats
at the same rent got **two receipts from one payment** — the same rupee
acknowledged twice, on documents the landlord signs and a tenant or a tax
officer may rely on.

This is the double-counting class this project refuses hardest — the same shape
as counting an internal transfer as income — except here it ends in a signed
document rather than a wrong total.

Two smaller faults sat beside it, both false negatives:

```
a tenant who paid ₹24,000 of ₹25,000   →  received: false
a rise to ₹25,500 the record missed    →  received: false
```

The tenant paid and got nothing.

## What was built

**A property may name the account its rent arrives in.** `property.rentAccount`
is optional, and it is what makes a payment attributable.

**With it set**, a credit into that account inside the month is the rent, and
the receipt states **what arrived** — so a part payment is receipted for the
part, with the shortfall reported beside it, and a rent rise is no longer
invisible. The receipt says ₹24,000 because ₹24,000 arrived.

**Without it**, the older exact-match rule stands. Any credit in any account
would otherwise become rent, which trades a false negative for a false
positive on a signed document. **The change is opt-in**, and a household that
records nothing new sees exactly what it saw before — asserted by a test.

**A credit two lettings could claim is attributed to neither.** `rentReceived`
now takes the household's other lettings and refuses a contested credit, with
the month saying why:

> a credit this month could belong to more than one letting — record which
> account each property's rent arrives in to tell them apart

That sentence matters more than the refusal. *"Nobody paid"* and *"somebody
paid and this application will not say whose it was"* are different situations,
and only the second has an action attached. They are counted separately —
`missing` against `contested` — and the screen prints both.

Binding two lettings to the **same** account is contested again. It
disambiguates nothing, and pretending otherwise would be worse than the
original bug.

## What is still not built

**A tenant record worth the name.** `tenantName`, `tenantPhone` and `deposit`
are three fields on the property row. No tenant entity, no lease history, no
arrears figure — only a count of months where less arrived than the rent on
record.

Closing that means deciding what a tenancy is here: a relationship with its own
ledger, or three fields on a flat. The receipt generator implies the first and
the schema provides the second, and that is a product decision rather than an
implementation detail.

## What was checked

Four domain mutations, all caught — including reinstating the original bug,
which fails three tests. One browser mutation, also reinstating it, which fails
the check that the contention message reaches the screen.
