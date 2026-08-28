# The Keyboard Had No Declared Behaviour, and the Bar Sat On Top of It

`android/app/src/main/AndroidManifest.xml`, `js/ui/shell.js`, `css/base.css`,
`.github/workflows/android.yml`, `tests/native.test.mjs`, `tests/browser.mjs`.

## What was found

Two separate things, one of which is a declaration and the other a layout.

**Nothing said how the window should respond to the keyboard.**
`android:windowSoftInputMode` appeared nowhere — not on the activity, and not
contributed by any library: every `AndroidManifest.xml` under
`node_modules/@capacitor/*` was read, and none of them sets it.

Unset means `SOFT_INPUT_ADJUST_UNSPECIFIED`, which is not a behaviour but a
request for Android to choose one. It usually chooses `adjustResize`; it
sometimes chooses `adjustPan`, and which varies by version and OEM.
`adjustPan` scrolls the whole window upward instead of resizing it, taking the
header off the top of the screen and leaving a fixed bottom bar wherever the
scroll puts it. So the app's layout under a keyboard was a property of the
phone rather than of the app.

**And the bar was in the way either way.** `.bottom-nav` is
`position: fixed; bottom: calc(var(--inset-bottom) + var(--space-2))`. Under
`adjustResize` the WebView shrinks, `bottom` re-anchors to the shorter
viewport, and the bar lands directly on top of the keyboard: sixty-four pixels
of tabs wedged between the keyboard and the field being filled in, in the half
of the screen the keyboard had not already taken.

Nothing in the application listened for focus at all, so there was no code
that could have known a keyboard was up.

## What changed

**The activity declares `adjustResize`.** Not because it is the better of the
two — because it is *a* behaviour rather than a coin toss, and it is the one
the CSS below is written against.

**The bar stands down while a field has focus.** `js/ui/shell.js` sets
`data-typing` on the shell root from `document.activeElement`; the CSS hides
`.bottom-nav` and drops `.app-main`'s bottom padding, so the form gets the
reserved room back rather than a dead strip under the last field.

Only for controls that actually raise a keyboard — `textarea`,
`contenteditable`, and an `input` whose type is one of text, search, email,
tel, url, number, password. A `select` opens a picker and a checkbox opens
nothing; hiding the navigation when somebody ticks a box would be the same bug
pointing the other way, and the naive version of this — any `focusin` — does
exactly that. It is the mutation the check below catches.

The clear is deferred a task. Tabbing between two text fields fires `focusout`
before `focusin`, so clearing on `focusout` alone flickers the bar in and out
between them — on a phone, that is the bar appearing over the keyboard for a
frame.

## Where this does and does not apply

Record forms open in a modal, whose scrim is `z-index: 70` against the bar's
`30`. There the bar was already covered and this changes nothing. The two
places a phone raises a keyboard with the bar on screen are the header's
search box and the chat composer, which is why the checks drive those and not
a record form.

## How it is checked

**The declaration, twice.** `tests/native.test.mjs` reads the source manifest.
That is not enough on its own — a library or a build type can override the
attribute during manifest merging — so `.github/workflows/android.yml` reads
it back out of the *built APK* with `aapt2 dump xmltree`, comparing the value
against `0x10`. Unset is `0x00`, which is the thing being ruled out, so the
value is compared rather than merely found. That step runs where the real
Android toolchain runs, which is the only place it can.

**The layout, in a browser.** A browser has no soft keyboard, so what is
driven is the half that decides the layout: focus enters a field and the bar
stands down. Nine checks across the header search (`input`) and the chat
composer (`textarea` — a separate branch), covering the bar going, the padding
collapsing, both coming back, and a control that raises no keyboard leaving
the bar alone.

Mutation-tested, run rather than asserted:

```
raisesKeyboard returns true for everything   659/660
  FAIL  a control that raises no keyboard leaves the bar alone

windowSoftInputMode removed                  2744/2746
  FAIL  the activity declares how it resizes, rather than letting Android pick
  FAIL  and it is on the activity that holds the WebView

declared on <application>, not the activity  2745/2746
  FAIL  and it is on the activity that holds the WebView
```

## What this does not establish

**That the keyboard no longer covers the field on a phone.** It cannot be
established from here: no browser raises a soft keyboard, and no part of this
ran on a device.

What is established is narrower and worth stating exactly. The window now
declares one resize behaviour instead of leaving it to the device, and that
declaration survives into the shipped APK — measured on the artifact, not
grepped from the source. And given that behaviour, the bar is out of the way
before the keyboard arrives. Whether the result feels right under a thumb is
still a question for somebody holding the phone.
