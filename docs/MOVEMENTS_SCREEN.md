# A Probe That Can Say A Screen Calls The Thing

`js/services/explain.js`, a Movements tab and two panels in
`js/modules/finance.js`, an `extra` option on `recordDetail`, and a new probe
kind in `tools/architecture.mjs`.

## The last headless engine, and the entity nothing linked to

`domain/explain.js` answered rule 57 for one movement and counted the answers
across a household, and nothing asked it either question.

Worse: **no module in the application mentioned `economicEvent` at all.**
`grep -n economicEvent js/modules/*.js` returned nothing. The entity this
repository's own architecture document once called *"the largest single piece
of Layer 4 work"* had been stored since Phase 5, was reachable at
`#/finance/economicEvent` because the route falls out of the schema, and no tab
had ever linked to it. The same gap the Messages tab closed one tranche
earlier, on a bigger entity.

## What is on screen now

A **Movements** tab beside Loans, in `NO_ADD` — no Add button, for the reason
the Messages tab has none. A movement is made of the rows it is made of, and it
is created by confirming a match between them. A blank form would produce a
movement with **no legs**, which is the worst thing `domain/explain.js` can
find and which the screen meant to report it would then have invited.

Above the list, the household count:

> 1 of 3 movements are made only of rows parsed from a statement. 1 includes a
> row somebody typed, and 1 has no rows behind it at all. None of this was
> checked by a person.

and, where there is anything wrong, the movements themselves, each linking to
its own record. Nothing has been changed: a figure recorded on a movement is
what somebody confirmed, the rows are what they say now, and both are kept.

Under a movement's own fields, where it came from — the legs, each with the
chain back to the file it was parsed out of, and both figures side by side when
the rows no longer add up to the one on the record.

## `recordDetail` gained an `extra`

The fields say what a movement *is*. Where its amount came from is a walk back
through the legs to the statement they were parsed out of, and no column can
hold that. `extra` renders below the fields, and `modules/finance.js` passes one
only for `economicEvent`.

## I deleted the panel by accident, and only the type checker noticed

Mutation testing the new code, I mutated `recordDetail` to drop the `extra`
render — and then restored the file with `git checkout`, which also reverted the
JSDoc I had written minutes earlier. The node suite passed. The browser suite
had already passed. **1673 tests and 279 browser checks had nothing to say about
a screen panel that was no longer rendered.**

The type checker caught it, and only by luck: `finance.js` passes `extra`, the
restored signature did not allow it, and that is a type error. Delete only the
*render* line and keep the signature, and nothing in the repository would have
known.

That is the same failure this stack has been finding all day, arriving on my own
work: a thing built, and nothing that would notice its absence.

## So the architecture document learned a new kind of claim

`tools/architecture.mjs` could assert three things: a file exists (`file:`), a
module exports a name (`export:`), and a term appears nowhere (`absent:grep:`).
All three are claims about **an engine**. None of them can say *a screen calls
it* — so a row could assert `explainEvent` and stay green while nothing drew it,
which is precisely how this tranche's subject came to exist.

`wired:<path>#<term>` says that file mentions that term. Three rows now use it:

| Row | Probe |
| --- | --- |
| Economic events, on a screen | `wired:js/modules/finance.js#ExplainService` |
| Rule 57 — every financial event explainable | `export:js/domain/explain.js#explainEvent` |
| A record screen can carry an answer its fields cannot | `wired:js/modules/crud.js#options.extra` |

The third is the one that closes the hole above. Deleting the render line now
fails `node tools/architecture.mjs` with the row named — verified by deleting
it.

Two details the probe needed:

- **Word boundaries.** `ExplainServiceOld` is not `ExplainService`, and a probe
  matching loosely would go green through a rename it exists to catch.
- **Escaped punctuation.** `options.extra` carries a dot, and an unescaped dot
  matches any character. A probe that goes green on `optionsXextra` is a probe
  with a hole in it. Both have tests.

## What the browser can and cannot check here

The Movements tab is asserted reachable, and asserted to offer no Add button.

The **per-record panel is not** driven in the browser, and the reason is
measured rather than assumed: a diagnostic run counted the confirmable
transfers on the finance overview at that point in the suite and found **zero**.
Manufacturing one means importing a second statement with a matching credit,
into a suite that is one long ordered session — and whose order I have already
broken twice today. The panel's content is tested against a real in-memory
database in `tests/services.test.mjs`; its rendering is held by the `wired:`
probe above. That split is stated here so nobody reads the browser count as
covering it.

## What is still not built

Nothing in this stack is headless now. Still absent: DOCX template versioning,
PDF output and Drive upload; Phases 13–15, 17, 20 and 23–25; nine of the
required top-level documents and all twenty compliance documents.
