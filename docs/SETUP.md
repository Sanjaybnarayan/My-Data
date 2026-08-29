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
2. Copy in **every** file from `apps-script/` — all six scripts and the
   manifest:
   - `Code.gs`, `Policy.gs`, `Sheets.gs`, `Drive.gs`, `Gmail.gs`, `Otp.gs`
   - `appsscript.json` — click the gear icon → **Show "appsscript.json"
     manifest file in editor**, then replace its contents.

   `Policy.gs` is not optional and is easy to miss because it is generated
   rather than hand-written: `Sheets.gs` calls `policyAllows` and
   `ownRecordAllows` from it with no guard, so a deployment without it throws
   `policyAllows is not defined` on every push and pull and nothing syncs at
   all. `Otp.gs` degrades quietly instead — `Code.gs` checks for it before
   calling it — so leaving it out just means sign-in by code does not exist.

   This list is checked against the directory by
   `tests/docs.test.mjs`, because it was wrong: it named four scripts and
   called them five, and the two it omitted were the authorisation rules and
   the one-time codes.
3. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Approve the scopes when asked. Google will warn that the app is
   unverified — that is expected: you are the developer and the only user.
   Click **Advanced → Go to FamilyOS (unsafe)**.
5. Copy the deployment URL. It ends in `/exec`.

> **Why the script asks for Gmail.**
> `Gmail.gs` reads the receipts shops email you, which is what Finance → Shops
> is built on. Gmail has no "only these senders" permission, so the scope it
> asks for can read the whole mailbox — that is Google's design, not a choice
> made here. What limits it is `Gmail.gs` itself: it refuses any search that
> does not name senders, and the query the app sends is printed on screen
> before it runs. If you would rather not grant it, delete `Gmail.gs` and its
> scope line from `appsscript.json` before deploying; everything else works
> unchanged and the Shops tab will simply report that mail search is not
> available.
>
> **Upgrading an existing deployment.** Adding `Gmail.gs` changes the scopes,
> so after **Deploy → Manage deployments → Edit → New version**, run any
> function once from the editor to be re-prompted for approval. Until you do,
> mail search returns an authorisation error and nothing else changes.

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
   - Scopes: `openid` and `email`. That is the whole required list — the
     browser signs you in and proves who is asking, and nothing else. Every
     sheet and every document is written by the Apps Script backend under
     *its* permissions, not yours. Everything below is optional and each buys
     one named feature. **Settings → Google permissions** lists the same thing
     with a copy button, generated from the code rather than written out here.
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

## Updating the backend later

`apps-script/` is source somebody pastes into script.google.com. Nothing in
this repository can reach your deployment, so a change to any `.gs` file does
nothing at all until you paste it in again — however green the tests are.

**Do not use "New deployment" for an update.** That mints a *second* web app
with a *different* `/exec` URL, leaves the old one running the old code, and
the app keeps talking to the old one. The symptom is a change that visibly
does not take effect, with no error anywhere.

To update an existing deployment:

1. Open the project at <https://script.google.com>.
2. Replace the contents of each changed file. If a **new** file has appeared
   in `apps-script/` since you set up, add it — see the list in Step 1.
3. **Deploy → Manage deployments** → the pencil (Edit) on your existing
   deployment → **Version: New version** → **Deploy**.
4. The `/exec` URL does not change, so nothing in Settings needs touching.

If Google asks you to approve scopes again, a file has asked for a permission
the old version did not have. That is worth reading rather than clicking
through: `docs/SETUP.md` lists every scope and what buys it, under *Google
permissions, in full*.

---

## Mailboxes for receipts

Finance → Shops reads the receipts shops email you. There are three ways to
attach a mailbox and they trade differently, so the screen offers all three and
the easy one first.

**Sign in with Google.** Press *Add a Gmail account*, pick the account, done.
Add as many as you have. Nothing to deploy.

The cost, plainly: reading mail from the page means the page holds a
`gmail.readonly` token for an hour at a time. Gmail has no narrower permission
that works — the one returning headers without bodies cannot see a total. So a
script injected into this application, which could already reach its Drive and
Sheets tokens, could also read a connected mailbox. Each mailbox is its own
consent, for its own account, revocable on its own at
<https://myaccount.google.com/permissions>. The application's ordinary sign-in
never gains the mail permission.

**Use this deployment.** If you deployed `Gmail.gs` in Step 1, your backend can
read the mailbox of the account that deployed it — with the Gmail permission
granted to that script rather than to the page. No token in the browser. Reads
one mailbox: that account's.

**Use another account's deployment.** The most setup by a distance, and the only
way to read a *second* mailbox with no Gmail token in the page. That account:

1. Signs in to <https://script.google.com> and creates a project, copies in the
   same files from `apps-script/`, and deploys exactly as in Step 1.
2. Is added as a test user on **the same** OAuth consent screen from Step 2.
   Without this, Google refuses the sign-in.
3. Hands you its `/exec` URL, which goes into Shops → Mailboxes under *Add
   another account's deployment*.

Whichever you use, **the backup does not move.** A mailbox answers mail
searches and nothing else: never a workbook, never a Drive folder, never
anything to sync. One account still holds all of that.

