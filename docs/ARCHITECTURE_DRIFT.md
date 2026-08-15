# The architecture document now describes this repository

`tools/architecture.mjs`, `tools/architecture-budget.json`,
`docs/FAMILY_OS_MASTER_ARCHITECTURE.md`, tested in `tests/architecture.test.mjs`.

## What was measured

An audit of the master architecture document against the code. It opens with
*"nothing here is built yet except what is marked **exists**"* — written during
Phase 0 — and **thirteen rows marked `missing` had been built**:

| Layer | Rows that had gone stale |
| --- | --- |
| 1 — Trust | session revocation & device management, ABAC (partial), six-level classification, consent, provenance, lineage, retention, AI governance (partial) |
| 3 — Intelligence | OCR, entity resolution (partial) |
| 4 — Data | `EconomicEvent`, transfer matching |
| 5 — Connectors | Google Calendar |

Layer 4's row was the sharpest: this document called `EconomicEvent` plus a
transfer-matching engine *"the largest single piece of Layer 4 work"*, and both
had been built two phases earlier.

**Anyone trusting the document would have planned work that was already done.**
That is not hypothetical — the roadmap has now caught itself doing exactly this
nine times, and answered it each time with *"measure before building"*, which
relies on somebody remembering.

## The fix is not an edit

Editing the tables would have produced a document that was accurate for one
afternoon. Every row now carries a **probe**, and CI runs them:

```
| Consent engine                 | exists  | `file:js/data/consent.js`          |
| Data classification            | exists  | `export:js/data/classification.js#LEVELS` |
| Anomaly detection, forecasting | missing | `absent:grep:anomal`               |
```

- `file:` — the path must exist.
- `export:` — the file must export that name. A module can survive a rename
  with its contents gutted, and a path check alone still passes.
- `absent:grep:` — the term must appear nowhere in `js/` or `apps-script/`.

**The third is the one that matters.** A document drifts by understating what
has been built, because building is what people do and nobody re-reads a table
to check whether it is still pessimistic. All thirteen stale rows drifted that
way. `absent:` is the only probe that fails in that direction.

48 claims now hold.

## The forbidden edge, counted instead of deplored

The document declares four edges that must not exist and admits one does:
screens calling `db.repo(...)` directly rather than going through
`js/services/`. That is not a boolean anybody fixes in a tranche —

```
71 direct calls across 14 screens
 3 in the service layer built to hold them
```

— so it is a **ratchet**, like the typecheck budget. The number lives in
`tools/architecture-budget.json`, may only go down, and a rise fails the build
with the five worst files named. The service layer has existed since Phase 1 and
is barely adopted; naming the number is what turns *"we should migrate someday"*
into something with a direction.

## What this cannot check, stated rather than implied

It verifies that a claim is **backed by evidence of the kind it names** — not
that the words in the component column are true of the code. Rewriting a row to
say *exists* and pointing `file:` at any file that happens to exist will pass,
and mutation testing confirmed it does: that mutation is the one survivor of six
and it is **accepted, not outstanding**.

Deciding whether "anomaly detection" describes a module is a judgement, and a
tool attempting it would be a worse judge than the reviewer reading the diff.
What the tool removes is *silent* drift — the row nobody edited, which is how all
thirteen got that way.

## Corrections this made to my own work

The checker failed on its first run against probes **I had just written**:

- `js/auth/lock.js#Lock` — the export is `lockScreen`.
- `js/core/config.js#localOnly` — the export is `loadLocalOnly`.
- `js/domain/tabular.js#readTable` — the export is `detectHeader`.

Three wrong claims in the first seventeen, written by somebody who had just read
the files. That is the argument for the tool in one line.

A fourth correction was in the tests: I asserted that a `db.repo` mention inside
a comment was counted, and it was not — the mention had no parenthesis. The
premise was wrong, not the code. The test now pins the real behaviour, and
`uiDatabaseCalls` takes an injectable file list so it can be tested without
breaking the repository to do it.

## Verification

- **5 of 6 mutations caught**; the sixth is the documented limitation above.
- `npm test` 1454, typecheck **181 against a budget of 181** — the four findings
  the new tests raised were fixed by typing the injection points rather than by
  raising the budget.
- The tool runs in the `suite` job, beside the policy and lint checks.

## Still not done

- **The 71 calls are still 71.** This tranche makes the number visible and
  irreversible; it does not migrate a single screen. That is the next
  architectural tranche, and it now has a scoreboard.
- **`absent:` probes are single terms.** A component that could be named two
  ways needs two rows or a regex, and the tool takes a regex but the document
  currently uses plain words.
