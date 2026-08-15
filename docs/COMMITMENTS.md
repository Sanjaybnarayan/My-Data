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

---

# The other direction: money that leaves and nothing records

Everything above asks what the **records** add up to. A bank statement answers a
different question — what actually left — and the two had never been put side by
side.

## What was measured

One salaried household, six months of statement, against its own records:

```
  committed, from the records          : ₹53,500 a month
  repeating charges the ledger can see  : ₹55,329 a month
```

Two charges, repeating monthly at a steady amount, that no record in the
application accounts for:

```
  CLOUD BACKUP    ₹1,180  monthly  x6
  NETFLIX           ₹649  monthly  x6
```

**₹1,829 a month — ₹21,948 a year.** Both figures were already being computed.
Neither had ever been compared with the other.

## A correction to this document's own first draft

The first measurement said **₹10,829 a month**, because the fixture's grocery
shop was exactly ₹9,000 in each of six months — which no real grocery shop is.
With realistic variation the detector's own 20% tolerance rejects it, and the
figure falls to ₹1,829.

That is worth recording rather than quietly fixing. The overstatement came from
a fixture built to be *tidy*, and a household would have been shown a number
nearly six times too large. The same fixture discipline that found the receipt
reader's flattened-text bug applies to money: **a fixture that is neater than
reality produces a finding that is bigger than reality.**

## What it will not do

**It does not create anything.** A detected charge is not a record. Promoting
one to a `subscription` on the strength of a name match would be this file
deciding something the household did not, and the standing rule here is that an
uncertain match is never forced.

**It is not added to the committed total.** Not because the money is not real,
but because `total` means *what the records say*, and this is read from
statements. The sentence says which, in those words, so the two are never
confused:

> A further ₹1,829.00 a month leaves on a schedule that no record here explains
> — CLOUD BACKUP, NETFLIX. That is read from your statements, not from this
> list, so it is not added to the figure above.

**An uncertain match is excluded from the figure.** Two records that fit equally
well, or a single shared word on otherwise unalike names, are reported as
questions and counted in nothing. A total that included maybes would overstate,
and the entire value of this number is that it can be believed.

## How a narration is matched to a record

Word overlap, not equality. A record says *Rent* and the narration says
*LANDLORD RENT*; a record says *Home loan* and the narration says *ACH DR HDFC
HOME LOAN EMI*. Requiring equality would report every real commitment as
unaccounted — a wrong claim in the other direction, and a louder one.

`WEAK` is what stops that being too generous: *ach*, *upi*, *emi*, *bank*,
*card*, *payment* and the like are dropped before overlap is counted. Without
it, a record called *Card payment* shares both its words with every card
narration and would account for all of them.

**The amount is reported, not required.** A record saying ₹499 while ₹649 leaves
every month is one commitment at a stale price, not two commitments — and that
pair is exactly what is worth showing. Requiring the amounts to agree would hide
it as unaccounted and invent a second commitment that does not exist. This is
the same choice `duplicateCommitments` makes, for the same reason.

## What this costs

The Finance overview now categorises every transaction it loads on each paint,
to find what repeats. Measured:

| Rows | categorise | recurring | total |
| --- | --- | --- | --- |
| 2,000 | 75ms | 12ms | 87ms |
| 10,000 | 152ms | 12ms | 164ms |
| 20,000 | 223ms | 23ms | 246ms |

A quarter of a second at the 20,000-row limit the screen loads at. That is the
same order of work the Ledgers screen already does on every visit, and it is
stated here rather than discovered later.

## Verification

- **10 of 10 mutations caught** on the domain layer — including *a stopped run
  counted as a commitment*, *an ambiguous match picking the first record*,
  *uncertain charges counted in the figure*, *a cadence ignored when totalling*,
  *the unaccounted figure folded into the committed total*, and *weak words
  identifying a commitment*.
- Two survived the first pass and were **genuine missing tests**: a record named
  for a common word swallowing every narration, and `differsBy` reporting a
  difference against no record at all — a value a screen could print as
  *"differs by ₹649"* when there is nothing to differ from.
- A third survivor was **my own mutation being wrong**: it replaced only the
  first line of the `WEAK` set, leaving *card* and *payment* weak, so the test
  it was meant to defeat could not fire. The fourth time in this project that a
  survivor has turned out to be a bad mutation rather than a gap, and the reason
  every survivor is read before it is believed.
- **4 browser checks**, driving real transactions through the real form, and
  **the wiring itself mutated** — the screen not passing what it detected, and
  the detector run over nothing — because a panel that is silent when it has
  nothing to say is indistinguishable from one that never runs. That is the
  receipt-match lesson, applied before it could happen again rather than after.

## Still not done

- **Nothing offers to create the missing record.** A button that turned a
  detected charge into a subscription is the obvious next step and is
  deliberately absent: it would need the household to confirm an amount, a
  cadence and a name that were all inferred, and inferring three things and
  asking for one confirmation is how a wrong record gets written.
- **A charge is matched to a record, never to an account.** A household paying
  the same subscription from two accounts sees one charge, because
  `counterpartyKey` groups on the payee alone.
- **The detector cannot tell a subscription from a habit.** A standing order and
  a fortnightly shop of consistent size look identical by shape. The tolerance
  rejects most habits, as the correction above shows, but not all — and where it
  does not, the household is shown a row it can dismiss rather than a claim it
  must argue with.
