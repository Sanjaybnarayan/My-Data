# Consent and the Processor Registry

Phase 0.5, sixth tranche. `js/data/consent.js`, tested in
`tests/consent.test.mjs`, surfaced in Settings, and enforced in
`js/sync/engine.js` and `js/sync/drive.js`.

## Three things called "consent", and only one of them is

| | What it is | What it proves |
| --- | --- | --- |
| A capability being available | A client id is configured, so signing in is possible | Nothing |
| A grant at Google | Somebody pressed Allow on Google's consent screen | What *Google* may do |
| A decision recorded here | A person was told what would happen and said yes | Consent |

The middle row is the seductive one, because the application can read the
granted scopes off the OAuth response and they look like an answer. They are
evidence about a different question. `grantedScopes` is stored **beside** each
decision, never as one.

## `unrecorded` is not a kind of yes

The state of a purpose nobody was ever asked about is `UNRECORDED`, and
`hasConsent()` returns **false** for it.

This is the guard the suite checks hardest, because the pull in the other
direction is strong: an application that already works can read its existing
configuration as agreement, and that is the reading under which nothing has to
change. It is also the reading that manufactures a consent record for a
conversation that never happened.

## The finding

Of the five purposes that send data anywhere, **two had no moment of asking at
all** — and they are the two that matter most:

| Purpose | Asked where, before this tranche |
| --- | --- |
| `identity` | Google's own consent screen |
| **`backup`** — every record to your spreadsheet | **nowhere** |
| **`documents`** — your files to Drive | **nowhere** |
| `mail` — reading a mailbox | Add a Gmail account, per mailbox |
| `escrow` — the unlock key to Drive | Continue with Google |

Keeping a copy of every record in a spreadsheet is the most consequential thing
this application does with a household's data, and it followed from a
deployment being configured. Nobody was ever put the question.

The report marks these `neverAsked`, which is deliberately distinct from "asked
and declined" and from "asked and not yet answered" — a screen that rendered
them the same would read as an unanswered prompt rather than as an absence.

**The Settings card is the fix, not the report of it.** It is now the moment of
asking: a purpose with no answer offers Agree and No, and pressing either
writes a record.

## The gate: an explicit no stops it, an absent record does not

`refused()` — not `!hasConsent()` — is what `sync/engine.js` and
`sync/drive.js` check. The difference is the whole design:

- A household **already syncing** has no record, because until this tranche
  there was nothing to record with. Gating on the absence would silently stop
  their backups on upgrade, and they would find out when they needed one. That
  is a data-loss bug wearing a privacy costume.
- A **withdrawal or a denial** is somebody sitting in front of a screen saying
  no. It is honoured immediately, before the first request.

Backup and documents are refused separately, because a household may well want
the ledger backed up and the passport scans kept off Drive, and one switch
cannot say that.

## One mailbox is not another

`mail` is `perSubject`. Consent to read `a@example.com` says nothing about
`b@example.com`; recording a mail decision without naming a mailbox throws
rather than applying to all of them.

## The processor registry

Three entries, and the differences between them are the point:

| | Relationship | Sees |
| --- | --- | --- |
| Your Google account | your own storage | whatever each purpose sends |
| Your Apps Script deployment | your own code, running as you | every record it is sent |
| Whoever serves the page | delivers the code, never the data | that the page was requested, from what address, when. **No records.** |

Google is not a third party this application handed data to — the household
signs in as themselves and the data lands in storage they own and can revoke.
Whoever wrote this application cannot read any of it.

The host is the entry that usually goes unmentioned. It never sees a record,
because none is ever sent to it, but it sees that somebody fetched the
application. That is worth saying out loud, and the suite asserts it is said.

## The assistant is in the table because nothing leaves

`assistant` is listed with **zero** processors and `localOnly: true`. It is
there precisely because it is the one people assume sends data somewhere. A
future change that routed a question to a hosted model would have to edit that
line, which is harder to do without noticing than adding a `fetch` somewhere.

## Anti-drift

`assertSound()` checks that every scope a purpose names exists in
`core/scopes.js`, that every processor it names exists, that a local-only
purpose names no processor, and that an egressing purpose names at least one.
The same check `scopes.js` applies to its own four lists, for the same reason.

## Limits, stated

- **Per device.** Consent records live in the local meta store, which does not
  sync. A second device has its own history and starts with none. Defensible —
  a person consents on a device, in front of a screen — but "the household's
  consent history" is not something this can show.
