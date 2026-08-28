# UI Information Architecture

## Routing

Hash-based, so the application can be served from any static host — including a
`file://` open of the folder — with no server rewrite rules. A PWA that needs
`try_files` configured is a PWA that breaks on somebody's shared hosting.

```
#/finance                      a module
#/finance/transaction          an entity list
#/finance/transaction/txn_1    one record
#/finance/transaction/new      the create form
```

Module code is loaded on first navigation with a dynamic `import()`, so the
opening payload is the shell and the dashboard rather than every module.

### What is allowed in a URL

**Record identifiers only** — `txn_1`, `person_3`. Never an account number, a
PAN, a policy number, a name or an amount. A hash is not sent to a server, but
it is in the address bar, in the back-stack, and in any screenshot of the
window, so an opaque id is the only thing that belongs there.

The document title is the static `<title>FamilyOS</title>` from `index.html`
and no code ever changes it, so no record name can reach the window title or
the switcher's *caption*. That is the right outcome, but it is currently a
consequence of never having implemented per-screen titles rather than a
control. Anything that adds them must keep record names out.

**The caption was never the larger half.** Android's recents switcher also
holds a photograph of the whole screen, taken automatically every time the app
is backgrounded — a balance, a health record's title, an identifier somebody
had tapped to reveal. This paragraph used to end at the title and read as
though the switcher were handled. `MainActivity` now sets `FLAG_SECURE` for
the window's whole life, which blanks that capture and, deliberately, blocks
screenshots and screen recording of FamilyOS along with it. The reasoning and
its cost are in `docs/ANDROID_SCREEN_CAPTURE.md`. **iOS has no equivalent and
none is built** — the gap is named there rather than left for somebody to
assume closed.

## Navigation

**One navigation per viewport.** The module list comes from the
permission-filtered set of modules the signed-in person may open, and every
surface renders from it, so a module can never appear in one and not another.

| Viewport | Surface |
| --- | --- |
| ≥ 901px | Persistent left rail, `--nav-width` 260px — all 25 modules |
| ≤ 900px | Bottom bar, 5 primary destinations. The other 20 are Profile's own groups |

A phone used to carry **both**: the bottom bar *and* a burger opening a drawer
listing all twenty-five. Two complete navigations, one over the other, which
is what a device showed. The drawer is gone; the rail it shared markup with is
`display: none` below 901px rather than transformed off-screen, because a
transformed panel stays in the accessibility tree and in the tab order — so a
screen reader met twenty-five module links and then five of them again.

Nothing became unreachable. `js/modules/profile.js`'s `grouped()` claims every
module the schema declares, with a catch-all group for anything no named group
takes, and `tests/profile.test.mjs` holds it to that. The one thing the drawer
had that the module list does not is **Lock now**, which would otherwise have
gone from one tap to four (Profile → Settings → Security); it is an icon
button in the header on a phone, hidden on desktop where the rail carries it
with a label.

The drawer closes on navigation — `delegate(nav, 'click', 'a', …)` in
`js/ui/shell.js` — and on scrim press, and the toggle keeps `aria-expanded` and
its label in step with the state.

Closing the drawer returns focus to the button that opened it — but only when
focus was still inside the drawer, so that following a link leaves focus where
the new screen puts it. Opening does not move focus: the drawer is a panel
beside the content, not a dialog over it.

## Screen shapes

Four, and almost every screen is one of them.

**Dashboard.** Cards that summarise and link onward. Nothing is edited here.

**Entity list.** A page header, a filter bar, and a table or card list. Masked
fields render masked. Empty means an `empty()` state that says what to do, not
a blank grid.

**Record.** The full values, including the ones the list masked, each behind a
`reveal()` press. Connections and history sit below the fields.

**Editor.** A modal built by `entityForm` from the schema. Refusal comes from
the same validator the repository uses, and names the field.

## Where a screen gets its data

Through a service in `js/services/`, which reads through `db.repo(...)`. A
service never touches `.adapter`, and a test scans the source to keep it that
way. **58 direct `db.repo()` calls remain in `js/modules/`**, recorded in
`tools/architecture-budget.json` as `uiDatabaseCalls` and checked on every run.
The budget has never been raised.

## Hierarchy on a card

1. What it is — the title.
2. What it says right now — the number, status or date, in `metric` or `money`.
3. What it needs — a `dueBadge`, a warning, a conflict count.
4. What you can do — one action, at the end.

A card with two competing primary actions has been designed as a form.

## Demo and real data

**Not implemented.** There is no demo-data concept in the application: no flag
on a record, no marking in a list, and therefore nothing stopping a demo record
being counted in a total beside real ones.

Nothing currently generates demo data either, so there is no live defect. But
the moment anything seeds sample records — an onboarding tour, a screenshot
fixture, a sales demo — this becomes one, and the requirement is written here
rather than discovered then: a demo record must be marked on the record and in
every list that shows it, and must never be summed into a figure that also
counts real ones.

## What this is not

Not an admin dashboard. The unit of the interface is a **card about one thing a
household owns or owes**, not a row in a table of everything. Tables exist for
the cases where comparison across many rows is the actual task — a statement, a
ledger — and not as the default rendering of a list.

## UI-8: five tabs, no sixth, and nowhere for a module to hide

The brief allows exactly five bottom tabs and says everything else is reached
through them. In practice that makes Profile the only door to twenty modules,
and the door was a hand-written list.

### The eleventh time

`GROUPS` named twenty module ids beside a schema declaring twenty-five. All
twenty-five happened to be reachable — the five missing from `GROUPS` are the
five tabs — so nothing was broken. What was missing was anything that would
*keep* it true. Add a module to the schema tomorrow, forget this file, and it
is reachable only by typing its URL: no tab, no group row, no search result
that names a screen rather than a record.

This is the same fault as the hand-written module walk in the browser suite,
the dashboard's entity array, and the eight before them. The pattern is always
a maintained list beside a derivable one, and the cost is always something
silently absent.

### The order is a judgement; the completeness is not

The four groups stay hand-written, because *yours*, *what you own*, *your life*
and *what is on record* is a decision about how a household thinks and no
derivation produces it. But `grouped()` now derives the last group: anything in
the schema that is neither a bottom tab nor named in a group falls into
**Everything else** — unsorted and unloved, but present, and visibly wanting a
home rather than quietly gone.

`PRIMARY` moved from a module-private constant in `js/ui/shell.js` to an
export, so the five tabs are one list rather than two that agree today.

### Three checks, at two levels

- **The list.** Every module in the schema is reachable from `grouped()`,
  `PRIMARY` or Settings.
- **The mechanism**, against a fabricated schema rather than the real one. With
  every module currently claimed there is no catch-all group at all, so
  asserting on real data would pass whether the derivation worked or not.
- **The links**, in a browser. The unit test proves the list; only the DOM
  proves the anchors. A group card returning `null`, a role filter, or a wrong
  `Router.href` would each leave the list correct and the screen a dead end.

The browser check carries its own control — Profile must link at least fifteen
distinct modules — because a screen that rendered no links at all would make
every module look primary and pass for the wrong reason.

**523 browser checks pass, 2527 unit tests. 2 of 2 mutations caught**: removing
the catch-all fails the mechanism test, and removing it *and* dropping `vault`
from a group fails all three — the browser reporting `unreachable: vault`.

### What this does not do

It does not decide that "Everything else" is a good place for a module to live.
It guarantees a module is reachable, not that anybody thought about where it
belongs — and a group appearing on that screen is the signal that somebody
should.
