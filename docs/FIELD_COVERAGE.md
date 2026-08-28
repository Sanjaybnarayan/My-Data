# Auditing For The Fifth One

`tools/field-coverage.mjs`, `tools/field-coverage.json`, checked in
`tests/modules.test.mjs`. The reminder fixes it turned up are in
`js/domain/reminders.js`.

## Why

Four times a field has been collected on a form and read by nothing:

| Field | Found | How |
| --- | --- | --- |
| `transaction.category` | `docs/ENTERED_CATEGORIES.md` | tripped over |
| `person.relationship` | `docs/FAMILY_TREE.md` | tripped over |
| `transaction.person` | `docs/HOUSEHOLD_LEDGER.md` | tripped over |
| `importantDate.remindDaysBefore` | this document | **audited for** |

Each looked like a missing feature and was a wiring gap — the data present,
structured and ignored. Three of the four were found by accident, while
measuring something else. This is the check that stops the fifth being an
accident too.

## What it measures

A field is *collected* the moment it is on the schema: the generic form renders
it, the generic table can column it, the detail screen shows it. That is not the
same as being **read** — `transaction.person` appeared on three screens and no
code ever looked at its value.

So the test is whether the field's key appears **by name** anywhere outside the
schema and the generic machinery that works on any field at all. Thirteen files
are excluded as generic: the form and table components, the validator, the
formatters, migrations, classification, search, the report writers and
`modules/crud.js`. A hit in one of those proves nothing, because they iterate
`entity.fields` and would "use" a field no domain logic has ever heard of.

Two schema flags count as being read, because they are: `expiry` and
`anniversary` are what `expiryReminders` and `upcomingDates` iterate looking
for, so the value reaches a derivation without anything naming the key.

## What can fool it

Comments are stripped before the scan; **string literals are not.** So a field
name appearing in ordinary prose inside a quoted string counts as a read.

Found by tripping over it: adding `js/domain/compliance.js`, whose text
included the phrase *"and is an employer besides"*, made `person.employer` and
`employment.employer` disappear from this list without either becoming any more
read than before.

The prose was reworded rather than the scanner loosened, because stripping
string literals would hide the reads that legitimately use one — a field
fetched by a quoted key is still a field being read. The limitation is recorded
here instead: **this inventory can shrink for the wrong reason**, and a field
leaving the list is worth a glance at what made it leave.

## What a finding does *not* mean

**80<!--live:unreadFields--> of 614<!--live:fields--> fields are unread, and that is not 73 bugs.** A vehicle's chassis
number and a medication's dosage are reference data: you record them, you read
them on screen, and nothing should compute with them.

**This paragraph used to open with "a policy's nominee", and that example was
wrong.** It stood here as the illustration of a field that is *correctly*
unread, and `docs/NOMINATIONS.md` records what happened when it was finally
tested: a household could not ask which of its accounts had no nominee, what
was nominated to one person, or whether two spellings were the same person —
three derivations, all taking that field as input. The correction is left
visible rather than replaced with a safer example, because the failure was not
the example. It was assuming a field is reference data because it looks like
reference data **on a form**, and that assumption can be made about any of the
names still on this list.

The inventory is therefore **names only, with no per-field justification**. A
hundred invented reasons would be worth less than the single question this
actually asks: *is this new field wired to anything, and did you mean it not to
be?* Adding to the list is a deliberate act with a commit message attached.

The check fails in both directions. A field that has since been wired up must
come off the list, or the inventory rots into something nobody trusts.

Verified by adding a `person.favouriteColour` to the schema: the suite fails and
names it.

## What it found

### `importantDate.remindDaysBefore` was ignored, in both directions

The form offers "remind me N days before", with a default of 7 and a range up
to 365. `upcomingDates` used the caller's horizon for every record.

```
  date                     in   asked  shown?
  Wedding anniversary     80d     90d  no    <-- wanted yes
  Visa renewal            60d     90d  no    <-- wanted yes
  Bin day                 20d      2d  yes   <-- wanted no
  Dentist                 10d     14d  yes
```

So a household asking to hear ninety days before a visa renewal got
forty-five, and one asking for two days before the bins went out got nagged
from twenty days away. **A preference collected and discarded**, which is the
same shape as the entered-category bug.

The fix mirrors what the expiry path already does with `expiryLead`: the
per-record lead wins where there is one, and it may reach further out than the
caller's default, because that is what asking for it means. `??` rather than
`||`, because nought is a preference — "tell me on the day" — and falling
through would overrule somebody who said so.

### And a second bug underneath it

Writing the tests surfaced something the audit had not been looking for.
`upcomingDates` takes a `from` date and computed the distance from the **wall
clock** anyway. In the application the two agree, because `from` defaults to
today. They disagree for any caller that passes one — including
`allReminders` with an injected clock, which was already resolving the clock to
a day for exactly this reason and then losing it one function later. Its own
comment says so:

> *"passing the clock straight through would leave it using the wall clock
> while the expiries used the injected one"*

Which is precisely what happened.

It survived because the birthday path has no `away < 0` guard, so a
wall-clock-derived negative simply passed the `> days` test and appeared with a
nonsensical `days` figure that nothing asserted. Both paths now measure from
`from`, and the birthday test asserts the figure rather than only the age.

## What mutation testing found

Six mutations, four caught on the first pass.

| Mutation | Caught by |
| --- | --- |
| **The per-record lead is ignored** (the original bug) | *told about when it asked to be* |
| **A lead of nought falls through to the default** | *a lead of nought means on the day* |
| **The lead is capped at the caller's horizon** | *told about when it asked to be* |
| **The distance is measured from the wall clock again** | *a short lead is not nagged about early* |
| **Past dates are shown** | **survived** — now caught |
| **A birthday is measured from the wall clock** | **survived** — now caught |

The second survivor is the more interesting: the existing birthday test asserted
only the age being turned, so the `days` figure — the entire point of an
"upcoming" list — was unasserted and could be off by a year.

## Not done

- **The other 92 are catalogued, not judged.** Some are probably worth wiring:
  `account.dueDay` and `account.statementDay` are exactly what a card-bill
  reminder would need, and `subscription.autoRenew` is the difference between
  being charged and lapsing. None of them is a *wrong number* today, so none was
  fixed here.
- **The scan is by name and whole-word**, so a field read only through a
  computed key (`record[k]`) reads as unread, and a key that collides with a
  common identifier reads as read. The first direction is safe — it
  over-reports. The second can hide a real gap, and `category` is the obvious
  candidate for it.
- **`event.remindMinutesBefore` is still unread** and stays on the list: events
  have no notification path at all, so wiring the lead would be building the
  reminder rather than reading a field.
