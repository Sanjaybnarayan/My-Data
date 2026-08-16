# Two Kinds Of Document, And Two Numbers Being Leaked

What `docs/DOCUMENT_FORMATS.md` measured, answered. An `agreement` kind and a
`vehicle` kind in `js/domain/extract.js`, `readAgreement` and `readVehicle`,
chassis and engine numbers added to `SENSITIVE`, and three rows in the
architecture document.

## The part that is a security fix

`vehicle.chassisNumber` and `vehicle.engineNumber` are `encrypted: true` on the
schema. The application had already decided these were sensitive.

It was writing both, in the clear, into `ocrText` — which is *searchable*, and
in this schema a field cannot be both searchable and encrypted, so `ocrText`
is stored unencrypted and syncs to a cell in the household's Google Sheet.

This file's own header describes exactly this failure, about a different
document:

> Extracting text from a scanned PAN card and dropping it into a searchable
> field would quietly undo that decision — the application would have
> *worsened* its own security posture by getting better at reading.

That was written about PAN, solved for PAN, and not applied to two fields the
schema had already classified. Measured on two real documents: the
registration certificate, and the dealer's invoice, which carries the chassis
number too.

### Anchored on the label, not on the shape

Both new rules use a new `at` form — one regex matching the label *and* its
value, keeping the value — rather than the existing `near` + `pattern` pair,
which gates on a nearby word and then redacts every token of that shape in the
document.

That distinction is not theoretical here. A chassis number is seventeen
alphanumerics; so is a part number, an order number and a policy number, and a
vehicle invoice is full of them. Redacting on shape would gut the invoice. It
is also the failing already recorded against the `Card` rule in
`docs/DOCUMENT_FORMATS.md`, so repeating it in a new rule written the same day
would have been hard to defend.

## An agreement was being read as a bill

Measured before building: a real house agreement classified as **`bill`**, a
real rent agreement as **`receipt`**. Neither is either thing.

There was no `agreement` kind, so an agreement fell through to whichever
money-word appeared in it first — a lease says "payable", a rent agreement says
"received", and that was the whole of the reasoning behind the answer. A `bill`
classification is not inert: it is the kind whose due date feeds the reminder
machinery, so a lease was one step from raising a bill reminder for itself.

`vehicle` is deliberately narrower than it could be: `certificate of
registration` and `FORM-23A`, and **not** `chassis`. Matching on the chassis
number would take the dealer's tax invoice with it, and buying a car is not
registering one. A test asserts the invoice is still a receipt, and the
mutation widening the rule fails it.

## The body of a deed is not parsed, on purpose

`readAgreement` reads the Karnataka e-stamp header and stops. A lease's rent,
term and notice period are **sentences**, and reading them with patterns would
produce precisely the confident wrong number this module exists to avoid.

The header is worth having on its own: it is identical across leases, rental
agreements and partnership deeds, it says what the *state* thinks the document
is — which is more reliable than what the body calls itself — and it is where
the money is, because the stamp duty is a real payment.

`document.issuedOn` existed on the schema and nothing had ever written it. An
e-stamp's issue date is exactly that field: the date the state issued the
paper, which is neither the date the parties signed nor the date it was filed
here.

## Reading a label that may be on either side of its value

Three of the four e-stamp documents print the value *before* its label; the
fourth prints it the ordinary way round. So `readEitherSide` tries both.

**The first version of it preferred the label-first reading, and that was worse
than not having it.** In a value-first document the label is followed by the
*next* field's value, so preferring label-first does not fail — it answers
confidently and wrongly. Measured on real files, it returned:

- the two partners of a deed **the wrong way round**, and
- the string `"Second Party"` as the name of the first party.

Orientation cannot be settled per document either. One deed measured here
writes `Certificate No.` label-first, `Purchased by` value-first and `First
Party` label-first — in the same header block.

So when both readings find a value and the values differ, the answer is
**nothing**. This is the module's existing rule applied to its own new helper,
and it has a real cost, stated rather than hidden: a manufacturer this reader
could have named is now blank, because `Motor Car` sits above `MFR` and
`KIA …` below it and neither reading can be shown to be the right one.

Before and after, on the five documents these two readers apply to:

| | Fields returned | Wrong |
| --- | --- | --- |
| Preferring label-first | 29 | **5** |
| Refusing to choose | 18 | **0** |

Eighteen true fields beat twenty-nine containing five lies, on documents where
one of the lies is which of two people is the first party to a deed. Counted,
not estimated: the five were the first party of a rental agreement, both
parties of a partnership deed, and a car's model and fuel.

## A closed set, because the nearest word was a seating type

The registration certificate prints `PETROL STDG/SLPR` on one line and `FUEL`
on the next, and nothing readable after it. So "the word nearest the label" is
`SLPR` — a seating type — and the ambiguity rule above does *not* save it,
because there is only one reading. A fuel on an RC is a closed set, so it is
written as one.

This was found by mutation testing, and the first version of the test **did not
catch it**: my fixture put an ordinary word after `FUEL` where the real card
has a number, which manufactured an ambiguity that masked the bug. The fixture
now matches the card, and the mutation fails.

## The field-coverage ratchet moved, and three of the four are not wirings

77 → **73**. Worth stating plainly, because the number invites the wrong
reading: only **one** of the four is a real wiring — `document.issuedOn`, now
written by `suggestions`. The other three (`identityDocument.issuedOn`,
`education.registrationNumber`, `vehicle.registeredOn`) left the list because
the new extractor output keys happen to share their names.

That is the tool working as designed — its own header says the test is
*"whether the field's key appears by name anywhere outside the schema"* — but a
name-level test is coarser than the question it stands for, and a drop of four
should not be read as four fields getting wired.

## What mutation testing found

Nine mutations, all nine caught after the fixture was corrected:

| Mutation | Caught by |
| --- | --- |
| Ambiguous readings prefer label-first | *two readings that disagree produce nothing at all* |
| Chassis no longer redacted | two tests, including the marker |
| Engine no longer redacted | *kept out of searchable text* |
| Chassis matched on shape alone | *anchored on their label, not on their shape* |
| `agreement` kind never matches | three tests |
| `vehicle` widened to match `chassis` | *a dealer's invoice for a car is still a receipt* |
| RC expiry not routed to `expiresOn` | *the expiry the reminders already watch* |
| Fuel matched as any nearby word | *read from the closed set it belongs to* |
| `receipt` ordered before `agreement` | three tests, two of them pre-existing |

## What is still not built

**A `certificate` kind.** The blood donation certificate still reads
`unknown`, honestly.

**More than one document in one file.** `Invoice__RTO.pdf` is a dealer's GST
invoice and an RTO tax receipt — different issuers, dates and totals — and
`readDocument` returns one amount. This is the finding from
`docs/DOCUMENT_FORMATS.md` that is *not* addressed here, because it is a
missing concept rather than a missing pattern: the extractor assumes one file
is one document, and under rule 57 both of those are economic events.

**The Luhn check on the `Card` rule**, still argued for and still not written.

**The body of an agreement.** Rent, term, notice period and renewal date are
all prose, and none of them is read.
