# The example household

Settings → *Data* → **Example household** writes six invented people and the
records around them, so the application can be looked at with something in it.
An empty screen looks the same whether it works or not.

## What it writes

| | |
| --- | --- |
| People | 6 — two grandparents, two parents, a son and a daughter |
| Relationships | 13, enough for the family tree to draw |
| Savings accounts | 12, two for each person |
| Cars | 2 |
| Insurance policies | 4 — a family health floater, a senior-citizen top-up, and comprehensive motor cover on each car |
| Identity documents | 15 — PAN, Voter ID and Passport for the four adults, driving licences for the three who drive |
| **Total** | **52 records** |

Balances are opening balances and nothing else. **No transactions are
written**, so nothing here produces a trend, a category, a reconciliation or a
forecast — a demonstration that invented a derived figure would be teaching the
screens to lie.

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

## The three promises

**It is refused by a household that has people in it.** There is no merge, no
"skip duplicates" and no force flag. Invented records mixed into real ones
cannot be told apart again by hand, and the first rule of the brief is that
existing data stays usable. An occupied household gets a refusal and a count.

**Every record says so on itself.** Each one carries *"Part of the example
household. Not a real record."* in its notes, so a row read in a list, in an
export or on a shared screen carries its own provenance instead of relying on
the reader remembering what they clicked a month ago.

**It comes out again.** The ids written are recorded together in one meta key,
so removal is derived from what was actually written rather than from a guess
about which rows look invented. A guess would eventually delete something real.

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

## A side effect worth recording

Ten fields stopped being "unread" when this was written: a chassis number, an
employer, a TPA helpline, a premium frequency and others. They were not dead
code — nothing in the repository had ever filled one in. `docs/FIELD_COVERAGE.md`
now says so.
