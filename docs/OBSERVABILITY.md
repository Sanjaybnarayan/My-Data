# Observability

The document `docs/COMPLIANCE/SOC2.md` recorded as missing, written because the
thing it describes now exists.

## What was measured first

```
a write failed         : true
is it recorded anywhere: false
```

A refused write threw, a screen showed a message, and the moment somebody
dismissed it the fact that anything had gone wrong was gone. Nothing counted
failures, nothing noticed a sync that had been failing for a week, and the
audit trail — which records *changes* — had nothing to say about faults.

## Two words this is not

**Not telemetry.** Nothing here leaves the device. There is no reporter, no
endpoint, no sampling, no "anonymous usage data" and no plan for any. An
application whose premise is *encrypted, on this device* does not get to ship
an exception to that premise and call it observability.

**Not monitoring.** SOC 2's CC7 assumes somebody is watching: an operator, a
pager, a rotation. There is no operator here. The household is the only party
who can see this, and only when they open Settings. Nothing alerts, nothing
escalates, and nothing aggregates across devices — a phone whose sync has been
failing for a week is invisible to the laptop.

The card says both of those in as many words, because a screen headed with
problems invites the assumption that somebody is watching them.

## What it is

A bounded, redacted, local record of things that went wrong, so a household can
answer the question nothing could answer before: **has this been happening?**

A single failed sync is a bad minute. The same failure every day for a week is
something a household should be told, and until this existed the two were
indistinguishable the moment somebody reloaded — `lastError` holds the most
recent one and is overwritten by the next.

| Kind | What it means |
| --- | --- |
| `error` | a write, read or parse that threw |
| `refusal` | a rule said no — not a fault, but a run of them means somebody is fighting the application |
| `sync` | a sync attempt that did not complete |
| `storage` | the device is running out of room |

`error` and `refusal` are kept apart deliberately. A run of refusals means a
form will not accept what somebody is trying to record; a run of errors means
the application is broken. Filing both as "error" would hide the first and
overstate the second.

## Redaction is the whole safety argument

An error log is the classic accidental leak. Messages and stack traces carry
the values that caused them — amounts, names, account numbers — the very fields
encrypted everywhere else in this database. A diagnostics store quietly
accumulating those would be a plaintext copy of the household's records wearing
a different hat.

So nothing is recorded raw, and `redact()` works by **removing anything that
looks like a value** rather than by recognising the sensitive ones. That is the
safe direction: a pattern nobody thought of becomes unreadable rather than
retained.

Removed: figures, amounts however written, emails and UPI handles, anything in
quotes, long opaque strings, and the unique half of a record id — `per_«id»`
keeps the type and loses the person.

Kept: `where`, `code` and `entity`, which are written by this codebase and not
derived from anybody's data, and small numbers, because *"2 of 5 failed"* is
diagnosis and not data.

`tests/diagnostics.test.mjs` proves it the only way worth proving it: real
failures driven through the real repository, then a walk of the store, failing
if any value from the record that caused them appears.

## Two bugs this work found in the tooling

**A ratchet failing open.** `tools/field-coverage.mjs` strips comments with a
scanner that tracks quotes and knew nothing about regex literals. `/'[^']*'/`
holds three apostrophes; the scanner took the third as opening a string and
stopped stripping comments for the rest of the file. Prose then counted as
code, and `healthRecord.diagnosis` was reported as read because this module's
comments happened to contain the word.

That is a ratchet failing in the worst direction — silently passing. The
scanner now understands regex literals, the unread list is unchanged at 83, and
four tests cover it, including that division is still division.

**A check that could not fail.** The first browser check asserted that nothing
sensitive appeared on the diagnostics card — but the card rendered only the
kind and the code, never a message, so turning redaction off entirely changed
nothing on screen. The card now shows the redacted message, which is both more
useful and makes the check able to fail. It does: with redaction removed, it
does.

## What it costs

One system store, bounded at 200 events, dropped oldest-first. It does not
sync, is not an entity, and is not encrypted — because it must not contain
anything worth encrypting, which is a property the tests enforce rather than a
hope.

Recording never throws. A diagnostics write that broke the operation it was
describing would turn one failure into two, and the second would be this
module's fault.

## Status

`SOC2/cc7-monitoring` moves from `NOT_STARTED` to **`TESTED`**, with the gap
recorded on the control: there is no operator, no alerting, and no view across
devices, and the SOC 2 regime already carries `applies: NOT_TO_THIS` because
there is no service organisation for an auditor to opine on.

It is **not** `VERIFIED`. No control in this repository is.

**14 of 14 mutations caught**, including *redaction off entirely*, *numbers
kept*, *ids kept whole*, *the message stored unredacted*, *a refused write
swallowed rather than rethrown*, *refusals and errors not told apart*, and *a
failed sync not recorded* — the last two of which survived the first round and
each named a wire nothing was testing.
