# A Hundred And Eighty-Five Ways To Empty A List

`js/ui/components/table.js`, `js/modules/crud.js`, `css/components.css`,
`tests/browser.mjs`.

## What was measured

Every entity list in the application gets a filter bar for free: a search box,
plus up to two dropdowns built from the entity's enum fields. That is a good
deal — a new module gets working filters by existing.

It was built from the **schema**. So it offered every value a field *could*
hold, whether or not any record held one. Measured across the seeded
household:

| | |
| --- | --- |
| enum filters drawn | **40**, across 37 entities |
| that cannot narrow anything | **18** — every record shares one value, or none |
| options matching no record at all | **185** |

The worst was `legalDocument.kind`: **eleven kinds offered above a single
document.** Ten of the eleven, chosen, empty the list.

Others in the same shape: `investmentTransaction.kind`, nine offered over six
records with one value between them. `document.category`, twelve offered and
eight matching nothing. `education.level`, `emergencyContact.kind`,
`event.kind` — nine each, one value present.

`economicEvent.kind` offered four options over **zero** records.

## Why an option that matches nothing is worse than no option

An empty list does not read as *"you have none of those."* It reads as **your
records are missing** — and this application asks a household to keep its
will, its policies, its children's vaccination records in one place. A filter
that can silently produce a blank screen on the Vault is not a neutral
convenience. It is the interface telling somebody their documents are gone.

Nothing about it was visible from the code. The bar was correct in the sense
that mattered to a compiler: it offered the field's declared options, and
choosing one filtered honestly. It only became wrong when there were records —
or rather, when there were *few* records, which is every household for its
first year.

## What changed

The bar is built from the records instead. A filter has to earn its place
twice:

- **It appears only when the records show two or more different values.** One
  value narrows nothing: a column every record agrees about is a fact about
  those records, not a way of telling them apart.
- **It offers only the values actually present.** Every option left is one a
  record carries, so no choice can empty the list.

And the search box, which had the same problem in a quieter way: a box over
two records is slower than reading them. It appears at eight, which is where a
list stops fitting on a 390×844 phone under a header and a navigation row —
the point where finding beats looking.

When that leaves the bar with nothing in it, it takes no room at all. The
`:empty` rule has to carry the margin too, or the saving is a blank strip
instead of a useless control.

## What it came to

| | before | after |
| --- | --- | --- |
| entity lists showing a bar | 53 of 53 | **19 of 53** |
| enum filters drawn | 40 | **22** |
| options offered | 259 | **74** |
| options matching no record | **185** | **0** |

About 60px came back on each of the 34 screens that no longer draw one — on
`vault/legalDocument` the single document it holds is now the first thing
under the heading.

## The trap this invites

The bar decides what to draw from how many records there are. Feed it the
**filtered** set and a search narrowing 105 transactions to two drops below
the threshold and takes its own search box away mid-keystroke — the control
disappearing under the cursor that is using it.

So `load()` passes every record, before `userFilter` is applied, and there is
a check that types `zzzzzzzz` into the ledger's search and asserts the box and
the filter beside it are both still there.

A second one, less obvious: a value chosen before the records changed
underneath it. Delete the last two `insurance` policies of a kind and the
filter that offered it is gone — but `state.kind` still holds the value and
would go on filtering from a control nobody can see. The rebuild clears any
selection it can no longer draw, and re-emits the filter so the list comes
back rather than staying mysteriously short.

## What the checks hold

Driven across **every entity list the schema declares**, not a list written
out by hand, so a module added later cannot quietly reintroduce this:

- No filter offers a value no record has.
- No filter is drawn that cannot tell two records apart.
- No search box stands over a list short enough to read.
- A bar holding nothing takes no room, margin included.

And in the other direction, because every assertion above is satisfied by
having no filters at all — without these two the block passes by deleting the
feature:

- **Every field whose records show two or more values gets its filter.**
- **Every list too long to read keeps its search box.**

Both worked out from the records the screen is standing on, so they hold for
whatever this run seeded rather than for a number written down once.

Then the behaviour, driven on whichever list this run has enough of:

- Choosing a filter narrows the list, never empties it, and clearing puts the
  rows back.
- A search that finds almost nothing keeps its own box, and the filters beside
  it.

## What the new checks caught, including three of their own

The first run of this block failed five times. One was a real bug in code this
change had not touched; three were the checks themselves.

**The Transactions ledger had the same bug, in its own filter panel.** Its
Category filter has always been built from the records — `[...new
Set(records.map((r) => r.category))]`, right there in the source. Its
**Account** filter listed every account the household holds. Twelve accounts
and statements imported for four of them left eight options that empty the
ledger when chosen. The check reached a component I had not looked at and
found the identical fault one line above a correct implementation of it.

**A check that failed on the correct behaviour.** "A bar holding nothing takes
no room" collected the screens where the bar correctly took no room, then
asserted that list was empty. It failed on every screen that was working.

