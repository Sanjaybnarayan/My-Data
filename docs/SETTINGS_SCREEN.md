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

---

## Measured again, later, and the headings had not held

Everything above is still what happened. It stopped being enough.

The repair was six named sections and a jump row. Grouping gave the screen
something to navigate by and **nothing to bound it**: a heading is not a limit.
Measured again against every other screen in the application, on the same
390×844 phone:

| | Settings | median screen | next slowest |
| --- | --- | --- | --- |
| settle | **392ms** | 73ms | 90ms |
| nodes in the outlet | **615** | ~100 | — |
| scroll height | **10,623px** | — | — |
| cards | **21** | — | — |

Slowest, tallest and largest at once — and the page had grown from 19 cards at
6,905px to 21 at 10,623px *with the sections in place*. The grouping was doing
what it was built for and none of what it was hoped for.

Behind the 392ms: `paint` gathered everything before drawing anything. The sync
status, the database statistics and disk usage, twelve activity rows, a hundred
diagnostics, the connectors needing attention, the breach readiness, the
keyring methods, every person, and a full consent report — which itself reads
the mailboxes and the people records are held *about*. **Twelve awaited reads,
on every visit, whichever group somebody came for.** A household changing its
PIN paid for a hundred diagnostics.

## Each group is a route

`#/settings/device`, `#/settings/wrong`, and four more. `render` reads
`route.entity`, falls back to the first group, and builds one:

    const CONTENTS = {
      async device(db, repaint) {
        const methods = await db.keyring.methods();
        …
      },
      async about() { return [aboutCard()]; },
    };

`about` needs nothing and now does nothing. Nothing else asks for what it does
not draw.

| | before | after |
| --- | --- | --- |
| settle | 392ms | **119ms** |
| nodes | 615 | **111** |
| scroll height | 10,623px | **2,331px** |

A particular setting can also be linked to now, which it could not be: the
jump row's `href="#connections"` would have been read as a route and taken
somebody off the screen entirely, so the row was buttons calling
`scrollIntoView`. **The groups *are* routes, so the reason for the buttons has
gone with the change that made it true** — the row is anchors, carrying
`aria-current="page"` on the one you are standing in. `.settings-group` and
`.settings-group-title` are gone from the stylesheet with the sections they
styled.

### And the accessibility note above resolves itself

The last section of this document said the group headings and the card headings
were both `h2`, that no level was skipped, and that fixing it properly meant
`cardHeader` taking a level across a hundred call sites. There are no group
headings any more. One `h1` — still the word **Settings**, not the group's
name, or somebody arriving from a link would have nothing telling them where
they were — and `h2` per card, which is the structure that note wanted.

## What the checks had been reading

Twelve browser checks named a card by its text and read it off `#/settings`,
because Settings *was* one page. Nine of those cards are in other groups now,
and the run said so by throwing: a click on **Check the log** timed out against
a screen that no longer holds it.

Each one was pointed at the group holding its card rather than weakened —
`device` for the language and the unlock methods, `wrong` for the diagnostics,
the audit chain and the breach card, `agreed` for consent and devices,
`connections` for the OAuth scopes. Six of them were reading a string captured
before any of that navigation happened, which would have kept passing on stale
text for as long as the string survived anywhere on any screen; they read the
group they are about.

The old measured block asserted `.settings-group` count, a jump chip per
section, and 19 cards on one page. All three of those facts are gone. It was
**rewritten rather than deleted**, because what it was really holding — every
card carries a heading, the scope reference is folded, the redirect URI is
visible without opening anything — is all still true and still worth holding;
it walks the six routes and sums.

The new block measures the thing the sections never had: **no one group may be
more than half of what the whole screen was**, and the cards must all still be
somewhere. A group that silently rendered nothing would pass every other check
in the block.
