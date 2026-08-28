# A Phone Carried Two Complete Navigations

`js/ui/shell.js`, `css/base.css`, `tests/browser.mjs`,
`docs/UI_INFORMATION_ARCHITECTURE.md`.

## What was found

Reported from a device: a burger in the top-left and a tab bar along the
bottom, at the same time. Both were navigation, and between them they drew
**thirty module links on one screen** — twenty-five in the drawer and five on
the bar.

The drawer shared its markup with the desktop rail. Below 901px the rail was
moved out of the way with `transform: translateX(-102%)` and brought back by
a `data-drawer` attribute the burger toggled.

Two separate faults sat in that:

**On a phone, the drawer was a second navigation.** Not a fallback for
anything — `js/modules/profile.js`'s `grouped()` already claims every module
the schema declares, so all twenty of the non-primary modules were reachable
from Profile before this change. The drawer duplicated them.

**On a desktop, the burger was a dead control.** `.nav-toggle` had no CSS rule
anywhere, so the button rendered beside the always-visible rail — and the
transform it toggled lives inside the `max-width: 900px` media query, so
above 901px pressing it set an attribute nothing read.

## The half a screen does not show

`transform` moves a panel; it does not remove it. A transformed panel is still
rendered, still in the accessibility tree, and still in the tab order. So the
duplication a sighted person saw as a burger beside a tab bar was, for someone
using a screen reader, twenty-five module links followed by five of them
again — with no burger involved and nothing on screen to explain it.

That is why the rail is `display: none` below 901px rather than moved, and why
the check reads the rail's computed style instead of only asking whether a
burger is on screen.

## What changed

- **The drawer is gone**: the burger, the scrim, `toggleDrawer`, and the
  click delegation that closed it. `.app-nav` is `display: none` under 901px.
- **`setDrawer` went with it** — exported from `buildShell` and called by
  nothing, before this change or after.
- **Lock moved into the header on a phone.** It was the drawer's one control
  that is not a module, and the only other way to it is Profile → Settings →
  Security → Lock now. One tap to four, for the thing somebody reaches for
  when handing over the phone, is not a cost worth paying silently. It sits
  with sync and theme rather than where the burger was, because it is a global
  control and not a way to somewhere, and it is hidden above 901px where the
  rail carries the same action with a word on it.

Nothing became unreachable. `tests/profile.test.mjs` already held `grouped()`
to claiming every module, including a catch-all group for anything no named
group takes; the browser suite now checks the screen actually *draws* them,
which is the half that can be true in the data and missing on the page.

## How it is checked

`tests/browser.mjs`, at 390×844 and then at 1280×900:

- a phone draws one navigation, not two — five module links in the frame;
- and the rail is gone from the tree, not moved off-screen;
- no burger remains, and no drawer scrim is left behind;
- lock stays one tap on a phone;
- and every module is still reachable without a drawer — every id the schema
  declares, matched against what Profile and the bar actually render;
- a desktop draws the rail instead, still has no burger, and has one path to
  lock rather than two.

Mutation-tested. Putting the off-screen transform back — the exact previous
behaviour — reproduces the report:

```
649/651
  FAIL  a phone draws one navigation, not two — 30 module links drawn in the frame
  FAIL  and the rail is gone from the tree, not moved off-screen — block
```

Thirty is the number from the device: twenty-five plus five.

## Two mistakes worth leaving on the record

A `Set` returned from `page.evaluate` arrives as `{}` — `evaluate` hands back
JSON. It threw rather than passing, but the shape is worth naming where
somebody will copy the check.

Three call sites used `waitForSelector('.app-nav')` as their "the shell is
up" signal, two of them in phone-sized contexts. `waitForSelector` waits for
*visible*, not attached, so hiding the rail broke them — correctly. The phone
context now waits on `.bottom-nav`, which is the readiness signal that is
actually true there.
