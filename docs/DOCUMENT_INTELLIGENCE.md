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
