# What Does Not Add Up

The specification's Case 3, and the record type it asked for.
`js/domain/conflict.js`, `js/services/conflict.js`, `js/modules/conflicts.js`,
tested in `tests/conflict.test.mjs` and through a real database in
`tests/services.test.mjs`.

## What the audit found

> **Case 3 — SMS ₹5,000 vs statement ₹5,500.** The gap: no single
> `FINANCIAL_DATA_CONFLICT` record type joins the two paths. A household sees
> a disagreement in one place and an unmatched leg in another. **P2.**

That understated it. Measured before anything was written:

```
sms vs statement amount   : stored on smsMessage.agreement
any two sources disagree  : Finance › Messages, derived
corroborated, no ledger   : Finance › Messages, derived
wages paid vs agreed      : Family › one staff member's record, derived
sources disagree on DATE  : nowhere — not detected

one list holding all of them: NO
```

Four kinds, three structures, two screens — and the fourth kind did not
exist. A household that suspected a figure was wrong had to already know
which screen the application had chosen to mention it on.

Rule 57 says every financial event must be explainable. A disagreement a
person cannot find is not explainable, however carefully the module that
found it worded the sentence.

## The date hole

`evidenceFor` compared amounts and nothing else. So this:

```
transaction  trn_9   ₹2,500  2026-08-20   reference UTR998877
sms          sms_9   ₹2,500  2026-08-24   reference UTR998877

reconcile verdict : linked
evidence agree    : true
```

Two sources naming days four apart, reported as agreeing. The **match** is
right — a UTR is the one thing both sources copy from the same underlying
rail, and `reconcileWithStatement` is correct to link on it rather than on a
date. Being silent about the dates afterwards is the fault.

The window is `MATCH_DAYS`, exported from `domain/evidence.js` rather than
copied, because the number that decides *these are the same payment* and the
number that decides *these name different days* must be the same number. A
gap of a day is a posting delay and is not listed.

## What it refuses

**It never picks a winner.** No record here carries a field meaning *this is
the right one*, and a test asserts the absence of six such keys on every
conflict and every figure. `domain/sms.js` already establishes the rule — the
statement outranks a message on `SOURCE_PRIORITY`, and that ranking is
*reported*, never applied. A list that resolved what all four of its inputs
deliberately refused to resolve would undo the rule in one place for all of
them.

**It is derived, never stored.** A conflict written into the database
outlives the thing that caused it: correct the statement row and the stored
record still says the sources disagree. Every call reads the records as they
are now, so a conflict disappears exactly when its cause does. There is
therefore nothing to mark as resolved, and the screen says so — resolving one
of these means changing a record, not ticking a box beside it.

**A payment with one source is not a conflict**, and neither is a transfer
leg with no counterpart. Most statement rows have only the statement and most
transfers are imported from one side. `docs/THREE_SOURCES.md` makes that
argument for corroboration and it holds here: a list calling every one-sided
record a conflict is a list nobody opens.

**It refuses months `staffpay.js` refuses.** A part month, or one touched by
unpaid leave, is left unjudged there and stays unjudged here. Deducting for
unpaid leave needs a daily rate, and dividing a monthly figure by a number of
working days is arithmetic no household agreed to.

## One table, not five

The kinds are the keys of `FINDERS` and `CONFLICT_KINDS` is read off them. A
hand-written list of kinds beside the finders that produce them is the fault
this repository has now found nine times, and it was not written a tenth. The
screen's copy is keyed the same way — `conflict.heading.<kind>` and
`conflict.why.<kind>` in the catalogue, built from the kind at the call site —
so a kind added with no copy fails a test rather than rendering an untitled
card.

## The banner that used to say half of it

`evidenceBanner` printed the orphans and the amount disagreements above the
Messages table. Two of the four kinds, beside a screen that now holds all
four, is how a household learns to distrust both numbers. It now counts and
points. The corroboration line stays where it was, because corroboration is
not a conflict.

## The check that could not fail

Removing `if (check.comparable === false) continue;` from the wages finder
changed no test. `reconcile` returns `months: []` when it cannot compare, so
`disagreements` was already empty and the guard could not alter an outcome.
It was removed rather than propped up with a test written to fit it — the
third unreachable belt-and-braces check found in this repository, after the
two `docs/SEALED_VALUES.md` records.

Two tests were weak in the same way and were fixed rather than left:

- *every conflict has a sentence with its figures in it* looped over
  `conflict.figures` and asserted nothing before the loop, so emptying
  `figures` passed every check inside it. A loop over nothing always agrees.
- *countByKind ignores a kind it has never heard of* asserted
  `counts.amount === 0`, which stayed true while a mutant added
  `invented: 1` beside it. It now asserts the keys.

Fourteen mutations, all caught.

## What the browser can and cannot check

The browser fixture never imports a statement, so the two alerts pasted
through the real box are linked to nothing and there is no disagreement for
the screen to list. Rather than fabricate one through a form that cannot set
the hidden `reference` field a bank match needs, the browser checks the
**empty state** and the populated screen is driven in `tests/services.test.mjs`
against a real database.

The empty state is worth checking on its own account: it is the sentence most
likely to overclaim. *All clear* is what an application says here, and this
one must not. Three checks assert it says *nothing disagrees*, that it says
agreement between records is not a person having checked any of them, and
that the words *verified* and *confirmed* appear nowhere. Rewriting the copy
to say `All clear` and `and that has been verified` fails all three.

## What it still does not do

It does not reconcile. It does not rank. It cannot tell a household which of
two figures is true, because that is a question about the world and no
arrangement of these records answers it. What it does is make sure that when
the records the household already has do not agree with each other, there is
one place that says so.
