# `"250000twenty thousand"` — A Total That Was a String

`js/domain/categorise.js`, `js/domain/amounts.js`, `js/services/finance.js`,
`js/modules/finance.js`, `tests/amounts.test.mjs`.

## The rule

v6.0: **never silently lose data**, and **never silently ignore sync,
AI-extraction or reconciliation errors**.

## Why a bad row exists at all

The household's records live in **their own Google Sheet** — that is the shape
of the backend, not an accident — so any row can be edited by hand. Somebody
typing `twenty thousand` into an amount column has done nothing wrong.

On the way back, `Repository.applyRemote` writes the row without validating
it, and deliberately:

> Skips validation, permissions and the outbox — it is already authoritative,
> and re-queueing it would bounce the same row between two devices forever.

That is the right call. **A sync that rejected a row would lose it**, and
losing a household's record is worse than holding a strange one. The server
side does not close the gap either: `apps-script/Policy.gs` is generated from
the schema but governs *who may read and write each store*, not field shapes.

So an unreadable amount is expected, and the only question is what the
arithmetic does with it.

## What it did

```js
const total = (list) => list.reduce((sum, t) => sum + t.amount, 0);
```

`+` on a string concatenates. Measured, on one clean row and one hand-edited:

```
clean   moneyOut: 350000
edited  moneyOut: "250000twenty thousand"
```

Not an error, not a wrong number — a **corrupted** one, formatted and shown as
the household's spending.

## What changed, in two halves

**`total` adds only finite numbers.** One line, and the file's size ceiling
meant it had to be exactly one line.

**And the rows it skips are reported.** That second half is not optional.
Skipping silently would trade a visible corruption for an invisible omission —
a total quietly about less than it claims — which is the same fault this
application has now been bitten by three times in two days: a categoriser that
deleted real spending, an assistant that reported an absence it had not
established, and this.

`js/domain/amounts.js` counts the rows and builds the sentence; the Finance
service calls it over the same month's rows the settlement report uses, and
the screen prints it in `money--negative` rather than `faint`. A total about
fewer records than the household has is the one caveat on that card they
cannot work out for themselves.

A row with **no** amount is not counted. Most entities have none and never
did; counting those would report thousands and teach somebody to ignore the
number.

## How it is checked

`tests/amounts.test.mjs`, twelve cases, in both directions:

- a string is not readable however numeric it looks, nor is `NaN` or
  `Infinity`; a number is, including zero and a negative;
- a row with no amount is not a fault, a row that has one and cannot be read
  is, and there is nothing to say when every row is readable;
- the sentence says the totals exclude them and does not guess at the value;
- **a hand-edited amount no longer concatenates**, and **the row it skipped is
  still reported**, and a clean month is unaffected.

Mutation-tested:

```
total concatenates again        2 FAIL  the arithmetic, and the pair check
describeUnreadable returns null 1 FAIL  the sentence
```

The second mutation is the important one: it is what "fix `total` and move on"
would have looked like, and the suite refuses it.

## A note on the size ceiling

`js/modules/finance.js` was at exactly 800 lines. The sentence is built in the
service so the screen carries no branch and no import, which was still one line
too many — so an adjacent settlement ternary was compressed by two lines. That
is a formatting change to neighbouring code, made to avoid raising the number,
and it is recorded here rather than left for a reviewer to wonder about.

## What this does not establish

That any household has such a row. The narrations and amounts here are typed,
not taken from anybody's sheet. What is established is that if one exists, the
total is arithmetic and the row is named — where before the total was a string.
