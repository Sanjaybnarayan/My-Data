# A list that stops without saying so

Nearly every list in this application draws a `slice`. A sweep of all
twenty-four found **five** that said how many rows they were hiding and
nineteen that said nothing at all.

The application had already decided this question. `js/modules/crud.js`
carries the reasoning above its history card:

> …how many there are in total, is what a person reads.

and does it: six entries, then *"23 entries in all."* Four other lists follow
that rule. The rest silently stop.

## The one that mattered

Health's **Being taken, and coming up** card capped medications at eight. No
total, no badge, no footer. A household on eleven current medications saw
eight of them and nothing saying there were more — on the screen whose whole
purpose is to answer *what is this person taking*.

That is not a cosmetic fault. Every other instance in the sweep hides
documents, payments or import warnings; this one hides medicine.

## Two shapes, because there are two situations

`restOfList(total, shown, { href })` in `js/ui/components/basics.js`. It
returns `null` when nothing is hidden, so a caller places it unconditionally
and a list that fits is unchanged.

| | when | what it draws |
| --- | --- | --- |
| link | the rest are on another screen | **See all 12** |
| count | the rest are on this screen, or nowhere | **and 4 more** |

The distinction is the point. Several of these cards sit directly above the
full, filterable list on their own page — Documents' two attention cards do —
and a "see all" there leads back to the page it was clicked on, which is worse
than the silence it replaces.

## Where it went

| screen | card | cap | what it said before |
| --- | --- | --- | --- |
| Health | Being taken, and coming up | 8 medications | nothing |
| Health | same card | 5 appointments | nothing |
| Documents | Expiring | 5 | a badge with the real total |
| Documents | Expiry unclear | 5 | a badge with the real total |
| Family | Their documents | 10 | a badge with the real total |
| Family | Months that do not match | 6 | the count, in the sentence above |
| Family | What has been paid | 6 | a badge with the real total |
| Finance | Could not be explained | 8 | a badge with the real total |
| Trade import | refused rows | 20 | *already correct* — converted |

Trade import was one of the five that already said it, in a string of its own.
It is converted here so there is one sentence for this rather than two that
can drift apart, and `tradebook.andMore` is deleted. `dash.seeAll` went the
same way: the dashboard's footer now calls the shared `list.seeAll`.

## Two the ratchet refused

`js/modules/receipts.js` and `js/modules/statements.js` both have the fault
and neither is fixed here. `tools/module-size.mjs` reported them at 1020 and
838 lines against recorded budgets of 1008 and 827, and its instruction is not
advisory:

> No crowded file may grow and none may join. Move code out rather than
> raising the number.

Receipts is the worst-stated instance in the application — the card's subtitle
reads *"31 of 40 receipts found the payment that settled them"* and then lists
twelve — so leaving it is a real cost, stated rather than hidden. Both wait
behind the split the ratchet is asking for.

`js/locale/en.js` hit the same wall from the other side: two new keys took it
to 802 against a threshold of 800, so it would have *joined* the list. The
locale is already split by area, and `en-tradebook.js` says why in its own
header — *"Splitting also keeps `en.js` under the size the module-size ratchet
holds it to, which is what forced the first split too."* The chat-settings
block moved out to `js/locale/en-chat-settings.js`. en.js: 802 → 754.

## And two things found on the way

**A button that is an anchor is still a button.** `base.css` underlines links,
correctly, and `.btn` never said it was not one — so all **eleven** `<a
class="btn">` in the application drew a pill with underlined text inside it.
The dashboard's "See all 9" footers have looked like that since they shipped
last week. `.chip` was given the same line in the Settings split for the same
reason; this is that fix, one component later.

It was found by reading a computed style, not by looking. An underline inside
a small pill reads as emphasis rather than as a mistake, which is how it
survived every screenshot taken of the dashboard this week.

**The recovery screen's acknowledgement.** `.lock-card` sets `text-align:
center`, right for the heading and the phrase and wrong for the one checkbox
on it: the box sits at the row's left edge while each line of its label is
centred independently.

| | line 1 left | line 2 left |
| --- | --- | --- |
| before | 115px | **187px** |
| after | 94px | 94px |

Seventy-two pixels apart, at 390px, on the screen that hands somebody the only
way back into their own data. It does not show at 1280px, where the label fits
on one line — which is why the enrolment this suite walks twice has never seen
it.

## What the checks measure

Three of today's four defects were found by looking at a screenshot and none
by a check failing, so each fix ships with a measurement that could have.

- **The capped list.** Seeds eleven medications first. The example household
  has fewer than eight, so a check written against it would find no footer and
  assert nothing — the exact fault the dashboard block was rewritten to avoid
  yesterday. The number is read out of the footer's own text and compared
  against what the database holds, never against a number written into the
  test file.
- **The underline.** Walks the eight screens the card-header check already
  visits, reads `textDecorationLine` off every `a.btn`, and guards on having
  found any at all.
- **The acknowledgement.** Reads the label's own line boxes through a `Range`
  and asserts they share a left edge. A line count cannot see this and neither
  can the element's width — both are identical either way. `lines >= 2` is a
  guard: if the label ever stops wrapping the check has nothing left to
  measure and should say so rather than pass on one line trivially flush with
  itself.
