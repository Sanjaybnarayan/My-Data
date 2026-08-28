# The Recents Switcher Kept a Photograph of the Screen

`android/app/src/main/java/com/familyos/app/MainActivity.java`,
`tests/native.test.mjs`, `docs/UI_INFORMATION_ARCHITECTURE.md`.

## What was found

`FLAG_SECURE` appeared nowhere in `android/`. Without it, Android captures the
screen every time the app goes to the background and keeps the image for the
recents switcher. Nobody asks for that capture, nothing on screen is redacted
for it, and it survives until the task is dismissed.

So whatever a household had open went with it: an account balance, a health
record's title, a bill amount — and any identifier they had tapped to reveal,
which is the case masking-by-default exists to bound and which the capture
ignores.

The same flag is what permits screenshots and screen recording, so both were
also unrestricted.

## The half that was already reasoned about

`docs/UI_INFORMATION_ARCHITECTURE.md` had thought about the switcher, and
stopped at the caption:

> The document title is the static `<title>FamilyOS</title>` … so no record
> name can reach the window title, the task switcher or a screenshot of
> either.

Every word of that is true. It is about the **text label**, and a reader
finishes the paragraph believing the switcher is handled. The picture beside
the label is the larger half and went unmentioned. That paragraph now says so.

## What changed

`MainActivity.onCreate` sets the flag for the window's whole life:

```java
getWindow().setFlags(
    WindowManager.LayoutParams.FLAG_SECURE,
    WindowManager.LayoutParams.FLAG_SECURE);
```

**Why not the lifecycle toggle.** Setting the flag in `onPause` and clearing
it in `onResume` protects the switcher while leaving deliberate screenshots
working, which is a genuinely better product. It also depends on the flag
landing before Android takes its snapshot, and that ordering varies by OEM and
version. It cannot be tested from a build machine. A protection whose
correctness rests on a race nobody here can observe is not one this repository
is entitled to claim, so it is not the one built. `tests/native.test.mjs`
asserts the toggle is *absent*, and this paragraph is the argument it points
at if somebody adds it later.

**The cost, stated rather than discovered.** No screenshots of FamilyOS, no
screen recording, no casting — app-wide, for everyone, permanently. A
screenshot is a choice somebody makes with the app already unlocked in their
hand; the recents capture is not a choice at all. That asymmetry is the whole
argument for paying the cost, and it is the user's decision, taken
deliberately rather than defaulted into.

## iOS is not covered

iOS has no `FLAG_SECURE`. The equivalent is an overlay drawn over the window
on `applicationWillResignActive`, which is a different mechanism with its own
verification problem, and **it is not built**. `docs/NATIVE_PARITY.md` records
what happens when the two native projects quietly diverge; this one is named
here instead so nobody has to find it.

## How it is checked

`tests/native.test.mjs`, reading the activity source — the only automated
check available for a native window flag, and honest about being that:

- the window is `FLAG_SECURE`, with the `WindowManager` import that makes it
  compile;
- the flag is set for the window, not toggled around the lifecycle;
- it is set inside `onCreate`, after `super.onCreate` — `getWindow()` is null
  before the activity is attached, so a field initialiser would throw on
  launch.

The file is read with its comments stripped. The lifecycle check reads for the
*absence* of `onPause`, and the comment beside the flag argues about `onPause`
by name — so against the raw text it failed on correct code, which is the same
defect as passing on wrong code.

Mutation-tested, run rather than asserted:

```
flag removed entirely      2 FAIL  the window is FLAG_SECURE …
                                   and the flag is set inside onCreate …
moved to an onPause toggle 2 FAIL  and it is set for the window, not toggled …
                                   and the flag is set inside onCreate …
WindowManager import dropped 1 FAIL the window is FLAG_SECURE …
```

## What this does not establish

No part of it ran on a phone. These checks establish that the flag is set in
the source and that the APK compiles with it — not that a particular device's
switcher shows a blank card. The mechanism is a documented Android window
flag applied for the window's whole life rather than a timing-dependent
toggle, which is why it is claimed at all; it is still a claim about code,
not an observation of a device.
