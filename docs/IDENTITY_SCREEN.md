# The Engine Nothing Drew

`js/services/identity.js`, changes to `js/modules/identity.js`, tested in
`tests/services.test.mjs` and in the browser suite.

## The finding this repository keeps making

`docs/IDENTITY_CONFLICTS.md` closed with:

> **What is still not built.** No screen. This tranche is the engine and its
> tests; `js/modules/identity.js` does not yet show a conflict banner.

That is the finding this codebase has made more often than any other — *the
domain function exists and no screen calls it* — recorded honestly in the same
paragraph that created it. A CRITICAL identity conflict that nothing draws is a
conflict nobody is told about.

## Why it went through a service

The screen was already calling the repository three times to build the KYC
banner. Adding conflicts inline would have made it four, and put the decision
about **what a household is told when two people share a CKYC identifier** in a
function that can only be exercised by opening a browser.

`IdentityService.review()` assembles it instead, tested against a real
in-memory database with no DOM near it. The screen's direct database calls go
from three to none, and the architecture ratchet's UI→database budget drops
**61 → 58**, locked in — it only tightens.

## What the screen now shows

```
One identifier, more than one person                                    [3]

  KIN recorded against 2 people
    one CKYC identifier is recorded against 2 different people. That is either
    an institution's error or somebody's identity being used twice, and nothing
    here will merge them. It is held against You and Ravi Iyer.

  Axis Bank: date of birth
    Axis Bank holds a date of birth that does not match your own record …

Nothing here is merged, corrected or decided. A disagreement between two
identity records is usually evidence that something is wrong somewhere else —
at an institution, or in what somebody was told.
```

Above the per-person drift, always. One identifier held against two people is
not a worse version of an address disagreement; it is a different thing, and
grouping the banner by person would push it halfway down the screen because the
alphabet said so. A browser check reads the DOM order and fails if the drift
card comes first.

## What the screen refuses

**It never prints the identifier.** `sharedIdentifiers` returns the *field
name* and never the value, and a screen that printed the KIN beside the finding
would undo that on its own. The browser check asserts the digits typed into the
form appear nowhere in the conflict card.

**It never says what to do.** The severity is a badge. A household decides what
to do about a shared CKYC identifier; this screen's job is to make sure they
know it exists.

**Conflicts and drift stay apart.** Where one person's institutions disagree
*among themselves* is a different question from where an institution disagrees
with the household's own record — different fixes, and a merged list would need
a column to say which was which.

## Two survivors, and what they meant

Six mutations of the service; two survived:

| Mutation | Survived because |
| --- | --- |
| **Deleted KYC records are included** | `Repository.list` had already dropped them |
| **Deleted people are compared** | the same |

Neither is dead code, and neither is a missing guard in the service. The
assembler is **exported** so it can be used without a database — that is the
whole point of the layer — and at that interface the filters are the only thing
standing between a deleted row and a comparison. The tests now call
`assembleIdentityReview` with plain arrays, and both mutations fail.

This is the same conclusion `domain/events.js` reached about `recordedMovements`
and recorded in a comment: *belt and braces through the service, where the
repository has already dropped soft-deleted rows — mutation testing says so.*

## A type finding with a real defect behind it

`listSection`'s `banner` option was typed `() => (Node|null|Promise<Node|null>)`.
Its only caller has always returned an **array** of cards. `replace` accepts
either, so nothing ever broke, and the inferred type of that caller was loose
enough that nothing complained — until a view model with real shapes in it made
the array concrete and the checker said so.

The signature was wrong, not the code. Typecheck held at 181: fixed, not
budgeted.

## What is still not built

The estate and explainability engines from the two tranches after this one are
still headless — `docs/NOMINATIONS.md` and `docs/EXPLAINABILITY.md` both close
the same way this one opened. Profile completion is still missing from Phase 2.

## UI-9: the identity wallet

Identity documents as cards, above the table that edits them.

### Why a card and not another row

A passport is a physical object a household recognises by its shape. The table
is the right way to *edit* one and the wrong way to answer *"has anything
lapsed"* — which is the question somebody opens this screen with, and which a
column of dates makes them do arithmetic for.

The design principle is borrowed; the execution is not. No issuer artwork, no
imitation of anybody's wallet application, no logo a household could read as a
connection to an authority that does not exist.

### What a card may carry, and no sixth thing

The kind, whose it is, the number **masked**, the state of the expiry date they
typed, and when the record was last changed. Each comes from a stored field.
`walletCard` makes `updated` a required argument — a card that does not say
when it was last touched invites a household to read it as current.

### Unknown is an answer

`expiryState` returns four states, and `unknown` is one of them. A document
with no expiry recorded is **not** "in date"; it is a document nobody has said
when it runs out. Cards sort worst-first — expired, expiring, unknown, in date
— because a wallet that led with the documents that are fine would bury the one
that is not.

### Verified is the word that must never appear on a card

Nothing here contacts an issuing authority. There is no CKYCRR, no DigiLocker,
no ABDM, no passport office. Every number was typed in from a document somebody
was holding, and the line under the cards says so. The only status a card
carries is about the date they entered.

### Masking lives in the service, not the screen

A wallet card is exactly the hand-built surface `js/data/schema.js` warns
about — the kind that never passes through the field renderer, alongside record
headers, list subtitles, search results and reference pickers. So
`IdentityService.wallet` masks before the screen sees a number, where a second
screen cannot forget to.

### The lead time is read, not repeated

`identityDocument.expiresOn` already declares `expiryLead: 180`.
`walletLead()` reads it off the field; `DEFAULT_LEAD` is only a fallback for a
caller with no schema in hand, and a test asserts the two agree. Two numbers
meaning one thing drift, and this drift would be silent — the cards would
simply start warning at a different time from every other expiry.

### Two checks that could not fail, found by mutating

**The sweep never opened this screen.** UI-7's identifier sweep walks each
module's default route and each seeded record's own screen. The wallet lives on
`#/identity/identityDocument` — a *tab*, reached only by naming the entity — so
a hand-built card there was invisible to it. The sweep now walks every entity's
list screen too, and with that in place it catches an unmasked wallet card by
itself, without knowing the wallet exists.

**"A document with no expiry says so rather than reading as in date"** passed
against a mutation that made a missing date read as in date. It was looking for
the words *no expiry recorded*, which the card prints as its meta line whatever
state it is in. The badge is what carries the claim, so the badge is what is
asserted now.

A third check had to be relaxed rather than tightened: *"nothing on the screen
says verified"* failed on the sentence that exists to deny it — *nothing here
is verified, only recorded*. Forbidding a word punishes its honest use. The
check is scoped to the cards, where the claim would actually be made.

**535 browser checks, 2541 unit tests. 2 of 2 mutations caught**: the wallet
printing numbers in full (six failures, three of them from the general sweep),
and a missing expiry reading as in date.
