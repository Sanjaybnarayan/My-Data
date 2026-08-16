# Ten Real Documents, Measured

An agreement, two partnership deeds, a rent agreement, two fee receipts, a
vehicle registration certificate, a combined invoice-and-RTO-receipt, an
electricity bill and a blood donation certificate — read with this
application's own reader, and put to this application's own extractor.

**None of their values are in this repository.** Every fixture written from
this work is a retyped layout, the way every fixture here already is. What is
recorded below is shapes, labels and failures, and no number, name, address or
identifier out of any of the ten.

The point of measuring against real files rather than against fixtures is that
fixtures are written by the same person who writes the parser, and agree with
it by construction.

## What the reader could not read

`Electricity_bill.pdf` came back as **2,718 characters of mojibake** — not an
empty document, which would have been honest, but a page of rubbish that would
have gone into `ocrText`, been indexed as searchable text, and synced to the
household's Sheet. The reader's own header warns about exactly this:

> without it the text comes out as plausible-looking gibberish, which is worse
> than failing

It was doing the thing it warns about. Three separate defects, all in the same
three lines, all of which had to be true at once:

| | What it did | What real producers write |
| --- | --- | --- |
| 1 | Read `/Font << … >>` out of the page dictionary | `/Resources 3620 0 R` — a *reference* |
| 2 | Matched font names as `[A-Za-z0-9]+` | `/C0_0` — names contain underscores |
| 3 | Bound only `/F1 5 0 R` | `/Ft0 << /BaseFont … >>` — written in place |

Any one of them empties the page's font table. An empty font table is not a
blank page: with an `Identity-H` font — which is what all twelve fonts in this
bill are — the two-byte glyph indices pass straight through as though they were
characters. Every one of those twelve fonts carried a `/ToUnicode` CMap, and
this reader has correct code for parsing them, sitting directly above the
lookup that never reached them.

A fourth thing was wrong in the same place and is fixed with them: a
dictionary was found with `<<([^>]*)>>`, which ends at the first `>` inside it,
so a resources dictionary containing a font dictionary was read only as far as
the font.

After the fix the bill reads: `ELECTRICITY BILL`, `Account Details`,
`Billing Details`, `Bill Period`, `Pres. Rdg`, `Prev. Rdg`, `Consumption`,
`Fixed Charges`, `Energy Charges`, `FPPCA Charges`, `Net Payable`, `Due Date`.
1,732 characters of text, where there had been 2,718 characters of noise.

**Nothing failed when this was fixed.** 1,709 tests and every ratchet passed
before and after. Not one of the three was covered, which is why the four
mutations are now written down in `tests/pdfread.test.mjs` and each one is
verified to fail with the case named.

The other nine documents read byte-identically to before — checked, not
assumed.

## What is still wrong with that bill, and is not a bug

The Kannada half of the bill is still unreadable, and no change to this reader
will fix it. It is a **scan**: an image with an OCR text layer drawn
invisibly over it, and the OCR engine mapped Kannada glyphs onto a Latin font.
`ಬಿಲ್` became `l!J;J;,od`. That is wrong in the file, and the file is what we
have.

This matters for a bilingual bill in a way it would not for an English one.
The labels are written `<kannada>/English Label` — the English is the second
half of a slash-separated pair, and it survives. So the labels are readable and
the Kannada is not, which is a tolerable failure. The English OCR is itself
poor enough to matter: `Net Payable` came out `Nllt PajialJ/11`, which is why
the extractor finds the due date on this bill and **not the amount**.

## What the extractor makes of each document

Measured by running `detectKind` and `readDocument` over the reader's output:

| Document | Read as | Fields found |
| --- | --- | --- |
| Electricity bill | `bill` | due date |
| Fee receipt (school) | `receipt` | received by, amount, date, receipt no |
| Fee receipt (coaching) | `receipt` | amount, date |
| Invoice + RTO receipt | `receipt` | payer, amount, date |
| Rent agreement | **`receipt`** | payer, date |
| House agreement | **`bill`** | biller |
| Partnership deed ×2 | `unknown` | — |
| Vehicle RC | `unknown` | — |
| Blood donation certificate | `unknown` | — |

Four of these are worth naming individually.

### An agreement is not a bill, and not a receipt

The house agreement is classified as a **bill** and a biller is picked out of
it; the rent agreement is classified as a **receipt** with a payer and a date.
Both are legal agreements, and neither is either thing.

