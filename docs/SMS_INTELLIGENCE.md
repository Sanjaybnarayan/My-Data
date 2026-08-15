# SMS Intelligence — Phase 6, not started

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

## What exists today

Nothing. The only occurrence of "sms" in the codebase is a categoriser rule
matching *"sms charges"* on a bank statement — a fee, not a message.

There is no SMS entity, no `SMSMessage`, `SMSEvent`, `SMSSource` or
`SMSProcessingRecord`, no permission handling, no OTP classification, and no
abstraction behind which any of it could later sit.

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

## Still not done

**All of it.** This document is a record that the phase exists, not a claim that
any part of it has begun.