- **Nothing checks the roadmap**, which is the other document that has gone
  stale nine times. The same probe idea would work there and is not done here.

---

## Postscript: the limitation bit one tranche later

This document closed by recording that `absent:` probes are single terms and
that a component nameable two ways needs two rows. That was written as a
theoretical caveat. It became a real one immediately.

The anomaly-detection tranche landed `js/domain/unusual.js`. The row said:

```
| Anomaly detection, forecasting | missing | `absent:grep:anomal` |
```

and it **still passed**, because the word *anomal* appears nowhere in the
module. It is called `unusual.js`, its export is `unusualSpending`, and its
docstring says *outlier*. Three synonyms, none of them the one probed.

Two things followed:

1. The row was split — anomaly detection now claims `exists` with an `export:`
   probe, and forecasting keeps its own row and is genuinely still missing.
2. The remaining `absent:` probes take a **regex with alternatives**
   (`forecast|projection`), which the tool always supported and the document was
   not using.

The tool did what it promises: it never claimed to catch a row nobody edited
*and* whose vocabulary it was not given. What this shows is the narrower lesson —
**a probe is only as good as the words in it**, and the person adding a row is
the person least likely to guess what a future implementer will call the thing.

---

## The ratchet moves: 71 → 63

The first screen off the repository is the Finance overview, and it was chosen
on evidence rather than on size.

`financeOverview` loaded **eight entities** and built its whole view model
inline — balances, this month's totals, the settlement report, the EMI split,
spend by member, upcoming bills, budgets, the commitment figure and the running
balance series. `services/service.js` names exactly this as the first of the two
things the layer is for:

> **Assembly has no home.** A screen loads eight entities, feeds them to pure
> functions in `domain/`, and builds a view model inline — so the assembly can
> only be tested through a browser.

**That cost was paid three times in one tranche.** Wiring the unusual-spending
findings into this screen family failed silently three times running — a month
key read from a field that does not exist, an array that is grouped rather than
sorted taken as sorted, and an import added by a replacement that matched
nothing. Each produced no error, no output, and a green suite.

`assembleOverview()` is now pure: records in, view model out, no database and no
clock unless one is passed. Five tests exist that could not have been written
before, including one pinning the seam that took two tranches to build — the
detector runs on the ledger, the committed figure comes from the records, and
the screen is where they meet.

**The refactor introduced a bug and the type checker caught it.** The screen
still draws `loansCard(loans, transactions)`, and the first version of the view
model did not carry `loans` — a `ReferenceError` on a screen every browser check
opens. `npm test` passed; `tsc` did not. It is now passed through deliberately,
because a view model that withheld it would send the screen back to the
repository, widening the very edge this narrows.

Typecheck held at **181** throughout: six imports the assembly took with it were
deleted rather than budgeted, and the load spec was annotated rather than
excused.

## And again: 63 → 61

`documents.js` was the next largest at twelve calls, but it was migrated on
*kind* rather than count. Two of its calls are the second thing the service
layer is for:

> **Cross-entity operations have no home.** `Repository.referencedBy` throws
> `wrong-layer` on purpose. Anything spanning entities has nowhere to live but a
> screen.

Both begin with a document and end by changing a different entity — filing a
receipt writes a `transaction`, recording a scanned identifier writes an
`identityDocument`. Both are writes where being wrong matters: one files
evidence against a payment, the other creates a record holding a document
number, and neither could be exercised without a browser.

**The refusals did not move.** `attachmentFor` still decides what counts as a
match; the service asks it rather than re-deciding, because a second place
deciding is a second place to be wrong. Only the writing moved, and with it the
knowledge of which repository the write lands in.

Five tests now cover ground that had none: that a receipt is **appended** rather
than substituted for what is already filed, that an uncertain match returns an
answer instead of throwing and **writes nothing at all**, and that filing the
same receipt twice is declined as a decision already made.

**61 of the original 71 remain**, across thirteen screens. Ten of `documents.js`
are ordinary reads and belong in a load spec, which is the same shape as the
Finance migration rather than a new one.


---

## Postscript 2: the tool had a silent failure of its own

The probe added in Postscript 1 — `absent:grep:forecast|projection` — **never
parsed**. A pipe inside a markdown table cell splits the cell, so `probesIn`
found nothing there: the row was silently not a claim, could never fail, and was
not even counted in the total.

It was found only by building forecasting and noticing the check still passed.

Alternatives now use **commas**. More importantly, a cell that looks like a probe
and does not parse is now reported as **malformed** rather than skipped — a
silent non-claim is the exact failure this tool exists to prevent, and it had
one. See `docs/CASH_RUNWAY.md`.
