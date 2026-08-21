# A Percentage That Can Reach A Hundred

`js/domain/profile.js`, `IdentityService.profiles()`, drawn above the people
list in `js/modules/identity.js`. Tested in `tests/profile.test.mjs`, in
`tests/services.test.mjs`, and in the browser.

Build prompt v6.0, Phase 2: *"Calculate: Individual Completion %, Family
Completion %, based on configurable sections."* The percentage is the easy
part. Making one that does not lie took the rest of the tranche.

## The measurement that set the design

A person who rents, drives nothing, owes nothing and runs no websites, with
everything else filled in:

```
naive rule       75%  —  12 of 16 sections · waiting on Loans, Vehicles,
                         Property, Digital life
```

**Those four cannot be filled by any amount of typing.** There is no car to
record. The number sits at 75 permanently, the household learns that the bar is
decoration, and within a week it is furniture.

So a section can be marked **not applicable**, and the figure is over the
sections that apply:

```
once said so    100%  —  12 of 12 sections · 4 marked not applicable
```

"No vehicles, and that is correct" is a complete answer to Vehicles. It is a
different state from "nobody has looked", and a number that cannot tell them
apart is measuring the wrong thing.

The answer lives on `person.notApplicableSections`, hidden from the form
because it is given by dismissing a section, not by typing section ids.

## The figure is never shown alone

Rule 57 — every figure must be explainable — applies here too. `completion`
returns the sections behind the number, each with what it is waiting for, and
the screen prints the sentence under the name:

```
Asha    12 of 16 sections · waiting on Loans, Vehicles, Property, Digital life
```

A bare percentage is a scold. It says a household is failing at something
without saying at what, and the only available response is to feel behind.

## What it refuses to do

**It does not weight sections.** Deciding Identity is worth three times Notes
would be this file inventing a household's priorities. Every applicable section
counts once and the list is there to be read.

**It does not treat a part-filled section as empty.** Somebody with a name and
no photograph is not in the same state as somebody with nothing, and one number
for both would say they are. Part-filled counts as recorded, and the missing
field names are shown.

**It has no figure for a person to whom nothing applies.** Zero would say the
record is bare; a hundred would say it is finished. Both are inventions. There
is no percentage, and the household figure leaves them out rather than counting
them as either.

**It does not report a permission failure as a gap.** A child cannot read
loans. Telling them a parent's Loans section is unfilled would turn *you may
not see this* into *nobody has done this*. Sections the reader cannot see are
dismissed for them, so the figure covers what that reader can actually account
for.

## The household figure is a mean, and why that is the harder choice

`familyCompletion` averages the members' percentages rather than dividing all
recorded sections by all applicable ones. On three full profiles and one bare
one the two rules give **75% and 69%**.

The mean is not chosen because it is kinder — here it is higher, elsewhere it
would be lower. It is chosen because **the ratio weights a person by how many
sections apply to them**: somebody with a car, a house and a loan would count
for more of the household's figure than somebody who rents. That is a statement
about their assets, not about how well either record is kept.

## Two second copies avoided

The section list names entities, and which field on each entity points at a
person is **derived from the schema** rather than written out again. This
project has now found the same fault three times — `modules[].entities` beside
`entity.module`, a store walk naming four of seven stores, and this would have
been the third. `personKey` refuses an entity with two person references rather
than guessing: `relationship` has `fromPerson` and `toPerson`, and picking one
would be the code deciding whose relationship it is.

`unknownReferences()` checks every section against the schema, and **takes the
list as an argument** so a test can hand it a broken one. Asserting only that
today's list is clean passed just as well against a function that returned
nothing at all — which is what the first version of that test did, and what
mutation testing caught.

## What the tests could not establish

The service records *presence* rather than a count. Mutating it to a running
total leaves the entire suite green, because `completion` only ever asks
whether the number exceeds zero. The two are indistinguishable by behaviour.
Presence is written so that the load limit can never make a stored count wrong
— a property of the code, not one a test can observe, and worth saying plainly
rather than implying a test proves it.
