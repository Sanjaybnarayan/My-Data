# Location, safe zones and SOS

Phase 15. Read the limits first, because they are most of the design.

## What this does not do

**There is no background tracking.** A position is read only while somebody has
the application open and asks for one. A web page and a Capacitor WebView with
no foreground service are both suspended when the screen goes off, and a
suspended page reports nothing. Nothing is recorded while a phone is in a
pocket.

**There is no OS geofencing.** A real geofence is registered with the platform
and wakes the app when it is crossed. What this has instead is arithmetic:
`js/domain/geo.js` compares a position the app already holds against circles it
knows about. Same comparison, none of the wake-ups. **Crossing a zone while the
app is closed produces nothing at all** — no alert, no record, and no later
catch-up.

**Nothing sends an SOS.** There is no server in this application, no SMS
gateway and no push. An SOS composes a message and records that it was raised;
a person sends it from their own phone. `sentVia` records what they say they
did, and its default is `not sent`.

What a background implementation would need, stated so nobody has to discover
it: `@capacitor/geolocation`, a foreground-service notification, and on Android
10+ a separate `ACCESS_BACKGROUND_LOCATION` grant with a Play policy
declaration attached to it. None of that is in this repository.

## The rule the geometry exists for

A position has an accuracy and a zone has a radius, and comparing the two is
the whole job.

A fix reported as accurate "to within 2,000 metres" cannot say whether somebody
is inside a 200-metre circle around a school. Its centre may well land inside —
and a naive `distance < radius` then reports **"arrived at school"**, a specific
claim about a child's whereabouts derived from a measurement that does not
support it.

So there are three answers, not two:

```
INSIDE     distance + accuracy <= radius
OUTSIDE    distance - accuracy >  radius
UNCERTAIN  the two circles overlap, and nothing can be said
```

`UNCERTAIN` is not a failure and not a null. It is a state every caller must
handle, and it propagates: a crossing is only ever reported between two
readings that were each decidable.

A device that did not report an accuracy has **not** said it is certain. That
one is worth naming because the obvious code gets it backwards — `Number(null)`
is `0`, so a missing accuracy read through `Number` alone becomes perfect
confidence. It was written that way here first, and the test that asserts the
opposite is what found it.

## What is stored

| Entity | What it holds |
| --- | --- |
| `safeZone` | A named circle: centre, radius in metres, kind, and optionally who it is about |
| `locationPing` | One reading — person, time, coordinates, accuracy, and the zone it resolved to |
| `sosAlert` | Somebody raised an alarm, with a position if one could be read |

**Coordinates are encrypted.** `latitude` and `longitude` on both
`locationPing` and `sosAlert` are `encrypted: true`. This is the most sensitive
table in the database — more than the money, because money records what you
bought and this records where you were.

**The zone name is stored in the clear beside them**, so a screen listing a
week of readings does not decrypt every row to discover it says "school" six
times. The coordinates remain the record: `lastKnown` recomputes the zone
rather than trusting the stored name, because a zone can be moved or resized
after a reading was taken.

## How long it is kept

The household chose to keep a history rather than only the latest position. A
history nobody ends is a permanent record of where a family goes, so it ends
two ways:

- **Live rows** are deleted after **30 days** (`RETAIN_DAYS` in
  `js/domain/safety.js`). The service does this on every write, so it cannot be
  forgotten by a household that never opens Settings.
- **Deleted rows** are purged on the `location` retention policy — **7 days**,
  the same as a secret.

`js/data/retention.js` could not do the first on its own: it governs how long a
*deletion* is held open for second thoughts and never ages out a live row. Both
halves are needed or the history outlives the intent either way.

## Who can see whom

The household's decision, recorded here rather than left in a commit message:

- **`locationPing` is readable by owner, spouse and adult.** A parent sees a
  child.
- **A child cannot read it.** A child does not see a sibling.
- **A child can write one**, because the reading is produced by the device in
  their pocket, and `ownRecordAllows` on the server narrows that to their own
  rows. This is the only exception to a schema in which the child role was
  otherwise read-only everywhere, and `tests/policy.test.mjs` asserts the list
  so that a *different* entity cannot quietly join it.

**There is no consent record for a child's location.** That was asked and
answered: parents always see children. It is written down here because it is
the sharpest form of the open question `docs/PHASE_AUDIT_REPORT.md` §9 raises —
a person's movements are recorded with nothing on file saying they agreed — and
a decision of that kind should be visible rather than implicit. An adult's
location is recorded the same way; nothing here asks anybody's permission
beyond the operating system's own prompt.

## What a reading is worth

Every screen showing a position shows how old it is, because a location without
a timestamp reads as *now* and here it frequently is not.

| Age | Reported as |
| --- | --- |
| ≤ 15 minutes | fresh |
| ≤ 2 hours | ageing |
| beyond that | **stale**, and said in the past tense |

A stale reading is phrased as history — *"…that is the last reading on this
device, and it is old enough that it says nothing about now."* The alternative
is a screen telling somebody where their child is on the strength of a reading
from this morning.

A crossing between two readings hours apart is marked `certain: false`. Nobody
watched them go, and a time printed without that caveat is an observation
nobody made.

## What has not been tested

Everything here is tested against injected positions —
`tests/location.test.mjs` supplies its own `geolocation` — and none of it has
been run on a phone that moved. The arithmetic is verified; the experience of
carrying it around is not.
