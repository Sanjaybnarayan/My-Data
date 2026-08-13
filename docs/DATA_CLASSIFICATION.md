# Data Classification

Phase 0.5. Implemented in `js/data/classification.js`, tested in
`tests/classification.test.mjs`.

## The problem it solves

The schema carried one boolean — `encrypted` — which answers "is this
ciphertext at rest". That is a *storage* decision, and it was doing duty as a
*sensitivity* decision, which it is not:

- A PAN, a medical note and a vault password are all `encrypted: true`, and are
  not alike for masking, export, retention or what may be handed to a model.
- A bank balance is `encrypted: false`, because a search index over ciphertext
  finds nothing, and is plainly not public.

So "6.6% of fields are encrypted" was the only sensitivity answer available,
and it was answering a different question.

## The six levels

| Level | Meaning | Count |
| --- | --- | --- |
| `PUBLIC` | Safe to show anyone | **0** |
| `INTERNAL` | Housekeeping — ids, timestamps, versions | 2 |
| `PRIVATE` | Ordinary household detail | 115 |
| `SENSITIVE` | Balances, addresses, employers | 201 |
| `HIGHLY_SENSITIVE` | Identity and health — a leak is not fixable by changing it | 105 |
| `CRITICAL_SECRET` | Opens something else | 3 |

**Nothing is `PUBLIC`, and that is the honest answer.** The level exists so the
scale matches the one policies are written against. Finding a reason to use it
would be worse than leaving it at zero.

## Derived, not hand-annotated

426 fields hand-labelled would be 426 chances to be wrong and one afternoon
before the labels drifted from the schema. The level is derived from signals
the schema already carries — field type, `encrypted`, the entity's access
list, the module — and an explicit `classification:` on a field overrides when
the derivation is not good enough.

Rules, first match wins, each written so that being wrong protects *more*:

1. Declared `classification:` — beats everything
2. `type: 'password'` → `CRITICAL_SECRET`
3. `encrypted: true` → `HIGHLY_SENSITIVE`
4. Module is health, identity or vault → `HIGHLY_SENSITIVE`
5. Structural key → `INTERNAL`
6. Entity readable only by owners → `HIGHLY_SENSITIVE`; only by adults → `SENSITIVE`
7. `type: 'currency'` → `SENSITIVE`
8. Otherwise → `PRIVATE`

**An unknown field returns `CRITICAL_SECRET`.** The first draft returned
`PRIVATE`, which meant a misspelt key came back as "safe to display" — an
invisible failure in the one direction this module must never fail in.
Masking everything is a visible bug; revealing something because a key was
mistyped is not. `isKnownField()` tells the two apart.

## The invariants

`assertSound()` walks every field and enforces:

- No encrypted field classifies below `HIGHLY_SENSITIVE` — somebody paid the
  cost of ciphertext, and a rule contradicting that is a broken rule
- Every `CRITICAL_SECRET` is actually encrypted
- No `CRITICAL_SECRET` is in the search index — searchable means plaintext by
  construction

All three currently hold. All three were mutation-tested: breaking each one
fails a named test.

## What it revealed

**108 fields classify at `HIGHLY_SENSITIVE` or above. 80 of them are stored in
the clear.**

That is not automatically wrong — a searchable field cannot be ciphertext, and
that trade is documented per field by `whyPlain()`. But it is the number that
"6.6% encrypted" was hiding, and it is now on the Privacy report via
`mostSensitive()`.

## What this does not yet do

Masking is available (`mask()`) and is **not yet applied by the UI**. Wiring it
into list columns, detail views, search results, exports and the assistant is
the next tranche of Phase 0.5 and is where the classification starts changing
what a person sees rather than only what a report says.
