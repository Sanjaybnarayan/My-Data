# What the household is committed to

## What was measured

The Finance screen printed this, verbatim:

> **₹79,590.00 a month is already committed to bills, EMIs and subscriptions.**

`committedMonthlyOutflow(recurring, loans)` takes two arguments. There is a
`subscription` entity — `amount`, `frequency`, `renewsOn`, `active`,
`autoRenew` — and a `digitalAsset` entity with `annualCost` and `renewsOn`.
Neither reached the figure.

```
  committed, as the screen reported it : ₹79,590.00
  subscriptions recorded, per month    :  ₹5,341.92
  digital assets recorded, per month   :    ₹598.33
  the truth                            : ₹85,530.25

  bills due in the next 30 days        : 3   (rent, broadband, EMI)
  subscriptions renewing in that window: 5   — none of them listed
  autoRenew / cancelUrl / annualCost read by: nothing
```

**The number being low is the smaller half of it.** The sentence *named*
subscriptions, so a household reading it had been told the figure covered
something it did not. Every other wrong number found in this repository was
silent; this one made a claim.

Five subscriptions renewed inside the next thirty days and none appeared among
the bills. What the household did get was *"Netflix renews in 3 days"* — a
date, with no money attached to it, which is the half of the fact that costs
nothing to know.

## `autoRenew` is the field, and reading it is the point

A subscription that renews itself is a **commitment**: the money leaves whether
or not anybody acts. One that does not is the opposite — it **lapses** unless
somebody acts.

Counting the second as committed outflow would report money the household is
not going to spend, and would bury the only thing worth saying about it, which
is that the service stops on that date. So the two are separated and both are
reported:

> ₹84,931.92 a month is already committed to bills, EMIs and subscriptions, of
> which ₹5,341.92 is subscriptions that renew themselves. A further ₹598.33 a
> month is recorded against subscriptions and digital assets that do not renew
> themselves, so that money only leaves if somebody renews them.

A `digitalAsset` has no `autoRenew` field at all, so it counts as lapsing.
Calling it committed would put money into that figure on the strength of a
field that does not exist — the side of the guess that claims less.

**A record with `autoRenew` absent renews**, because the schema defaults it
true. That case was found by mutation: every fixture set the field explicitly,
so nothing pinned what happens to a row written before the field existed or
synced back from a sheet with a blank cell. Reading absence as *"does not
renew"* would have dropped those rows out of the committed figure silently —
reintroducing this exact bug through the back door.

## The double count it refuses to guess at

A household can record Netflix twice: once on the Subscriptions screen, and
once as a recurring payment whose `kind` is *subscription*. Nothing links them.

- Adding both **overstates** the commitment.
- Picking one silently **discards a record the household entered on purpose**.

Neither is done. Both are counted, and the pair is named with the amount at
stake — the same shape as [`SETTLEMENT.md`](SETTLEMENT.md), which names a card
bill counted twice rather than quietly correcting it:

> Up to ₹649.00 of this may be counted twice: Netflix is recorded both as a
> recurring payment and as a subscription. Both are counted here, because which
> one is the real record is not something this can decide.

Matching is on the **name alone, not the amount**. A household that recorded
the same service a year apart has two different prices for it, and those are
exactly the pairs worth asking about. The amount reported is the larger of the
two — the most that could be double-counted. Only a recurring payment the
household typed as `kind: 'subscription'` is considered: a broadband bill that
happens to share a name with a streaming service is not the same commitment.

## A renewal is a bill

`upcomingBills` now has four sources — recurring payments, loan EMIs, card
statements and subscription renewals. On the measured household the list went
from **3 bills to 9**.

A subscription's `autoRenew` *is* its auto-debit flag: the provider charges the
card without anybody doing anything. One that does not renew carries
`why: "this does not renew itself — it stops on this date unless somebody
renews it"`, and the row reads *"lapses unless renewed"* rather than looking
identical to a bill that pays itself. `cancelUrl` rides along on the row.

A renewal more than thirty days past is dropped. Unlike a card bill, nothing
here records that it was ever paid, so nagging about it forever would be a
reminder nobody can clear.

## One shape for every bill

The four sources know different things — a card knows its statement date, a
subscription knows whether it renews, a recurring payment knows neither. The
first version left the keys off where they did not apply, and **the typechecker
caught it**: `bill.account` was readable on one row and a type error on the
next.

Every bill now goes through `asBill()` and carries the same keys, nulled where
they do not apply, including `entity` and `recordId` so any row can open the
record behind it. Card and subscription bills are derived rather than stored,
so their own ids open nothing.

## Where it lives

- `js/domain/commitments.js` — `monthlyCost`, `subscriptionOutflow`,
  `duplicateCommitments`, `commitmentSummary`, `subscriptionBills`,
  `describeCommitments`
- `js/domain/finance.js` — `committed()` for the figure a household should see;
  `committedMonthlyOutflow()` stays as the bills-and-EMIs half it always was
- `js/modules/finance.js`, `js/modules/dashboard.js`, `js/ai/intents.js` — the
  readers
- `tests/commitments.test.mjs` — 32 tests. 22 mutations, all caught, one after
  a survivor exposed the absent-`autoRenew` gap above.
