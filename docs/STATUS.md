# FamilyOS — What exists, and what does not

This replaces the build plan the application was written against. Every phase
in that plan is done, so a document written in the future tense had become a
misleading way to describe a finished thing. What is worth keeping is the
honest half: the line between what is built and what is not.

---

## Built

| Area | What is actually there |
| --- | --- |
| **Foundation** | Storage adapter with IndexedDB and in-memory implementations of one interface; the schema registry that thirty-three entities, their stores, indexes, forms, validation, encryption, Sheets tabs and the assistant's vocabulary are all derived from; single-transaction writes; audit trail |
| **Security** | AES-256-GCM field encryption bound to entity, record and field; one data key wrapped separately by PIN, WebAuthn and a recovery phrase; RBAC enforced in the repository rather than the interface; session timeout; rate-limited unlock |
| **Offline** | Every read and write local; outbox with exponential backoff; three-way field-level conflict merge with a deterministic tie-break so two devices converge without talking to each other |
| **Modules** | Sixteen, over thirty-three entities. Fifteen are the same file reading the schema; the exceptions are dashboard, finance, investments, documents, family, calendar, reports, settings and the assistant |
| **Statements** | PDF reader, column-aware parser, categoriser, import planner. Every account's statements at once, matched to accounts by the number printed on them, deduplicated by fingerprint, checked against the bank's own balances before anything is written |
| **Reports** | CSV, XLSX and PDF writers, all hand-rolled and dependency-free |
| **Delivery** | PWA with a service worker and offline shell; a single-file build (`npm run build`) for handing the whole application to somebody |
| **Tests** | 385 checks with no browser and nothing installed; 72 more in a real Chromium. Both in CI |

## Deliberately not built

Stated plainly so nothing is mistaken for finished.

**No language model.** The assistant is a deterministic intent parser over
local records. It answers the questions it recognises, shows the rows behind
every number, and says so when it cannot parse one — which, for medical and
financial records, is the only acceptable failure mode. Wiring it to a hosted
model would be a transport swap in `ai/assistant.js`, not a redesign, but no
model is called today and none should be without a decision about what leaves
the device.

**OCR is a hook, not an implementation.** The `ocrText` field exists and is
searched when populated. Nothing populates it. Drive's own conversion on upload
is where it would go.

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
  and both an override map and a named-businesses list exist to correct it.
- **A statement shows one side of a transfer.** The far end is often not an
  account this household holds, so imported transfers have no destination.
- **Payment apps hide the merchant.** Money through Razorpay or PhonePe with no
  named payee is categorised as a payment, not guessed at.
- **A missing month is detectable but not automatic.** The importer reports a
  break in the balances between two statements; nothing goes looking for the
  statement you never downloaded.
