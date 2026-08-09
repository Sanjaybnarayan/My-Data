# My-Data

Everything about a household's records — identity, family, money, investments,
documents, health, insurance, vehicles, property, education, tasks, calendar,
notes, passwords, digital assets and emergency information — in one application
that runs entirely in your browser.

The application is **FamilyOS**. It is the whole of this repository.

**Your records are not in this repository and must never be.** They live
encrypted in your browser, and optionally replicated to your own Google Sheets
and Drive. Git keeps everything forever and encrypts nothing; a financial
record committed once is readable by anyone who ever gets a copy of the repo,
including after you delete it.

---

## Run it

```
npm start
```

Then open <http://localhost:8080>. No build step, no `npm install` needed for
this — the application is native ES modules served as files.

Opening `index.html` from the filesystem will not work, and the reason matters:
WebCrypto, service workers and WebAuthn only exist in a *secure context*.
`localhost` is one; a `file://` path is not. That is a browser rule.

### One file you can put anywhere

```
npm run build          # → dist/familyos.html
```

The whole application folded into a single self-contained page: no server, no
build step at the other end, nothing fetched at runtime. It gives up the
service worker, and therefore offline — a worker has to be its own file at its
own URL, so one file cannot have one.

## Deploy it

`docs/DEPLOYMENT.md` covers hosting, headers, releases and backups. The short
version: it is static files and any HTTPS host will serve them.

`docs/SETUP.md` covers connecting it to your own Google account, which takes
about twenty minutes and is what turns a single-device record keeper into a
household's shared, backed-up one.

---

## What it is

- **Offline-first.** Every read and write is local. Sync is a background
  reconciliation, not the path a screen waits on.
- **Encrypted on the device.** A random 256-bit key encrypts the sensitive
  fields; your PIN, a fingerprint and a recovery phrase each wrap a copy of it.
  Nobody who has not got one of those three can read the data — including
  whoever hosts it.
- **Yours in a format you can read.** The backup is a Google Sheet in your own
  Drive, one tab per record type, every column named. Stop using this and the
  data is still yours in something anything can open.
- **No dependencies at runtime.** No framework, no charting library, no
  spreadsheet or PDF library, no Google SDK. The charts are hand-drawn SVG, the
  XLSX writer is a ZIP and some XML, the PDF reader and writer are both from
  scratch. An offline-first application that cannot start without a network
  request is not offline-first.

## Documents

Uploads are encrypted on the device before they are stored, and filed into a
folder per person in your own Drive. A PDF is also **read** on upload — its text
is extracted here, in your browser, and indexed — so searching for a policy
number finds the policy even though that number appears nowhere you typed it.

A scanned PDF is pictures of text and cannot be read this way; it is stored and
previewed like anything else, and findable by its title.

## Bank statements

**Finance → Import** takes every statement you have — all accounts, all cards,
all people — in one go, as PDF or as CSV. Each file is matched to an account by the number printed on
it, categorised by rules you can read in `js/domain/categorise.js`, and checked
against the bank's own opening and closing balances before anything is written.
Re-uploading the same month is harmless, and a month you forgot to upload shows
up as a break in the balances.

**Prefer CSV where your bank offers it.** A PDF is a picture of a table and has
to be read by where the ink landed; a CSV *is* the table, so none of that can go
wrong. Credit card exports work too — a card has no running balance and inverts
the sign, so it is read from the columns the bank labelled rather than from
arithmetic.

Either way the file is decoded in your browser. Nothing is uploaded anywhere.

**Finance → Transactions** is a ledger, not a list: money in and money out are
separate right-aligned columns with the balance beside them, because a column
where ₹50,000 arriving and ₹50,000 leaving are printed identically is a list of
numbers rather than a ledger. Any row opens in place to show everything the
import kept — the narration exactly as the bank wrote it, the reference, the
balance after, the statement it came from and the receipt that matched it —
without leaving the screen you were comparing it against. Rows group under a day heading carrying that day's own totals. Filter by
account, category, direction, date or amount, and every total is of the rows
shown.

**Finance → People, Lending and Insights** read the whole imported history, not
one file: who money has gone back and forth with and where each stands, what
has been borrowed and how much is still out, and the handful of facts about the
period that would change a decision. A counterparty the rules get wrong can be
corrected there, and the correction applies to every month already imported —
the categoriser is re-run over the narrations rather than its old conclusions
being read back.

There is a command-line version of the same thing:

```
npm run statement -- statements/*.pdf          # the analysis
npm run statement -- --csv statements/*.pdf    # every transaction, categorised
```

## Shops, subscriptions and receipts

**Finance → Shops** reads the receipts Zomato, Swiggy, Amazon, Flipkart,
Blinkit, Zepto, Uber, Netflix, your telco and your electricity board already
email you, and turns them into a per-shop spending ledger, a list of what
renews on its own and what it costs a *year*, and a match back to the bank rows
that paid for it.

There is no "connect your Zomato account" button because there is nothing to
connect to: none of those services publishes a consumer API. The only
alternative would be for this application to hold the password to every account
you own and drive their websites as you, which it will not do. Their receipts
are the seam that actually exists, and one Gmail connection covers all of them
at once — including shops nobody built an integration for, which you add by
naming the domain their receipts arrive from.

A first scan walks forward on its own — each pass starts where the last one
stopped — so a backfill over years of mail is one press rather than a date
field you keep nudging.

Gmail has no per-sender permission, so the meaningful limit is the query. It
names senders and a date and nothing else, and the screen prints it in full
before it runs. What is stored is the merchant, date, total, order number and a
Gmail message id — the message body is read on your device and never written
down.

**More than one mailbox.** Add as many as your receipts arrive at. Each scan
reads them in turn and reports what each returned; one that cannot be read is
named and the rest are still read.

Three ways to attach one, offered in that order:

- **Sign in with Google** — one click, nothing to deploy. Costs a
  `gmail.readonly` token in the page for an hour at a time; Gmail has no
  narrower scope that can still see a total. Each mailbox is its own consent,
  revocable on its own, and the app's ordinary sign-in never gains it.
- **Use this deployment** — if you deployed `Gmail.gs`, your backend reads its
  own account's mail with no token in the browser at all.
- **Use another account's deployment** — the most setup, and the only way to
  read a *second* mailbox with no Gmail token in the page.

None of them moves the backup. A mailbox answers mail searches and nothing
else: never a workbook, never a Drive folder, never anything to sync. See
`docs/SETUP.md`.

## Tests

```
npm test              # 554 checks, no browser, nothing installed
npm run test:browser  # 117 checks in a real Chromium
```

The suite imports the shipping modules — everything below the view layer is
DOM-free by construction — and runs them against an in-memory storage adapter
implementing the same contract as IndexedDB. Real AES-GCM, real PBKDF2, real
conflict resolution, real XLSX and PDF bytes.

## Where things are

| Path | What |
| --- | --- |
| `js/data/schema.js` | Thirty-four entities described once. Stores, indexes, forms, validation, encryption, Sheets tabs and the assistant's vocabulary are all derived from it |
| `js/domain/` | The rules — money, portfolios, statements, categorisation, reminders |
| `js/modules/` | The screens. Fifteen of them are the same file reading the schema |
| `js/security/` | Keys, field encryption, roles, sessions |
| `js/sync/` | Outbox, conflict resolution, the Apps Script client |
| `apps-script/` | The backend, which runs in your own Google account |
| `docs/` | Architecture, status, setup, deployment |
