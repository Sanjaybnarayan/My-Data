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
