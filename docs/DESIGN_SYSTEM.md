# Design System

The whole system is the custom properties in `css/tokens.css` and the rule that
nothing outside that file may write a colour.

`tests/tokens.test.mjs` asserts the vocabulary below exists, that every token is
defined in `:root`, and that the two dark-mode blocks redefine **exactly** the
same set — a token changed in one and not the other is a bug that appears for
half the users and is invisible to whoever made it. Everything below describes what
those properties are for and which decisions they have already settled.

## The one rule

> A component that hard-codes `#1a73e8` is a component that cannot be themed.

Dark mode is a redefinition of these variables and nothing else — no second
stylesheet, no per-component overrides. Eight colour literals exist outside
`tokens.css` and every one of them is listed and justified in
`docs/UI_UX_AUDIT.md`; six are cases a variable cannot reach, such as the
`theme-color` meta attribute, which is HTML and cannot read CSS.

## Layers

The palette is a tonal ramp per hue. **Nothing in the application refers to a
ramp step.** Components refer to *roles* — `--surface`, `--text-muted`,
`--danger` — and the roles refer to the ramp. That indirection is what makes a
theme a fifty-line block instead of a rewrite.

```
--blue-500: #1a73e8      the ramp        named by hue and lightness
--accent: var(--blue-500)  the role      named by what it is for
.btn--primary { background: var(--accent) }   the component
```

### Three roles per status, not two

Each status colour has a `--x`, a `--x-subtle` and a `--x-text`:

| Role | For |
| --- | --- |
| `--warning` | the thing itself — a bar, an icon, a rule |
| `--warning-subtle` | a ground to put it on |
| `--warning-text` | **text on that ground** |

`--accent` had all three from the beginning; the others had two, so a warning
badge painted `--warning` on `--warning-subtle` and measured **2.89:1**. The
rule is now uniform: **on a `-subtle` ground, use `-text`.**

Amber is the hue where this bites — it cannot be read at its own mid-tone —
which is why `--amber-800` exists and `--warning-text` points at it.

## What the tokens cover

Counted from the `:root` block, by the comment headings in the file itself:

| Group | Count | Notes |
| --- | --- | --- |
| Palette ramp | 37 | blue, teal, green, amber, red, purple, pink, 15 greys |
| Roles | 42 | surfaces, border, text, six statuses × three roles, 8 chart series |
| Spacing | 10 | `--space-1` … `--space-12`, 4px → 96px |
| Shapes | 9 | five radii, a named card radius, three shadows |
| Typography | 18 | two families, the numeric scale, six semantic sizes |
| Motion | 5 | two easings, three durations |
| Layout | 5 | nav widths, header height, bottom-nav height, content max |
| **Total** | **126** | 221 declarations with the two dark blocks |

The eight chart series sit under Roles because that is where the file puts
them; they are chosen so no two adjacent colours form a red/green pair.

## Decisions already made, and why

**No webfont.** `--font` is a system stack. Text paints on the first frame and
never reflows when a font arrives.

**Surfaces, not elevation, in dark mode.** Dark mode raises a surface by
lightening it. A shadow on a dark ground is invisible, so the border does the
separating instead.

**Three theme states, not two.** Light, dark, and *follow the system* — the
third is the default. The stored preference is read by an inline script in
`index.html` before the stylesheet paints, so a dark-mode user never sees a
white flash.

**Reduced motion means none.** `prefers-reduced-motion` sets every duration to
`0.01ms`, not to a smaller number. Vestibular triggers are not a matter of
degree.

**Forced colours are obeyed.** Under `forced-colors: active` the shadows go and
the border becomes `CanvasText`. Fighting a high-contrast mode makes the app
unreadable for the people who most need it.

**Contrast is measured, not asserted.** This file used to claim every text pair
met WCAG AA in both themes. When that was finally measured, nine pairs failed in
light and seven in dark. `tests/browser.mjs` now walks the rendered document in
both themes and fails the build on any pair under 4.5:1 (3:1 for large text).

**Colour is never the only signal.** Today is marked by a border and a bolder
number as well as by a colour. A selected tab carries weight and a rule. A
`badge--danger` carries its text.

## Touch targets

Every control reaches **44×44 CSS pixels** under `(pointer: coarse)` or below
900px wide. The rule lives at the end of `css/components.css` — after
everything it has to beat — and `tests/browser.mjs` measures the rendered boxes
across eleven screens rather than trusting it.

