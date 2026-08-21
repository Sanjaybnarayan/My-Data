# A Goal Is A Target With A Source

`js/domain/goals.js`, `js/services/goals.js`, drawn under Finance → Goals.
Tested in `tests/goals.test.mjs`, `tests/services.test.mjs`, and the browser.

Build prompt v6.0, Phase 9. The `goal` entity is new; everything it reads
already existed.

## A target with no source is a note

The easy version of this feature is a target amount, a "saved so far" box, and
a bar dividing one by the other. **That bar agrees with itself** no matter what
the household's accounts hold, which makes it a decoration with a percentage
printed on it.

So a goal names the accounts and holdings that fund it, and the figure is read
from those balances. Rule 57 — every figure must be explainable — is then
satisfiable: the sources are the explanation.

```
House deposit    ₹5,00,000 of ₹20,00,000 · 25% · ₹62,500 a month to reach it by then
```

## The same rupee must not fund two goals

Nothing stops a household naming one savings account under both *house
deposit* and *emergency fund*. Reporting both as funded from the same
₹5,00,000 would tell them they have twice the money they have — the same class
of error as counting an internal transfer as income, and the one this project
refuses hardest.

But a shared source is **not an error to prevent**. A household mid-decision
about which goal that money is for is in a perfectly ordinary state, and a
schema that forbade it would be forcing an answer to make the arithmetic
easier.

So the overlap is reported and the progress **withheld from every goal
involved**, each naming the others:

```
House deposit    Cannot be measured — its funding is also claimed by New car,
                 and the same money cannot fund both — say which one owns the
                 account to see either figure.
```

`domain/staffpay.js` does the same for a wage it cannot check. Saying why is
information; a number that looks authoritative and is double-counted is worse
than nothing.

Contested goals sort to the top and carry no percentage at all. Showing one
beside that sentence would invite a household to read the number and skip the
words, and the number is the part that is wrong.

## An emergency fund sizes itself

An emergency fund is not a rupee amount somebody looked up; it is *n* months of
what this household actually spends. `targetMonths` × the median monthly
spending from `domain/runway.js`.

When there is not enough history, `typicalDailySpend` returns zero **and a
reason**, and that zero is passed straight through rather than replaced with an
average of the little there is. The goal reports that it has no target and why:

```
Emergency fund   Cannot be measured — an emergency fund is a number of months
                 of spending, and there is not enough recorded spending yet to
                 say what a month costs.
```

A fund sized against a made-up month would be **declared complete**, which is
the specific harm.

## "On track" is not offered

It would need to know what has been put aside over time. This application
stores transactions, not a history of balances, so a contribution rate would
have to be inferred from transfers into the funding accounts — and inferring it
wrong produces a confident date.

What is offered instead is arithmetic that cannot be wrong: **what is left,
divided by the months left.** That says what reaching the target would take. It
claims nothing about whether it will happen.

Once the date has passed the goal is *overdue* and asks for nothing a month —
dividing what is left by a negative number of months produces a negative
"needed", which reads as though the goal funds itself.

Months are counted **whole**. From 21 August to 15 November is two months, not
2.8: the November payment has not come round by the 15th, and 2.8 is not
two-point-eight opportunities to pay something. `monthsBetween` in
`core/dates.js` is new and does that.

## Small things that were wrong first

**A goal naming one account twice was in conflict with itself**, and the
sentence it produced named the goal you were already reading. Found by a test
written for a case that seemed too silly to happen; the sources are now
deduplicated per goal before the overlap is counted.

**The funding callback was called `valueOf`.** Every object literal inherits
`Object.prototype.valueOf`, so an option by that name conflicts with the one
every object already has — TypeScript said so, and it was right about more than
types. It is `holdingValueOf` now.

**The browser check "a goal says where it stands" passed with the banner turned
off**, because it only looked for the goal's name and the list prints that
either way. It now asserts the banner's own heading and the arithmetic only the
banner produces, and fails when the banner is not drawn.

## A ratchet tightened on the way past

Three `page.evaluate` blocks imported modules by a path relative to the served
root, which is not where the test file lives, so the type checker reported
three "cannot find module" errors for imports that work perfectly. Passing the
specifier in as an argument makes it a value rather than a literal — which is
the honest description of what it is — and took the typecheck budget from
**169 to 167**.
