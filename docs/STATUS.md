# FamilyOS — What exists, and what does not

This replaces the build plan the application was written against. Every phase
in that plan is done, so a document written in the future tense had become a
misleading way to describe a finished thing. What is worth keeping is the
honest half: the line between what is built and what is not.

---

## Built

| Area | What is actually there |
| --- | --- |
| **Foundation** | Storage adapter with IndexedDB and in-memory implementations of one interface; the schema registry that fifty-three<!--live:entities--> entities, their stores, indexes, forms, validation, encryption, Sheets tabs and the assistant's vocabulary are all derived from; single-transaction writes; audit trail |
| **Security** | AES-256-GCM field encryption bound to entity, record and field; one data key wrapped separately by PIN, WebAuthn and a recovery phrase; RBAC enforced in the repository rather than the interface; session timeout; rate-limited unlock |
| **Offline** | Every read and write local; outbox with exponential backoff; three-way field-level conflict merge with a deterministic tie-break so two devices converge without talking to each other |
| **Modules** | Twenty-three<!--live:modules-->, over fifty-three<!--live:entities--> entities. Eight are the same file reading the schema; the other eleven have a screen of their own — dashboard, finance, investments, documents, family, calendar, identity, vault, vehicles, reports and settings — as does the assistant, which is a route rather than a module |
| **Documents** | Capture, encrypt on the device, upload to a per-person Drive folder, preview PDFs and images, read the text out of a PDF, and pull structured fields out of a bill or a policy — a due date fills itself in and the existing reminders pick it up |
| **Statements** | PDF reader, column-aware parser, CSV/TSV reader, credit-card exports, categoriser, import planner. Every account's statements at once, matched to accounts by the number printed on them, deduplicated by fingerprint, checked against the bank's own balances before anything is written |
| **Receipts** | A merchant registry, the Gmail query built from it, a receipt reader, a per-shop ledger, subscriptions reported by what they cost a year, and a match back to the bank rows that settled them. Several mailboxes, each attached by a Google sign-in or by a deployment |
| **Transactions** | A ledger with separate In and Out columns, a running balance, day headings with their own totals, sortable headings, filters whose totals follow them, and rows that open in place; stacks into cards on a phone |
| **Undoing** | Imported files listed as files, removed together with the transactions they created; orphaned rows found and cleared; a deleted document takes its local copy and its Drive file with it |
| **Ledgers** | Person-to-person, borrowing and lending, and insights — over the whole imported history rather than one statement, with retroactive corrections |
| **Backend** | Apps Script, loaded into Node and tested against literal stubs: admission, the member list, the cache, the request contract |
| **Reports** | CSV, XLSX and PDF writers, all hand-rolled and dependency-free |
| **Delivery** | PWA with a service worker and offline shell; a single-file build (`npm run build`) for handing the whole application to somebody |
| **Tests** | 2,084 checks with no browser and nothing installed; 328 more in a real Chromium. Both in CI. These two are the only figures in this table that `tools/self-description.mjs` cannot guard, so they are the two most likely to go stale — see `docs/SELF_DESCRIPTION.md` |

## Deliberately not built

Stated plainly so nothing is mistaken for finished.

**One language, and a door for a second.** There is a locale layer, the schema
labels and the dates go through it, and `tools/strings.mjs` measures what does
not: 3,415<!--live:unroutedStrings--> English strings across 145<!--live:unroutedFiles--> files, a
count that may only fall. What there is not is a second catalogue, because
machine-translating Indian financial and legal vocabulary would produce
confident false statements about a household's money that the household cannot
check. A language below complete coverage cannot present itself as complete,
and a translation that drops a `{amount}` is refused rather than shown.
`docs/LOCALISATION.md` measures it.

**No language model.** The assistant is a deterministic intent parser over
local records. It answers the questions it recognises, shows the rows behind
every number, and says so when it cannot parse one — which, for medical and
financial records, is the only acceptable failure mode. Wiring it to a hosted
model would be a transport swap in `ai/assistant.js`, not a redesign, but no
model is called today and none should be without a decision about what leaves
the device.

**Identifiers are redacted before anything is indexed.** `ocrText` is
searchable, and in this schema searchable means unencrypted — a search index
over ciphertext finds nothing. So a PAN, an Aadhaar, a passport or a card
number found in a document is removed from the indexed text and handed back
separately, to be put somewhere encrypted. Getting better at reading must not
make the application worse at keeping a secret.

**Scans are read by Drive, in your own account.** A photograph of a bill is
pixels, and a browser cannot read pixels. So when a file arrives that this
device could not read for itself, the Apps Script backend copies it to a Google
Doc — conversion is what triggers OCR — exports the text, and throws the copy
away. The file never leaves the household's Google account, no third-party OCR
service is involved, and nothing is bundled: the alternative was fifteen
megabytes of WASM in an application whose premise is that it has no runtime
dependencies. It needs the backend redeployed to take effect, and text that
comes back is redacted on exactly the same terms as text read on the device.

**Text extraction on the device.** A PDF made by a
computer carries its text as text, and every PDF uploaded to Documents is now
read on the device and stored in `ocrText`, so it can be found by a policy
number that appears inside it and nowhere in anything anybody typed.

