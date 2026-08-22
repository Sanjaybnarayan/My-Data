# Watching Somebody, With Their Agreement

`js/core/screentime.js`, `js/services/screentime.js`,
`ScreenTimePlugin.java`. Tested in `tests/trail.test.mjs`.

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

The JavaScript is driven against a fake plugin. The Java compiles in CI and has
never met a real `UsageStatsManager`. `docs/PHASE_STATUS.md` says so in the row
rather than leaving it to be discovered.

One test fixture is worth noting: the first version of the fake **resolved**
with an empty list when the permission was missing, and the real plugin
*rejects*. The check passed for the wrong reason until the fake was made
faithful — "nobody used anything" and "this phone will not tell you" are
different answers, and a screen showing zero for the second would be inventing
a finding.