- **Not a compliance artefact.** No regulation has been assessed. This is a
  record of decisions and a factual list of who touches what.
- **`identity` is gated by nothing.** Signing in happens before there is a
  database to read a record from. It appears in the report; it is not enforced.
- **Escrow and mail are not gated either.** Both have a real moment of asking
  already, and both are one-time actions rather than recurring egress, so the
  gate would sit in a place nobody passes twice. Recording them at their moment
  is the next step and is not done.

## What mutation testing checked

Thirteen mutations, all caught by the named test that should catch them. The
three worth recording:

| Mutation | Result |
| --- | --- |
| Gate on `!hasConsent` instead of `refused` | 4 tests fail — including *"a household that was never asked keeps its backup"* |
| Remove the Drive gate | 1 test fails — the one that drives the real uploader, not the one that calls `refused()` |
| Make the Settings button repaint without writing a record | 1 browser check fails — *"agreeing records a decision that can be withdrawn again"* |

The second was written that way on purpose. Asserting `refused()` returns true
would have proved only that the helper works — the same shape of vacuous test
that mutation testing caught in the retention tranche. The third is the same
discipline applied to the card: a check that only asserted the card rendered
would have passed with a button that did nothing.

## A control that changes nothing is worse than no control

The first draft of the card offered Agree and No on the **assistant** row. The
assistant sends nothing anywhere, so both buttons would have written a record
and changed nothing — and a decision that does nothing teaches somebody that
the rest of the list is theatre too. Local-only purposes now render without
controls, saying so.

The card also lists **every** purpose rather than only the active ones.
Somebody reading a card headed "What you agreed to" wants the whole list of
what this application can do with their records; the on/off badge carries which
are happening now, and only active ones count toward the gap total.


## People, rather than Google (later tranche)

### What was measured

```
purposes recorded  : identity, backup, documents, mail, escrow, assistant
any about a person : NO
```

All six purposes were about the household's own data going to Google. None was
about a person whose data the household *holds* — a member of staff, a child.
Those records were created by an adult, and nothing anywhere asked, recorded
that nobody had asked, or made the absence visible.

### The distinction that made this more than adding two rows

A local-only purpose returns **true** from `hasConsent` with no record at all,
and that is correct for the reason the code gives: nothing leaves the device,
so there is no third party for anybody to have agreed with.

That reasoning fails completely when the third party is a **person**. Nothing
leaves the device and there is still somebody whose records these are, who
either was told or was not. Reading "granted" off an empty log there would
manufacture a consent record for a conversation that never happened — the exact
failure the top of `js/data/consent.js` exists to name.

So `aboutAPerson` marks the two new purposes, and `hasConsent` short-circuits
only for local purposes that are *not* about a person. A mutation restoring the
old line fails four tests.

The same distinction was wrong in two more places, and both were found by
following it rather than by a test failing:

- **`gaps`** excluded every local-only purpose, which would have made the one
  gap this pair exists to surface permanently invisible.
- **`report`** read per-subject purposes off `state.mailboxes`, which would
  have listed every staff consent as belonging to a Gmail account.

### Who is owed one, derived and not listed

Everyone on the staff list, and every person whose role is `child`. Derived
from the records themselves, because a stored flag starts disagreeing with the
records it describes the first time somebody adds a staff member without
ticking it.

A household with neither is asked nothing. An empty list produces no rows,
rather than a purpose nobody owes.

### What this is not

**It gates nothing**, and the module has always said so. A staff record is
writable with no consent recorded, and a test asserts exactly that — this is
the moment somebody would assume otherwise.

**It is not verifiable parental consent.** An adult records a decision about a
child's records and the record says which adult and when. Nothing verifies that
adult is the parent or guardian, and this application has no means to. The
DPDP control therefore moves to `IMPLEMENTED` and **not** `TESTED`, with that
sentence on the control itself.

**The staff member cannot see it.** The record says the household asked, on the
household's word alone. `STAFF/staff-access` — a role and an access path for
the person the records are about — remains `NOT_STARTED`, and this work does
not pretend to have touched it.

**9 of 9 mutations caught**, including *local-only making a person purpose
agreed*, *a record naming nobody*, *person purposes excluded from the gap
count*, *read off mailboxes instead of people*, *children or staff left out of
who is owed one*, and *the screen never passing anybody*.