**Two checks measuring the fixture, not the behaviour.** "At least twelve bars
still drawn" and "the ledger lists its transactions" were both calibrated
against the example household's 105 transactions. This suite seeds its own,
smaller set — so twelve was a number from the wrong dataset, and the ledger
check reported `0` about a screen that was fine, because the ledger draws
`.ledger-row` rather than the generic table's `tr[data-id]`. It was measuring
the wrong element and the wrong dataset at once.

Both are now derived. The check works out from the records themselves which
fields *should* offer a filter and which lists *should* keep a search box,
then asserts the screen agrees — and the behaviour is driven on whichever list
this particular run seeded enough of, chosen at runtime rather than named in
advance.

That correction matters more than the original finding. A check that hard-codes
what the fixture happens to contain passes for as long as nobody changes the
fixture, and says nothing the whole time.

## And the second run found the class collision

Two more failures on the next run, and they were one fault:

`filterBar` gave its bar the class **`.filter-bar`**. That name was already
taken — the Transactions ledger has its own filter panel, three rows of it,
styled at `css/components.css:1554`. So the two rules added here for the
generic bar, `margin-bottom` and the `:empty` collapse, were silently reaching
into the ledger's panel and adding a margin to each of its rows. Nothing
failed. Nothing logged.

This is the same collision as `.nav-group` and the shell's sidebar, two
changes ago, and it was found the same way — not by the stylesheet, but by a
check that got confused. "Every field whose records show two or more values
gets its filter" demanded a `Kind` filter on `#/finance/transaction`, because
it found a `.filter-bar` there and assumed the generic component had drawn it.
The ledger deliberately replaces that component. The check was insisting a
bespoke screen behave like the schema's default, and the only reason it could
make that mistake was the shared name.

The generic bar is `.record-filters` now. The dead-option scan still reads
both, because the ledger's panel had the identical bug and there is no reason
to stop watching it — but only a screen actually drawing `.record-filters`
owes the generic filters.

The other failure fell out of the same thing: the ledger's panel is `hidden`
until a filter is on, so the behaviour test resolved to a control it could not
click and timed out after thirty seconds. The scan takes visible controls
only, which is also the honest rule: a control nobody can reach cannot mislead
anybody.

**Twice now, in three changes, a new class name has quietly restyled an
existing component, and neither time did a stylesheet or a test notice
directly.** Both were found by something else going wrong nearby — a
screenshot, and a confused check. A third would have been found by nothing.

So there is now `tools/class-names.mjs`, and it is deliberately narrow. It
counts **how many class names more than one file writes**, and that number may
only fall. Adding a fourth `.card` or a tenth `.btn--primary` does not move it,
because those names are already shared. The count rises for exactly one event —
*a name one file wrote is now written by two* — which is the collision and
almost nothing else.

It cannot tell a collision from deliberate sharing: `.sentence-row` is written
by Health and by Ledgers on purpose and counts the same. So it is a budget, not
a defect count, and the honest reading of a failure is **"you have introduced a
shared class name — is that what you meant?"** Sharing on purpose is fine and
this repository does it 64 times. Doing it by accident, finding out from a
screenshot, and having nothing to stop the third one is not.

Confirmed to bite, on the tree rather than in theory: writing `.record-filters`
into a second file takes `node tests/run.mjs` to exit 1, naming both files.
`tests/classnames.test.mjs` also pins the two collisions themselves — the
sidebar keeps `.nav-group`, Finance's tabs are named for Finance, and the
schema's filters do not answer to `.filter-bar`.

## And an idiom I broke without noticing

The type budget went from 155 to 163 on this change — eight findings, all mine,
and the gate caught them before the push.

Six were one mistake repeated. `tests/browser.mjs` runs code inside the page
with `page.evaluate`, and that code imports the application's own modules. The
rest of the file passes the module specifier **in as an argument**:

    await page.evaluate(async ([spec, …]) => {
      const { app } = await import(spec);

I wrote `await import('/js/context.js')` instead. It works at runtime — the
browser resolves it fine — but the type checker, running in Node, cannot
resolve a browser path and reports `TS2307` six times. Passing the specifier as
a variable is not a style preference; it is what stops that. The idiom was
there and I did not look at it before writing beside it.

The other two were a `filterBar` options object with no JSDoc type, and
`select.options` read off an `Element` that `querySelectorAll` types as
`Element` rather than `HTMLSelectElement`.

All eight fixed rather than budgeted: back to exactly 155, no findings raised.
The budget exists so a 25,000-line codebase can be checked at all, not so a new
change can spend it.

## The rule was already written down

`docs/A_PICKER_NOBODY_WAS_LISTENING_TO.md`, and the language card in Settings
that says "English only" rather than offering a menu of one — checked by
`tests/browser.mjs` as *"does not offer a picker with one entry in it"*.

The rule existed. It had been applied to the one control somebody looked at.
Applying it to the control the schema generates for all 53 entities is what
this change is.
