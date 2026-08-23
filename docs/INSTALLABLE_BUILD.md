# One Permission Made The Whole App Uninstallable

`android/app/build.gradle`, `android/app/src/sms/AndroidManifest.xml`,
`.github/workflows/android.yml`. Tested in `tests/native.test.mjs`.

## What happened

The APK was downloaded to a phone and Android refused it:

> **App blocked to protect your device**
> This app can request access to sensitive data. This can increase the risk of
> identity theft or financial fraud.
>
> *App not installed.*

That is Google Play Protect's block for a sideloaded app requesting a
**restricted permission** — the SMS and Call Log family. It is not a warning
with an *install anyway*: the dialog offers only OK, and the install does not
happen.

Measured against Google's restricted set, exactly one of this build's nine
permissions is in it:

```
  ok      ACCESS_BACKGROUND_LOCATION      ok      INTERNET
  ok      ACCESS_COARSE_LOCATION          ok      PACKAGE_USAGE_STATS
  ok      ACCESS_FINE_LOCATION            ok      POST_NOTIFICATIONS
  ok      FOREGROUND_SERVICE
  ok      FOREGROUND_SERVICE_LOCATION     BLOCKS  READ_SMS
```

Background location and usage access — the two that *sound* alarming — are not
in the set and were never the problem.

**One permission was making every other feature in the application unreachable
on a real phone.** The ledger, the documents, the encryption, the safe zones:
all of it, unusable, because of Phase 6.

## How it was found

Somebody tried to install it.

Nothing in this repository could have caught it. CI builds the APK and proves
it compiles; Play Protect runs on the device at install time and has no
representation here. `docs/PHASE_STATUS.md` said "the SMS permission makes this
a sideload build" — which was true and was not the whole truth. Sideloading is
what you do when Play will not distribute an app; it is not a thing you can do
when Android refuses to install it.

That row has been corrected rather than left standing.

## Two flavours

```
standard   no READ_SMS.  Installs.  ← the one to put on a phone
sms        READ_SMS.     Blocked until Play Protect is switched off.
```

Nothing else differs. Same application id, same code, same plugins. On
`standard`, `SmsInboxPlugin` is still compiled in; Android answers its
permission check denied because the manifest never asked, and
`js/core/smsinbox.js` reports `DENIED` — a path it already had for somebody who
says no. Phase 6 degrades to "cannot read an inbox on this build", which is
the same thing it says in a browser.

**Deliberately the same `applicationId`.** A suffix would let both sit on one
phone, and would also change the OAuth redirect scheme that
`tools/native-scheme.mjs` checks against the configuration — breaking Google
sign-in to gain something nobody asked for.

## What is checked

`tests/native.test.mjs` asserts `src/main` contains **none** of the nine
restricted permissions, not merely that it lost `READ_SMS` — the next one
added would block installs the same way and for the same reason.

CI goes further and reads the **built APK** with `aapt2 dump permissions`,
because a manifest is what was written and an APK is what Android sees. A
merge, a library manifest or a flavour misconfiguration could put the
permission back without either manifest changing.

Six mutations, all caught: the permission creeping back into `standard`, a
different restricted permission arriving, the `sms` flavour losing it, the
flavour being dropped from Gradle, an `applicationIdSuffix` appearing, and the
flavour manifest losing the explanation of why it exists.

## Turning Play Protect off, if you want the SMS build

Settings → Google → All services → Play Protect → the gear → **Scan apps with
Play Protect** off. Install, then turn it back on.

Worth saying plainly: that setting exists to stop people installing malware,
and switching it off to install something is exactly the pattern malware
relies on. It is the right call here only because you know what this build is
and where it came from. The `standard` flavour exists so that is a choice
rather than a requirement.
