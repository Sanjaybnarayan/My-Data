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

## What is still not done in Phase 4

- **No multi-account backend.** Several mailboxes work; the sync backend is
  still one Apps Script deployment for one account.
- **Incremental scanning is date-based, not `historyId`-based.** The window
  advances to the newest receipt found, which is honest and readable — the
  whole privacy argument rests on the query being something a household can
  read — but it re-reads a day it has already seen.
- **Drive and Calendar have no health of their own.** The model is general;
  only Gmail scanning is wired to it so far.

**15 of 15 mutations caught**, including *a 401 treated as an ordinary error*,
*one failure condemning a mailbox*, *a success not clearing an expired grant*,
*the message stored unredacted*, *the vocabulary duplicated instead of shared*,
and *the screen never recording or persisting the outcome* — the last of which
survived until the two call sites became one.
