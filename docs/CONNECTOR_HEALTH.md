# Connector health

## What was measured first

```
grant revoked (no token)   status=401 retryable=false :: not signed in to this mailbox
token rejected by Gmail    status=401 retryable=false :: Gmail refused the request (401)
rate limited               status=429 retryable=true  :: Gmail refused the request (429)

is any of this recorded? connectors never call diagnostics: NO
```

The clients already told the failures apart correctly — that was never the gap.
What was missing is that **nothing remembered**. A scan that failed because
Google had withdrawn the grant produced a toast, and the moment somebody
dismissed it the mailbox looked exactly like one nobody had scanned yet.

So "no receipts have appeared this month" had no answer. It could mean nothing
was bought, or that a mailbox had been dead since the day somebody changed
their password, and the application could not tell a household which.

## One vocabulary, moved rather than copied

`CONNECTOR_STATUS` was written for Phase 6 and lived in `js/domain/sms.js`,
where only SMS could reach it. Phase 4 needed the same words for Gmail, so it
moved to `js/domain/connector.js` and `sms.js` re-exports it.

A second copy would have drifted, and the day the two disagreed about what
`EXPIRED` meant nobody would have known which screen was right. A test asserts
they are the same object, not merely equal.

## The distinction that matters

**`EXPIRED` is not `ERROR`.**

A revoked or expired grant needs a person to sign in again and will never fix
itself. A 500 or a rate limit will. Filing both as "something went wrong"
leaves somebody waiting for a connector that is never coming back.

So:

| Situation | Status | Why |
| --- | --- | --- |
| never scanned | `NOT_CONNECTED` | not broken — nobody has tried |
| last scan worked | `SYNCED` | |
| one retryable failure | `CONNECTED` | a bad minute is not a broken mailbox |
| two or more in a row | `ERROR` | now it is a pattern |
| any 401 or 403 | `EXPIRED` | immediately, and it does not age out |

A 401 is `EXPIRED` on the first one, not after patience runs out, because
waiting does not fix a revoked grant. And it never softens with time: a test
takes a 401 from 2020 and requires it still to read `EXPIRED`.

**The status comes from the code, never the message.** A message is prose and
gets reworded; if the wording decided the state, a copy edit would change what
the application believes. A test asserts two identical failures with completely
different messages produce the same status.

## A success clears everything

Including an expired grant — because signing in again is exactly how somebody
fixes this, and a screen that did not notice would have them fix it and then
tell them it was still broken.

## Nothing is stored as it arrived

Connector health lives in `meta`, which is not encrypted, and a connector error
can carry an address or a query. Every message goes through `redact()` from
`js/data/diagnostics.js` first, for the same reason it exists there: a mailbox
error quietly accumulating somebody's email address would be a leak with a
helpful face.

## Where it lives, and why not inside the mailbox

Beside the mailboxes, under its own `meta` key. `readMailbox` rebuilds a stored
entry from a fixed shape and deliberately drops anything it does not recognise
— so health living *inside* a mailbox would be thrown away on the next read.

## Failures are recorded as well as remembered

`KIND.connector` in the diagnostics store, its own kind rather than folded into
`sync`: they fail for different reasons and are fixed by different people. A
failing sync is usually the backend; a failing connector is usually an
authorisation the household has to renew.

## One call site, and why that is the design

`afterScan(health, id, error)` records both outcomes through one function.

The first version had `noteSuccess` on one branch and `noteFailure` on the
other, and mutation testing found the consequence: **the success call could be
deleted and nothing noticed.** A browser check can drive a *failing* scan —
attach a Google mailbox with nothing signed in and the client raises a 401 —
but it cannot drive a succeeding one, because succeeding needs a real Google
token this repository does not have.

Two call sites, one of them untestable. One call site cannot be half-removed,
and removing it fails three browser checks.

## Drive and Calendar, and one recorder for all three

### What was measured

```
Gmail scan (receipts)    health: yes | diagnostics: yes
Drive (documents)        health: NO  | diagnostics: NO
Calendar                 health: NO  | diagnostics: NO
```

A Drive upload or a calendar push whose authorisation had gone produced a toast
and nothing else — exactly the state Gmail was in before this model existed.

### One function, not three copies

The Gmail scan did four steps inline: load the health, decide the outcome,
persist it, write the diagnostic. Adding Drive and Calendar would have made
three copies of those four steps.

The last time this repository had *two* copies of one decision — `noteSuccess`
on one branch and `noteFailure` on another — mutation testing found that one of
them could be deleted with nothing noticing. Three copies is that problem with
more places to hide. So `js/data/connectors.js` has `attempted(db, id, {error,
where})`, and all three call it.

`js/domain/connector.js` still decides what a state *means* and still touches
no database, which is what keeps it testable without one.

### Once per run, not once per file

A Drive flush records one outcome for the whole flush. Five documents failing
because one grant expired is one problem, and counting it five times would make
a single revoked authorisation look like a crisis.

**A flush with nothing to upload records nothing at all.** It is not a success
and not a failure — it says nothing about the connector, and recording it as a
success would clear a genuinely expired grant the next time somebody opened the
application. A test asserts exactly that.

### Where a household sees it

Gmail says so on the Shops screen, which is where somebody is already looking
for receipts. Drive and Calendar have no screen of their own, so Settings grows
a **Connections that need you** card.

It is **absent when everything works.** A card that is permanently present and
permanently green is a card people stop reading, and the one time it turns red
they will not notice.

### A dead export, found and given a caller

`needingAttention` was written, exported and tested in the previous tranche —
and had **no production caller**. Tested dead code is still dead code, and it
is the same fault as building an encryption layer no screen can reach. The
Connections card is its caller; had there been no honest one, the right move
was to delete it.

## What is still not done in Phase 4

- **No multi-account backend.** Several mailboxes work; the sync backend is
  still one Apps Script deployment for one account.
- **Incremental scanning is date-based, not `historyId`-based.** The window
  advances to the newest receipt found, which is honest and readable — the
  whole privacy argument rests on the query being something a household can
  read — but it re-reads a day it has already seen.
- **The sync engine still has no health of its own.** It records diagnostics
  and holds `lastError`, but it is not in this model, so a backend that has
  been refusing for a week does not appear on the Connections card.

**8 of 8 mutations caught**, including *health never persisted*, *a success
recorded as a failure*, *Drive reporting per file rather than per run*, *an
empty flush clearing an expired grant*, and *Calendar never reporting at all* —
the last of which needed a browser check, because its call site is a screen.

**15 of 15 mutations caught**, including *a 401 treated as an ordinary error*,
*one failure condemning a mailbox*, *a success not clearing an expired grant*,
*the message stored unredacted*, *the vocabulary duplicated instead of shared*,
and *the screen never recording or persisting the outcome* — the last of which
survived until the two call sites became one.
