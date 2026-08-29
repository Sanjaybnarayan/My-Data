# An SOS With No Button

`js/modules/safety.js`, `docs/LOCATION.md`,
`docs/FAMILY_OS_MASTER_ARCHITECTURE.md`, `docs/PHASE_STATUS.md`,
`tools/architecture.mjs`, `tests/architecture.test.mjs`.

## The rule this breaks

v8.0: **do not claim a feature works if the backend does not actually support
it.** Here it is the *front* that does not support it, which is worse — the
claim sits on the side a household reads.

## What was found

Phase 15 is called "Location, safe zones and SOS". The SOS half is written:

- `SafetyService.raise` — records the alert, attaches a fresh position, returns
  the composed message and why there is no map link if there is not;
- `domain/safety.js#sosMessage` — composes it;
- a `sosAlert` entity in the schema, `encrypted: true`;
- five `sos.*` locale strings;
- tests over all of it.

**Nothing calls any of it.** Measured:

```
grep -rn '\.raise('   js/    → 0 hits
grep -rn "t('sos\."   js/    → 5 hits, all inside js/domain/safety.js
```

There is no SOS button on the safety screen, and no other screen imports
`SafetyService` at all. A household cannot raise an alarm from this
application.

Four documents said otherwise, in the present tense:

| Where | What it said |
| --- | --- |
| `js/modules/safety.js`, first paragraph | "Where the household was, the zones those readings are measured against, and **a way to raise an alarm**" |
| `docs/FAMILY_OS_MASTER_ARCHITECTURE.md` | "what Phase 15 built is what a foreground application honestly can: … and **an SOS that composes a message for a person to send**" |
| `docs/LOCATION.md` | "**An SOS composes a message and records that it was raised**; a person sends it from their own phone" |
| `docs/PHASE_STATUS.md` | Phase 15 · "Location / safe zones / SOS" · **MOSTLY_COMPLETE** · 70, with a gaps column naming background location and geofencing and **not this** |

The module's own header is the one that matters most. It is the file a person
opens to find the SOS, and it told them the screen has one.

## The second finding, in the checker

`tools/architecture.mjs` already has a probe for exactly this shape. Its
comment: *"the engine exists and no screen calls it is the finding this
codebase has made more often than any other"*, and `wired:<path>#<term>`
exists to catch it.

Every use of it in the component table pointed at the **engine**:

```
| Household staff | exists | wired:js/services/records.js#documentsForStaff |
| Chat            | exists | wired:js/services/chat.js#send                 |
| Safety          | exists | wired:js/services/safety.js#whereEveryone      |
```

`js/services/chat.js` defines `send`. `js/services/safety.js` defines
`whereEveryone`. **Those three probes cannot fail** — a check that cannot fail
is worse than no check, because it occupies the place where a real one would
go. They now point at `js/modules/chat.js`, `js/modules/family.js` and
`js/modules/safety.js`, which is what the probe was built to assert.

## What changed

**The claims are corrected.** All four documents now say there is no SOS, and
say it where the old sentence was rather than in a footnote. Phase 15 drops
from MOSTLY_COMPLETE / 70 to PARTIALLY_COMPLETE / 62, with the missing entry
point listed first in its gaps.

**A new probe direction, `unwired:<path>#<term>`.** The honest row —
*"built and nothing calls it"* — is a claim like any other and goes stale in
the opposite direction: somebody wires the engine and the sentence saying
nothing does survives. `absent:` cannot catch that, because it asks whether a
term appears anywhere in `js/` and the engine's own file always mentions it.
`unwired:` asks one file, the screen, and fails the moment the wiring appears:

```
| An SOS a household can raise | built and unreachable — no screen calls it | unwired:js/modules/safety.js#raise |
```

**Both directions now read code rather than prose.** The first version of the
probe fired on the very comment that was wrong — `js/modules/safety.js` said
"a way to raise an alarm", and `\braise\b` matched it. Both `wired:` and
`unwired:` now strip comments through `tools/field-coverage.mjs#withoutComments`.
That closes a hole in `wired:` too, which was already shipping: a row could
claim a screen calls something on the strength of a comment saying it should.

## How it is checked

Four cases in `tests/architecture.test.mjs`, mutation-tested:

```
M1  unwired never notices the wiring   FAIL  fails once the screen does call the thing
M2  unwired always fails               FAIL  fails once the screen does call the thing
                                       FAIL  reads code, not the prose beside it
M3  stop stripping comments            FAIL  reads code, not the prose beside it
                                       FAIL  a wired probe is not satisfied by a comment either
```

M1 and M2 fail different sets, which is the point of having both: a probe
stuck on "pass" and a probe stuck on "fail" are different defects and a single
test would catch only one.

## What this does not do

**It does not build the SOS.** Whether this application should have a button
labelled SOS is a decision about a life-safety affordance, and it is not
obviously yes: there is no server, no gateway and no push, so the button would
compose a message and hand it to the phone's own share sheet for a person to
send. `sentVia` would record what they say they did, defaulting to `not sent`.
That may well be the right design — it is the one the code was written for —
but shipping it is the household's call, not a loose end to tidy while
correcting a sentence.

**It does not establish that anyone was misled.** The SOS was never on a
screen, so no household tried to use one and found it missing. What was wrong
was the record of what exists, and the record is what the next person plans
from.
