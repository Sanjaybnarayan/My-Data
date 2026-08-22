# A Family Tree Of Strangers

Phase 2, first tranche. `js/domain/tree.js`, tested in `tests/tree.test.mjs`
and in the browser suite, surfaced on Family.

## The bug

The person form carries a `relationship` dropdown — self, spouse, son,
daughter, father, mother, and the rest — right beside the name. Filling it in is
the obvious thing to do, and nothing on that screen suggests there is anywhere
else to record a family.

The tree read none of it. Measured on six people, every one of them tagged:

```
what the household filled in        what the family tree showed
  Sanjay     self                     generations : 1
  Asha       spouse                     level 0 : Asha, Krishnan, Lakshmi,
  Ravi       son                                  Meera, Ravi, Sanjay
  Meera      daughter                 edges drawn : 0
  Krishnan   father                   unplaced    : all six
  Lakshmi    mother
```

Every one of them sat under *"Not connected to anyone… these people have no
relationship recorded"* — while their relationship was recorded, on their own
record, in the field the form puts first.

The same family entered through the separate Relationships entity gave the
correct three generations. So the data was there twice over: once in a place
nothing read, and once in a place nothing prompted anybody to fill in.

## The third instance of one pattern

This is the same shape as two findings already recorded:

| Field | Collected by | Read by |
| --- | --- | --- |
| `transaction.category` | the transaction form | nothing — `docs/ENTERED_CATEGORIES.md` |
| `transaction.person` | the transaction form | `services/records.js`, `services/conflict.js`, `services/finance.js` — **closed** |
| `person.relationship` | the person form | nothing — this document |

**This application collects more than it reads.** Each instance looks like a
missing feature and is actually a wiring gap: the data is present, dated,
structured, and ignored. Worth checking for directly rather than waiting to
trip over the fourth.

## Implied, never stored

The edges are derived at read time, like classification, provenance and accrual
before them. Writing them into the `relationship` entity would give a household
two copies of one fact to keep in step, and correcting the dropdown afterwards
would leave the copy behind.

Stored edges are listed first when the two are merged, so where an implied edge
collapses onto a recorded one, **the recorded one survives with its own id** —
somebody entered it deliberately.

## Where it refuses

| Refused | Why |
| --- | --- |
| **Nobody marked as `self`** | "son" is a relationship *to somebody*. Guessing who would rearrange the whole family around an assumption |
| **Two people marked as `self`** | it is not clear whose family the relationships describe, and picking one would silently move everybody else |
| **An in-law with no spouse recorded** | a father-in-law is a parent *of your spouse*; placing him as your own parent puts your spouse's family in the wrong branch |
| **A relationship with no rule** — `other` | implies nothing, and that is not an error either |

Each refusal produces a sentence, shown on the Family screen. Silence would
leave a household staring at a flat tree with no idea why, when the fix is
usually one field on one record.

In practice the first refusal is rare: first run already creates a person named
"You" with `relationship: 'self'`, so a fresh install has what this needs from
the beginning. That was discovered by the browser check failing — it created its
own `self` and correctly tripped the two-selves refusal.

## When the two ways of recording disagree

Two ways to record one fact means two ways to record it differently. Ravi's own
record says he is a son; an edge says he is Sanjay's parent.

**Neither side wins.** Both are reported, named, and left for a person to
settle — the codebase's rule that an uncertain match is never forced. A tree
that quietly chose one would be wrong in a way nobody could see.

A pair with no stored edge at all is *not* a conflict. That is the gap this
fills, not a disagreement.

## What mutation testing found

Sixteen mutations. Fifteen caught, one survived.

| Mutation | Caught by |
| --- | --- |
| **The person form is never read** (the original bug) | *appears as a family rather than a flat list of strangers* |
| **A son becomes a parent** / **a father becomes a child** | the generation assertions |
| **A grandmother is only one generation back** | *siblings, grandparents and grandchildren land in the right generation* |
| **An in-law is placed as your own parent** | *an in-law hangs off the spouse, not off self* |
| **Implied edges are put before recorded ones** | *an implied edge and a recorded one are the same edge, not two* |
| **A contradiction is not reported** | *the contradiction is reported rather than silently resolved* |
| **Agreement is reported as a contradiction** | *agreement is not a conflict* |
| **A guard skipping `self` is removed** | **survived** — the guard was dead |

The survivor was a guard of my own that could never fire: `self` is absent from
both mapping tables, so it falls through the way `other` does. It was deleted
rather than kept, and the property it was trying to state — that nobody is made
their own parent — is now asserted directly, which also catches a future `self`
entry being added to the table.

## Not done

- **`describeRelation` still walks edges linearly** for each person rendered.
  Fine for a household; it is O(people × edges).
- **Half-siblings, step-parents and adoption** have no vocabulary in the
  dropdown or the relationship types, so nothing here can express them.
- **`person.relationship` is relative to `self` only.** A household recording a
  cousin's children would need the Relationships entity, and the dropdown
  cannot say so.
- **The relationship dropdown and the Relationships entity still both exist**
  with no cross-linking on screen. This makes them agree where they can and
  reports where they cannot; it does not merge them.
