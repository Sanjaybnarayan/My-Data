# FamilyOS — Setup

Two ways to run this. Pick the first if you want to look at it; pick the second
if you want to keep your family's records in it.

---

## 1. Run it locally, with no Google account (2 minutes)

```
npm start
```

Open <http://localhost:8080>. Choose a PIN, write down the recovery phrase,
and the app is yours. Everything works: every module, the assistant, reports,
search, offline. Nothing is backed up anywhere, and the data lives in that
browser profile only.

A plain `file://` open will not work, and the reason matters: WebCrypto,
service workers and WebAuthn are only available in a *secure context*.
`localhost` counts as one; a file path does not. That is a browser rule, not a
choice this application made.

---

## 2. Connect it to your own Google account (about 20 minutes)

Your records go into a Google Sheet and a Drive folder **in your own account**.
There is no FamilyOS server, no shared database and no account to create with
anybody. The trade is that you do the setup once.

### Step 1 — Deploy the backend

1. Go to <https://script.google.com> and create a new project. Call it
   `FamilyOS`.
2. Copy in the four files from `apps-script/`:
   - `Code.gs`, `Sheets.gs`, `Drive.gs`
   - `appsscript.json` — click the gear icon → **Show "appsscript.json"
     manifest file in editor**, then replace its contents.
3. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Approve the scopes when asked. Google will warn that the app is
   unverified — that is expected: you are the developer and the only user.
   Click **Advanced → Go to FamilyOS (unsafe)**.
5. Copy the deployment URL. It ends in `/exec`.

> **"Anyone" sounds alarming — why is it safe?**
> The web app runs as *you*, and every request must carry an OAuth access
> token that `Code.gs` verifies belongs to your own Google account. A stranger
> who finds the URL has no such token, and the script refuses them. What
> "Anyone" actually controls is whether Google will *route* the request; the
> authorisation is done by the script.

Open the `/exec` URL in a browser. It should answer with a short JSON block
confirming the deployment is reachable. If it shows a Google sign-in page
instead, the deployment access is not set to "Anyone".

### Step 2 — Create an OAuth client

1. Go to <https://console.cloud.google.com>, create a project (or reuse one).
2. **APIs & Services → Library** — enable **Google Sheets API** and
   **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**, unless you have a Workspace account.
   - Fill in the app name and your email.
   - Scopes: add `drive.file` and `spreadsheets`.
   - Test users: **add your own email address, and every family member's.**
     While the app is in testing mode, only listed users can sign in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**
   - Authorised JavaScript origins: where you will host the app, e.g.
     `https://yourname.github.io` or `http://localhost:8080`
   - Authorised redirect URIs: the same origin plus the callback path, e.g.
     `https://yourname.github.io/My-Data/oauth-callback.html`
5. Copy the client ID. It looks like `1234…apps.googleusercontent.com`. There
   is no client secret to copy — a browser cannot keep one, and FamilyOS does
   not use one.

### Step 3 — Point the app at both

Create `familyos/familyos.config.json`:

```json
{
  "googleClientId": "1234-abcd.apps.googleusercontent.com",
  "apiUrl": "https://script.google.com/macros/s/AKfy…/exec",
  "currency": "INR",
  "sessionTimeoutMinutes": 15
}
```

This file is **not** in version control (`.gitignore` covers it) — not because
it holds a secret, but because your deployment URL is yours.

### Step 4 — First sync

Open the app, unlock it, go to **Settings → Google account → Sign in with
Google**, then **Set up the workbook**. That creates:

```
Drive/
  FamilyOS/
    FamilyOS Data              ← the spreadsheet, one tab per record type
    Documents/
      Asha Narayan/            ← one folder per person
        Identity/  Health/  Education/ …
      Ravi Narayan/
        Identity/  Vehicle/ …
      Household/               ← anything not about one individual
        Property/  Insurance/ …
```

One folder per person, categories inside, because that is how a family looks
for paperwork. It also means a single person's folder can be shared with them,
or handed over, without unpicking anyone else's — right-click their folder in
Drive and share it.

Category folders are created when something is first filed in one, so nobody
gets twelve empty folders. A person renamed in FamilyOS has their Drive folder
renamed on the next upload rather than a second one created beside it.

Open the spreadsheet and look at it. Every tab is readable, every column is
named, and if you ever stop using FamilyOS the data is still yours in a format
anything can open. That is deliberate.

Finish with **Settings → Sync → Verify backup**, which compares row counts on
this device with row counts in the sheet and tells you if they disagree.

---

## Adding family members

