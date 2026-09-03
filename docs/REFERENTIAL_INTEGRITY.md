# Referential integrity

**Phase 1 of the master specification asks for referential integrity.** This is
the half of it that can be built without changing where the data lives. The
other half — a relational store — is at the end of this document, unbuilt, with
the reason.

## What was measured first

Before any of this was written, run against the real repository:

```
db.repo('transaction').create({ account: 'acc_does_not_exist', … })
  → DANGLING REF ACCEPTED : acc_does_not_exist

db.repo('person').remove(id)   // with a health record pointing at them
  → deleted a referenced person: allowed
```

A `ref` field was a string, and nothing checked that the string named anything.
The screen warned before a delete — `RecordsService.impactOfDeleting` has
described what would break since long before this — but a warning is advice and
a foreign key is a rule.

## Where the rule lives

`js/data/integrity.js`, applied by `js/data/repository.js`. IndexedDB has no
constraints, so the constraint sits at the one door every user write already
passes through for authorization, validation and audit.

Nothing is hand-maintained. The references come from the schema: every field of
type `ref` or `multiref` with a `ref` target. Adding an entity adds its
constraints with it, and there is no second list to forget to update.

| Write | What happens |
| --- | --- |
| `create` | every reference must resolve, or the write is refused |
| `update` | the same, on the finished record |
| `remove` | refused if it would leave a **required** reference dangling |
| `applyRemote` | **exempt** — see below |

## Delete is RESTRICT, never CASCADE

Deleting a person does not delete their transactions. Cascading a delete
through a household's financial records because somebody tidied a contact is
not a tidy-up; it is data loss with a plausible explanation.

So the rule splits on what the schema already says:

- **Required** reference (`healthRecord.person`) — the delete is refused, and
  names what points at it.
- **Optional** reference (`transaction.person`) — the delete goes through. An
  optional reference is one the schema has always said may be empty, and the
  record still validates without it.

A soft-deleted row does not count as existing. Pointing at a record somebody
threw away is the same dangling reference as pointing at one that never was,
and it is the commoner way to arrive at one.

## The screen and the rule say the same thing

A dialog offering a Delete button on a delete that will be refused teaches
somebody that the button lies. So `impactOfDeleting` is asked first, and when
it reports a required dependent the screen shows a statement with one way out
(`inform` in `js/ui/components/modal.js`) rather than a confirmation.

Both ends of this have been built before and the wiring between them had not
been checked. `tests/integrity.test.mjs` now walks a blocking case and a
non-blocking case through *both* paths in one test and requires them to agree:
if `describeImpact` says "cannot be deleted", `repo.remove` must refuse, and if
it does not, the delete must go through.

## A unit of work defers its constraints

Recording a payment and the receipt for it is one act, and the receipt has to
name a transaction that is not written yet. `js/data/unit.js` passes what it has
staged to the repository, so a reference to a row created a line earlier
resolves — the deferred constraint a relational database would give.

It is not a way around the rule. A reference to something staged nowhere and
stored nowhere is still refused.

## Sync is exempt, and that is a real weakening

`applyRemote` does not go through the check. A pull arrives in whatever order
the backend hands rows over, so a transaction can legitimately land before the
account it names. Refusing it would permanently drop a row the household really
has, to satisfy an ordering nobody promised.

**Integrity is therefore enforced where records are made, not where they
arrive.** A dangling reference can still enter this database through a sync from
a device running an older version.

`danglingIn()` is the other half of that admission: it walks every entity with
references and reports the broken ones, so a household can be shown them rather
than meeting one on a screen that says "unknown". Each finding names two
things kept deliberately apart — the row that is broken, and what it points at
and cannot find.

### What the audit cannot see, and used to report anyway

A reference is resolved by reading the local store. **A row the server withheld
by role is the same absence as a row that does not exist**, and the audit was
calling both of them broken.

Pulls are filtered by role on the server — `readableEntities` in
`apps-script/Policy.gs` is named for it — and 24 reference fields in this schema
point from something a `child` may read at a person, loan or vault item they may
not. Measured against the real engine: a child's device pulling one vehicle
reported `reference/vehicle/owner` and put a broken-link diagnostic on the
activity card. Every sync that brought a vehicle, a relationship, an appointment
or an education record did the same, telling the household member least placed
to judge it that their records were damaged.

So the audit now asks `readScope()` how much of the target entity the signed-in
role reads. Anything short of `all` — including a child's own-record view of
`person`, which shows them one row and hides the rest — means a missing target
is not evidence of anything, and it is skipped. An owner reads everything, so
an owner's audit is unchanged and still reports the breakage this file is about.

This is also why sync cannot be made to refuse on the current signal, whatever
the ordering argument. Refusing would have deleted a child's vehicles.

## What is still missing

The specification's Phase 1 asks for a relational database. This is not one.
What is here gives the constraint behaviour; it does not give a store that
enforces it.

The honest statement of the gap is the one the audit made: **if the relational
requirement must be met, it should be met at the sync target** — replacing
Google Sheets with a real relational backend behind the same 16-action contract
that `tools/api-contract.mjs` already checks — not by rewriting the local store,
which is offline-first for reasons that have not changed. That needs a hosting
decision, and it has not been made.

Until it is, this document's claim is narrow and deliberate: **referential
integrity is enforced on local writes, is not enforced on sync, and there is no
relational database.**
