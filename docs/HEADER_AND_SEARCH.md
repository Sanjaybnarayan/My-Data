# The Header Was Three Things Fighting for 390 Pixels

`js/ui/shell.js`, `js/app.js`, `js/ui/components/syncstatus.js`,
`js/modules/dashboard.js`, `js/modules/profile.js`, `css/components.css`,
`css/base.css`.

## What was reported, and what was true

From a device: sync looked odd, search was "not searching anything", and both
bars needed work.

**Search was searching.** Driven end to end for the first time, it finds the
record, ranks it, and links to it. What was broken was narrower and worse than
a dead feature: `quickSearch` ran from **two** characters and `searchIndex`
dropped any word under **three**, so two characters always produced *"Nothing
matching"*. That sentence describes an empty household. It is what somebody
sees while still typing the third letter of a word, and it is a lie.

Two floors, one of them written twice — the shape this repository keeps
finding. `MIN_PREFIX` is exported now and the box imports it, so there is one
number. Below it the box says *"Keep typing"*, which is the true statement.

**Nothing had ever typed into that box.** The global search had no test at
all. The two lines touching it focused and blurred it for the keyboard checks
and never pressed a key.

## What moved, and why

**Sync left the header.** It said "Synced" almost always, in words, in the
strip a phone has least of. It is a card on the Dashboard — the screen
somebody lands on, so a failure is still met on the way in — with room to say
what is wrong and a button to try again.

The state-to-words map moved with it into `js/ui/components/syncstatus.js`
rather than being copied, and `syncNow` came out of `js/app.js` for the same
reason: with the pill gone, its four-line behaviour would have been rewritten
on the Dashboard, which is how two versions of one sentence begin.

**Search became a panel.** On a phone the button opens it over the bar and the
field gets the whole width; above 901px it is simply always inline, because a
desktop header has the room and an extra tap there is the worse trade.

**Lock left the header too**, one release after arriving there. It went there
because removing the drawer had otherwise left Profile → Settings → Security
as the only route. On a device it read as clutter beside the theme button, so
it is a row at the end of Profile: two taps, and a word rather than a glyph.

## Three faults found while moving things

**`listItem` promised a button and delivered a div.** A row given `onClick`
got `role="button"` and `tabindex="0"` and no key handler, so nine rows across
the application announced themselves to a screen reader as buttons and
answered only a pointer. Enter and Space work now; Space is prevented as well
as handled, because on a focused element it also scrolls.

**Locking from Settings wrote no audit entry.** The shell's lock dropped the
key, logged, and reloaded; Settings → Security's dropped the key and reloaded.
Both call `lockNow` now, so the event an audit log exists to hold is held
whichever route somebody took.

**`hidden` is a `display` rule, and lost.** The panel was hidden with the
attribute and shown with `.search-panel { display: flex }` — which beat it, so
the field stayed on screen with the attribute set. It is a class the
stylesheet owns now. The breakpoint rules had to move to `components.css` as
well: hiding the toggle from `base.css` lost to `.btn--icon`, which loads
after it, so the button appeared on desktop beside the field it exists to
replace. Both were found by checks failing, not by reading.

## What the checks cover

Sixteen new browser checks: the search finds a real record and links to it;
two characters does not claim there is nothing matching, and says the word is
unfinished; a genuine miss still says so; the phone header carries no sync and
the Dashboard card does; the search button opens the panel, takes the cursor,
says so to a screen reader, and puts it away again; a desktop keeps the field
inline and needs no button; lock is a row on Profile and is reachable by
keyboard.

The keyboard checks had to change with the design — the field is inside a
closed panel now, so they go through the button, which is the path a phone
actually has. They failed rather than passing on a path nobody walks.

## What this does not establish

The bottom bar and the keyboard have been confirmed on a device. **The header
rework has not.** Nothing here has run under a screen reader either, and the
`listItem` fault is exactly what that misses: nine rows were correct in
markup and unusable in practice.
