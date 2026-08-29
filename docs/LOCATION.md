# Location, safe zones and SOS

Phase 15. Read the limits first, because they are most of the design.

## What changed, and what it cost

**There is now background tracking on Android, and there was not.** Every
sentence in this file used to say the opposite, and a test failed if
`ACCESS_BACKGROUND_LOCATION` ever appeared in the manifest. The household
asked for it, the reasons against were put to them, and they chose it anyway.
This section records what was given up rather than quietly dropping the old
paragraph.

What was given up: an application that could not watch a family even if
somebody wanted it to. That property is gone and cannot be got back by
switching the feature off, because the permission is now declared and the
service is now written.

What is kept, and enforced rather than promised:

- **It is off until somebody turns it on.** Nothing starts it at boot —
  there is no `BOOT_COMPLETED` receiver and a test asserts it — and the
  service is `START_NOT_STICKY`, so Android will not restart it unasked.
- **It says so while it runs.** A foreground-service notification that cannot
  be dismissed. Android requires it; so does honesty.
- **It refuses to half-work.** Without the background grant the service is not
  started at all, rather than recording foreground-only and calling it a
  trail — which is what the application already did, and would make the
  switch a lie.
- **It writes nothing itself.** Fixes are held in memory and handed to the
  WebView, which puts them in the encrypted store. A service that wrote to
  disk would be a second, plaintext copy of a household's movements. The
  cost is stated rather than hidden: fixes still buffered when the process
  dies are lost.

**It has never run on a phone.** It compiles. That is a different claim, and
`docs/PHASE_STATUS.md` says which is which.

## What this still does not do

**There is no OS geofencing.** A real geofence is registered with the platform
and wakes the app when it is crossed. What this has instead is arithmetic:
`js/domain/geo.js` compares a position the app already holds against circles it
knows about. Same comparison, none of the wake-ups. **Crossing a zone while the
app is closed produces nothing at all** — no alert, no record, and no later
catch-up.

**Nothing sends an SOS, and the button says so three times.** There is no
server in this application, no SMS gateway and no push. What the button on the
safety screen does is **compose and record**: who needs help, the reason if one
was typed, the position if one can be read, a map link, and the accuracy. It
then hands that text to the phone's own share sheet. A person sends it.
`sentVia` records what they say they did and defaults to `not sent`, because
this application cannot know whether they did.

The three places that say it are the card, the confirmation dialog, and the
screen showing the composed message — in the order a person meets them. A test
holds all three, and mutating any one of them to claim that contacts are
alerted fails the build.

For one tranche this was built and unreachable: `SafetyService.raise`, the
`sosAlert` entity, `sosMessage`, the locale strings and the tests all existed
and no screen called any of them, while three documents described the flow in
the present tense. `docs/AN_SOS_WITH_NO_BUTTON.md` carries that measurement and
the `unwired:` probe that was added to catch it — the probe then failed the
build the moment the button was written, which is what it is for.

On Android 10+ the background grant cannot be obtained from the same prompt as
the foreground ones, and on 11+ not from a prompt at all — the person has to
choose *Allow all the time* on the application's settings page.
`BackgroundLocationPlugin.openSettings()` takes them there rather than raising
a request Android will deny without showing anything.

A Play Store background-location declaration and demonstration video would
also be required. This build already cannot go to Play because of `READ_SMS`,
so nothing new is foreclosed — but a build that dropped `READ_SMS` would still
need it.

## On a phone

`@capacitor/geolocation` is installed, and it is what asks Android for the
runtime permission. This matters more than it looks: `navigator.geolocation`
exists inside a Capacitor WebView and appears as though it should work, but the
WebView asks the *activity* through `onGeolocationPermissionsShowPrompt`, and
with no Android runtime grant behind it that prompt is answered no before a
person ever sees it. The feature would look broken rather than unpermitted. So
`js/core/position.js` prefers the plugin whenever there is one and falls back
to the browser API otherwise — one code path for both, because the plugin
returns the web shape deliberately.

The manifest asks for two permissions and no more:

| Permission | Why |
| --- | --- |
| `ACCESS_FINE_LOCATION` | A 200 m zone needs a fix precise enough to decide it |
| `ACCESS_COARSE_LOCATION` | Android lets somebody grant only the approximate one, and a household that would rather say "the right neighbourhood" than "the right doorstep" should be able to. A coarse fix still decides a 3 km zone, and the geometry refuses to place it against a 200 m one |

`android.hardware.location.gps` is declared `required="false"`, so a device
without GPS is not excluded from the store listing — it gets a screen that says
there is no reading rather than an app it cannot install.

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

Everything here is tested against injected positions and an injected plugin —
`tests/location.test.mjs` supplies both — and the APK is compiled on every push
so the manifest and the plugin are known to build. **None of it has been run on
a phone that moved.** The arithmetic is verified, the permissions are asserted,
and the experience of carrying it around is not.
