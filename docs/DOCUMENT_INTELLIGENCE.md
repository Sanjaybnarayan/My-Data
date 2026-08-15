# Document intelligence

Phase 3. The roadmap said *"extraction exists; OCR and DOCX new"*. Two thirds
of that was stale, and measuring found something else instead.

## What was measured

### 1. OCR already existed

`apps-script/Drive.gs` OCRs scans through Drive's own converter — the file is
copied as a Google Doc, exported as text, and the copy trashed. No third-party
service, no new dependency, no key shared. The roadmap line predated it.

**A refusal is a claim about the codebase, and it goes stale like any other.**
This is the third time that has been true in this repository.

### 2. Extraction is good, and nothing had ever said so

Twelve documents shaped the way Indian household paperwork is shaped —
electricity, telecom, gas, LIC, health and motor policies, property tax, rent
and school-fee receipts, a bank statement, a PAN card, an Aadhaar letter:

```
  fields a person would read off these documents : 28
  fields extraction finds correctly              : 25  (89%)
  fields it gets WRONG                           :  0
  fields it simply misses                        :  3
```

**Zero wrong** is the number that matters — a wrong due date is worse than no
due date, and the module was built on that principle. The three misses are all
one gap: `readBill` is used for receipts, and receipts do not say *"amount
payable"*, they say *"received the sum of"*. Recorded below, not fixed here.

### 3. The identifier was found, protected — and then thrown away

`domain/extract.js` opens by saying identifiers are *"found, removed from the
indexable text, and handed back separately **for the caller to put somewhere
encrypted**"*.

**That caller did not exist.** `sync/drive.js` set `document.identifiers` on the
object it returned and nothing read it; the Drive OCR path did not even do that
much. So a household photographs their PAN card and the application:

1. reads the number — correctly,
2. keeps it out of the searchable field — correctly,
3. drops it.

The half that works is the half that protects. `identityDocument.number` —
encrypted, indexed, exactly where a PAN belongs — stayed empty while a picture
of it sat in the document library.

### 4. A photographed document was silently second class

`canReadText` is true for `application/pdf` and nothing else, and the documents
screen is *built around* the camera. A photograph gets no local read: no kind,
no due date, no reminder. The screen said **"on device only"**, which is about
Drive, and never said a word about the text — so a photographed bill produced
no due date and nothing explained why.

## What was built

### The identifier is offered, never written

`identifierOffers(identifiers, document, identityDocuments)` returns one of five
states per identifier:

| State | Meaning |
| --- | --- |
| `offer` | Nothing recorded for this person and kind — this could be filed |
| `recorded` | The same number is already on file; nothing to do |
| `differs` | A *different* number is on file — a question, never an overwrite |
| `no-person` | The document is the household's, so there is nobody to file against |
| `no-home` | Found and redacted, but this schema has nowhere to keep it |

**Creating an identity record means asserting whose it is.** A document is filed
under a person or under the household, and a household document has no owner to
give a PAN to. Guessing would write it against the wrong member of a family —
worse than not writing it, and invisible afterwards because the field is masked
on every screen that shows it. So the deciding stays with the household, the
same rule the transfer pairing follows.

`differs` is deliberately not a merge. Either one of the two is a typo or the
document belongs to somebody else; both need a person to look. And a record
whose `number` could not be decrypted by this reader is **not** reported as
disagreeing — announcing a mismatch on the strength of a value nobody could
read would send somebody hunting a problem that is not there.

**A payment card number is redacted and never filed.** There is no benign reason
for sixteen digits to sit in a searchable field, and no place in this schema to
keep one either. Inventing a home for it is not a decision a scan should make.

### Nothing is stored to make the offer possible

`DocumentStore.identifiersIn(documentId)` decrypts the stored file and re-reads
it on demand. **A second copy of an unrecorded identifier, kept somewhere to be
surfaced later, is precisely what the redaction exists to prevent.** The
encrypted file is already on the device; reading it again costs a parse and
stores nothing.

