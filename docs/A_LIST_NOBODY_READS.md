# A List Nobody Reads

`js/domain/profile.js`, checked in `tests/profile.test.mjs`.

## What it looked like

Identity draws a Profiles card with one row per person — nine of them in the
example household. Each row's subtitle came from `describeCompletion`, which
joined **every** section a person's record was waiting on:

    Ananya Iyer
    6 of 16 sections · waiting on Identity, KYC, Documents, Loans,
    Investments, Insurance, Vehicles, Property, Employment, Digital life
    38%

Four lines, for one person, on a 390px phone. For somebody whose record is
empty it is thirteen names:

    3 of 16 sections · waiting on Identity, KYC, Documents, Bank accounts,
    Loans, Investments, Insurance, Health, Vehicles, Property, Education,
    Employment, Digital life

## The answer was already in the tree

`js/domain/timeline.js`, in the same directory, had settled the identical
question and written down why:

    // Three names, then a count. A list of eleven field names is a list
    // nobody reads, and the count is the part that says "a lot happened".
    const named = story.fields.slice(0, 3);
    const rest = story.fields.length - named.length;

So `describeCompletion` does the same: three names, then `and N more`.

| | before | after |
| --- | --- | --- |
| a bare person's subtitle | 13 names | 3 names and a count |
| row height | 4 lines | 2 lines |
| people above the fold | 3 | 4 |
| the screen | 2,801px | **2,418px** |

## What was deliberately kept

Naming the sections at all is a decision this application already made.
`js/modules/profile.js` says it in as many words — *"`describeCompletion` says
what it is waiting on rather than quietly counting"* — and
`tests/profile.test.mjs` holds it:

    test('the sentence under the number names the sections, not just the count')

That test passes untouched. The fix names **fewer**, not none, which is the
distinction between shortening a sentence and reversing a decision.

## The remainder comes off the full list

    const rest = result.waitingOn.length - named.length;

Not off `named`. This is written deliberately and commented, because the
opposite mistake shipped on the dashboard earlier the same day: a warning badge
that counted the rows it had drawn rather than the records it had found, so a
household with nine papers running out was told **5**. The same shape, one
screen over.

## Proved by mutation

The new test would be worth nothing if it passed against the old code, and the
old assertion could not tell the difference — it only asked whether `Loans`
appeared, which it does either way. So the source was reverted and the suite
run:

    FAIL  and names three of them, then says how many more
          got: "3 of 16 sections · waiting on Identity, KYC, Documents,
                Bank accounts, Loans, Investments, Insurance, Health,
                Vehicles, Property, Education, Employment, Digital life"
          expected: "and 10 more"

The test also guards its own fixture — it asserts the person is waiting on more
than four sections before checking that four were cut — because a fixture that
drifted under the cut would make every assertion beneath it vacuous.

## How it was found

By taking a screenshot of a screen nobody had looked at, and reading it. No
check failed; nothing was slow; the height was unremarkable at 2,801px. It is
the third finding today from looking rather than measuring — after a bottom
navigation breaking its own labels mid-word, and eleven of thirteen dashboard
cards below the fold.

---

# And The Bar Measured On One Screen

`css/base.css`, `tests/browser.mjs`.

Found in the same screenshot sweep, one screen over.

## What it looked like

    Dashboard   Notification   Chat   Finance   Profile
                     s

Only on `#/notifications`, and only there — every other screen drew all five
labels on one line. The selected tab was `font-weight: 600`, and bold text is
wider:

| tab, while selected | needs at 600 | box | verdict |
| --- | --- | --- | --- |
| Dashboard | 61.6px | 65.2px | fits |
| **Notifications** | **71.1px** | 65.2px | **5.9px short** |
| Chat, Finance, Profile | ≤ 44.5px | 65.2px | fit easily |

At the row's ordinary weight "Notifications" is 63.8px and fits.

## Why the padding could not save it this time

The earlier repair to this bar — four tenths of a pixel — was paid for out of
the tab's horizontal padding. There is no such change available here:

| where | gives, per tab |
| --- | --- |
| tab padding, 2px → 0 | 0.8px |
| the bar's own padding | 0.8px |
| pulling the bar's inset in | 1.6px |
| **total** | **3.2px** |

Against 5.9px. There is no arrangement of this bar at 390px in which a bold
"Notifications" fits, so the question was never geometry.

## So the weight went

The rule's own comment said the selected tab carries *"three things, not one:
the filled ground, the weight, and a bar above the icon"*, because *"colour
alone is not a distinction"*. That intent survives with two: a filled ground
and a 3px bar above the icon are both **shape**, and neither needs colour to be
seen. A check asserts exactly that, so the reason the third was affordable
stays true.

What is gained beyond the fix: the bar's layout no longer depends on which tab
you are standing on. Every label is now the same width on every screen.

"Notifications" clears its box by 1.4px, which is thin — but it is now measured
at four widths across all five tabs on every run, rather than trusted.

## The check had been measuring one of five states

This is the part worth keeping. The block written for the earlier repair walked
320, 360, 390 and 430 — and read the bar from `#/dashboard` every time. The
selected tab is the only one drawn bold, so the only bold label it ever
measured was *Dashboard*, which fits. The label that does not fit was on screen,
wrapped, in front of anybody who tapped the second tab, and the check reported
five labels on one line.

It walks all five tabs now, with a guard that the tab being stood on is
actually the marked one — otherwise it would visit five screens and measure the
same unselected state five times, which is the same fault wearing a different
hat.
