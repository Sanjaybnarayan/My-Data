# UI / UX Audit

**Measured on `main` at `17c4886`, 23 August 2026.** Every number below came
from running the application, not from reading it.

## Method

Two passes. A source pass counted what exists. A browser pass drove a real
Chromium at a 390×844 viewport through eleven screens and measured the boxes
the browser actually laid out — because a stylesheet cannot be asked to
describe itself, and this audit found three places where it had been.

## What exists

| Measure | Value |
| --- | --- |
| Screens (modules) | 24 files in `js/modules/` |
| Entities rendered | 53, with 614 fields, through **one** form and **one** table |
| CSS | 1,759 lines across `tokens.css` (262), `base.css` (291), `components.css` (1,206) |
| Design tokens | 108 in `:root`, 189 declarations with the dark-mode blocks |
| Exports from `js/ui/` | 60, across 11 files |
| Distinct `aria-*` attributes in use | 16 |
| Dark mode | `prefers-color-scheme` + `data-theme`, three states |
| Colour literals outside `tokens.css` | 7, of which 6 are correct (see below) |

## Corrections to the previous audit

The August 22 version of this file listed **bottom navigation on mobile** and
**skeleton states** as *absent*. Both ship:

- `.bottom-nav` renders below 900px and `tests/browser.mjs` has checked that it
  appears on a phone since before that audit was written.
- `skeleton()` and `skeletonList()` are exported from
  `js/ui/components/basics.js` and used by `js/modules/conflicts.js`.

Two rows out of a short list asserted that built things were unbuilt. This is
the same failure the scorecard had — a document describing the code with
nothing comparing the two — and it is why the numbers in this version were
measured rather than recalled.

## What the browser pass found

Measuring the rendered box of every button, link, input and select across
eleven screens at 390px wide:

| | Before | After |
| --- | --- | --- |
| Distinct kinds of control seen | 23 | 21 |
| Under 44px in some dimension | **18** | **0** |
| Under 24px in some dimension | **3** | 0 |

The three under 24px were `.tab` and `.tab--active` at 17px tall, and they were
17px because **`.tabs` and `.tab` had no CSS rule anywhere in the repository**.
They are written in `js/modules/belongings.js` and were never styled, so the
tab strip that switches between Belongings and Warranties rendered as a row of
bare text links.

### Three causes, all of the same kind

**1. A composed value overwritten by a raw one.** `button()` and `iconButton()`
in `js/ui/components/basics.js` built `class: ['btn', variant, rest.class]` and
then spread `...rest` over the top of it. `rest` still holds `class`, so a
caller writing `class: 'btn--small'` got an element whose entire class was
`btn--small` — no `btn`, therefore no pill, no background, no minimum height.
`card()` had the same two ingredients in the opposite order and was always
correct. The difference between the working function and the broken ones is one
line of position.

It survived review because it was survivable: six call sites had been written
`class: 'btn btn--small'`, restating `btn` by hand, and those looked perfect
beside the eleven that did not.

**2. A rule that lost the cascade.** `css/base.css` ended with

```css
/* Every tap target reaches the 44px minimum on a touch screen. */
.bottom-nav a, .nav-item, .btn { min-height: 44px; }
```

`base.css` loads before `components.css`, where `.btn { min-height: 38px }` has
identical specificity. The later declaration won. The rule reached `.nav-item`
and `.bottom-nav a` — the two selectors `components.css` does not restate — and
no button at all. The sentence above it had been true of nothing since it was
written.

**3. Inline styles that no stylesheet could reach.** The calendar month grid was
laid out from JavaScript with `gridTemplateColumns` and `gap` set inline. Inline
declarations beat every rule, so a phone could not tighten the grid, and seven
columns inside a padded card left each day **38px wide** — a target people aim
at with a thumb.

## Present / absent

**Present:** loading states, skeleton states, empty states, error states,
confirmation dialogs, destructive-action guards, sensitive-data masking,
reveal-on-request for identifiers, search, filters, charts, responsive tables,
toasts, timeline, bottom navigation, a drawer, three-state theming, reduced
motion, forced-colours support.

**Absent:** per-person profile pages, a family-member switcher, Wallet-style
entity cards, a card-list mode for tables on narrow screens.

## The hard-coded colours

Seven literals outside `tokens.css`. Six are correct and should stay:

| Where | Literal | Verdict |
| --- | --- | --- |
| `css/base.css` print block | `#ccc` | **Correct** — print is always on white paper |
| `css/components.css` toast error/success | `#fff` ×2 | **Correct** — the grounds are fixed `red-600` / `green-600` in both themes |
| `css/components.css` switch knob | `#fff` | **Correct** — the knob is white on both themes |
| `js/ui/theme.js` `theme-color` meta | `#0e1014` / `#fbfbfc` | **Correct** — an HTML attribute cannot read a CSS variable |
| `js/ui/components/form.js` colour input default | `#1a73e8` | **Acceptable** — a starting *value* the user edits, not a UI colour |

The brand mark used to be an eighth: `#fff` on a gradient built from
`--accent`. It was a real dark-mode contrast defect — white on `--accent`, which
becomes `--blue-300` in dark mode, measures **2.23:1**. It now uses ramp
colours, so every point along the gradient clears 4.5:1 in both themes — and
`tests/browser.mjs` measures it rather than taking this paragraph's word.

## Against the target direction

| Component | File | Verdict |
| --- | --- | --- |
| Card, badge, empty, money, skeleton primitives | `js/ui/components/basics.js` | **KEEP** |
| Schema-driven form | `js/ui/components/form.js` | **KEEP** — 53 entities from one implementation |
| Table | `js/ui/components/table.js` | **REFINE** — needs a card-list mode on narrow screens |
| Shell / navigation | `js/ui/shell.js` | **KEEP** — drawer and bottom nav both ship |
| Charts | `js/ui/components/charts.js` | **KEEP** |
| Modal / toast | `js/ui/components/modal.js`, `toast.js` | **KEEP** |
| Token layer | `css/tokens.css` | **KEEP** — the foundation already exists |
| Icons | `js/ui/icons.js` | **KEEP** — inline SVG, no network request |
| Tab strip | `js/modules/belongings.js` | **DONE** — was unstyled, now in `components.css` |
| Calendar month grid | `js/modules/calendar.js` | **DONE** — inline layout moved to classes |
| Per-person profile | — | **BUILD_NEW** |
| Wallet-style entity cards | — | **BUILD_NEW** |
| Family-member switcher | — | **BUILD_NEW** |

## Can this UI evolve toward the target?

**Yes, additively.** The token layer exists, rendering is schema-driven, and
card primitives are already the vocabulary. A Wallet-style card renderer added
beside the existing table would apply to all 53 entities at once, the same way
the generic form does today.

## What now measures this

`tests/browser.mjs` walks eleven screens at 390px and fails the build if any
control renders under 44px in either dimension. It found a control on its first
real run that the ad-hoc script written to develop it had missed — the ✕ that
dismisses an error toast, 25×25, and the only way to clear a toast that is given
no timer on purpose.

It also asserts that the sweep found at least fifteen kinds of control, because
a sweep that measures nothing reports no failures.

## Open, not fixed

- **Tables on narrow screens** scroll horizontally rather than becoming cards.
- **35 class names** appear in JavaScript with no CSS rule. Most are hooks the
  tests select on, which is a legitimate use; `input--small`, `row--center`,
  `row--tight` and `field__label` read like they were meant to be styled and
  are not. Nothing measures this, and it is how `.tab` stayed at 17px.
