# The example household

Settings → *Data* → **Example household** writes six invented people and the
records around them, so the application can be looked at with something in it.
An empty screen looks the same whether it works or not.

## What it writes

**272 records across 49 of the 53 kinds.**

| | |
| --- | --- |
| People | 6 — two grandparents, two parents, a son and a daughter |
| Relationships | 13, enough for the family tree to draw |
| Savings accounts | 12, two for each person |
| Transactions | 112 — eight months of salary, groceries, fuel, utilities, school fees and a monthly sweep into savings |
| Cars | 2, with 3 services and 6 fill-ups |
| Insurance policies | 4 — a family health floater, a senior-citizen top-up, comprehensive motor cover on each car |
| Identity documents | 15 — PAN, Voter ID and Passport for the four adults, driving licences for the three who drive |
| Health | 4 records, 2 courses of medication, 3 vaccinations, 3 appointments |
| The rest | documents, tasks under a project, goals, purchases and warranties, a will and its beneficiaries, schooling, employment, subscriptions, safe zones, emergency contacts |

### Transactions, and why there are some

The first version wrote none, reasoning that a demonstration must not invent a
*derived* figure. That was the right instinct pointed at the wrong thing. A
transaction is a record, the same as an account is; what would be dishonest is
claiming one had been **fetched** from a bank, or that a reconciliation had
closed when nothing was compared.

Writing none left the whole of Finance blank — no spending, no categories, no
CFO page — which is most of the application. So they are here, generated from a
recurring pattern rather than typed out one by one, because a household's money
*is* a pattern with exceptions and ninety literals would be the same thing said
less honestly.

None is marked `reconciled`; none carries a `statement`, an `importKey` or a
`movement`. They are what a person typing into the app produces, and nothing
about them claims otherwise. The monthly sweep into savings is a `transfer`,
so it counts as neither income nor expense — the single most common way a
household budget ends up double the truth, and therefore the thing most worth
having in a demonstration.

## Every date is relative to the day you load it

The first version used fixed dates, and they rotted in both directions.

**Forward.** Every expiry sat outside its own `expiryLead`, so the reminders
screen was empty and the assistant's *"what is expiring?"* had nothing to
answer — two of the things a person most wants to look at, demonstrating
nothing. **Backward.** A son born on a fixed date is fifteen this year and
twenty-five in ten years, still filed as a child.

So the dates derive from the load date. The grandfather is always 78, the son
always 15; one PUC is always about to lapse and one always just has; a policy
renewal, a service and a passport always sit inside their own lead times. Eight
reminders, one of them overdue, whenever it is loaded.

This invents nothing. The creation date is the one thing about an example
household that is literally true, and `tests/example.test.mjs` checks both
properties at two clocks a decade apart — a demonstration that only works this
year is the same defect in slower motion.

## Why this is allowed at all

The build brief forbids fake data, and means something specific by it: fake API
responses, fake bank connections, fake Google connections, fake government
integrations. The distinction this file rests on is that **none of those is
here.**

Nothing connects to anything. Nothing claims to have been fetched. These are
records of the kind a person types in, written through the same repository, the
same validation, the same field encryption and the same audit chain as records
a person does type in — `services/example.js` writes through `repo()` and never
through the adapter, so the example household is fed to the screens by exactly
the code path a real one is.

## What is still not invented

Four kinds stay empty, and each for its own reason.

`economicEvent` is derived, and the attempt to seed it honestly is what proved
it. The two legs of one transfer were written as ordinary transactions so the
application's own matcher would pair them and confirming the pair would write
the movement — a derived row appearing because the app derived it. The
repository refused them: *"A transfer needs a destination account."*
`isLooseLeg` in `domain/events.js` wants a leg with no destination, which is
what two banks each reporting their own side of one movement produces, and what
a person entering a transfer by hand never produces. So loose legs reach this
application only through an import or a sync, and the Movements tab stays empty
in the example household — honestly, because the thing that fills it is an
import artefact.

`deviceKey`, `conversation` and `message` are end-to-end encrypted. Fabricating
key material would make the security model look like something it is not: a
demonstration of E2EE built from keys nobody holds. The chat screen stays empty
and stays honest.

The seven that were added were the ones whose exclusion turned out to be about
provenance rather than the record. The schema keeps the two apart, and the
fields that would assert a fetch are the fields left blank — `receipt.mailbox`
and `messageId`, `bankStatement.fileName` — while `locationPing.source` is set
to `manual`, a position somebody recorded rather than a trace a device left.

## The three promises

**It is refused by a household that has anything in it.** There is no merge, no
"skip duplicates" and no force flag. Invented records mixed into real ones
cannot be told apart again by hand, and the first rule of the brief is that
existing data stays usable. An occupied household gets a refusal and a count.

The rule used to be *"a household that has people in it"*, and that made the
feature impossible to use. `resolveActor` in `js/app.js` creates a person named
*You* on the first unlock — "a family that has to fill in a form before seeing
anything has already been asked too much" — so by the time anybody can reach
Settings there is always exactly one person, and *Load example household*
always answered with the refusal toast. Measured on the real screens: install
returned `{loaded: false, people: 1}` immediately after enrolment, and all
twenty-five sections stayed empty.