1. **Identity → People → Add** — one record per person, with a role:

   | Role | Can read | Can write |
   | --- | --- | --- |
   | `owner` | everything | everything |
   | `spouse` | everything | everything except other people's vault items |
   | `adult` | most things; not the vault, not identity documents | family, health, tasks, notes |
   | `child` | only records about themselves | their own tasks and notes |
   | `guest` | emergency contacts only | nothing |

2. Add their email as a test user on the OAuth consent screen (Step 2.3).
3. On their device: open the app, set their own PIN, sign in with their Google
   account, and sync. They get their own encryption key wrapping the same data.

The roles are enforced in the repository, not in the interface — a child's
device does not merely hide the Finance screen, it refuses the read.

---

## Bank statements, once a month

**Finance → Import.** Choose every statement PDF you have — all accounts, all
people, in one go. Each file is read on this device: the PDF is decoded in the
browser, categorised by rules you can read in `js/domain/categorise.js`, and no
part of it is uploaded anywhere.

A person can have as many accounts as they like. Each file is matched to one by
the account number printed on it, so nothing has to be sorted by hand:

| What the screen shows | What it means |
| --- | --- |
| **matched** | The account number on the statement matches an account on record |
| **unsure** | Something matched, but not the number — check before importing |
| No account | Nothing on record matches. **Create the account** does it from the statement head |
| **arithmetic closes** | Opening + everything in − everything out equals the closing balance the bank printed |
| **n already here** | Rows imported previously, which will be skipped |
| **n unreadable** | Rows the parser would not guess at. These are named, not swallowed |

Three things follow from importing monthly rather than once:

**Re-uploading is harmless.** Every transaction carries a fingerprint of the
things a bank cannot restate — account, date, amount, direction, reference and
narration. A row already on record is skipped, so it does not matter whether
you remember which files went in last month.

**A missing month is visible.** If one statement's opening balance does not
follow the previous one's close, the screen says so and by how much. That gap
cannot be seen in any single statement — only in two of them together — and it
is the failure that quietly makes a year's totals wrong.

**Nothing is written until you have looked.** Reading and importing are
separate steps, and a file whose arithmetic does not close needs a second
confirmation.

Every import also writes a **Statement** record under Finance, holding the
period, the bank's own opening and closing balances and any rows that could not
be read. Statements are the evidence a month was loaded at all.

### If you run a business

Name it under **Your businesses** on the Import screen, exactly as it appears on
the statement. Until you do, a firm's account is indistinguishable from a
stranger sending money back and forth — which is what it looks like to any rule,
and why this is asked rather than guessed.

Once named, money from the firm counts as earnings and money into it counts as
capital rather than spending, and a two-way ledger shows the net: what has been
drawn out against what has been put in. That is the partner's current account,
and no bank statement contains it.

If a payee is categorised wrongly — a shop trading under a person's name, or an
employer the rules read as a friend — open the transaction and change its
category. Every classification is a rule you can read, not a guess a model made.

There is a command-line version of the same thing for a machine that has the
files already:

```
node tools/statement.mjs *.pdf         # the whole analysis
node tools/statement.mjs --csv *.pdf   # every transaction, categorised
```

---

## The recovery phrase

Printed once, at first run. It is a second wrapping of the same encryption key.

**Nobody can recover your data without it or your PIN.** Not Google, not the
person who deployed this, not the author. That is what "encrypted on your
device" means, and pretending otherwise would be the dishonest version.

Keep it on paper, somewhere physical, away from the device. If you have synced
to Google, a forgotten PIN on one device is survivable — set up a new device
and pull everything down. If you have not synced, it is not.

---

## Troubleshooting

**"Google asked for sign-in" on every sync**
The access token expired and silent renewal failed, usually because
third-party cookies are blocked for `accounts.google.com`. Sign in again from
Settings; if it recurs, allow cookies for that origin.

**"The sign-in window was blocked"**
Pop-ups are blocked for the site. Allow them — the flow uses a popup rather
than a full redirect so a half-filled form is not lost.

**Sync says "Needs attention"**
Something the server refused. **Settings → Sync → See what is stuck** names the
record and the reason. The commonest cause is a schema change that has not been
migrated: sign in and the next sync migrates the sheets automatically.

**Nothing syncs and the state says "not configured"**
`familyos.config.json` is missing, or one of the two values is blank. The app
works fully offline in this state by design — it is not an error, it is an
un-connected install.

**A record shows "could not be decrypted"**
The row was written with a different data key — usually because the app was
erased and re-enrolled, creating a new key, while old rows remained in Sheets.
The clear fields are still readable. There is no way to recover the encrypted
ones without the original key.

**Storage is full**
**Settings → Data on this device** shows the browser quota. Documents are the
usual cause; uploaded files can be dropped from the device once they are safely
in Drive.
