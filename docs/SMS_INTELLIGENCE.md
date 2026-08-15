# SMS Intelligence — Phase 6

One of the eight documents the master prompt requires from Phase 0. It did not
exist, and neither does the phase it describes.

## Why this document exists before the code

Phase 6 was **skipped without record**. Every phase number in
`docs/IMPLEMENTATION_ROADMAP.md` from 6 onward was shifted by one as a result,
so what was built as "Phase 6" was the prompt's Phase 7, and SMS never appeared
in any plan, any status table, or any "still not done" list.

A missing row is worse than a stale one. A stale row wastes a measurement; a
missing row deletes a phase and nothing notices.

This file exists so that cannot happen again, and it states plainly: **nothing
here is built.**

## What the prompt asks for

A pipeline of fifteen stages from `SMS RECEIVED` to `AUDIT`, twenty-four message
categories, an extraction contract of twenty fields, three storage modes,
real-time processing with idempotency, cross-account reconciliation, and a
conflict engine.

Seven of the fifty-seven non-negotiable rules — **51 to 57** — exist solely to
constrain it:

| Rule | What it requires |
| --- | --- |
| 51 | SMS is never an authoritative financial record without reconciliation |
| 52 | Multiple sources describing one event are **linked, not duplicated** |
| 53 | OTP and security SMS are not retained unnecessarily or sent to AI |
| 54 | Permissions are never requested without checking current platform policy |
| 55 | If Android SMS access is not policy-eligible, build the abstraction and alternative ingestion instead |
| 56 | An SMS parse is never treated as accurate without source confirmation |
| 57 | Every financial event must be explainable |

## What existed when this was written

Nothing. The only occurrence of "sms" in the codebase was a categoriser rule
matching *"sms charges"* on a bank statement — a fee, not a message.

There was no SMS entity, no `SMSMessage`, `SMSEvent`, `SMSSource` or
`SMSProcessingRecord`, no permission handling, no OTP classification, and no
abstraction behind which any of it could later sit.

The section *"What is built now"* below is the part that has since changed.
**`SMSMessage` and the other three entities are still not stored** — the reader
and the reconciler are pure, and nothing is persisted yet.

## What can honestly be built here, and what cannot

**This is a PWA, and the prompt says so itself**: *"SMS is an OPTIONAL
Android-native capability. The PWA must NOT depend on direct SMS access."*

A browser cannot read an SMS inbox. So the deliverable for Phase 6 in this
repository is **rule 55**, explicitly: the abstraction and the alternative
ingestion paths, with the native capability behind an interface that reports
`NOT_SUPPORTED` rather than pretending.

That is a real piece of work and it is not a small one:

- an `SMSSource` connector with the prompt's status vocabulary;
- the message → economic-event pipeline, testable against pasted or imported
  message text without any device permission;
- the extraction contract, refusing invented values the way `domain/extract.js`
  already refuses them;
- OTP detection classified `AUTHENTICATION_SECRET` and excluded from AI and
  notifications, which is rule 53 and is the part where being wrong matters
  most;
- the conflict engine, which is `domain/events.js`'s problem shape again —
  ₹5,000 against ₹5,500 is a question, never a silent choice.

## What is built now

`js/domain/sms.js`, tested in `tests/sms.test.mjs`. The reading half of the
phase, on message **text** from wherever it came — which is rule 55's
"abstraction and alternative ingestion", not a device integration.

### The security gate runs first, and that ordering is the protection

A bank's OTP message looks exactly like its debit message: same sender, same
shape, and often **the same amount inside it**. So `isAuthenticationSecret`
runs before any field is read, and a message it claims yields *nothing* — no
text, no amount, no reference, not even the fields that would be harmless.

The cheapest way never to store a one-time code is never to parse the message
holding one. A gate that runs after extraction has already copied the code into
a field.

The vocabulary is deliberately wide — *do not share*, *CVV*, *UPI PIN*,
*verification code* — because the two errors are not comparable. A false
positive drops a notification nobody needed. A false negative copies somebody's
credential into a database and possibly into a model.

### Rule 51, on every reading

Every reading carries `authoritative: false`, and `SOURCE_PRIORITY` puts SMS
below every statement and above only an AI inference. An SMS is a notification
*about* a transaction, never the transaction.

### The four tests that could not run before

| Prompt test | Now |
| --- | --- |
| the same SMS twice → one event | `dedupe`, fingerprinted over what a resend cannot change — deliberately **not** the arrival time |
| SMS + statement → one transaction, multiple evidence | `reconcileWithStatement` returns `LINKED` with `evidence: ['sms', 'bank-statement']` |
| SMS ₹5,000 vs statement ₹5,500 → CONFLICT | both figures and the difference, and *"nothing here changes a figure on its own"* |
| SMS + statement + Gmail receipt → one event | **partly**: the SMS-to-statement link exists; joining the Gmail receipt to the same event is not built |

**The amount is compared after the link is made, never used to make it.** That
is the subtle half: if differing amounts stopped two records matching, a
conflict could never be found at all — the disagreement would look like two
separate events.

### The native capability says what it is

`nativeStatus()` returns `NOT_SUPPORTED` with a reason and the alternatives that
do work. The same refusal `docs/KYC.md` makes about CKYCRR, for the same reason:
a connector with no authorised access reports its state and does nothing else.

**12 of 12 mutations caught**, including *the security gate running after
extraction*, *an OTP reading keeping its text*, *a disagreement silently taking
the statement figure*, and *the native connector claiming to work*.

A vacuous test of mine was caught by the type checker rather than by me: it
asserted `nativeStatus()` is not `CONNECTED`, which returns a literal and so
could never fail.

## On the screen, in the same tranche

Recorded as a gap and closed rather than left. The Import screen — where
ingestion already lives — takes a pasted message, says what it read, and says
whether an imported statement agrees.

It carries the refusals, not just the reading:

- **rule 51 on the page**, not only in the data: *"a message is a notification
  about a transaction, not the transaction. Nothing here is recorded from it."*
- **a credential is refused and the box is cleared**, so the code does not sit
  on screen after the message is rejected.

**Six browser checks**, and the wiring mutated. Removing the screen's refusal
fails two of them — but **not** the check that the OTP's amount never appears,
because `domain/sms.js` had already declined to parse it. Two independent
layers, and the checks tell them apart: the domain refuses to read a credential,
the screen refuses to display one, and neither depends on the other being right.

### The ratchet caught this change

The first version read transactions straight from the screen and took the
forbidden-edge count from **61 to 62**. The budget may only fall, so the read
moved into `services/sms.js` instead — where it belonged anyway, since
reconciling a message against every transaction is exactly the cross-entity
question that layer exists for. A credential never reaches the database call at
all: not because a query would leak it, but because there is no reason to run
one, and the shortest path a secret can travel is the safest.
- **No entities.** `SMSMessage`, `SMSEvent`, `SMSSource` and
  `SMSProcessingRecord` are in the prompt's list and not in the schema, so
  nothing is stored and the three storage modes do not exist.
- **No three-way link.** SMS to statement is done; adding the Gmail receipt to
  the same economic event is not.
- **No real-time processing**, no `last_processed_message`, no idempotent
  incremental run — all of which need somewhere to store state.
- **No Android companion**, and the policy check rule 54 requires has not been
  done, because there is nothing yet to request a permission for.