`readable: false` means nothing on this device can get text out of the file —
a photograph, which only Drive's OCR can read. That is not the same as a
document with no identifiers in it, and the screen does not report the two the
same way.

### The screen says whether the text was read

`textState(document)` gives four answers, each with its reason:

- `read` — there is extracted text
- `pending-upload` — *"photographs are read when they reach Drive, so nothing
  has been filled in from this one yet"*
- `unreadable` — a PDF with no text layer is a scan; an image already in Drive
  that came back with nothing
- `empty` — nothing here can read this kind of file, so its dates have to be
  typed

## What the browser check proves

A PAN card with a **real text layer** — five PDF objects, a `Tj` content stream
and a valid xref, built in `tests/browser.mjs` — through the real capture path.
Every other document check in this suite uploads ten bytes beginning `%PDF-`,
which produces no text at all, so nothing that *reads* a document had ever been
driven end to end.

It asserts the number is offered, shown as `••••234F`, that **the full number
appears nowhere on the screen**, that recording it stops the offer, that the
identity record exists afterwards — and that the identity list does not print
the number it just stored.

## Recorded, not done

- **A receipt reader.** `readBill` is used for receipts and its labels are bill
  labels. Two of the three measured misses are receipts saying *"received the
  sum of Rs. 35,000/-"*.
- **`policy.expiresOn` from a range.** *"from 15/09/2025 to midnight of
  14/09/2026"* carries the expiry with no label in front of it.
- **A background OCR finds identifiers with nobody watching.** When Drive reads
  a scan during a sync, the offer is only seen if somebody opens that document
  afterwards. Re-reading on demand makes it recoverable for PDFs at any time;
  for images it needs another Drive round trip, which is not built.
- **DOCX.** `.doc/.docx/.xls/.xlsx` are in the picker's `accept` list, are not
  in `canReadText`, and are not in Drive's `OCR_TYPES` either — so those files
  are stored and filed and never read. Phase 3's "DOCX templates" is a separate
  piece of work and is untouched.


# Reading a receipt

The tranche above measured extraction at **89% with zero wrong fields**, and
recorded three misses — *"all three are receipts, which say 'received the sum
of' rather than 'amount payable'"*. Measuring it properly found both halves of
that sentence were understated.

## What was measured

Four real layouts, retyped: a school fee receipt, a temple donation, a rent
receipt and a hospital payment.

```
  amount + date found : 0 of 8
```

Not three misses — **nothing at all**. And the reason is one sentence: a bill
and a receipt describe the same money in opposite tenses. A bill says *amount
payable* and *due date*; a receipt says **"received the sum of"** and *receipt
date*, because the paying has already happened. Receipts were routed through
`readBill`, so every label it looked for was a phrase a receipt never uses.

## The wrong values, which mattered more

`zero wrong fields` did not survive contact with these:

| Layout | `biller` came back as |
| --- | --- |
| School fee | `Mr Sanjay Narayan` — the person who **paid** |
| Donation | `Sanjay Narayan` — likewise |
| Rent | `Sanjay Narayan towards rent for the month` — not anybody's name |

A receipt's "from" is the payer; a bill's is the company. Filing one as the
other is not a missing field, it is a claim.

So a receipt now names a `payer` and never a `biller`. **The fields differ
because the facts differ**, and reusing the bill's shape is precisely what made
a payer look like a biller.

## A receipt that says "Bill No"

The hospital payment receipt was detected as a **bill**, because `Bill No:
IP/2026/77812` sits at the top of it. `receipt` is now matched before `bill`,
and a test pins that an actual electricity bill still reads as one — a
reordering that dragged bills across with it would be a worse bug than the one
being fixed.

## Where it still declines

