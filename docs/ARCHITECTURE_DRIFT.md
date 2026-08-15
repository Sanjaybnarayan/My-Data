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
