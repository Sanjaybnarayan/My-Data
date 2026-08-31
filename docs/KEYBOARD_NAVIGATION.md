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

## And the duplicate id is now checked generically

The dialog fault was found by reading the code and suspecting it. That is not
a method — it does not scale to the next one, and it did not find this one for
the eleven months the constant sat there.

So the accessibility walk, which already opens every module and entity screen
and checks heading order, accessible names and labels, now also fails on **any
id used twice on any screen**. A duplicate is invalid HTML on its own, but the
reason it earns a check is what points at one: `aria-labelledby`,
`aria-describedby` and `label[for]` all resolve through `getElementById`, which
returns the first match. A duplicate never errors. It quietly names the wrong
element, which is the whole of what went wrong in the dialogs.

---

# The Undo That Expired, and Was Never Announced

`js/ui/components/toast.js`, `js/locale/en.js`, `tests/browser.mjs`.

Deleting a record raises `Person deleted` with an **Undo** beside it. That
button is the only way back — the record is soft-deleted and restoring it
otherwise means knowing about Settings → Deleted items.

It carried the ordinary four-second timer.

## Two faults, one line apart

**It expired.** `duration = ms ?? (kind === 'error' ? 0 : 4000)`. An error gets
no timer because somebody has to read it; nothing said the same about a toast
that *offers* something. Four seconds is enough to read "Person deleted" and
not enough to notice a button beside it, decide, and reach it — and for
somebody tabbing towards it, or waiting to be told it is there, it is not an
offer at all.

The application already knew this. Both actionable toasts in `js/app.js` pass
`ms: 0` by hand. The Undo after a delete is the third, and the one that did
not — so the convention existed, and the one place a household is most likely
to want it was the place it was missed. It is decided in `toast()` now rather
than at the call site, so the next actionable toast does not have to remember.

**And it was never announced.** `announce(message, …)` was passed the message
alone, so the live region said "Person deleted" and stopped. The button beside
it was announced to nobody. The person who cannot see an Undo is the person who
most needs telling it exists, and they were the one told least.

The live region now carries both, through one catalogue key rather than two
announcements — `{message} — {action} available` — because where the offer
belongs in the sentence is a fact about the language, not about the component.

## What is checked

Nothing had ever driven a toast for its own sake. The suite read one's text in
a single place and cleared leftovers in another; it had never raised one,
waited to see whether it survived, or asked what the live region said about it.
Four checks now:

- both toasts were raised — the premise, so the rest cannot pass on an empty
  screen;
- a toast offering an action announces the action, not only the message;
- a plain confirmation clears itself — so the timer is still real;
- and an Undo does not expire before it can be taken.

The third is what stops the fix from being "remove the timer". A confirmation
that needs dismissing is the fault the file's own header warns about: *"Saved"
that needs a click is worse than no message at all.*

---

# The Live Region Held One Message, and Kept the Wrong One

`js/ui/dom.js`, `tests/browser.mjs`.

Two faults in `announce()`, the one function every screen-reader announcement
in this application goes through — the router's *"you are now on Finance"*, and
every toast.

## Politeness was rewritten per message

There was one region, and each call set its `aria-live` before writing to it:

```js
liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
```

A screen reader registers a live region when it is inserted and takes its
politeness then. Rewriting the attribute afterwards is not reliably picked up,
which puts the one case that depends on it — an error, the only caller that
passes `assertive` — on the setting it was trying not to use.

There are two regions now, one per politeness, each created once and never
retuned.

## And two messages in one frame left only the second

`schedule` batches into a single animation frame, so two calls close together
wrote both messages into the same element back to back with nothing between
them. Measured, reading the mutation records rather than the element:

```
["(cleared)", "Dashboard", "Could not save"]
```

Three mutations, one frame. The first message reached the DOM and was gone
before anything could read it.

**This was not hypothetical, and it broke the fix directly above it in this
file.** `crud.js` deletes a record like this:

```js
toast('Person deleted', { action: { label: 'Undo', … } });
router.navigate({ module: def.module, entity: entityName });
```

The toast announces the offer; the navigation announces the screen it lands
on. So the Undo announcement — added one commit earlier precisely so that
somebody who cannot see the button is told it exists — was overwritten by the
name of a list. The fix was correct and the plumbing underneath it threw the
message away.

Messages are queued now, one per frame, in order.

## Measuring this correctly took three attempts

Worth recording, because the first two readings said the code was fine.

1. A `MutationObserver` that pushed one entry per *callback*. The callback
   batches records, so two mutations collapsed into one entry.
2. One entry per record, but reading `el.textContent` inside the callback — by
   then the element already held the final value, so every entry read the same
   string.
3. One entry per record, reading `record.addedNodes[0].data` — the value at
   the time of that mutation. Only this one shows the sequence.

The first two are the same mistake in different clothes: asking the element
what happened instead of asking the record. A measurement that reads the end
state cannot see something being overwritten, which is the only thing this was
looking for.

## What is checked, and what is still not

- an announcement is not overwritten by the next one in the same frame;
- politeness is a property of the region, not rewritten per message.

Both are claims about the DOM: that the region holds each message for a frame
of its own, and that two regions exist with fixed `aria-live` values. Whether a
screen reader speaks them in that order is not something this machine can
establish and is not claimed. UI-14 stays PARTIALLY_COMPLETE.
