# A Schema With Nowhere To Put A Secret

Phase 6, second tranche. `smsMessage` in `js/data/schema.js`,
`MessagesService.ingest`, changes to `js/modules/statements.js`. Tested in
`tests/services.test.mjs` and the browser suite.

## What could not be done without storing anything

`docs/SMS_INTELLIGENCE.md` built the reader and the reconciler and kept
nothing. That made **rule 52** — *multiple sources describing one event are
linked, not duplicated* — unachievable by construction. There was no second
source to link to, only a reading that vanished when the screen closed.

A stored message is the **evidence** behind a link. A household asking why a
transaction is dated the 15th when the statement says the 16th can be shown the
alert that arrived on the 15th. Nothing else in this application can answer
that.

## Rule 53, enforced by shape rather than by care

> OTP and security SMS are not retained unnecessarily or sent to AI.

Three things stand between a one-time code and the database, and only the first
is a check anybody has to remember:

1. `domain/sms.js` classifies the message **before reading any field**, so a
   credential yields no text, no amount and no reference.
2. `MessagesService.ingest` returns before the repository is reached.
3. **`smsMessage` has no field a code could live in.** No `otp`, no `code`, no
   `pin`, no `secret`. A test asserts their absence.

The third is the one that matters. There is no redacted-but-stored middle
ground to get wrong, because there is nowhere to put one — and a schema with
nowhere to keep a secret cannot be talked into keeping it later.

The test for this walks **every store in the database** — all
forty<!--live:entities--> entities plus the seven the application owns
for itself, forty-seven<!--live:stores--> in all — and fails if the six digits
appear anywhere at all. Asserting against the one table it was most likely to
land in would have been the weaker claim.

That sentence was not true when it was written. The walk named audit, outbox,
search and meta, and the database also has `shadow`, `conflicts` and `blobs` —
`shadow` being where the last server-agreed copy of a record with unpushed
edits is kept, which is precisely where a redacted-but-retained value would
have survived unnoticed. Planting the code in `shadow` and re-running proved
it: the old test passed, the widened one fails. Nothing was leaking there, so
this was a gap in the proof rather than a leak in the application — but the
document had been claiming the stronger thing for as long as the gap existed.
The list is now `Object.keys(systemStores)`, so a store added later is covered
without anybody remembering to add it.

## What it stores, and what it refuses to write over

A message is written with `transaction` pointing at the row it matched — the
link, not a copy — and the reconciler's verdict beside it:

| Reconciliation | Stored as |
| --- | --- |
| Same money, same account, same day | `linked`, with the row's id |
| Same event, different amount | `conflict`, with **both figures left alone** |
| Nothing matches | `none`, with no row invented |

The conflict case is the one worth naming. The statement figure is never copied
over the message's and the message's is never copied over the statement's — the
same refusal `domain/explain.js` makes about a movement's legs and
`domain/kycconflict.js` makes about a bank's copy of a date of birth.

An unmatched message is still kept. It is evidence of something no imported
statement covers, which is worth knowing rather than discarding.

**`authoritative` is not a field.** It would be a constant `false`, and a stored
constant is one edit from being wrong. `SOURCE_PRIORITY` says where a message
ranks — below every statement, above only an AI inference — and the reconciler
reads that rather than a column. That is rule 51.

## The same message twice

A resend carries a second timestamp and the same fingerprint, so the existing
record is returned rather than a second one written. Two rows for one alert
would make the evidence look like two events — the failure rule 52 exists to
prevent, arriving by a different door.

## A sentence that stopped being true

The Import screen said:

> A message is a notification about a transaction, not the transaction. **Nothing
> here is recorded from it.**

That was accurate when written and false the moment `ingest` replaced
`readAndReconcile`. It now reads:

> …It is kept as evidence and linked to the statement row it matches; it never
> becomes a transaction of its own.

A browser check asserts the new half. A sentence that was true when written is
the easiest kind to leave standing after it stops being so, and this repository
has now caught itself doing it in a screen as well as in a roadmap.

## What the browser found that no unit test could

**`receivedAt` is required, and a pasted message has none.**

Every Node fixture here supplied one, so the missing required field never
appeared until a person typed into the real box — and then it threw on save,
four times, in the console-error checks. The blind spot was in the fixtures, not
the code: a message pasted by hand genuinely does not carry an arrival time.

The day it was **brought in** is recorded, rather than the day it was sent being
invented. `transactionDate` — the date printed inside the message — is stored
separately and is the one that means anything.

## The second unreachable guard in two tranches

Five mutations; one survived. `transaction: result.agreement === NONE ?
undefined : result.transaction?.id` could not fail, because the reconciler
already returns a null transaction in that case.

That is the same finding as `docs/SEALED_VALUES.md`'s survivor, one tranche
apart, and the pattern is mine rather than the code's: I write a belt-and-braces
condition beside a guarantee that already holds. Both were deleted rather than
tested. A check that cannot fail is worse than no check, because the next reader
trusts it.

The four caught: storing a credential redacted, dropping the deduplication,
recording a conflict as a link, and losing the message text on the way in.

## The four entities the prompt names

`SMSMessage` exists now. The other three are mapped rather than built, and that
is a decision rather than an omission:

- **`SMSEvent`** — an economic event derived from a message is an
  `economicEvent`. A second event entity keyed to one source would put the same
  movement in two tables, which is the duplication rule 52 forbids.
- **`SMSProcessingRecord`** — every write already produces an audit entry in the
  same transaction as the change, and `data/lineage.js` walks the chain. A
  parallel processing log would be a second, weaker copy of it.
- **`SMSSource`** — the connector's status vocabulary exists in `domain/sms.js`
  and `nativeStatus()` returns `NOT_SUPPORTED`. A stored connector row would
  record a connection that cannot exist in a browser.

If a native Android companion is ever built, `SMSSource` becomes a real record
and this paragraph becomes wrong. It says so here so that it is checked rather
than assumed.

## What is still not built

No screen listing the kept messages, so the link is stored and not yet shown —
which is the *"what could not be done without storing anything"* problem in its
next form. The Gmail↔SMS three-way link is untouched. `explainability()` from
`docs/EXPLAINABILITY.md` remains headless.
