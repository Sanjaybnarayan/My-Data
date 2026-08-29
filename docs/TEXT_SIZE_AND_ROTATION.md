# Two Settings a Household Uses, Neither Ever Tested

`css/tokens.css`, `css/base.css`, `tests/browser.mjs`.

## What was found

Asked to finish the partially-complete phases, the first thing measured was
what had never been driven at all. Two things had not: **Android's text-size
setting** and **turning the phone sideways**.

The type scale is in `rem`, so the system setting reaches it. Everything
around it was in `px` — the bottom bar 64px, an icon button 38px, the
tap-target floor 44px. Large text inside fixed boxes is where a layout breaks
if it breaks, and it did:

```
at 20px root (Android "Large")     Dashboard, Notifications cut off
at 24px root (largest font size)   Dashboard, Notifications, Finance cut off
```

Three of the five tabs, truncated to `Notificat…`, for somebody who turned the
text up **because they could not read it**. That setting exists to prevent
exactly this outcome.

**Rotation was fine.** No sideways scroll, the bar stayed on screen, and the
content kept usable room between the two bars at 844×390. Measured, not
assumed, and reported as a non-finding.

## What changed

`--bottom-nav-height` is `4rem` instead of `64px`. That is the same 64px at
the default root size, so nothing moves for anybody who has not changed the
setting — and `.app-main` reserves its bottom padding from the same token, so
a bar that grows can never end up over the content.

The labels wrap instead of being cut. `overflow-wrap: anywhere`, because the
long ones are single words: without it "Notifications" overflows rather than
breaking. A wrapped label is not pretty at the largest setting. A truncated
one is not readable, which is worse.

## The check that was too strict, and why

The first version also read `.list-item-title` and failed on
`You added BLINKIT COMMERCIAL…` — a record's own free text, ellipsised in a
preview row, with all of it one tap away. That is a design choice, not a
fault, and a check forbidding it would have demanded something nobody wants.

What must never be cut is a **fixed label**: a tab, a card heading, the app's
name. Short, chosen by the application, and the whole of what somebody has to
read to know where they are. The check reads those three and nothing else.

Mutation-tested — restoring the ellipsis reproduces the fault and names the
tabs:

```
690/692
  FAIL  and no fixed label is cut off at 20px — SPAN: Dashboard | SPAN: Notifications
  FAIL  and no fixed label is cut off at 24px — SPAN: Dashboard | SPAN: Notifications | SPAN: Finance
```

## What this does not establish

A browser's root font-size is a faithful simulation of Android's font-size
slider **because the type scale is in `rem`** — but it is a simulation. It is
not the WebView's `textZoom`, and Android's *Display size* setting (which
scales layout as well as text) is not simulated at all. Neither has run on a
device.
