# Component Library

60 exports across 11 files in `js/ui/`. There is no framework: `h()` builds real
DOM nodes and every component is a function that returns one.

## The construction layer — `js/ui/dom.js`

`h(tag, props, children)` sets text through `textContent` and never parses a
string as markup. That is why the rest of the application never thinks about
escaping: a payee called `<img onerror=…>` is displayed literally. The one place
HTML is unavoidable — the rich-text body of a note — goes through
`js/security/sanitize.js` and nowhere else.

| Export | Purpose |
| --- | --- |
| `h` | build an element |
| `append`, `replace`, `frag`, `text` | children, and the only sanctioned way to clear a node |
| `$`, `$$`, `on`, `delegate` | queries and listeners |
| `schedule` | a frame-batched write |
| `focus`, `trapFocus` | focus management for dialogs |
| `announce` | say something to a screen reader |

## Primitives — `js/ui/components/basics.js`

`card`, `cardHeader`, `button`, `iconButton`, `badge`, `chip`, `avatar`,
`metric`, `money`, `empty`, `skeleton`, `skeletonList`, `progress`, `listItem`,
`dueBadge`, `dateText`, `reveal`, `divider`, `pageHeader`.

### The composition contract

Every primitive that accepts a `class` **adds** it to the classes it composes.
It never substitutes. This is stated because it was not true:

```js
// What button() did. `rest` still holds `class`, so the spread wins.
{ class: ['btn', variant && `btn--${variant}`, rest.class], ...rest }

// What it does now.
{ ...rest, class: ['btn', variant && `btn--${variant}`, rest.class] }
```

`button({ class: 'btn--small' })` used to return an element whose whole class
was `btn--small` — no `btn`, so no pill, no background, no minimum height.
`tests/composition.test.mjs` asserts the contract for `button`, `iconButton`,
`card`, `badge` and `chip`, and includes the broken composition to prove the
test can still fail.

**When adding a primitive that takes props: spread first, compose after.**

### `reveal(value, {label})`

The control for a masked identifier. Renders `••••••••` with an eye toggle and a
copy button, and the copy toast says *clear your clipboard when you are done* —
a clipboard on a shared machine is a real leak.

Whether a field is masked at all is not decided here. `js/data/classification.js`
answers it: `CRITICAL_SECRET` always, and `HIGHLY_SENSITIVE` only for text
fields whose key looks like an identifier. Names, dates, diagnoses and amounts
are not masked, because hiding them protects nothing from the person reading
the screen and destroys the thing they opened.

## Form — `js/ui/components/form.js`

One export, `entityForm`. 53 entities and 614 fields render through it. Field
type comes from the schema; validation is the same validator the repository
uses, so an invalid save is refused for the same reason in both places.

## Table — `js/ui/components/table.js`

`entityTable`, `cellFor`, `filterBar`. Sortable columns carry `aria-sort`.

A masked cell in a **list** renders the masked string with a title saying *open
the record to see it in full* — not a `reveal()` control. A list of eye buttons
would destroy the list rather than protect anything; the full value is on the
record, behind a deliberate press.

**Known gap:** on a narrow screen the table scrolls horizontally rather than
becoming a card list.

## Modal — `js/ui/components/modal.js`

`modal`, `confirm`, `inform`, `prompt`. Focus is trapped while open and returned
on close; `aria-modal` and a labelled heading are set by the component, not by
callers.

## Toast — `js/ui/components/toast.js`

`toast`, `mountToasts`. An error toast is given **no timer** — it stays until
dismissed — which is why its ✕ has to be a real target. It was 25×25 until the
tap-target sweep found it.

Every toast also reaches the live region through `announce`, because a screen
reader does not see one appear.

## Charts — `js/ui/components/charts.js`

`barChart`, `lineChart`, `donutChart`, `sparkline`, `legend`, `seriesColour`,
`niceMax`. Inline SVG, series colours from tokens, no charting dependency.

## Shell, routing, theme, icons

| File | Export | Notes |
| --- | --- | --- |
| `js/ui/shell.js` | `buildShell` | header, drawer, bottom nav, outlet |
| `js/ui/router.js` | `Router` | hash-based; modules loaded with dynamic `import()` on first navigation |
| `js/ui/theme.js` | `storedTheme`, `effectiveTheme`, `applyTheme`, `watchSystemTheme`, `nextTheme`, `THEMES` | three states |
| `js/ui/icons.js` | `icon`, and the path set | 24×24 paths, `currentColor`, no icon font and no network request |

## Adding a component

1. Put it in `js/ui/components/`, not in a module — a component used by one
   screen today is used by three next month.
2. Take `class` and spread `...rest` **before** composing it.
3. Style it in `css/components.css`. A class written in JavaScript with no rule
   behind it renders as bare text; 35 such class names currently exist and one
   of them, `.tab`, shipped 17px tall.
4. If it is interactive, it inherits the 44px minimum only if its selector is
   in the touch block at the end of `css/components.css`. Add it, and let
   `tests/browser.mjs` confirm it rather than assuming.
