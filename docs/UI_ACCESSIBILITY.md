# UI Accessibility

What is implemented, what is measured, and what is missing. Nothing here is
claimed on the strength of an attribute being present in the source — where a
line says *measured*, a check measures it.

## Measured

**Touch targets — 44×44 CSS pixels, every control.** `tests/browser.mjs` drives
a real Chromium at 390×844 across eleven screens, reads the rendered box of
every button, link, input and select, and fails the build on anything under
44px in either dimension. It also asserts the sweep saw at least fifteen kinds
of control, because a sweep that measures nothing reports no failures.

This is the standard the application states, and it is stricter than WCAG 2.2
AA (2.5.8 asks 24×24). It matches AAA 2.5.5.

Before the sweep existed, 18 of 23 kinds of control were under it and three
were under 24px. The rule that was supposed to enforce it sat in `css/base.css`
and lost the cascade to `css/components.css`, so it applied to nothing. The
comment above it had been true of nothing since it was written — which is the
argument for measuring rather than declaring.

**Text contrast — WCAG AA, both themes.** `tests/browser.mjs` walks the
rendered document in light and in dark across ten screens, resolves each text
element's real ground (compositing translucent layers, and resolving a gradient
to its stops), and fails on any pair under 4.5:1 — 3:1 for large text. It also
asserts it read more than 200 text elements per theme, because a sweep that
reads nothing reports no failures.

`css/tokens.css` had claimed this since it was written. When it was first
measured, **nine pairs failed in light and seven in dark.** One token caused
most of them: `--text-faint` was `--grey-500`, which is 4.27:1 on white and
3.91:1 on `--surface-sunken`.

**What the sweep cannot see:** a style that only appears in a state the run
never reaches. The offline sync pill had the same 2.89:1 defect as the warning
badge and this sweep did not find it — the network never went down. It was
found by reading the rule after the badge pointed at it. A passing run means the
pairs that rendered are sound, not that every pair in the stylesheet is.

**No horizontal overflow on a phone.** Twenty-seven screens at 390px and 320px,
measured in `tests/browser.mjs`, naming the widest offending element rather than
reporting that "something" is too wide.

This check used to run on the dashboard alone — the screen least likely to fail
it. Widened, it found seven screens scrolling sideways, four of them at 1204px
on a 390px phone, and at 320px a badge carrying the qualifier on the encryption
claim being pushed off the edge.

## Implemented

**Reduced motion.** `prefers-reduced-motion: reduce` sets every duration token
to `0.01ms` — none, not less. Vestibular triggers are not a matter of degree.
The sync-pill spinner is stopped explicitly.

**Forced colours.** Under `forced-colors: active` the shadows are removed and
`--border` becomes `CanvasText`, so Windows high-contrast supplies its own
palette instead of fighting the app's.

**Colour is never the only signal.**

| Meaning | Colour | Also |
| --- | --- | --- |
| Today, in the calendar | accent | a border, and a bolder number |
| A selected tab | accent | weight, and a rule under it |
| A due or overdue item | warning / danger | the `dueBadge` text |
| A sync problem | danger | the pill's own words |
| A chart series | 8 series tokens | a legend with labels |

**Focus is visible.** `:focus-visible` in `css/base.css` draws the ring, and it
is `:focus-visible` rather than `:focus` so a mouse user does not see one on
every click.

**Dialogs trap focus.** `trapFocus` in `js/ui/dom.js` keeps Tab inside an open
modal and releases it on close. Without it, tabbing walks into the page behind,
which for a screen-reader user means the dialog silently ceases to exist.

**The drawer returns focus.** Closing it moves focus back to the button that
opened it, when focus was still inside.

**Toasts reach a live region.** A screen reader does not see a toast appear, so
`announce()` says it. Errors are announced assertively; everything else
politely.

**Icon-only controls are labelled.** `iconButton` sets `aria-label` and `title`
from one argument, so an unlabelled icon button is not a thing a caller can
accidentally build.

**An error toast has no timer.** It stays until dismissed, because a message
somebody has to read must not disappear while they are reading it. Its ✕ is a
real target — 32×32, and 44×44 on touch.

**16 distinct `aria-*` attributes** are in use: `atomic`, `busy`, `current`,
`describedby`, `expanded`, `hidden`, `invalid`, `label`, `labelledby`, `live`,
`modal`, `pressed`, `sort`, `valuemax`, `valuemin`, `valuenow`.

**A skip link** is the first focusable element on the page.

**Masked values are not hidden by colour.** A masked identifier renders as
`XXXX 1234` or `••••••••` — an actual change of characters, not a low-contrast
treatment — and its title says how to see it in full.

## Not implemented

**No screen-reader run has ever happened.** No TalkBack, no NVDA, no VoiceOver.
Every accessibility claim above is either measured mechanically or read from
the source. Mechanical checks cannot tell you whether a screen is *usable*,
only whether particular defects are absent, and the difference between those
two is exactly where real accessibility problems live.