Every scan reads each mailbox in turn and reports what each returned. One that
cannot be read is named in the results and the others are still read.

---

## Continue with Google, and what it costs

Once a client id is configured, the lock screen offers **Continue with Google**
beside the PIN. Press it, pick the account, and you are in with backup already
set up — on that device and on every other one, with nothing to remember and
nothing to type.

It works by keeping the key that unlocks your data in your own Google Drive, in
`appDataFolder`: a hidden per-application folder that only FamilyOS can see,
that does not appear in your Drive listing, and that disappears when you
disconnect the app. The key kept there is *not* your data and not the key your
records are encrypted with — it is a key that unwraps that one, exactly like
the one your PIN derives.

**The cost is real and it is this: anyone who can sign in as that Google
account can read everything.**

The PIN was the one thing standing between "somebody has your Google password"
and "somebody has your family's medical records and identity documents".
Choosing this removes it. Anyone who phishes the account, picks up an unlocked
laptop with the session live, or is handed the password to fix something, gets
the lot.

That is a reasonable trade for some households and a bad one for others, so it
is a choice made in the open rather than a default:

| | Setup | Who can read your data |
| --- | --- | --- |
| **Continue with Google** | one press | anyone who can sign in as you |
| **PIN** | six digits, once per device | anyone who has your PIN *and* a device |

You can have both — a PIN as well as Google is strictly better than Google
alone, because either opens it and only one of them is worth stealing. Turning
Google off later deletes the key out of Drive rather than merely forgetting it,
and leaves your PIN, fingerprint and recovery phrase untouched.

**No extra permission is needed.** The key goes in an ordinary file in your
Drive called `FamilyOS unlock key.json`, created under the `drive.file`
permission the application already uses — so this works with the consent screen
you already have.

Adding `drive.appdata` is optional. It moves the key into a hidden
per-application folder that does not appear in your Drive listing. That is a
difference in tidiness, not in security: the hidden folder is not a boundary,
and anyone who can sign in as you reads either. A key written in one place is
found from the other, so adding or removing the scope later loses nothing.

## Google permissions, in full

Two consent surfaces, and conflating them is why somebody adds a scope in the
Cloud Console and nothing changes.

**The OAuth consent screen** is what a person grants when they press a button
in the app. **The Apps Script deployment** authorises itself, once, from its
own `appsscript.json`, on the "this app isn't verified" screen during
deployment — family members never see it and adding it to the consent screen
does nothing.

### On the OAuth consent screen — required

| Scope | What it is | Why |
| --- | --- | --- |
| `openid` | Sign in | Proves which Google account is asking. Nothing more. |
| `email` | Your email address | The backend admits accounts by address, and mailboxes are named by one. |

### Optional — each buys one feature

| Scope | What it is | Add it if |
| --- | --- | --- |
| `profile` | Your name and picture | Shown in the corner of the app. Cosmetic. |
| `drive.file` | Files this app creates in your Drive | Only for Continue with Google, which keeps the unlock key in a file of its own. Documents you upload do not need it — those go through the Apps Script backend, under the backend’s own permission. Narrow either way: it cannot see anything else in your Drive. |
| `drive.appdata` | A hidden folder of its own | Tidier home for the unlock key. Optional: without it the key goes in an ordinary visible file, which works identically. |
| `gmail.readonly` | Read your mail | Only if you attach a mailbox with “Add a Gmail account” in Shops. Asked for separately, per mailbox, never at ordinary sign-in. |

### The Apps Script deployment authorises separately

| Scope | Why |
| --- | --- |
| `spreadsheets` | The backend writes the backup workbook. |
| `drive.file` | Document folders, uploads, and the OCR conversion. |
| `script.external_request` | Verifies your access token with Google before answering anything. |
| `userinfo.email` | Compares the caller against the account that deployed it. |
| `gmail.readonly` | Only if you kept `Gmail.gs`. Delete that file and this scope to opt out. |

Everything here is declared once, in `js/core/scopes.js`, and read by the code
that asks for it, by **Settings → Google permissions**, and by a test that
fails if this file and `apps-script/appsscript.json` disagree. This table was
generated from it.

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
3. **Settings → Household accounts → Admit** their email. The backend runs as
   one Google account and, until an account is on this list, refuses any token
   that is not that account's — so without this step their sign-in succeeds and
   every sync afterwards returns a 403. Only the account that deployed the
   backend can change the list; it is admitted by identity and never appears
   on it.
4. On their device: open the app, set their own PIN, sign in with their Google
   account, and sync. They get their own encryption key wrapping the same data.

Being on that list grants the right to *reach* the workbook, not to read it.
The sensitive fields in it are ciphertext, and the key that opens them is
wrapped by a PIN, a fingerprint or the recovery phrase on each person's own
device — it never goes near Google. Somebody admitted but without one of those
three sees rows of ciphertext and nothing else.

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

### Scanned documents

A PDF made by a computer is read in your browser. A **photograph or a scan** is
pixels, and is read by Drive's own OCR in your own Google account when the file
uploads — so it needs the backend deployed, and a scan uploaded while you are
offline is read whenever the upload eventually goes through.

Nothing about this sends your documents to anybody: the file is copied to a
Google Doc inside your Drive, the text is exported, and the copy is thrown away.

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
