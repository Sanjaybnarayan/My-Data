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

## Three local fixes, and the class left open

That is the third time this fault was met and the third time the *instance*
was fixed. The comment in `domain/timeline.js` that cleared `account.upiId`
was answered by stripping comments. The phrase in `domain/compliance.js` that
cleared `person.employer` was answered by rewording the phrase. The exported
`registered` in `core/locale.js` that cleared `will.registered` was answered by
renaming the function.

Each fix was right and none of them closed the class, because the class is not
"this sentence" — it is **text that is not code sitting in the haystack**. Two
more doors were still open, and both were measured rather than argued:

**Catalogue files.** Every user-facing sentence in `js/locale/` was in the
haystack. `will.registered` and `legalDocument.registered` were cleared by a
line about geofencing — *"They are not registered with the phone"* — and
`healthRecord.diagnosis` by one about health advice — *"No advice, no
diagnosis and no score."* The rename in `core/locale.js` had therefore changed
nothing: both fields stayed off the list, and the comment there went on saying
the name was the fix. A catalogue file is nothing but sentences, and this
search already strips comments on exactly that reasoning.

**Regex bodies.** A pattern is made of English words.
`/fuel|petrol|…|filling station|petro/i` in `domain/categorise.js` sorts a bank
narration; it cleared `fuelLog.station`. `/report|prescription|scan|x-?ray|…/`
in `domain/filing.js` sorts an uploaded file; it cleared
`healthRecord.prescription`. The tool's header had said regex literals were
untracked and that the failure would be "a field reported unread when code
names it — **loud**". It was the opposite and it was silent.

**String bodies stay.** Measured before deciding: dropping them would report 12
more fields, and at least seven are genuine — `domain/profile.js` lists
`emergencyContactName` and `emergencyContactPhone` in a `fields:` array it
reads by key, and `domain/kyc.js` names all five `kycRecord.held*` fields the
same way and reads `record[field.key]`. The paragraph above was right; it now
has a number behind it.

## The other direction: eleven fields the search index reads

The tool exempts three schema flags as generic wiring — `expiry`,
`anniversary`, and the keys an entity's `sort` names. There is a fourth it did
not know about. `searchableValues()` in `js/security/fieldcrypto.js` filters on
`f.search && !f.encrypted` and reads `record[f.key]`, for 140 fields, on every
write.

Eleven of them were on this inventory, described as collected and read by
nothing, while the local search index read them on every keystroke:
`account.upiId`, `certificate.issuedBy`, `digitalAsset.accountIdentifier`,
`education.achievements`, `education.qualification`, `person.nickname`,
`purchase.seller`, `trip.stayingAt`, `vaultItem.username`,
`vehicleService.workDone` and `vehicleService.workshop`.

`account.upiId` is the field this tool's own header cites as the reason
comments are stripped. Putting it back on the list was the right fix to the
wrong question: it never belonged there.

So the inventory moves **63 → 57**: five added that nothing reads, eleven
removed that something always did.

### And then two of the five were wired

`will.registered` and `legalDocument.registered` are the reason this whole
section exists — the pair whose clearing by a geofencing sentence proved the
rename in `core/locale.js` had never worked. Being reported was the point, and
what came of it is `registrationStatus()` in `js/domain/estate.js`.

That module opens by recording that two documents called `account.nominee`,
`holding.nominee` and `policy.nominee` reference data needing no derivation,
and that measuring it said otherwise in one line. `registered` is the same
claim one step along.

What it derives is deliberately thin, because the subject is not.
**Registration is not validity**: an unregistered will is still a will —
registration is optional in India and makes one harder to challenge, not
lawful — while for a deed it is frequently compulsory, and which deeds under
which statute is a question this application cannot answer and must not appear
to. So the screen reports which instruments in force the household has
**recorded as registered**, and separately where the household's own record
disagrees with itself: a document marked registered with no registration
number, or a number recorded against one not marked registered. That second
half needs no legal opinion at all.

The list is called `notRecorded` rather than `unregistered` on purpose. The
field is a boolean, so it has two states and a household has three — yes, no,
and never asked. A form nobody opened says no in the same voice as a person
who did.

Inventory **57 → 55**.

### And one more, from the half of a file that is not generic

`js/data/validate.js` is on the exclusion list because a hit there proves
nothing — it iterates `entity.fields` and would "use" a field no domain logic
has heard of. True of the coercers and the type switch, and they are the reason
the file must stay listed: `case 'number':` names a *type* that several
entities also use as a **field** name, so a bare search there would clear
`identityDocument.number` on the strength of a switch label.

`entityRules` in the same file is the opposite. Fourteen entities' worth of
hand-written cross-field rules, naming twenty-nine fields outright — `r.endTime`,
`r.completedOn`, `r.monthlyLimit`, `r.creditLimit`, `r.upiId`, `r.deceasedOn`.

Excluding the file wholesale hid all of them, and **`event.endTime` sat on this
inventory while a rule refused any event whose end time preceded its start**.
The list said the field was dead; the application was rejecting records because
of it.

The block is now read back in by position — the same way `tools/strings.mjs`
decides a class list by where it sits rather than by how it is spelt, because a
rule can be written in any style and no style test would have told these two
halves apart.

Inventory **55 → 54**.

### What this does not fix

The search still matches a field's bare name against one haystack, so it cannot
tell `cost` on a vehicle service from `cost` on a health record, or a field
named `url` from the field *type* `url`. **283 of 548 fields share a key with
at least one other entity.**

Scoping it to the entity was tried and does not work: a file that reads
`record[field.key]` names a *variable*, not an entity. Measured on three
modules that genuinely read the fields in question — `domain/kyc.js`,
`domain/fuel.js`, `domain/upkeep.js` — the entity name appears 3, 2 and 1 times
in the raw file and **zero times in code**. It survives only in comments, which
this search must strip for the reason the top of this file gives.

That limitation is why the entry above matters: it was found by reading an
excluded file, not by tightening a rule.

## What a finding does *not* mean

**54<!--live:unreadFields--> of 617<!--live:fields--> fields are unread, and that is not 54 bugs.** A vehicle's chassis
number and a medication's dosage are reference data: you record them, you read
them on screen, and nothing should compute with them.

Fourteen of them stopped being unread when the example household was written,
which says something about what "unread" was measuring. A chassis number, an
employer, a TPA helpline and a premium frequency had no code that touched
them — not because they were dead, but because nothing in this repository had
ever filled one in. Writing a household that has them was enough.

`sosAlert.resolvedAt` is the fourteenth, and it arrived the same way: seeding
an alert that had been *resolved* was what made the field read. An alert with
no resolution is the only kind the repository had ever held, so the code path
that reads the resolution had nothing to run on.

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