The cause is that `KIND_RULES` has no `agreement` kind at all, so every
agreement falls through to whichever money-word appears first — a lease says
"payable" and a rent agreement says "received", and that is the whole of the
reasoning behind the answer. A bill classification is not inert: it is the
kind that feeds due dates into reminders.

This is the same failure the ordering comment in `KIND_RULES` already
describes for hospital receipts, one level up — there the fix was to order two
existing kinds correctly, and here the kind does not exist to order.

### One PDF, two economic documents

`Invoice__RTO.pdf` is two documents stapled together: a GST tax invoice from a
dealer on page 1, and a Karnataka RTO tax receipt on page 2. They have
different issuers, different numbers, different dates and **different totals**,
and one of them is a purchase while the other is a tax payment.

`readDocument` returns one `amount`. Whichever it returns is wrong about the
other, and there is nothing in the returned shape that can say "there were
two". This is not a parsing bug to fix in a regex — it is a missing concept:
the extractor assumes one file is one document.

Under rule 57 this is the sharper version of the problem. Both of these are
economic events, they are different amounts, and the application would record
at most one of them.

### The RC card is the easiest document here and is read as nothing

The vehicle registration certificate extracts cleanly — 664 characters of
`LABEL: VALUE` and `LABEL VALUE` pairs, no OCR damage, no ambiguity. It is the
best-behaved file of the ten. It comes back `unknown` because there is no
`vehicle` kind, so nothing looks for a registration number, chassis number,
engine number, class, fuel, or the registration and fitness dates that are the
reason a household keeps the document at all.

The order of the pairs is scrambled relative to the printed card — a label
appears after the value it belongs to in one case — so a reader for it must
match on labels and must not assume reading order. That is a fact about the
file worth writing down before anybody builds it.

### The e-stamp header does not print its fields in a fixed order

All four Karnataka e-stamp documents share one header block. In **three** of
them the OCR layer emits the value *before* the label — the certificate
number, then the words `Certificate No.` — so a pattern of the form
`Certificate No[.:]\s*(…)` finds nothing. In the fourth it is the ordinary way
round.

That is worse than a consistent inversion, which could simply be matched
backwards. The same issuer's same header block comes out in two different
orders in files of the same kind, so **neither order can be assumed** and a
reader for it has to accept the label on either side of its value. Measured
across all four, not inferred from one.

This is a single shared format across agreements, deeds and leases — issue
date, account reference, unique document reference, description of document,
consideration price, first party, second party, stamp duty paid by, stamp duty
amount — and it is the one part of an agreement that is genuinely structured.
It is also where the money is: the stamp duty is a real payment.

## A false positive that redacts real data

One bank statement reports a **Card** identifier. It is not a card. It is a
sixteen-digit Google Workspace payment reference inside a UPI narration.

The rule that found it is the only one in `SENSITIVE` with no label
requirement, and its comment explains why:

> A card number needs no label: there is no benign reason for sixteen digits
> in that shape to sit in a searchable field.

Measured against a real statement, that is not true. Payment references,
UTRs and merchant order numbers are sixteen digits routinely, and a statement
is full of them.

Two consequences, and they point in opposite directions:

- The digits are stripped from `indexable`, so a household searching their own
  statement for that reference **finds nothing**.
- The value is handed back to the caller as a card number to be stored
  encrypted — a claim about what the data *is*, and it is false.

I have not changed this. Loosening a redaction rule trades a searchability
problem for a disclosure risk, and the current behaviour errs in the safe
direction; which way that trade should go is a decision to make deliberately
rather than as a side effect of a documentation pass. A Luhn check is the
obvious candidate — it would reject roughly nine in ten arbitrary sixteen-digit
strings while keeping every real card — and it is not written.

## What this measurement says about the roadmap

The extractor is good at the documents it was built against and returns
`unknown` for whole classes of document a household keeps. Of the ten files
here: three are read correctly, **two are read as something they are not**,
**four as nothing at all**, and one is read as a single document when it is
two.

Missing kinds, in the order the measurement argues for them: `agreement`
(four of ten files, and the only structured part — the e-stamp header — is
shared across all four), `vehicle` (a clean parse sitting unused), and
`certificate`. Missing concept: more than one document in one file.

