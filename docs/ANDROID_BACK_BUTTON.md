# Back Closed the Screen and Left the Dialog Standing

`js/app.js`, `js/ui/router.js`, `js/ui/components/modal.js`, `tests/browser.mjs`.

## What was found

The hardware back button was claimed from the platform and did one thing:

```js
App.addListener('backButton', ({ canGoBack }) => {
  if (canGoBack) globalThis.history.back();
  else App.exitApp();
});
```

That is right on a screen and wrong on a dialog, and the reason is where a
dialog is mounted. `modal()` appends its scrim to `document.body`. The router
replaces the children of `#outlet` and nothing else — deliberately, because
that is what a route change is. So back with a dialog open navigated the
screen out from under it and **the dialog stayed on the page**, over a screen
it was never about, with:

- `document.body.style.overflow` still `hidden`, so nothing behind it scrolls;
- focus still trapped inside it, so a keyboard or screen reader cannot leave;
- on a delete confirmation, a Delete button still wired to the record it had
  been asked about — on a screen now showing something else.

The last one is the one worth stating plainly: the dialog asks *"Delete Priya
Sharma?"*, back moves the page to the dashboard, and the button underneath the
question still deletes Priya Sharma.

## Why it was Android-only, and why the check missed it

A browser reaches this too — its own back button calls the same
`history.back()`. But a browser also has an Escape key, and `modal()` has
always closed on Escape, so the ordinary way out of a dialog worked and the
back path was never the one anybody took.

**A WebView has no Escape key.** On Android, back *is* the dismiss gesture.
It is the only one, and it did the wrong thing.

The existing check asked whether the listener was registered:

```
check('the hardware back button is claimed from the platform', claimed)
```

which is true of a listener that is registered and wrong. It could not fail on
this fault, because it never pressed the button.

## What changed

**Back closes the dialog on top, and stays put** (`js/app.js`). Exactly what
Escape does, because it is standing in for Escape. Only then does it fall
through to `history.back()` and, at the bottom of the stack, `App.exitApp()` —
so back is still the way out of the application when there is nothing else to
leave.

**The router closes every dialog on the way out** (`js/ui/router.js`), beside
the view teardown that was already there for the same reason. This is not a
second guard on the same fault: it catches the navigations the back handler
cannot see — a link inside a dialog, a guard's redirect, a notification tap.
Removing either one leaves an observable defect, and the browser suite fails
differently for each — run rather than asserted:

```
back handler's closeTopModal removed  641/642
  FAIL  and stays on the screen the dialog was opened from
        — #/identity/person/prs_01M14… -> #/dashboard

router's closeAllModals removed       640/642
  FAIL  a dialog does not survive a navigation it did not cause
  FAIL  and the page it was left over scrolls
```

Note what the first run does *not* fail: with only the router's net, back still
closed the dialog — it just took the screen with it. That is why counting the
dialog gone is not enough on its own, and why the check that the hash did not
move is the one carrying the Android half of this.

Closing without a result is the safe answer by construction: `confirm`
resolves `false` and `prompt` resolves `null`.

**`close()` is idempotent** (`js/ui/components/modal.js`). It now has more
than one caller, and without the guard a button that navigates and then closes
itself would fire `onClose` twice and take a second dialog's entry off the
stack with it. The open dialogs are a stack rather than the count that was
there before, because the count could answer "is the page scroll-locked" and
neither of the two new questions.

`dismissable: false` is passed by no caller in the tree. Back treats it as
Escape does — it is not a dismiss gesture for a dialog that refuses to be
dismissed — and the router closes it anyway, because stranded is worse.

## How it is checked

`tests/browser.mjs`, inside the fake Capacitor bridge that already boots the
application as a native shell. The bridge proxy records the callback along
with the listener name, so the check **calls the real listener** with the
argument Capacitor passes, rather than counting that it exists:

- the back button closes an open dialog;
- and stays on the screen the dialog was opened from;
- and unlocks the page behind it;
- and answers the confirmation *no*, rather than deleting the record;
- and is navigation again once no dialog is open — without this, a handler
  that did nothing at all would pass the first four;
- a dialog does not survive a navigation it did not cause;
- and the page it was left over scrolls.

## What this does not establish

No part of it ran on a physical device. This is a real Chromium driving the
shipping files behind a bridge shaped from `@capacitor/core`'s source, which
is enough to exercise the handler and the router and is not the same as an
Android WebView. Whether Android's gesture navigation delivers the event the
way the hardware button does is not tested here and cannot be from this
machine.
