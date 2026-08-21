# What Points At This, And What This Points At

`js/domain/connections.js`, `RecordsService.connectionsFor`, drawn on every
record detail by `js/modules/crud.js`. The reference derivation is
`referenceFields` in `js/data/schema.js`. Tested in `tests/connections.test.mjs`
and in the browser.

Build prompt v6.0, Phase 17: *Knowledge Graph, Universal Search, Family
Timeline, What Changed.*

## Universal search already existed, and was measured before anything was built

The shell carries a box saying *"Search everything"*. Testing that claim:
**41 of 43 entities have searchable fields**, the index is written in the same
transaction as the record, and a search finds a `will`, a `goal`, a
`beneficiary` and a `legalDocument`. Only `bankStatement` and `fuelLog` have
none.

So the second of Phase 17's four words was done. This tranche is the first.

## An edge is a reference, never a resemblance

The tempting knowledge graph joins records that *look* related: two rows
mentioning the same name, a payment near a document's date, an insurer's name
in a transaction narration. Every one of those is a guess, and **a guess drawn
as a line is indistinguishable from a fact.**

This project already refuses that inference elsewhere — a nominee is never
resolved to a person on a near match, an SMS is never merged with a statement
row on a near amount, and `namesAgree` was written because reusing a
looser comparison would have called two family members the same person. The
same rule holds here: an edge exists because **one record stores another's
id.** Nothing is inferred, so nothing on this card can be wrong in a way the
records are not already wrong.

## The defect underneath it

`db.referencedBy` and `db.danglingReferences` both decided what a reference was
like this:

```js
def.fields.filter((f) => f.type === 'ref' || f.type === 'multiref')
```

The schema declares **78 reference fields**. That filter matched 61. The
seventeen it missed are every `files` field — every document attachment in the
application.

Measured:

```
transaction.documents = ["dcm_01M0J…"]
referencedBy(document):  -> NOTHING REFERENCES IT
```

So a document attached to a transaction reported that nothing depended on it,
and `impactOfDeleting` — the check that exists to warn before a delete breaks
something — said the same. Deleting it left the transaction pointing at a
record that was gone.

`referenceFields` replaces the type list with **anything carrying a `ref`**, so
a fourth kind of reference cannot be missed the same way. This is the fourth
time this project has found a hand-maintained list beside a derivable one:
`modules[].entities`, a store walk naming four of seven, a `beneficiary.assetKind`
duplicating what `assetId` resolves to, and now this.

The user-visible half is the one worth stating: **deleting a document that is
attached to something now warns.**

## Both directions, reported apart

*What does this point at* comes from the record itself and is exact.

*What points at this* has to be searched for, and it is the more useful half —
a person's documents, a vehicle's services, a will's beneficiaries. Inbound
groups are ordered most-connected first, because a person's forty documents
matter more to somebody reading the screen than their one employment record,
and sorting by entity name would be the alphabet deciding.

They are reported apart because they mean different things. *"This transaction
has a document attached"* and *"this document is attached to a transaction"*
are the same edge from two ends, and a household reading the document wants the
second sentence.

## A reference to a record that is gone is kept

Not dropped. It is marked `missing`, shown as *"this points at a record that is
not there"*, and given no link. Dropping it would hide precisely what makes it
worth showing — and it is what `danglingReferences` was written to find and
could not see for seventeen kinds of edge.

## Where the assembly lives

In `RecordsService`, not the screen. A card that called `db.referencedBy` and
then looked up a title per target would be several database calls in a view,
exercisable only through a browser — and it would have cost the UI→database
budget a call it may not spend. That budget refused the first version of this
card, which is the ratchet doing exactly what it is for.

## Still not built in Phase 17

**The family timeline has no screen of its own.** The activity feed exists and
groups the audit log into things that happened, but it is a dashboard widget
eight stories deep. That is the remaining half of *Family Timeline*, and *What
Changed* is done — every record says what has happened to it.