**`agreement` and `vehicle` are built** — see `docs/AGREEMENTS_AND_VEHICLES.md`,
written after this and in answer to it. All twelve documents now classify
correctly. That work also closed a leak this page did not look for: the
chassis and engine numbers, which the schema holds `encrypted: true` and the
extractor was writing in the clear into searchable text.

Still open from this page: a `certificate` kind, the Luhn check argued for
above, and more than one document in one file.

---

# A Second Batch: Eight More, And Two Photographs

Two motor insurance policies, a vehicle loan statement, a warranty booklet,
four scanned documents, and photographs of a second vehicle's registration
card. Same rule as above: **none of their values are in this repository.**

## Three answers that used to be one

`extract()` returned `{ pages: [], encrypted: false }` for all three of these,
identically:

- a file that is not a PDF
- a PDF this reader could not parse
- **a PDF of photographs, with no text layer at all**

Two of the eight are the third case — a 60-page warranty booklet and a scanned
certificate. A household scanning a warranty card would have been told nothing,
when the true answer is *"this needs OCR"*, which is something they can act on.

`pageCount` is now reported alongside `pages`, and a `reason` says which case
it is. Blank pages are still not added to `pages`, because a blank page in the
middle of a statement would shift every row a caller counts on.

## A NUL inside a word

The Tata AIG policy read `Certi<NUL>cate of Insurance`. Not a space — the byte
`0x00`, invisible on screen.

The font's CMap maps its `fi` ligature glyph to **U+0000**, which is a subset
font's way of saying *this glyph has no Unicode*. The reader emitted it
verbatim. That value would have gone into `ocrText` — searchable, and synced to
a cell in the household's Sheet — where it does not match a search for
`certificate` and looks to a reader like a spacing bug.

It is dropped now. The result is `Certicate`: still wrong, because the font
genuinely never said what that glyph was, but **wrong where somebody can see
it**.

## And a ligature that was mapped honestly

A different font in the same document maps the same ligature to U+FB01, which
is correct and equally unsearchable: `beneﬁts` does not match `benefits`, and
no label pattern in `domain/extract.js` containing `fi` would ever match.

Ligatures are decomposed to the letters they stand for. This is the one place
this reader is allowed to change what a document said — and it is not changing
it, because U+FB01 *is* `fi`, written as one glyph for the typesetter.

## What is measured and still not fixed

**Spacing.** The same policy still reads `con rm ation` for *confirmation* and
`M otor` for *Motor*. That is a different fault from the two above: the run
splitter inserts a space where a kerning adjustment is wide, and deciding
correctly needs glyph widths, which this reader does not parse. Named here so
the ligature fix is not read as having solved it.

**Motor policy expiry.** Both policies are correctly detected as `policy`, and
both yield a policy number, insurer and premium. **Neither yields an expiry
date**, which is the field the whole reminder machinery turns on. The reason is
a vocabulary gap: `readPolicy` looks for `valid upto`, `expiry date`, `policy
end date`; a motor policy writes **`Period of insurance <date> to <date>`** — a
range, where the expiry is the *second* date, and `readLabelledDate` returns
the first. It needs range handling, not another label, so it is not a one-line
change and is not made.

A motor policy also has no *sum assured* — it has an **IDV**, the Insured
Declared Value. One of the two yielded a `sumAssured` anyway, which is a label
collision worth being suspicious of rather than pleased about.

**A vehicle loan statement is a statement.** The TVS Credit document is
correctly read as `statement`, and it is one — but of a loan, not a bank
account. Nothing distinguishes the two, and the chassis and engine numbers on
it were redacted correctly by the rules added in
`docs/AGREEMENTS_AND_VEHICLES.md`, on a document class those rules were not
written for.

## The registration card photographs

Two photographs of a smart-card RC for a second vehicle, front and back. They
are images, not PDFs, and nothing in this repository reads them — Drive's own
converter is the OCR path, per the architecture document.

Worth recording because the **layout is a different one**: the printed card
measured earlier is the older format, and this is the chip-card format, whose
back carries `Maker's Name`, `Model Name`, `Colour`, `Body Type`,
`Seating`, `Month-Year of Mfg.`, `Cubic Capacity`, `Wheel Base` and the
registering authority as clean label/value pairs, and whose front carries
`Regn. Number`, `Date of Regn.`, `Regn. Validity`, `Chassis Number`,
`Engine / Motor Number`, `Owner Name`, `Fuel` and `Emission Norms`.

