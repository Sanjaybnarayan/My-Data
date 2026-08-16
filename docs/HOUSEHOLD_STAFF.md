# Staff Are A Role A Person Holds

Phase 13's first two tranches, and the three design decisions that shape the
rest of it. Two of the three are refusals.

## Measured before building

No `staff` entity and no staff module existed — 37 entities across 16
modules, none staff-related. The roadmap row saying "not started" was
accurate, which is worth checking rather than assuming: this repository has
found stale roadmap rows before.

## 1. A staff member is not a second person

`staff.person` is a **required reference**. Every name, phone number and
identity document stays on that person record like anybody else's.

Giving staff their own identity fields would create two records for one human
being — the failure the CKYC rules exist to prevent, where a person is
identified by a document rather than being a person. It also follows that one
person can hold two roles over time: a driver who later cooks is two `staff`
records and one `person`, and their history is not split in half.

Three tests assert this rather than the fields: `person` is a required `ref`,
**none** of `name`, `phone`, `email`, `aadhaar`, `pan`, `address` or `dob` is
declared here, and `endedOn` exists so leaving is history rather than a
deletion. Mutating the schema to add a `name` field fails all three.

## 2. `monthlyPay` is what was agreed, not what was paid

Wages actually paid are **economic events**, like any other money leaving the
household, recorded through the ledger where they reconcile and explain under
rule 57.

A figure stored on the staff record that nothing reconciles would be a second,
parallel money path: a household would have wages that never appear in their
own ledger, and `explainEvent` would know nothing about them. `monthlyPay` is
therefore the *agreement* — useful for noticing that a payment does not match
it, and never a substitute for the payment.

**This is the piece that is not built**, and it is the one that makes the
phase real. It carries a genuine design question — whether `economicEvent`
gains a `staff` reference or the link lives elsewhere — and answering it
wrongly creates exactly the parallel path this section forbids.

## 3. A staff member's documents are already reachable

Measured: `document.person → person`, and `staff.person → person`.

So the documents belonging to somebody the household employs are already
attached to them, through the same reference everybody else's are. **Adding a
`document.staff` reference would be a second path to the same thing**, and a
fragmenting one: a document filed against the person would not appear on the
staff record, and one filed against the role would not appear on the person.

Nothing is built for this, and nothing should be. What is missing is a *view*
— a staff record cannot yet show the person's documents — and that is a screen
reading an existing reference, not a new field.

## What `endedOn` is for

A staff list that ignores it shows a cook who left in 2019 beside the one who
starts tomorrow.

The one rule worth stating: **a leaving date in the future is somebody still
working here**, on notice. Counting them as former drops a person off the list
while they are still turning up. `standing()` is pure with an injectable date
so that boundary can be tested, and the mutation treating any leaving date as
past fails the test that names it.

## The architecture ratchet caught the first version

Reading the staff records straight from the module took the UI→database edge
from **58 to 59**, and that budget may only narrow. The read moved behind
`RecordsService.staff()`, which is what the seam is for. The budget is 58/58
again rather than raised.

## What is still not built

**Wages as economic events** — section 2, and the next thing to do.

**Attendance and leave.** Not started, and not obviously a separate entity: a
day off is a fact about a date, and this schema already has entities that
model dates.

**A staff record showing the person's documents** — a view over an existing
reference, per section 3.
