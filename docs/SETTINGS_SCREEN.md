# Settings, Measured

`js/modules/settings.js` and `js/modules/settings/`. Checked in
`tests/browser.mjs`.

## What was there

The note at the top of `js/modules/settings.js` says the cards live in
`js/modules/settings/` **"grouped by the question somebody came to this screen
to ask"**.

That was true of the *files*. It had never been true of the screen. Measured on
a 390×844 phone:

| | before | after |
| --- | --- | --- |
| cards | 19 | 19 |
| scroll height | 6,905px | 6,015px |
| screens of scrolling | **8.2** | **7.1** |
| tallest single card | **1,301px** (scopes) | 951px (audit log, grows with use) |
| named sections | 0 | 6 |

One flat grid, nothing to navigate by, and the tallest card — 19% of the whole
page — was a list of OAuth scopes to paste into Cloud Console, read once during
setup and never again, sitting above Security, Appearance and Backup. Somebody
changing their PIN scrolled past all of it.

## What changed, and how much it is worth

**Six named sections**, in the order the cards were already in, keeping the
reasoning that was already here: `privacyCard`'s own comment says it is first
"because it is the question people actually have", so the group it leads is
first too. Nothing is removed and nothing is hidden.

**The scope list folds away.** `<details class="card">` rather than something
new — `breachCard` in `settings/activity.js` already folded itself this way.

**A jump row.** Named sections are not the same as navigable ones. Buttons
rather than anchors, and that is not a style preference: the application routes
on the hash, so `href="#connections"` would be read as a route and take
somebody off the screen entirely.

Being straight about the size of the win: **the height improved 13%, not
tenfold.** Folding the scope card removed 1,301px and the six headings added
about 400 back. The gain is structure and a way to jump, not brevity — a
settings screen with nineteen cards of real content is going to be long.

## And one accessibility gap it turned up

`breachCard` was a `<details>` whose `<summary>` was bare text. A `<summary>`
is not a heading, so that card contributed **nothing** to heading navigation
while all eighteen others contributed one. Both folded cards now carry a real
`h2` inside the summary.

## Folding it hid something that had to stay

The scope card also held **the two strings a broken Google sign-in needs** —
the authorised JavaScript origin and the redirect URI. Folding the card took
them with it, and the card's own comment had said why that was wrong before it
was moved: *the commonest reason a sign-in fails has nothing to do with
scopes.* The OAuth client does not list where this copy is served from, Google
shows its own error inside the popup, and the application can only tell that a
window shut.

Two existing browser checks read that text and failed the moment it went behind
a disclosure, which is how it surfaced. I had checked whether any test read the
scope card and concluded none did; two did.

So the card is split. **Where this copy is served from** is now its own short
card, visible, next to the Google account. The hundred-line scope reference is
the part that folds.

## What the checks measure

The rendered document, not the source — the source is what made the claim.

- The screen has at least five named groups, and every one has a name.
- Every group can be jumped to.
- It still draws every card it drew before.
- Every card contributes a heading, folded ones included.
- The scope reference is folded by default and is a heading when closed.
- The redirect URI is visible **without opening anything**.

### A budget I got wrong first

The first version asserted that *no card* exceeded one viewport, on the
reasoning that card height does not depend on the fixture. That was wrong and
the suite said so: the audit log came out at 951px because it lists whatever
activity the run happened to create, and conflicts and deleted items do the
same. A budget on those is a budget on the fixture. What is worth pinning is
the thing that was actually wrong — a scope reference open by default above
Security and Backup.

## Not perfect, and worth naming

The group headings and the card headings are both `h2`. No heading level is
skipped, so the accessibility walk passes, but a card inside a group is
semantically a level below its group and does not say so. Fixing it properly
means `cardHeader` taking a level, which is a change to about a hundred call
sites for a precision no screen reader user has asked for here. Left as it is,
deliberately, and written down rather than quietly ignored.
