# Data Lineage

Phase 0.5, fourth tranche. `js/data/lineage.js`, tested in
`tests/lineage.test.mjs`.

`provenance.js` answers one hop — this transaction came from that statement.
Lineage answers the whole question:

> Started as the file august.pdf. A transaction was parsed from it. This
> receipt was matched to that transaction.

## Origin edges are declared, not inferred

The schema has **47 reference edges and most of them are not lineage.**
`transaction.person` says who a payment was *about*; `transaction.account` says
where it sits. Neither says where the record came from.

Walking every `ref` would produce a plausible-looking graph answering a
different question than the one asked — which is worse than answering nothing.
So origin edges are listed by hand, and there are **three**:

| Entity | Edge | Relation |
| --- | --- | --- |
| `transaction` | `statement` | parsed from |
| `receipt` | `transaction` | matched to |
| `investmentTransaction` | `holding` | recorded against |

That short list is the honest shape of this schema. A household record keeper
mostly stores things people typed; the derived chains run through the importer
and the mail reader. Adding an entry is a claim that one record was *derived*
from another, and should be made deliberately rather than fall out of a field
happening to be a `ref`.

## Where a chain stops

At something outside the application that can be **named but not fetched** — a
Gmail message id, a Drive file id, a file name. The application does not keep
that PDF and cannot re-read that email to prove the figure. Pointing at it is a
trail; implying it can be reopened would be a decoration.

A hand-typed row has a chain of one, and that is **not a failure** — it came
from a person, which is a real origin with nothing external to point at.

## A broken trail is reported, not hidden

A reference pointing at a record that has been deleted produces
`origin.broken` and a `missing` step, because *"the statement this came from
was deleted"* is a different and more useful answer than *"this is where it
started"*.

## Two bugs caught while writing it

**The sentence attached every relation to the wrong entity.** The first draft
read `matched to a receipt, parsed from a transaction` — describing a chain
that does not exist. A relation belongs to a *pair*, not to one name. Found by
printing the sentences and reading them.

**A chain of one narrated a hop it did not have.** `Started as something not
recorded, and is this account` — now `This account came from something not
recorded.`

## Not done

- Field-level lineage. This is record-level: a single mis-read *cell* cannot be
  traced.
- The prompt's longer chain — email → attachment → invoice → purchase →
  warranty — needs `Purchase` and `Warranty` entities, which do not exist.
