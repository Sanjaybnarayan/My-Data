# Watching Somebody, With Their Agreement

`js/core/screentime.js`, `js/services/screentime.js`,
`ScreenTimePlugin.java`, `js/domain/wellbeing.js`, `js/modules/wellbeing.js`.
Tested in `tests/trail.test.mjs`, `tests/wellbeing.test.mjs` and the browser
suite.

## What makes this different from everything else here

Wages, school records, health records — a household writes those down about
somebody. Screen time is the household **watching** somebody: which
applications they opened and for how long, collected by the phone whether or
not they ever thought about it.

`js/data/consent.js` opens by saying it gates nothing, and gives a good reason:
a household already syncing has no consent record, because there was nothing
to record with, and a gate would silently stop their backups on upgrade — a
data-loss bug wearing a privacy costume.

**That argument does not hold here.** Screen time is not a record the household
already has. It is a reading this application would go and take. There is
nothing to lose by refusing, and something specific to lose by not.

So `PURPOSES.screenTime` carries `withoutStops: true` — the only purpose in
the list that does — and `ScreenTimeService` enforces it:

```
nobody asked            -> asked: false, nothing read
the person said no      -> asked: false, nothing read
no person named         -> asked: false, nothing read
a recorded agreement    -> the device is asked
```

**The native call is not made** when the answer is no. Not made and discarded:
a reading taken and then thrown away is still a reading that happened, and a
test drives each of the four paths.

## The screen that was missing

For fifty commits this stack was complete and unreachable. The plugin, the
device layer and the consent-gated service all existed, `tests/trail.test.mjs`
drove all four refusal paths, and `grep -rn "ScreenTimeService" js/modules/`
returned nothing at all. That is this repository's most-repeated fault — the
engine exists and no screen calls it, the same one that left `ChatService.send`,
`markVerified`, `revoke` and `withdraw` unreachable — and the fix adds no
capability. It draws one.

`#/wellbeing` is reached from Profile, under *This device*. It is not a schema
module: it owns no records, so it is registered beside `timeline` rather than
appearing in the module list, and it sits outside the settings card on purpose.
That card is gated on being allowed to open Settings, and a member who may not
change household settings is still the person whose phone this is.

### It never says "unavailable"

`readiness` separates what the device allows from what consent allows, and the
screen must not collapse that at the last step. `STATE` gives the reason as an
id rather than only as a sentence — a screen that branched on the English would
break the first time somebody translated it — and `whyBlocked` in
`js/domain/wellbeing.js` maps each id to its own sentence and to which control
is honest to offer:

| state | sentence says | settings button | consent link |
| --- | --- | --- | --- |
| `noPerson` | nobody is signed in | no | no |
| `unasked` | they have not been asked | no | **yes** |
| `refused` | they said no, nothing is read | no | no |
| `noPlugin` | this build has no screen-time service | no | no |
| `noAccess` | usage access not granted | **yes** | no |
| `deviceRefused` | granted, and refused anyway | **yes** | no |

Two rules are load-bearing. Only the device cases offer the settings page,
because usage access is the only thing a settings page can fix. And a person
who said no is **not** offered a way to be asked again; their answer stands
until they change it where it was recorded.

A unit test asserts every id `STATE` can report has a case here and every case
maps to an id something reports — the hand-maintained-list-beside-a-derivable-one
fault, checked rather than hoped for. The browser suite drives four of the
states in sequence and asserts the four sentences differ, which is the check
that fails when the screen starts printing one sentence for all of them.

### What the screen shows, and what it refuses to

A total for the week and a row per application, longest first, with the
duration beside a bar. The bar is `.wellbeing-bar` and not the `progress`
component: that one paints a high ratio warning and a full one danger, because
it was built for budgets, where reaching the limit is the bad outcome. A share
of screen time is not a budget, and colouring somebody's most-used application
red would be this screen deciding that using it a lot is a problem. It does not
know that. The figure sits beside the bar and the bar carries an `aria-label`,
so length is never the only signal.

Applications are named by the last segment of the package — `com.whatsapp`
becomes `whatsapp`. Not the label a launcher shows: Android reports the package,
and a friendlier name would be the screen guessing which application somebody is
looking at.

**There is no daily average.** A phone switched off for three days still reports
seven, so dividing by seven produces a number that reads like a habit and is an
artefact. A unit test asserts `summarise` has not grown one.

And the screen lists, on itself, four things a phone's own wellbeing page shows
and this one does not — categories, screen time while walking or driving,
listening volume and hearing exposure, and app timers or bedtime mode. None of
them come from `PACKAGE_USAGE_STATS`, and the last group would have to *enforce*
something, which this build does not do. A timer that did not actually stop
anything would be worse than none. Somebody comparing the two screens is
entitled to know which absences are deliberate rather than broken.

## The permission is necessary and not sufficient

`PACKAGE_USAGE_STATS` is *special access*. It cannot be requested at runtime,
Android shows no prompt, and a `requestPermissions` call returns denied without
displaying anything — which to a caller looks exactly like the person refusing.
So the plugin opens the usage-access settings page instead, and a test asserts
the plugin contains no permission request at all.

Having the grant means the device will answer. It says nothing about whether
anybody should be asking, which is the service's job.

## What it will not return

Totals per application over a window. **No per-launch history and no
timestamps of individual openings** — a household asking "how long has this
phone been on TikTok this week" gets that, and does not get a log of every time
somebody picked their phone up. Android would provide the finer data; this does
not ask for it.

Nothing about content. Not what was typed, read or sent. Android does not offer
it and this does not want it.

## Never run on a device

The JavaScript is driven against a fake plugin, and the browser suite exercises
the screen in a browser, which by definition has no plugin — so the reading
path itself, the bar and the week card, have still never been drawn from real
device data. The Java compiles in CI and has never met a real
`UsageStatsManager`. `docs/PHASE_STATUS.md` says so in the row
rather than leaving it to be discovered.

One test fixture is worth noting: the first version of the fake **resolved**
with an empty list when the permission was missing, and the real plugin
*rejects*. The check passed for the wrong reason until the fake was made
faithful — "nobody used anything" and "this phone will not tell you" are
different answers, and a screen showing zero for the second would be inventing
a finding.