A bare "from" appears mid-sentence on most rent receipts, and reading it as a
name is what produced the nonsense above. Only labels that unambiguously
introduce a payer are read, so **some layouts yield no payer at all** — and that
is the intended trade. A missing name is a gap; a wrong one is a claim.

The same rule dropped `received by` as a label for who took the money: *"Payment
received by UPI"* is ordinary phrasing, and reading it filled the field with
`"UPI"` — a payment method presented as a person.

## What the mutation testing caught

**6 of 7**, and both of the original survivors were **my own mutations being
wrong**, which is worth recording because a bad mutation reads exactly like a
missing test:

- *"the commonest receipt phrasing is dropped"* survived because `'sum of'` is a
  substring of `'received the sum of'` and was left behind. Removing every
  phrasing fails the suite, as it should.
- *"the payer swallows the rest of the sentence"* survived because the fixture's
  payer was already `undefined`, so the assertion passed on nothing. It now
  asserts absence directly.

The remaining survivor is the length bound on a payer's name, which changes
nothing today because every label read is followed by a name at the end of its
line. Stated in the code rather than tested.

## Still not done

- ~~Nothing files a receipt against the payment it records.~~ **Done** — see
  below.
- **DOCX** remains unread, as before.
- **No receipt names its payee reliably.** Indian receipts put the issuing
  organisation in the letterhead rather than against a label, and reading a
  letterhead is guessing.


# Filing a receipt against the payment it records

The tranche above read a receipt's amount and date. The importer records the
payment that left the account. **Both facts sat in the database and nothing
connected them** — a household with a ₹48,500 school-fee receipt and a ₹48,500
debit had two unrelated rows and a filing job to do by hand.

The place for the answer already existed: `transaction.documents`. Nothing ever
proposed what belonged in it.

## The rules are the transfer-matching rules

Deliberately. This is the same shape of problem — two records that may be one
fact — so it takes the same answers rather than inventing softer ones:

- **Exact amount only.** "Close" attaches a receipt to the wrong payment, and a
  wrongly filed receipt is worse than an unfiled one: it is evidence pointing at
  the wrong transaction.
- **Ambiguity is not a match.** Two payments of the same amount in the window is
  a question. **Rent is the ordinary case** — twelve identical debits a year, and
  July's receipt must not land on June. The nearer one is not quietly promoted.
- **Both halves or nothing.** A receipt with an amount and no date is not
  matched on the amount alone, and one with a date and no amount is not matched
  at all: every household has several payments in any five-day window, and the
  one that matched would be a coincidence presented as evidence.
- **Nothing is written.** Attaching is a person's act.

## The window is lopsided on purpose

A receipt is dated when the money was *received*, which is on or after the day
it left the payer's account — cheques clear, transfers settle overnight, a clerk
stamps the receipt when they get to it. So the search runs five days **before**
the receipt date and only one after: a payment made a week *after* its receipt
was written is not that receipt's payment.

## Worked out when somebody looks, not at upload

`receiptMatchesIn` follows `identifiersIn` exactly: it re-reads on demand and
stores nothing. That is not tidiness. **The statement carrying the payment is
very often imported weeks after the receipt is filed**, so a match made at upload
time would freeze an answer taken before the evidence arrived — and the honest
answer at that moment is *"no payment of this amount is recorded near this date
— the statement it is on may not have been imported yet"*, which is a more
useful thing to be told than silence.

## What the mutation testing caught

**10 of 10.** Among them: a near amount matched, a credit matched as a payment,
the window ignored, the window made symmetric, two candidates called probable,
an uncertain match attachable by a button, and — the one worth naming —
**attaching a receipt replacing the document list rather than appending to it**,
which would file the receipt by losing the invoice already there.

## Still not done

- **No screen offers the match yet.** `receiptMatchesIn` is reachable from the
  document store and nothing calls it, which is the defect this repository keeps
  finding; it is recorded here rather than left to be discovered.
- **A part payment is never matched**, by design, so a receipt for a bill paid
  in two instalments stays unfiled.