`readVehicle` was written against the older layout. Its labels — `REG NO`,
`REG.DATE`, `REGFC UPTO`, `MFR`, `CLASS` — are **not** the labels on this card,
which says `Regn. Number`, `Date of Regn.`, `Regn. Validity`, `Maker's Name`
and `Vehicle Class`. So it would read little of this one, and that is stated
rather than assumed: no OCR text exists for it here to measure against, and a
claim about how well a reader handles a document nobody has run it on is
exactly the kind this repository does not make.

---

# A Third Batch: Sixteen Certificates, And A Rule Fitted To One

Sixteen more documents, most of them certificates, put through the same
reader and extractor. **None of their values are in this repository.**

This batch is mostly a verdict on the previous one.

## The `certificate` kind was fitted to a single document

`docs/ONE_FILE_TWO_DOCUMENTS.md` added a `certificate` kind built against the
one award certificate then available, pairing the word `certificate` with
`presented to`. That document argued the rule was principled because both
tokens survived OCR where `Appreciation` had not.

Nine more certificates arrived. **The rule matched none of them.**

| Certificate | Read as, before |
| --- | --- |
| Bonafide / study certificate | `unknown` |
| Migration certificate (CBSE) | `unknown` |
| No-dues certificate ×3 | `unknown` |
| Degree / marks statement | `unknown` |

A rule verified against one example is a rule fitted to one example, and the
care taken over *which tokens* survived OCR did nothing about the fact that
there was only ever one document to check against.

What an Indian certificate actually opens with is **`This is to certify
that`** — the bonafide certificate, the migration certificate and the study
certificate all say it. Adding it names three certificates where one was named
before.

### And the ordering is now load-bearing, where before it was decoration

The previous document recorded, honestly, that moving `certificate` above
`vehicle` broke no test because the two rules were disjoint. With the
attestation phrase that is no longer true. Measured across thirty-eight
documents, `hereby certify that` appears on:

- a dealer's **GST tax invoice** — *"We hereby certify that our Registration
  Certificate GST Under Act, 2017 is in force"*
- **two motor policies** and **two 80D tax certificates**

All five are better named by the kinds above, so `certificate` is now matched
**last**. Two tests assert it, and the mutation that moves the rule first
fails both.

## What the reader made of the rest

**Six of sixteen are scans with no text layer** — a Guvi certification, two
e-quiz certificates, a webinar certificate, a certificate letter and a policy
certificate. Each now reports *"the PDF has pages but no text in them — it is
a scan, and needs OCR"*, which is the work from the previous batch doing
exactly what it was built for, on six documents at once.

**The digital RC for `KA51MW7792`** — the same vehicle whose printed card was
measured earlier — yields **32 characters**. It is a DigiLocker-issued PDF
whose content is drawn as an image.

**The two 80D certificates read as `policy`**, and each yields a policy number
and a premium. That is not wrong: an 80D certificate is issued by an insurer
and states the premium paid. It is worth naming as a near-miss rather than a
success, because what the household actually wants from one is a **tax**
document for a financial year, and nothing here knows that.

## The sharpest finding: text that is scrambled letter by letter

The three no-dues certificates have a text layer, and it is unusable:

```
Zsbauipmrceeoa duheas: sw 5bi6teh0ei0nn9 c31l0o steod 4 i0n doauyr sb.ooks.
```

Two lines interleaved character by character. Diagnosed rather than guessed:
the page draws **one item per character** — 850 of them — and has only **seven
distinct Y values**, three adjacent pairs of which are **1, 1.18 and 2 points
apart**. `toRows` and `toLines` group by Y with a fixed tolerance of **2.2**,
so those three pairs merge into single rows and their characters are then
ordered by X — which weaves them together.

This is the failure this reader's own header warns about, in its worst form:
not an empty document, and not obvious mojibake, but something that **looks
like prose** and would go into `ocrText` as searchable rubbish.

It is **not fixed here.** Lowering the tolerance would split genuine rows that
carry superscripts or mixed font sizes, and the honest fix is different: two
runs at different Y that **overlap in X** cannot be on the same line, and a
merged row can be split on that. That is a real rule with a real test, and it
is a piece of work rather than a constant to tune — recorded with the
measurement so the next tranche starts from the numbers rather than from the
symptom.
