# UI / UX Audit

**Base:** `1c8d97d` · 22 August 2026.

## What exists

| Measure | Value |
| --- | --- |
| Screens (modules) | 21 |
| Entities rendered | 47, all through **one** form and **one** table |
| CSS | 1,562 lines across `tokens.css`, `base.css`, `components.css` |
| Design tokens | 176 custom properties in `tokens.css` |
| Dark mode | `prefers-color-scheme` + `data-theme`, three states (light / dark / follow system) |
| `aria-*` attributes | 81 across `js/ui/` and `js/modules/` |
| Direct `db.repo()` calls from UI | 58, budgeted and never raised |

A dark-mode user never sees a white flash: the stored theme is read by an inline
script in `index.html` before the stylesheet paints, and the native launch
screens ship in light and dark.

## Present / absent

**Present:** loading states, empty states, error states, confirmation dialogs,
destructive-action guards, sensitive-data masking, search, filters, charts,
responsive tables, notifications (toasts), timeline.

**Absent:** skeleton states, family-member switching, per-person profile pages,
bottom navigation on mobile, Wallet-style entity cards.

## Against the target direction

The target is a modern Android-native visual language, Wallet-inspired
information architecture, card-based entities, profile-centric layouts.

| Component | File | Verdict |
| --- | --- | --- |
| Card, badge, empty, money primitives | `js/ui/components/basics.js` | **KEEP** — already card-based |
| Schema-driven form | `js/ui/components/form.js` | **KEEP** — 47 entities from one implementation |
| Table | `js/ui/components/table.js` | **REFINE** — responsive; needs a card-list mode on mobile |
| Shell / navigation | `js/ui/shell.js` | **REFINE** — add bottom navigation for mobile |
| Charts | `js/ui/components/charts.js` | **KEEP** |
| Modal / toast | `js/ui/components/modal.js`, `toast.js` | **KEEP** |
| Token layer | `css/tokens.css` | **KEEP** — exactly the foundation the target needs |
| Icons | `js/ui/icons.js` | **KEEP** — inline SVG paths, no asset dependency |
| Settings | `js/modules/settings.js` (110 lines) + 7 files in `js/modules/settings/` | **DONE** — split by concern; it had grown to 1,894 first, because nothing measured it |
| Per-person profile | — | **BUILD_NEW** |
| Wallet-style entity cards (identity, vehicle, insurance, document) | — | **BUILD_NEW** |
| Family-member switcher | — | **BUILD_NEW** |
| Skeleton states | — | **BUILD_NEW** |

## Can this UI evolve toward the target?

**Yes, additively.** Three reasons:

1. **The token layer already exists.** 176 custom properties means a visual
   refresh is a token change, not a rewrite.
2. **Rendering is schema-driven.** A Wallet-style card renderer added beside the
   existing table would apply to all 47 entities at once, the same way the
   generic form does today.
3. **Card primitives are already the vocabulary.** `card`, `cardHeader`,
   `badge`, `empty` and `money` are what the target design is built from.

The profile screen is the one genuinely new construction. Everything needed to
populate it — completion percentage, per-person records, "needs attention"
reminders — already exists in the domain layer (`js/domain/reminders.js`,
`js/services/records.js`), and is not currently assembled onto one page.

## Accessibility

81 `aria-*` attributes, semantic table markup with `role="columnheader"` and
`aria-sort`, `sr-only` labels for checkbox sets, focus management in forms and
modals, keyboard handling on sortable headers (Enter and Space). Not audited
against WCAG, and no such claim is made.

## Sensitive data on screen

Masking is on by default and driven by `js/data/classification.js`. A masked
value is revealed per field, deliberately, and the reveal is labelled. This is
one of the stronger parts of the UI and it is applied through the same door for
screens, exports and the assistant.
