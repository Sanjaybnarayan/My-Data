# The Seven Modules That Had No Screen

`js/modules/secondary.js`, `js/services/secondary.js`, `js/domain/tenancy.js`,
`js/domain/upkeep.js`. Tested in `tests/secondary.test.mjs` and the browser
suite.

`insurance`, `property`, `education`, `tasks`, `notes`, `digital` and
`emergency` all fell through to the generic record screen. That screen is not
bad — it is the whole point of the schema being the program — but it can only
ever show one entity's rows, and three of these modules hold a question that
needs two.

## One file, seven routes

They share a shape: the generic tabs and lists exactly as they were, with at
most one card above them. Seven near-identical files would be seven places to
fix the next time that shape changes. Nothing was removed from any of them.

## Property: a tenancy recorded in two places

The finding that made this phase worth doing.

`property` carries `rented`, `tenantName`, `tenantPhone`, `monthlyRent`,
`deposit` and `leaseEndsOn`. There is also a whole `tenant` entity — `name`,
`phone`, `monthlyRent`, `deposit`, `agreementEndsOn` — pointing at a property.
The same tenancy, in two shapes.

That alone would only be untidy. What makes it worth a screen is that **the
application reads a different one for each question**:

| question | reads |
| --- | --- |
| a rent receipt (`domain/rentreceipt.js`) | `property.tenantName`, `property.monthlyRent` |
| the rent total in reports | `property.monthlyRent` |
| a reminder | **either** — both `leaseEndsOn` and `agreementEndsOn` are expiry fields |

So a household that fills in the tenant record and leaves the property fields
blank gets a lease reminder and no rent receipts. One that fills in the
property fields and never creates a tenant record gets receipts and no
agreement reminder. Neither screen had ever said so, and both households
believe they have recorded their tenancy.

The card names the property, the case, and **what that case costs** — because
naming a state is not something anybody can act on.

### What it does not do

It does not merge them and it does not decide which is right. A name on the
property and a different name on the tenant record are two statements by the
same household, and only they know which is current — one may be last year's
tenant nobody deleted. `Ravi` and `Ravi Kumar` are very probably one person,
and deciding that here would be forcing an uncertain match.

Nor is a blank a disagreement. A gap on one side is a gap; a screen that called
every half-filled record a conflict would cry wolf on all of them. And a
property agreeing with *any one* of several tenant records is not a
contradiction — last year's tenant still on file is not a fault.

A property that is not let has nothing to reconcile.

## Tasks: a status and a date that disagree

The two directions do not arise the same way.

**A completion date on a task that is not done** has no rule anywhere. Set a
date, leave the status open, and the ordinary form will save a record saying
two things.

**`done` with no completion date** is refused at the write path — `validate.js`
carries *"A completed task needs a completion date"* — so the form cannot
produce one. It arrives another way: `Repository.applyRemote` writes a row
coming back from the household's own spreadsheet with **no validation at all**,
deliberately, because a sync that rejected a row would lose it. Somebody
editing the Tasks sheet by hand is the path, and it is the same one that lets
an unchecked URL reach a screen.

That second case is the more interesting of the two: a household would have no
idea a hand edit had produced a record the application itself would refuse to
create. The browser check creates it exactly that way, through `applyRemote`,
rather than through a `create` the validator would reject — which is how the
first version of that check was written, and why it failed.

Neither is called *overdue*. `dueOn` already produces a reminder and the
Notifications tab already lists it; saying it again here would be two counts of
one thing.

## Emergency: could this list be used in a hurry?

The one thing an emergency list exists for is somebody reading it under
pressure, so "who do I ring first" has to have exactly one answer. The card
reports no contacts at all, nobody with a priority, two contacts claiming first
place, and anybody recorded with no phone number — an address and an email are
not what gets used in the first ten minutes.

All findings, not the first: fixing one would otherwise reveal the next a week
later.

## The four that point elsewhere

`insurance`, `digital`, `education` and `notes` get a sentence, not a card,
and that is the deliberate answer rather than a shortfall.

- `policy.nominee` is read by `domain/estate.js`, which reports every account,
  holding and policy with nobody named on it — one list rather than three that
  could disagree.
- `digitalAsset.legacyInstruction` is read by the same file.
- `education.nextFeeDueOn` and `certificate.expiresOn` are expiry fields, so
  they are already on the Notifications tab and in the dashboard's attention
  card.
- `notes` derives nothing from anything. A note is what somebody wrote.

Building a second nominee check here would be two implementations of one
question, which is the fault this repository has spent the week removing. A
test asserts the screen's code contains neither `nominee` nor
`legacyInstruction` — with comments stripped, because the header names both
while explaining why it does not touch them, and the first version of that
check found the explanation and called it the offence. That is the same trap
as the dashboard's widget list, which named the entity it had just removed.

## Mutations

A blank counted as a conflict, matching against the first tenant record only,
comparing names without folding case, ignoring a tie at first place, and not
counting an alternate number as reachable — each fails at least one check.

## Not run on a device

As with everything else here: the screens are driven in a real Chromium and
have never been opened on a phone.
