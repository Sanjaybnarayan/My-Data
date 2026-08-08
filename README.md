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

## Bank statements

**Finance → Import** takes every statement PDF you have — all accounts, all
people — in one go. Each file is matched to an account by the number printed on
it, categorised by rules you can read in `js/domain/categorise.js`, and checked
against the bank's own opening and closing balances before anything is written.
Re-uploading the same month is harmless, and a month you forgot to upload shows
up as a break in the balances.

The PDF is decoded in your browser. Nothing is uploaded anywhere.

There is a command-line version of the same thing:

```
npm run statement -- statements/*.pdf          # the analysis
npm run statement -- --csv statements/*.pdf    # every transaction, categorised
```

## Tests

```
npm test              # 385 checks, no browser, nothing installed
npm run test:browser  # 72 checks in a real Chromium
```

The suite imports the shipping modules — everything below the view layer is
DOM-free by construction — and runs them against an in-memory storage adapter
implementing the same contract as IndexedDB. Real AES-GCM, real PBKDF2, real
conflict resolution, real XLSX and PDF bytes.

## Where things are

| Path | What |
| --- | --- |
| `js/data/schema.js` | Thirty-three entities described once. Stores, indexes, forms, validation, encryption, Sheets tabs and the assistant's vocabulary are all derived from it |
| `js/domain/` | The rules — money, portfolios, statements, categorisation, reminders |
| `js/modules/` | The screens. Fifteen of them are the same file reading the schema |
| `js/security/` | Keys, field encryption, roles, sessions |
| `js/sync/` | Outbox, conflict resolution, the Apps Script client |
| `apps-script/` | The backend, which runs in your own Google account |
| `docs/` | Architecture, status, setup, deployment |