A *scanned* PDF is pictures of text and cannot be read this way. Both arrive as
`application/pdf`, so a scan uploads fine, is previewable and searchable by
title — and returns nothing for its contents. That is the remaining OCR gap,
and Drive's own conversion on upload is where it would go.

**No merchant is "linked", because no merchant can be.** Zomato, Swiggy,
Amazon, Flipkart, Blinkit and Zepto publish no consumer API — no OAuth, no
order-history endpoint. The two ways to get an order list out of them are to
drive their websites with the household's password, or to read the receipts
they send by email. The first was rejected: an application whose premise is
that it holds less than you expect cannot also hold the login to every account
a household owns, and a scraper breaks on every redesign anyway. So Shops reads
receipts, and one Gmail connection covers every merchant at once — including
ones nobody added, which a household can name by domain.

**Reading mail from the browser is a real escalation, and it is offered
anyway.** Signing a mailbox in puts a `gmail.readonly` token in the page for an
hour at a time; a script injected into this application could reach it, as it
could already reach the Drive and Sheets tokens. Gmail publishes no narrower
permission that would work — the metadata-only scope returns headers without
bodies, and a receipt's total is in the body. The alternative is real and kept:
an Apps Script deployment reads the mail with no token in the page. The
deployment is tighter and the sign-in is one click, and a feature nobody sets
up is a feature nobody has, so both exist and the screen says which is which.

**The Gmail scope is broad and the query is the limit.** Gmail has no
"only these senders" permission; reading mail means a scope that can read all
of it. Pretending otherwise would be the dishonest version. What actually holds
is threefold: the query names a fixed list of senders and is printed on screen
before it runs, the backend refuses any mail search without a `from:` term, and
nothing but merchant, date, total, order number and a message id is written
down — the body is read on the device and discarded.

**The backend admits a list of accounts, not one.** It runs as the account
that deployed it and used to refuse every other token, which made the documented
way to add a family member impossible — their sign-in worked and every sync
after it returned 403. The owner now keeps a list in Settings → Household
accounts. Being on it grants the right to *reach* the workbook, never to read
it: the sensitive fields are ciphertext and the key is wrapped on each person's
own device.

**A card statement is read from its columns, never from a balance.** There is
no account balance to run, and the sign convention is inverted — a purchase
increases what is owed. Every assumption the bank-statement parser makes about
balances is wrong on a card, which is why cards were unsupported until there
was a reader that takes the direction from the heading the bank wrote.

**Signing in with Google trades the PIN away, and says so.** The key that
unwraps the data can be escrowed in the household's own Drive `appDataFolder`,
which makes opening the app one press on any device and configures backup at
the same time. It also means anyone who can sign in as that Google account can
read everything — the PIN was the one thing standing between a compromised
Google password and a family's medical records. So it is a fourth wrapping
beside the other three rather than a replacement, it is offered with the cost
written next to the button, and turning it off deletes the key out of Drive
rather than forgetting it locally. Escrowed or not, what Drive holds is a
wrapping key and never the data key.

**Most fields are not encrypted, and the application now says so where a
household will see it.** Forty<!--live:encryptedFields--> fields carry
`encrypted: true` — identity and account numbers, passwords, diagnoses,
nominees, policy and registration identifiers. The other four hundred and
forty-four are stored as written, on this device and
in the household's Google Sheet alike, because a search index over ciphertext
finds nothing and a table cannot sort a column it cannot read. Settings →
Privacy counts both halves from the schema and names, per field, the reason it
is readable. Two checks in the suite hold the line: nothing sealed may also be
searchable, and nothing sealed may be a list column except two titles that are
named explicitly.

**Local-only is a switch, not the absence of configuration.** Sync, document
upload, mail reading and key escrow each check it separately, because there are
four ways out and one check at the top of the sync engine would leave three
open. It is off by default: a household that never turns it on still gets a
backup, and a backup nobody has is how records are lost.

**Market prices are entered by hand.** No third-party price API is bundled. An
Apps Script `GOOGLEFINANCE` bridge would cover the instruments Sheets supports.

**Voice notes and drawings store the blob.** No transcription, no editor beyond
a canvas surface.

**The single-file build has no offline.** A service worker has to be its own
file at its own URL, so one file cannot have one. Use a real deployment for
anything you intend to keep.

## Known limits worth knowing before you trust a number

- **Categorisation is rules, not judgement.** A shop trading under a person's
  name reads as a person; a friend whose UPI handle is their business name
  reads as a merchant. Every classification carries the rule that produced it,
  and both are correctable from Finance → People or Lending: naming a business,
  or overriding one counterparty's category. A correction is applied when the
  figures are read, so it reaches every month already imported.
- **Direction was not always stored.** Transactions imported before it was
  carry only `kind`, which cannot tell the two halves of a transfer apart.
  Those are counted as outgoing and the ledgers say how many, rather than
  presenting a guess as a reading. Re-importing replaces it.
- **A statement shows one side of a transfer.** The far end is often not an
  account this household holds, so imported transfers have no destination.
- **Payment apps hide the merchant.** Money through Razorpay or PhonePe with no
  named payee is categorised as a payment, not guessed at.
- **A missing month is detectable but not automatic.** The importer reports a
  break in the balances between two statements; nothing goes looking for the
  statement you never downloaded.
