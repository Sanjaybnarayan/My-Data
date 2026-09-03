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

### What a pull refuses, and what it cannot

It refuses to let the row count. It does not refuse the row.

**Dropping was never available, and this is the measurement that settles it.**
A transaction naming an account arrives in one pull and the account in the
next, because the other device wrote it a moment after this pull read its
cursor:

```
pull 1: {"pulled":1,"dangling":1}   reference resolves? false
pull 2: {"pulled":1,"dangling":0}   reference resolves? true
```

Discarding at the end of pull 1 loses the transaction for good — the server's
cursor has moved past it and no later pull brings it back. Anything calling
itself a refusal has to survive that.

So a row whose reference the end-of-pull audit can judge and cannot resolve is
**held**: `heldAt` is stamped on it, and `settled()` in `js/data/integrity.js`
is the single predicate the money modules ask beside the deleted check they
already made. The row is still listed, still opened, still the household's. It
adds itself to no total, because rule 57 says a financial event must be
explainable and a figure built partly from a transaction whose account nobody
can open is one nobody can trace.

Held is neither permanent nor silent:

- The next pull that brings what the row names releases it, and the release
  runs before the audit so the same pull cannot hold and re-hold one row.
- The record screen says so on the record, not only as a count elsewhere.
- The activity card gives the number being left out.

`settled()` replaced about twenty hand-written `!row.deletedAt` checks across
`finance.js`, `networth.js` and `portfolio.js`. That was not tidiness: `heldAt`
is a second reason, and adding it to twenty conditions by hand is how nineteen
of them keep the old meaning. A test asserts that a module which imports the
predicate does not also spell the check out beside it.

**Three modules was not the money.** That ratchet reads imports, so it says
which modules adopted the predicate and nothing at all about which figures a
held row still reaches — and ten more modules add up money without ever asking
`finance.js`. Measured by holding one ₹90,000 transaction and reading the
answer twice, with the mark and without it:

| Figure | Held row counted? |
|---|---|
| `household.spendByMember` | a member's spend read ₹1,20,000 instead of ₹30,000 |
| `runway.typicalDailySpend`, `typicalMonthlyOutgoings` | 10× the true figure, so months-of-cover with it |
| `unusual.unusualSpending` | **raised a "16× above usual" alert built only on the held row** |
| `cards.statementBalance` | ₹51,000 on the bill instead of ₹1,000 |
| `settlement.settlementReport` | a held payment settled a card bill |
| `amortise.paymentsFor` | a held row counted as a loan repayment |
| `costbasis.costBasis` | invested read ₹1,40,000 instead of ₹50,000 |
| `rentreceipt.rentReceived` | a held credit marked a month's rent received |
| `accrual.instalmentsFor` | a held row counted as an instalment the deposit received |

The alert is the one that matters most. A total being wrong is a number; being
told your food spending is sixteen times its usual size, on the evidence of a
transaction whose account nobody can open, is rule 57 failing in the direction
that reaches the household. All ten now ask `settled()`.

The suite passed 3113 of 3113 with every row of that table wrong, which is why
the tests added with the fix ask the only question that settles it — *does the
answer change when the mark is removed?* — rather than reading imports.

### What those ten figures say, and which still do not

`domain/amounts.js` was written against a specific fault: a total that is
right about the rows it counted and says nothing about the ones it left out.
Excluding a held row from ten more figures is the good half of that trade;
`describeHeld` is the sentence that closes it, and for a while it was shown in
one place, the month summary in `services/finance.js`.

A held row also says so **on its own record**, and the activity card gives the
number a pull is holding, so the exclusion was never wholly silent. It was
silent *beside the figures*, which is where somebody reading a number is
standing.

All of them now carry it, in six sentences rather than ten. The month totals,
the cost basis on the investments screen, the rent report, cash runway, the
card bills due, and the loans card each say what their own figure left out.

A member's spend and the deposits accrual card get none of their own, and that
is the rule below rather than an omission: both read exactly the window a
sentence on the same screen already covers — the month, and the portfolio's
trades — so a second one would be the same number twice on one screen.

**One sentence per window, not one per screen** — and equally, never one
window's sentence beside another window's figure. Runway is why this is stated
as a rule. The month summary's sentence is scoped to the month its totals are
about, which is right for them and useless for a forecast built from complete
months of history — measured, four rows held in past months moved monthly
outgoings from ₹10,000 to ₹1,000 and a usual day from ₹300 to nothing, while
the month-scoped sentence returned `null` and the screen said nothing at all.
Reusing that sentence beside the runway figure would have looked like
disclosure and reported on the wrong rows, so runway carries its own, scoped
to everything up to today. The test asserts the pair — month `null`, runway
not — because a test of the second alone would pass on a duplicate of the
first.

The card bill and the loans card are the same argument from the other end.
Both read narrower sets than any existing sentence: one cycle on one card
account, and the rows `paymentsFor` matches for a loan. `runwayHeld` counts
rows neither figure reads, so reusing it there would put a number beside a
figure it is not about — disclosure in appearance and misdirection in fact. So
each counts the rows its own figure would have used, the loan set obtained by
asking `paymentsFor` against the same list with the marks taken off rather
than copying its matching rules into the service, where the two would drift.
A held card purchase of ₹40,000 took the bill from ₹42,000 to ₹2,000, which is
the figure on this screen where being wrong is dearest.

Two functions gained a filter they never had. `totals()` and `byCategory()`
added up whatever array they were handed and trusted `inPeriod` to have
filtered first. It always had, so nothing was wrong — but the guarantee lived
in the call sites rather than in the two functions that add the money, and a
deleted row reached a total the moment somebody called either directly.

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
integrity is enforced on local writes; a pull refuses to let an unresolved row
count but never refuses the row; and there is no relational database.**
