# Spending unlike its own history

`js/domain/unusual.js`, wired into `insights()`, tested in
`tests/unusual.test.mjs`. Layer 3's *anomaly detection*, which the architecture
document recorded as missing and which measurement confirmed was.

## What was measured

A household's July: **₹85,000 on healthcare**, having never spent anything on
healthcare, and **₹61,000 at a supermarket** whose usual month is ₹8,100. The
Insights screen's entire output:

```
Bills and utilities is the largest spending category, 50% of all spending.
2 payments repeat on a schedule, ₹37,550 a cycle.
```

Both true. Neither about anything that happened. The first points at **rent** —
the most predictable line in the household — because *largest* and *unusual* are
different questions and only the first was being asked.

Nothing in the codebase compared a category to its own history.

## After

```
₹85,000 on Health and pharmacy — the first time anything has been spent there.
₹61,000 on Shops and retail, against a usual ₹8,100 — 7.5 times,
        measured over 5 earlier months.
```

## The refusals are most of the file

An outlier detector is where a household gets told nonsense confidently. A ratio
is trivial to compute and almost always misleading, so what matters is what it
declines to say.

| Refusal | Why |
| --- | --- |
| A first occurrence gets **no multiple** | There is no ratio against nothing. "∞ times usual" is arithmetic nobody asked for, so it is *never seen before* instead — a different and honest sentence. |
| Fewer than **3 prior months** is dropped | "Usual" has no meaning yet. A finding nobody should act on is noise wearing a disclaimer. |
| Below **₹2,000** is dropped | ₹50 becoming ₹500 is ten times usual and worth nobody's attention. A finding must clear an absolute floor as well as a ratio. |
| The **median**, not the mean | One expensive month drags a mean upward and then hides the next expensive month behind it. On the measured household the mean said 6.6×; the median said 7.5×. |
| A **partial month** says so | Three days into August every category has "fallen". The period being incomplete is stated on the finding rather than silently skewing it. |
| **Income is never unusual spending** | A bonus month is a spike by every measure here. Reporting it would tell a household it had overspent in the month it was paid extra. |

Findings are ordered by the **rupee difference**, not the multiple: a ₹50,000
jump matters more than a tripled ₹3,000.

It does not explain, advise, or guess at a reason. Every finding carries the two
numbers it was derived from so the household can disagree with it.

## Three mistakes of mine, and what each cost

**`summary.byMonth` is not sorted.** The default month was
`summary.byMonth.at(-1)?.key`, which returned **June** for a period ending in
July — so the note never appeared at all. `byMonth` is *grouped*, and grouping
promises no order. It now takes the largest key, and a test asserts the fixture
is genuinely out of order so the test cannot quietly stop proving anything.

**`categorise.js` has no imports**, being deliberately dependency-free. The
import I "added" was a string replacement against a line that did not exist, so
it silently did nothing and the function was undefined at runtime. Caught by
running the measurement rather than by reading the diff.

**A field named `key`, not `month`.** The first version read
`byMonth.at(-1)?.month`, which is `undefined`, so the whole block was skipped.
Three failures in one wiring, every one of them silent, and all three found by
re-running the measurement after each change rather than trusting the edit.

## Mutation testing

**12 of 12 caught.** Five survived the first pass and they were not all the same
kind of problem, which is the reason every survivor is read rather than counted:

- **Two were genuine missing tests** — nothing checked that `insights()` carries
  the findings, and nothing checked the month-selection bug above. The second is
  the live defect this tranche introduced and then fixed; it would have shipped.
- **One was a vacuous test of mine.** The income test used a *flat* salary, which
  fails the ratio threshold anyway — so removing the direction guard changed
  nothing. It now uses a bonus month, which is a spike by every measure.
- **One was a bad mutation of mine**, targeting the caveat in the first-time
  branch while the test exercised the above-usual branch. Both branches are now
  mutated and both tested.
- **One was dead code.** A guard skipping months after the one under examination
  had no effect on output: the two selections below it already filter by month.
  Removed rather than tested, on the same reasoning as the unreachable `break`
  in the UPI reader.

## Verification

- `npm test` — **1476/1476** (was 1460)
- typecheck — **181, budget 181**: the one new finding was a signature promising
  a default for a required option, fixed rather than budgeted
- field-coverage (83), policy drift, lint, architecture (48 claims) — clean
- the service-worker precache ratchet caught the new module, as designed

## The browser check, and what it can and cannot catch

A real transaction goes through the real form and the Insights screen is read
back. It asserts the category is named, the amount is beside it, and — scoped to
that one sentence — that no multiple appears.

**Mutating the wiring against it: 1 of 3 caught, and that is the right number.**

| Mutation | Browser | Why |
| --- | --- | --- |
| the screen never asks for the findings | **caught** | exactly what a browser check is for: an absent panel and a silent one look identical from outside |
| the month reverts to `.at(-1)` | survived | in the browser's own data the latest month *is* grouped last, so the defect does not surface there. The unit test catches it, which is the layer it belongs to |
| a first occurrence is given `Infinity` | survived | the first-time sentence never renders `times`, so no screen can observe the field. The unit test asserts it directly |

Two domain defects caught by domain tests and one wiring defect caught by the
browser is the correct division. Trying to make the browser catch the other two
would be testing the wrong layer, and a check that passes for the wrong reason
is worse than no check.

One assertion had to be corrected: it first scanned the *whole screen* for the
word "times", which other findings legitimately contain. Scoped to the sentence
making the claim, plus a separate check that no `Infinity` or `NaN` reaches the
page anywhere.

## Still not done
- **Forecasting is still missing**, and keeps its own architecture row now that
  anomaly detection has one of its own.
- **A category is compared only to itself.** A household whose whole spending
  doubled sees every category flagged, with nothing saying the month as a whole
  was unusual.
- **No seasonality.** School fees every April and insurance every March will be
  flagged annually until a year of history teaches it otherwise, and it has no
  mechanism to learn that.
