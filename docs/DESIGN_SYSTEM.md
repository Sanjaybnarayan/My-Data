# Design System

The whole system is **102 custom properties** defined in `css/tokens.css` — 177
declarations once the two dark-mode blocks redefine what they change — and the
rule that nothing outside that file may write a colour. Everything below describes what
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

## What the tokens cover

Counted from the `:root` block, by the comment headings in the file itself:

| Group | Count | Notes |
| --- | --- | --- |
| Palette ramp | 34 | blue, teal, green, amber, red, purple, pink, 13 greys |
| Roles | 32 | surface, border, text, accent, positive/warning/danger, 8 chart series |
| Spacing | 7 | `--space-1` … `--space-7`, 4px → 48px |
| Shapes | 7 | four radii, three shadows |
| Typography | 12 | system stack, no webfont |
| Motion | 5 | two easings, three durations |
| Layout | 5 | nav widths, header height, bottom-nav height, content max |
| **Total** | **102** | |

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

## Adding a token

1. Add it to the `:root` block in `css/tokens.css`.
2. Add its dark-mode value to **both** the `[data-theme='dark']` block and the
   `prefers-color-scheme` block. They are duplicated on purpose — a media query
   cannot be re-entered from an attribute selector — and a token defined in one
   but not the other is a bug that only appears for half the users.
3. If it is a colour used for text, check the contrast pair in both themes.
