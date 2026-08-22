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

This file exists so that cannot happen again. It said **nothing here is built**,
and each section below records what changed and when — including the parts that
are still not built.

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

The section *"What is built now"* below is the part that has since changed, and
it changed twice: the reader and reconciler came first, and `smsMessage` is now
stored and linked to the row it matches (`docs/SMS_STORAGE.md`). The other three
entities are mapped rather than built, for reasons that document sets out.

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

`nativeStatus(device)` answers from what is actually present. A browser and the
iOS shell get `NOT_SUPPORTED` and always will — iOS has no inbox API for a
third-party app. The Android companion build gets `AUTH_REQUIRED` until the
permission is granted and `CONNECTED` after, because "can read" and "is allowed
to read" are different facts and a screen has to tell them apart.

Called with nothing, it returns `NOT_SUPPORTED`. The unsafe direction is the one
you have to ask for.

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
- **No three storage modes.** One is built — the encrypted `smsMessage` row.
- **No real-time processing.** The inbox is swept when somebody asks; nothing
  wakes on an arriving message, and `RECEIVE_SMS` is deliberately absent.

## Reading the inbox, on the Android build

The gap was never the reading. `domain/sms.js` could read a bank alert from the
day it was written; what did not exist was anything to hand it one. Every alert
had to be pasted, one at a time.

`js/core/smsinbox.js` and `SmsInboxPlugin.java` close that. The plugin reads
`content://sms/inbox` and nothing else — not sent messages, not drafts, no
writes, no marking, no deleting — and this application is not and does not
become an SMS handler.

### Rule 54, done rather than deferred

The policy check the rule requires, with what it found:

`READ_SMS` is a Play **restricted permission**. An app may hold it only as the
user's default SMS handler, or under an approved Restricted Permission
Declaration for a listed use case. FamilyOS is not a default SMS handler and
does not want to be. A finance app reading bank alerts has appeared as a
declarable use case, but declarations are reviewed case by case and are
routinely refused for apps in exactly this position.

The authoritative policy page could not be fetched from the build environment,
so this is drawn from secondary sources and is stated as such rather than
presented as a reading of the policy itself. **Anyone preparing a Play listing
must check it directly.**

So the conclusion, which is written at the permission in `AndroidManifest.xml`
as well as here: **with `READ_SMS` present, this build is for sideloading** —
which is what the CI debug APK is and how this household installs it. If a Play
listing is ever wanted and the declaration is refused, the answer is to remove
the permission and keep the share/paste path, not to argue.

`RECEIVE_SMS` is not requested. It would wake the app on every arriving message,
which is interception rather than something a person asked for, and nothing here
needs it. `tests/native.test.mjs` fails if either that or `SEND_SMS` is ever
added, and fails if the manifest comment stops carrying the distribution
warning.

### A one-time code does cross the bridge

Stated plainly rather than implied. The inbox is read whole — the provider has
no "financial messages only" filter — so every OTP the household has received
passes through this code in memory. It is then classified by `domain/sms.js` and
dropped: never written, never sent, never shown to a model.

Filtering in Java instead was considered and rejected. It would mean a second
copy of the patterns rule 53 depends on, in the language with no tests over it,
deciding whether somebody's one-time code got read. One tested copy is safer
than two where the untested one goes first.

`tests/smsinbox.test.mjs` asserts this the only way worth asserting it: a sweep
containing an OTP, then a walk of **every store the database has**, failing if
the code or its text appears anywhere.

### The watermark, and which way it fails

A sweep asks only for what arrived after the newest message already handled, so
an inbox holding years of messages is not re-read on every visit.

It moves forward only past messages that actually landed. A refused or failed
read leaves it alone, and a sweep that stops half way leaves it on the last real
message. The next sweep then repeats a few, and the fingerprint makes repeats
free. The other way round loses messages silently — and silence is the outcome
this whole phase exists to avoid.

### Every count is reported, including the discarded ones

Rule 57 is usually read as "explain what you kept". The inverse matters as much:
somebody told *"7 messages"* out of twelve needs to know what happened to the
other five, or the number reads as data quietly going missing. So a sweep
reports read, kept, already recorded, and **how many carried a one-time code and
were discarded unread**.

### What this does not change

Rule 51 does not relax because capture got easier. A message read off the device
is still `authoritative: false`, still below every statement in
`SOURCE_PRIORITY`, and still reconciled rather than believed. The word
*connected* on the screen is followed by what it means — read when you ask,
nothing in the background, still checked against a statement.

**10 of 10 mutations caught**, including *the security gate removed from
ingestion*, *the watermark advancing past a refused read*, *`DENIED` collapsing
into a generic failure*, *a bad timestamp becoming 1970*, and *the connector
claiming `CONNECTED` on a device with no plugin*.

### What is still not built

- **The native half has never run on a device.** It compiles — the CI `apk` job
  proves that much — and every JavaScript path is tested against a fake plugin.
  Nothing here has read a real inbox, and this document does not claim it has.
- **No `SMSEvent`, `SMSSource` or `SMSProcessingRecord` entities.** The
  watermark is a `meta` key, not a processing record.
- **iOS gets nothing**, permanently. There is no third-party inbox API.
