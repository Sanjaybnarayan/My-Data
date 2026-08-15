# Every Financial Event Must Be Explainable

Rule 57, on the record the rule is about. `js/domain/explain.js`, additions to
`js/data/provenance.js`, one new index in `js/data/schema.js`, tested in
`tests/explain.test.mjs` and `tests/provenance.test.mjs`.

Rule 57 sits in the prompt's block of SMS rules, 51 through 57, and unlike the
six above it is stated generally: *every financial event must be explainable*.
This tranche reads it that way and applies it to `economicEvent` — the entity
the phrase names — rather than to messages. The SMS half of that block is
`docs/SMS_INTELLIGENCE.md`.

## What the application said

`data/provenance.js` reads one hop, `data/lineage.js` walks the chain, and both
are careful files. Asked about a movement whose two legs were parsed from a
named PDF, the application answered:

```
transaction     hops: 2   Started as the file hdfc-jul-2026.pdf. This transaction was parsed from it.
economicEvent   hops: 1   This economic event came from something not recorded.

provenance of the movement: {"source":"unknown", …}
explain: "Source not recorded."
```

Three separate ways of saying *we know nothing about this* — about the one
entity in the schema that rule 57 names.

It was false twice over. The reasoning was on the record all along:
`economicEvent.why` holds the sentence the matcher wrote when the movement was
confirmed. And the legs were findable, because `transaction.movement` points at
the event.

## Why nothing found them

Every edge `lineage.js` follows is a **forward** reference. A transaction names
its statement; a receipt names its transaction. A movement names nothing — its
legs name *it*.

That is the right way round for the schema. An event does not know in advance
how many rows will turn out to belong to it, and `transaction.movement` is
where that fact belongs. It is the wrong way round for a walker that only reads
forward, and no amount of care inside `lineage.js` was going to notice.

So the reverse lookup lives in `domain/explain.js` and `lineage.js` is left
alone. Adding a reverse edge there would turn every origin walk into a query
rather than a get, to serve one entity.

## What it reports now

```
## well-formed
  Made of 2 account rows, from somebody typing it in and the file
  hdfc-jul-2026.pdf. It was treated as one movement because a debit and a
  credit of the same amount one day apart. None of this was checked by a person.

## edited rows
  amount recorded ₹25,000 · from legs ₹22,000 · agrees false
  Made of 2 account rows, from somebody typing it in. It was treated as one
  movement because same amount, same day. The rows no longer add up to the
  figure recorded here. Both are shown and nothing changes either.

## no legs
  Nothing is recorded as a leg of this movement, so there is nothing behind
  the figure on it.
```

And for the household:

```
total 3 · documented 0 · partly typed 2 · unexplained 1 · disagreeing 1
```

## What it refuses

**It never repairs the amount.** When the legs no longer add up to the figure
stored on the event, both numbers are reported and neither is changed. The
stored figure is what a person confirmed; the legs are what the rows say now. A
disagreement between them is the most interesting thing this file can find, and
silently preferring either would destroy it — the rule the reconciler and the
KYC comparison already follow.

**It never treats an uncomputable amount as agreement.** Where no leg says
which way the money went, `fromLegs` is `null` and `agrees` is `null` — not
`0` and not `true`. An unanswered question is not an agreement, and zero is a
claim about the money.

**It never counts a typed leg as unexplained, or as documented.** Somebody
typing a figure is a real provenance, and a different one from a bank's own
paper. The two are counted apart rather than summed into one reassuring number.

**It never says anybody checked it.** Every chain ends at something a machine
read. A test asserts the sentence contains *"None of this was checked by a
person"* and none of *verified*, *confirmed by* or *proven*.

## Two honesty defects in shipped code

### The sentence blamed the record for the tool's limit

`explain()` returned *"Source not recorded."* in two entirely different
situations: a record that genuinely says nothing about where it came from, and
an entity this file was never taught to read. A household reads that and
concludes their data is incomplete, when the truth is that nothing ever looked.

`isUnderstood()` exists precisely to tell those apart — its own doc comment says
so — and `explain()` was not asking it. It now says:

> Nothing here knows how to read a source for this kind of record. That is a gap
> in this application, not a fact about this record.

### `complete` was the wrong name

The first version of the per-movement result carried `complete`, defined as
*every leg traces past its own row **and** there is more than one leg*.

Two things wrong with that. `complete` is the kind of word a screen turns into a
tick — over a movement half of which somebody typed from memory. And it folded a
missing second leg into the same flag as a missing document, which is a
different fault with a different fix. It is now `fullyDocumented`, which claims
exactly what it checks, and the one-leg case is a problem of its own.

## The reader that was missing

`economicEvent` now has a provenance reader: `SOURCES.DERIVED`, method *"matched
from the account rows it is made of"*, with `why` as its evidence and confidence
`medium` — a rules decision, never a person's, whatever `why` says. Where no
reasoning was recorded it drops to `low` and says so.

`verification` stays `unverified`, as it does for every entity. Nothing in the
schema records a human sign-off, so nothing may claim one.

## One index

`transaction` gains `['byMovement', 'movement']`. Without it, asking a two-leg
movement for its legs is a scan of every transaction the household owns.
Structural migrations are derived from the schema, so this costs one schema
edit and nothing else.

## What mutation testing found

Twelve mutations, all twelve caught. The ones worth naming:

| Mutation | Caught by |
| --- | --- |
| **A fee is one of the legs** | *a fee is not part of the amount* |
| **The amount is the sum of both sides** | *the movement is the larger side, not the sum of both* |
| **No direction gives zero** | *rows with no direction give null, never zero* |
| **An uncomputable amount agrees** | *an unanswered question is not an agreement* |
| **A movement with no rows is fine** | *a movement with no rows behind it at all* |
| **A typed leg counts as documented** | *a typed leg is explainable, and is not counted as documented* |
| **`fullyDocumented` ignores the chain** | *a typed leg …* |
| **Another movement's legs are included** | *the legs are found by index, not by reading every transaction* |
| **The sentence drops "checked by a person"** | *nothing here ever says a person checked it* |
| **A disagreement is folded into the buckets** | *a disagreement is counted apart from how well documented it is* |
| **A movement is read as hand-typed** | *a movement says it was calculated* |

## The ratchets

- The precache check required `js/domain/explain.js`.
- Two existing provenance tests failed the moment the reader was added — the
  list of understood entities, and the assertion that `explain('vehicle', {})`
  says *"Source not recorded"*. The second was not a stale test but a **wrong**
  one: it asserted the behaviour this tranche found to be misleading.
- Typecheck held at 181; field coverage 78; policy, lint and architecture clean.

## What is still not built

No screen. `explainability()` is the household-level count and nothing draws it,
so the movements report remains a function with tests rather than something a
person can open. The other half of rule 57 — an explanation for a *category* or
an *insight*, rather than a movement — is untouched: `domain/categorise.js`
records no reasoning it could be asked for.