**Contrast is checked only where it renders.** See the note under the sweep: a
state the run never enters is a state nothing measures. Non-text contrast — the
3:1 that WCAG 2.2 asks for borders, focus rings and icons under 1.4.11 — is not
checked at all; the sweep looks at text.

**Tables scroll horizontally on a narrow screen** rather than becoming a card
list.

**No keyboard shortcuts and no roving tabindex** in the bottom navigation or
the tab strips; both are plain link lists, which works but is not the pattern a
screen-reader user expects from a tab set. The tab strip in
`js/modules/belongings.js` uses links rather than `role="tablist"`, which is
honest — they are navigation, not tabs over one panel — but it means the
`.tab--active` state is carried by `aria-current` alone.

**No reduced-transparency handling** (`prefers-reduced-transparency`).

## If you are adding a screen

1. Interactive things must be `<button>` or `<a>`. A `<div>` with an `onClick`
   is not reachable by keyboard, and the tap-target sweep will not see it
   either — it looks for real controls.
2. An icon-only control goes through `iconButton`, which forces a label.
3. Anything that appears without a navigation — a toast, an inline error —
   goes through `announce()`.
4. Do not encode a state in colour alone. Add the word, the border or the
   weight.
5. Add your control's selector to the touch block at the end of
   `css/components.css`, then let `tests/browser.mjs` confirm the size rather
   than assuming it.

## UI-7: the screen that had never opened, and the sweep that found it

### A staff member's record has never rendered

`recordDetail` calls `options.extra(record)`. `staffDocuments` took that
argument as an **id** from the day it was written, so `repo('staff').get()` was
handed a whole object. IndexedDB refused it — *the parameter is not a valid
key* — the route threw, and clicking a staff member left you looking at
whatever screen you were already on.

Three cards had therefore never drawn: the pay reconciliation against what was
agreed, what that person can be shown about themselves, and the documents filed
against them. `extra(record)` arrived in #76 and `staffDocuments(id)` in #81,
so the contract was wrong from the first commit that used it.

Nothing walked there. The module sweep opens `#/family`, and the index renders
perfectly well.

### Why four hundred passing checks pointed nowhere near it

The only symptom that reached the console was `transaction aborted` — no store,
no key, no stack past `idb.js`.

`IdbAdapter.tx` aborts the transaction deliberately when the function inside it
throws, then rethrows the real error. But the abort rejects the transaction's
`done` promise, and on that path nobody awaits it. The unhandled rejection is
what surfaced; the informative error did not. Claiming the rejection before
aborting makes the real message the only one reported, which is how
`DataError: The parameter is not a valid key` finally became visible.

A second, smaller fault in the same call: `documentsForStaff` returned the
person's **id** where the screen read `.name` and `.id` off it. The card was
headed *"What they can be shown"* for everybody, and asked what was held about
`undefined`. It now returns the person record.

### Are identifiers masked? Three attempts at a check that can fail

The brief requires Aadhaar, PAN, bank account, CKYC and card numbers masked by
default, and forbids sensitive values in a URL or the page title. Three
existing checks covered one entity. The sweep now covers **23 fields across 16
entities**, and getting there took three tries:

1. **Ask `maskable()` which fields to watch.** That is the function under test.
   Unmasking `accountNumber` made the sweep stop seeding a sentinel into it, so
   the leak became invisible and the run passed clean. *A check that derives its
   own subject from the code under test cannot fail.*
2. **A key-shape regex.** It flagged `receipt.orderId` and `deviceKey.deviceId`
   — an order number off a shop receipt, and the id that tells two of your own
   phones apart. Neither is a secret, and `classification.js` explains at length
   why masking everything is a visible bug.
3. **A named list.** Hand-maintained, which this repository normally treats as a
   defect; the mitigation is that every pair is checked to still exist in the
   schema, so a rename fails loudly rather than leaving the sweep watching
   nothing.

### Masked, unmasked, and never shown are three different answers

Sentinels end in four uppercase letters because `mask()` keeps the last four
characters. That separates the outcomes:

| What the sweep sees | What it means |
| --- | --- |
| the full token | shown in full — a leak |
| the tail only | masked, on a real screen, proven |
| neither | never displayed at all; the sweep proves nothing here |

Today: **19 of 23 proven masked**, 4 never displayed —
`vaultItem.password`, `vaultItem.totpSecret`, `digitalAsset.licenceKey` and
`beneficiary.assetId`. The first two are `CRITICAL_SECRET` and have no partial
form by design.

That third row is why the first mutation appeared to survive. Unmasking
`account.accountNumber` changed nothing visible until the sweep learned to tell
"masked" from "never rendered".

### The control that makes the negative result mean something

Every non-identifier text field is seeded too, and at least 50 of them must be
found on a screen. If ordinary values never reach the DOM, the absence of the
masked ones says nothing — and an earlier version of this sweep was in exactly
that state for seven entities without reporting it.

**521 browser checks pass. 2 of 2 mutations caught**: identifiers rendered in
full (19 leaks reported, 0 proven masked), and the record handed back as an id
(five failures, and the console error now names the real cause).