The owner row is not a record a person put there; the application wrote it,
unasked, so the first screen would have a subject. So occupancy now means more
than that one row — matched **by id** against `auth.currentPerson`, because a
household that has typed its own name over *You* has still not added a record.
Everything else is a sweep of every entity: a household that had entered
nothing but one vehicle would have passed a check that counted only people, and
had an invented family written in beside their car.

**Every record says so on itself.** Each one carries *"Part of the example
household. Not a real record."* in its notes, so a row read in a list, in an
export or on a shared screen carries its own provenance instead of relying on
the reader remembering what they clicked a month ago.

**It comes out again.** The ids written are recorded together in one meta key,
so removal is derived from what was actually written rather than from a guess
about which rows look invented. A guess would eventually delete something real.

**And it reaches the household's sheet, because it is written like everything
else.** Measured: installing queues 272 `put` operations in the outbox, and
removing queues 272 `delete`s. That is the same write path this file spends its
first section defending — a demonstration fed by records that skipped the
outbox would be a demonstration of a code path the application does not have —
but it means a household that loads this to look around gains 272 invented rows
in their own Google Sheet on the next sync, and loses them again on the one
after. The card says so now; it did not before, and the promise above was true
about the device while saying nothing about the sheet.

## There is no Aadhaar, and that is the interesting part

Every other identifier here sits in a series nobody is issued: PAN and Voter ID
use `ZZZ`, passports use `Z`, driving licences use RTO code `KA00`. Each is the
right shape — so the screens that show one have something real to draw — and
each is impossible as an allocation.

Aadhaar has no such series. `js/data/formats.js` enforces the real rule, a
leading digit of 2 to 9 and a valid Verhoeff check digit, so **the set of
numbers this application accepts is the set of numbers UIDAI can issue.** Around
1.4 billion of roughly 8 × 10¹⁰ valid numbers have been issued, which puts each
invented one at about a one-in-fifty chance of already belonging to somebody,
and six of them at about one in ten that one is a living person's Aadhaar —
written into a repository, in a file that says it is fake.

Weakening the validator to admit a safe number would be worse than the problem:
it would make the application accept a mistyped Aadhaar from a real household
in order to make a demonstration tidier.

So the example household has no Aadhaar. It is uneven, which is honest: a
household whose Aadhaar is not on file is an ordinary household, and the screens
that ask for one have something real to show. Lakshmi has no driving licence for
the same reason — a demonstration where everybody has everything teaches a
screen nothing about the gap it exists to surface.

## Where its words live

In `js/locale/en-example.js`, and deliberately **not** spread into `en.js`.

`coverage()` measures a language as the share of all keys translated, and
`tests/locale.test.mjs` holds the fact that follows: schema labels outnumber UI
strings, so a translator who finishes the catalogue is nowhere near done.
Spreading these thirty-five keys in was enough to make that false — the UI
catalogue went past the whole schema label set, and a measurement of *how
translated the interface is* moved because a demonstration family got names.

`domain/example.js` reads the keys directly instead. The English is still in
`js/locale/`, so it is a catalogue rather than a string escaping into the
source, and a second language adds `hi-example.js` beside it. What it does not
get is automatic switching with the active locale — an honest limit, and a
cheaper one than a corrupted measurement, with no second language yet to want it.

## What it still does not fill

Twenty-six kinds stay empty, and they divide cleanly.

**Things that should not be invented.** `bankStatement`, `receipt` and
`smsMessage` are artefacts of an import or a device capture — writing them
would be the fake-fetch this file exists to avoid. `economicEvent` is derived.
`locationPing`, `sosAlert`, `deviceKey`, `conversation` and `message` are
device and chat state, produced by enrolment and hardware rather than typing.

**A person who is not in this family.** `staff` requires a `person` row, and
adding one would make the household seven people when it is six.

That is the whole list. Everything else is filled: a flat and a let shop unit
with a tenant, a home loan and a car loan, four holdings with the dates they
were valued on, budgets set below what the household actually spends on two of
the four, a vault of deliberate nonsense, powers of attorney, certificates, KYC
records, notes, diary events and a trip.

**A finding this seed produced.** The holdings and properties carry `valuedOn`,
and a comment here once claimed `domain/networth.js` would report those
valuations as stale. It did not: `staleValuations` meant *no `currentValue` at
all*, and `valuedOn` was never consulted. Measured at the time: a property
valued three years ago contributed its full figure and was flagged as nothing,
while the same property with no valuation was flagged.

That is fixed — see `docs/A_VALUATION_WITH_A_DATE_ON_IT.md`. The example
household's two properties are valued 14 and 20 months back on purpose, so the
demonstration shows the state a household most needs to see: a figure that is
real, precise, and out of date.

## A side effect worth recording

Ten fields stopped being "unread" when this was written: a chassis number, an
employer, a TPA helpline, a premium frequency and others. They were not dead
code — nothing in the repository had ever filled one in. `docs/FIELD_COVERAGE.md`
now says so.
