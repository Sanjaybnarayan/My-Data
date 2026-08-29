# A Count That Stopped Counting

`docs/COMPLIANCE_READINESS.md`, `tools/compliance.mjs`,
`tests/compliance.test.mjs`.

## The rule this touches

v6.0: **do not claim regulatory compliance without implementation, testing,
evidence and applicability review**, and *"never claim compliance
automatically."*

## What was found

`tools/compliance.mjs` guards the register properly. Nothing may claim
VERIFIED; an IMPLEMENTED row must cite a file that exists; a TESTED row must
cite a suite the runner actually executes; every regime must have a document
and every document a regime; and no compliance document may contain a phrase
that reads as a compliance claim. All of it is tested in both directions.

**The document that summarises those checks was not one of the things they
check.** `docs/COMPLIANCE_READINESS.md` opened with a hand-typed block:

```
19 regimes · 68 controls
41 TESTED · 8 NOT_APPLICABLE · 7 IMPLEMENTED · 7 NOT_STARTED
 4 DESIGNED · 1 LEGAL_REVIEW_REQUIRED · 0 VERIFIED
```

The register now reads **45 TESTED · 9 IMPLEMENTED · 8 NOT_APPLICABLE ·
5 DESIGNED · 1 LEGAL_REVIEW_REQUIRED · 0 NOT_STARTED · 0 VERIFIED**. Seven
controls the document called NOT_STARTED had been finished, and none remained.

Seven of the nineteen per-regime rows had drifted with them:

| Regime | The document said | The register said |
| --- | --- | --- |
| DPDP | TESTED 2 · IMPLEMENTED 1 · DESIGNED 1 · NOT_STARTED 2 | TESTED 2 · IMPLEMENTED 2 · DESIGNED 2 |
| UIDAI | TESTED 4 · IMPLEMENTED 1 | TESTED 5 |
| Property | TESTED 3 · IMPLEMENTED 1 · NOT_STARTED 1 | TESTED 4 · IMPLEMENTED 1 |
| Staff | TESTED 2 · NOT_STARTED 2 | TESTED 2 · IMPLEMENTED 2 |
| Electronic Records | TESTED 3 · NOT_STARTED 1 | TESTED 4 |
| SOC 2 | TESTED 1 · NOT_STARTED 1 · NOT_APPLICABLE 1 | TESTED 2 · NOT_APPLICABLE 1 |
| ISO 27701 | TESTED 1 · IMPLEMENTED 1 · DESIGNED 1 | same three, different order |

**Every drift is in the same direction: understating what is built.** That is
the direction `tools/architecture.mjs` was written to catch, for exactly the
reason its header gives — a document that overstates what is missing causes
work to be planned that is already done. It had reached the compliance
register's own summary, which two other documents cite as the readiness
position.

The document did date itself — *"Base: `1c8d97d` · 22 August 2026"* — which is
honest, and is not a mechanism. Nothing read the numbers after they were typed.

## What changed

The block is generated. `tools/compliance.mjs` gained `readinessBlock()`,
which derives the headline counts and the per-regime table from `REGIMES`, and
a fifth check comparing it against what the document carries between
`<!--counts:begin-->` and `<!--counts:end-->`. `--update` rewrites it.

Two details are deliberate:

- **Statuses are printed in a fixed order**, not sorted by count, so that
  regenerating after one control moves gives a one-line diff about that
  control rather than a reshuffle nobody reads.
- **Zero is printed for VERIFIED and NOT_STARTED and omitted for everything
  else.** Those two zeroes are the claims worth making; the rest would be
  padding. A test holds both halves of that.

A document that has lost its markers is reported, not skipped — otherwise
deleting two comments would quietly return the numbers to being hand-typed.

## How it is checked, and the one that got away first

Five cases, mutation-tested. The first round:

```
M1  a stale number in the document   CAUGHT
M2  the markers deleted              CAUGHT
M4  the two zeroes omitted           CAUGHT
M3  the comparison never fails       *** NOT CAUGHT ***
```

M3 is the one worth recording. `check()` reads the real document, the real
document was in sync, and the test asserted only that no problem was found —
so replacing the comparison with `false` broke nothing. **The check could not
be shown to fail**, which is the defect this entire file exists to prevent,
arriving inside the fix for it.

The comparison was pulled out into a pure `readinessProblems(text, block)` and
handed a document that has drifted. Re-run:

```
M3  the comparison never fails       CAUGHT
M5  a missing document passes        CAUGHT
```

## What this does not do

**It does not make any compliance claim, and the register's ceiling is
unchanged.** VERIFIED is still zero, still a ratchet, and still requires a
person qualified to judge. Correcting the summary moved seven controls from a
stale NOT_STARTED to what they had already reached; it did not raise any
control's status.

**It does not check that a cited suite exercises the control it is cited for.**
`tools/compliance.mjs` verifies that the file exists and that the runner runs
it. Whether the tests inside it are about that obligation is a judgement, and
the tool does not pretend to make it — its header already says so.

## The non-finding beside it

`PMLA/no-str` is the one NOT_APPLICABLE control with no `gap` sentence, and
`unexplained()` deliberately does not look at NOT_APPLICABLE rows. That looked
like a missing applicability review and is not: every one of the nineteen
regimes carries a `why`, the shortest is 118 characters, `PMLA`'s says *"record-keeping
and reporting obligations fall on reporting entities. A household keeping its
own statements is not one, and has nothing to file"*, and
`tests/compliance.test.mjs` asserts a `why` on all nineteen. The applicability
argument is made where it belongs and is enforced. A control-level restatement
would be style, so no check was added for it.
