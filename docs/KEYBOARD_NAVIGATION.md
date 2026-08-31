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

---

# The Dialogs Said Four Things, and Two of Them Were Not True

`js/ui/components/modal.js`, `tests/browser.mjs`.

`modal.js` opens by claiming four behaviours — focus moved in on open and
restored on close, focus trapped while open, Escape closes — and adds that
"each of them is invisible until somebody using a keyboard or a screen reader
hits it". That sentence was right, and it was describing its own file.

The suite touched modals in fifteen places. Every one of them waited for
`.modal`, read its text, clicked a button and waited for it to detach. Nothing
had ever pressed Escape. Nothing had asked what a dialog is *called*. So the
two claims that were false had nothing standing between them and a release.

## A destructive confirmation announced as the dialog underneath it

The title carried `id="modal-title"` — a constant — in a module that stacks
dialogs deliberately. `openDialogs` is an array, the Android back button closes
"the dialog on top", and the scroll lock releases only when the last one goes.

`aria-labelledby` resolves through `getElementById`, which returns the **first**
match in the document. With two dialogs open, the one on top was announced with
the name of the one underneath it.

Settings → Connection → *Changes that could not be sent* → **Discard** reaches
it in three clicks. Measured in the page, before the fix:

```
dialogs:          2
ids named
  modal-title:    2
top dialog is:    "Discard this change?"
announced as:     "Changes that could not be sent"
```

A confirmation asking whether to throw away a pending change, introducing
itself as the list it was opened from. A destructive confirmation is the worst
thing in this application to mislabel, and the household member most likely to
be misled by it is the one who cannot see which dialog is on top.

`prompt` had the same construction in `for="prompt-input"`, where two stacked
prompts would put the label on the first one's field. Nothing reaches that
today — every `prompt` in the tree is awaited before the next opens — so it is
fixed as the same fault rather than reported as a second one.

## And a dialog that never took focus at all

Found by the check written for the first fault, which is the whole argument for
writing it:

```js
const firstField = dialog.querySelector('input, select, textarea, button:not([aria-label="Close"])');
focus(firstField ?? dialog);
```

The fallback says plainly what to do when a dialog has no field in it. It had
never once worked. `focus()` calls `el.focus()`, and a `div` with no `tabindex`
is not focusable — `.focus()` on one is a silent no-op. So for any dialog whose
only control is its own Close button, which that selector excludes on purpose,
focus stayed on whatever was behind the dialog while an `aria-modal` element
covered the page.

Reachable in several places, all of them the *quiet* branch: Settings → Data →
*Check for broken links* on a database with none, and every dialog whose body
is an `empty()` — "Nothing stuck", "Nothing deleted", "Nothing has conflicted".
A household with tidy records is the one that gets the broken dialog.

The dialog now carries `tabindex="-1"`: reachable by script, never a stop in
the Tab order — `trapFocus` excludes `[tabindex="-1"]` from its cycle for the
same reason.

**This is the router fault at the top of this file with the halves swapped.**
There, `tabindex="-1"` was set and nothing ever focused it. Here, something
focused it and the attribute was never set. The same two lines, failing in
opposite directions, in two components, neither caught by a check that read
markup.

## What is checked now

Five checks, built in the page rather than driven through the live path — the
real `Discard` button throws a record's pending change away, and the reasoning
is the one the `listItem` block already records:

- two dialogs at once do not share one title id;
- the dialog on top is announced by its own name;
- opening a dialog moves focus into it;
- Escape closes a dismissable dialog;
- closing it puts focus back where it came from.

Mutation-tested, both ways. Restoring the constant id fails the first two and
nothing else:

```
FAIL  two dialogs at once do not share one title id
FAIL  and the dialog on top is announced by its own name
      announced as "The one underneath", is "The one on top"
```

Removing the `tabindex` fails the third and nothing else:

```
FAIL  opening a dialog moves focus into it
      movedIn: false
```

## What this still does not establish

The same limit as everything above it. These are claims about focus, ids and
`aria-labelledby` resolution — that the top dialog's accessible name is now its
own title is a fact about the DOM, not a recording of a screen reader saying
it. `docs/UI_PHASE_STATUS.md` keeps UI-14 at PARTIALLY_COMPLETE, and this
finding is an argument for why it should stay there: the fault was in the
half that markup checks can see, and it survived fifteen dialog checks that
were looking at the text instead.