It used to live in `css/base.css`, where it lost the cascade to
`components.css` and applied to nothing. The measurement exists because the
comment did not survive contact with one.

Small controls stay visually small: `.btn--small` keeps its short padding and
gains the box around it. A 44px target around a 30px-looking button is the
intent, not a mistake.

## What this system is not

It is **not** a copy of any third-party interface. The ramp is derived from
Material's tonal approach, which is a published method, not a design. No
proprietary layout, icon set, or trademarked graphic is reproduced anywhere in
`css/` or `js/ui/icons.js`; the icons are 24×24 paths drawn for this
application and stroked with `currentColor`.

## The naming, and one deliberate deviation

The v8.0 brief asked for a token list using names like `--color-primary`,
`--radius-md` and `--shadow-sm`. **Fifteen of those already existed here under
different names.** They have not been renamed, and no aliases were added.

Two names for one value is how a token system drifts: the next person has to
choose between them, nothing says which is canonical, and the two eventually
disagree. So there is one name per value, and this table is the translation.

| Brief's name | This repository | Why |
| --- | --- | --- |
| `--color-primary` | `--accent` | already used in ~60 rules |
| `--color-secondary` | `--secondary` | **added** — teal, the second hue |
| `--color-background` | `--surface` | the page ground |
| `--color-surface` | `--surface-raised` | a card on the page |
| `--color-surface-elevated` | `--surface-elevated` | **added** — a card on a card |
| `--color-text-primary` | `--text` | |
| `--color-text-secondary` | `--text-muted` | `--text-faint` is a third step |
| `--color-success` | `--positive` | reads correctly on money |
| `--color-warning` | `--warning` | same name |
| `--color-error` | `--danger` | |
| `--color-info` | `--info` | **added** |
| `--radius-md` | `--radius` | 14px; cards use `--radius-card` |
| `--radius-xl` | `--radius-xl` | **added** — 28px, wallet cards and sheets |
| `--shadow-sm/md/lg` | `--shadow-1/2/3` | numbered by elevation, not size |
| `--font-body` | `--font-body` | **added**, with the five siblings |

**Added because they genuinely did not exist:** `--secondary`, `--info`,
`--surface-elevated` (each with a `-subtle` ground and a `-text` role),
`--radius-xl`, `--radius-card`, `--space-8`, `--space-10`, `--space-12`, and
the six semantic type sizes.

Every new text-on-ground pair was contrast-measured before it shipped:

| Pair | Light | Dark |
| --- | --- | --- |
| `--secondary-text` on `--secondary-subtle` | 5.71:1 | 6.33:1 |
| `--info-text` on `--info-subtle` | 7.05:1 | 5.47:1 |

## Type: sizes, not families

`--font` and `--font-mono` are **families**. `--font-display`, `--font-headline`,
`--font-title`, `--font-body`, `--font-label` and `--font-caption` are **sizes**,
mapped onto the numeric scale. The names sit close together, so this is said
plainly here rather than discovered.

A screen should ask for the role it means — `--font-display` for a net-worth
figure — rather than a step number, so retuning the scale is one edit.

The stack stays the system UI stack rather than Inter. The brief allows either;
a system stack paints on the first frame and never reflows when a webfont
arrives, which on a financial screen means the number never moves after you have
started reading it.

## Radius

| Token | Value | For |
| --- | --- | --- |
| `--radius-sm` | 8px | inputs, small controls |
| `--radius` | 14px | inline surfaces |
| `--radius-lg` | 22px | — |
| `--radius-card` | `--radius-lg` | **every card**, one edit to retune |
| `--radius-xl` | 28px | wallet cards, bottom sheets |
| `--radius-pill` | 999px | buttons, chips, badges |

Cards moved from 14px to 22px, inside the 18–28px band the brief asks for.

## Adding a token

1. Add it to the `:root` block in `css/tokens.css`.
2. Add its dark-mode value to **both** the `[data-theme='dark']` block and the
   `prefers-color-scheme` block. They are duplicated on purpose — a media query
   cannot be re-entered from an attribute selector — and a token defined in one
   but not the other is a bug that only appears for half the users.
3. If it is a colour used for text, check the contrast pair in both themes.
