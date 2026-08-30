# A valuation with a date on it

A household's flat was worth ₹1.15 crore. It said so on the dashboard, in the
net-worth figure, in the assistant's answer and in the exported report. The
figure was three years old, and nothing anywhere said so.

Delete the figure entirely and the application spoke up at once: *"1 item
valued at cost or excluded — update the valuations for a truer figure."*

So the unknown was surfaced and the confidently-stale was silent, which is the
wrong way round. A missing number asks to be filled in. A precise-looking
number that is three years old does not ask for anything.

## Measured

```
property valued 3 years ago  → counted in full, flagged: 0
same property, no valuation  → flagged: 1
```

## Why this is a defect and not a design choice

The schema records exactly three "as of" dates, and the application already
ages two of them.

| Date | Aged? |
| --- | --- |
| a location ping | yes — `domain/safety.js`, `STALE_MINUTES = 120` |
| `kycRecord.recordedOn` | yes — `domain/kyc.js#stale`, `months = 24` |
| `holding.valuedOn`, `property.valuedOn` | **no** |

The one it did not age is the one attached to a household's largest numbers.

`valuedOn` was not ignored, either — which makes it worse rather than better.
`domain/accrual.js` reads `holding.valuedOn` to compound a deposit forward from
the day its figure was true, and refuses to value one that has no such date:
*"Without knowing when the figure was true there is nothing to compound from."*
The date was trusted for arithmetic and ignored for honesty.

## What it does now

`staleValuations` gains rows for valuations that are real but old, each
carrying the age:

    property · The flat in Malleswaram · valued 14 months ago
    property · Shop unit, Gandhi Bazaar · valued 20 months ago

`STALE_AFTER_MONTHS` is twelve. That is a judgement, and it is named in one
place rather than buried: a household revisits what a flat or a fund is worth
about once a year, and a figure that has been through a full year of whatever
moves it is no longer evidence of anything. The **age** is carried on every
row, so a household that disagrees with the threshold can still see exactly
what it is disagreeing about.

**No figure moves.** `holdingValue` still returns `currentValue`, `netWorth`
still counts it, and the total is identical to the paise. This adds a sentence
beside a number; it does not change the number. A test asserts that directly.

## What is still not said

**A vehicle cannot be aged.** The schema gives it a `currentValue` and no
`valuedOn`, so there is nothing to measure against, and none is invented. A
test states this rather than leaving it as an omission a reader has to notice.

**`holdingGain` shares the exposure.** A gain percentage is computed from
`currentValue` against `invested`, so "+27%" can rest on a two-year-old figure
exactly as the net-worth line could. That is left alone deliberately: changing
what it computes would change a financial figure, and the fix for being misled
by an old number is to say it is old, not to quietly compute a different one.
The staleness is reported once, at the level where a household reads the total.

## Where it shows

Four surfaces read `staleValuations`, and three carried wording that named only
the missing case — "valued at cost or excluded". Each now says *missing or out
of date*, because a caption that describes half the findings under it is how a
correct number ends up meaning the wrong thing:

- `js/modules/dashboard.js`, the line under the wallet card
- `js/ai/intents.js`, the caveat on a net-worth answer
- `js/reports/build.js`, the note on the exported statement
- `js/domain/cfo.js` prints `reason` verbatim, so it needed nothing and now
  reads *"The flat in Malleswaram — valued 14 months ago"*

## Held by

`tests/domain.test.mjs` — an old valuation is reported and says how old; a
recent one is not; the threshold is the boundary it claims to be, checked on
both sides; **no figure moves**; a row with no valuation is reported once, for
the better reason, rather than twice; a vehicle cannot be aged.

Mutated three ways, each verified to have landed: the age rows removed
(caught), the guard that stops double-reporting removed (caught), and the
threshold moved out of reach (caught).
