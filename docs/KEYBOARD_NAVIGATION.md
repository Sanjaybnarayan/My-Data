# The Screen Said It Announced Itself, and Did Neither

`js/ui/router.js`, `js/ui/components/basics.js`, `tests/browser.mjs`,
`docs/UI_ACCESSIBILITY.md`.

## What was found

The router ended every successful navigation with this:

```js
// Landing on a new screen should start at the top and announce itself.
this.#outlet.scrollTop = 0;
const heading = this.#outlet.querySelector('h1, h2');
if (heading) heading.setAttribute('tabindex', '-1');
```

`tabindex="-1"` makes an element focusable by script. Nothing focused it.
`announce()` exists in `js/ui/dom.js` and the router did not import it. So the
comment described two behaviours, the code prepared for one of them, and
neither happened — the shape this repository keeps finding, which is a claim
with nothing checking it.

**What it cost somebody navigating by keyboard.** The link they followed was
inside the outlet. `replaceChildren` removed it. Focus falls to `<body>` when
the focused element leaves the document, so every navigation put them at the
top of the page: the next Tab started at the skip link, then the header, then
the whole tab bar, before reaching anything on the screen they had asked for.

**And nothing was announced.** For somebody using a screen reader, following a
link changed the page silently.

## What changed

The heading is focused, and its text goes to the live region — except on the
first render, where the page load announces itself and saying the name twice
is worse than not saying it. `preventScroll` is passed because the line above
has already put the scroll where it belongs.

## The second half: what a keyboard can reach

`listItem` gave a row with an `onClick` a `role="button"` and a `tabindex="0"`
and no key handler. Nine rows across the application announced themselves to
a screen reader as buttons and answered only a pointer. Enter and Space work
now; Space is prevented as well as handled, because on a focused element it
also scrolls the page.

`js/ui/components/table.js` does the same thing and was **already correct** —
it has a `keydown` delegate beside its `click` delegate. Checked rather than
assumed, and reported as a non-finding.

## What is checked, and what is not claimed

Nine new browser checks. They are about **keyboard operability**, which this
machine can drive, and not about what a screen reader says, which it cannot:

- navigating puts focus on the new screen, not back at the body;
- the live region carries the screen it landed on — a claim about the DOM;
- the dashboard has controls a keyboard can reach, and none of them is
  nameless;
- a row announced as a button is focusable;
- a list row given an action is announced as a button, and answers Enter and
  Space, not only a click.

The last two are driven on a `listItem` built in the page with a handler that
only sets a flag. Every `listItem` with an `onClick` in this application does
something — locks, deletes, opens a picker — and a check should not have to
pick the least destructive one to find out whether Enter works. The first run
of this check pressed Enter on the live **Lock now** row, which locked the app
and reloaded the page, and took the rest of the suite down with it. The
comment beside that code had named the hazard before the code ignored it.

Mutation-tested. Removing the focus call — restoring exactly the state before
this change — reproduces the fault:

```
683/684
  FAIL  navigating puts focus on the new screen, not back at the body
        — BODY "Skip to contentFOFamilyOSDashboardNotificationsProfileIdenti"
```

The detail is the fault itself: focus on `<body>`, reading from the skip link.

## What this does not establish

**Nothing here has run under a screen reader.** Every check above is a claim
about focus, roles, names and DOM content. That a heading is focused is not
that it is read out; that the live region holds a screen's name is not that
anybody hears it. Those remain unverified, and `docs/UI_PHASE_STATUS.md` keeps
UI-14 at PARTIALLY_COMPLETE for that reason.

What has changed is that the keyboard half is now driven rather than assumed.
Until this file existed, every check in the suite reached its target by
clicking.
