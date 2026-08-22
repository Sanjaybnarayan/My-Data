# The Scorecard Went Stale In The Direction It Exists To Catch

`tools/architecture.mjs` now reads `docs/PHASE_STATUS.md` as well as
`docs/FAMILY_OS_MASTER_ARCHITECTURE.md`. Tested in `tests/architecture.test.mjs`.

## What was found

`docs/PHASE_STATUS.md` opens by explaining why it exists:

> *Leaving the audit's numbers standing would have been the exact fault the
> audit exists to catch — a document asserting that built things are unbuilt.*

Four of its twenty-seven rows were doing exactly that.

| Row | Claimed | Measured |
| --- | --- | --- |
| 2 | "No family-tree view" | `js/domain/tree.js` exists, is the **default tab** on Family, and has browser checks |
| 2 | "No per-person profile screen" | `js/domain/profile.js` exists and is drawn on Identity |
| 7 | "FD/RD classification imprecise (`p2p-out`)" | reads `sweep` / `internal` on all three axes |
| 25 | "3,319 strings" | 3,487, and rising until the ratchet was added |

A fifth, in the summary prose, called §8.1 an open critical defect four lines
below the row recording its fix. That one was corrected in an earlier tranche;
these are the rest.

The cost is not tidiness. **A scorecard that overstates what is missing causes
work to be planned that is already done** — and this session nearly did it: a
check-in note written from the scorecard listed *"Phase 2: no family-tree view,
no per-person profile screen"* as the next thing to build. Measuring first is
what stopped it.

## Why a document with a checker went stale anyway

`FAMILY_OS_MASTER_ARCHITECTURE.md` has had probes since Phase 0 and its rows
hold. `PHASE_STATUS.md` had none. That is the whole difference, and it is the
eleventh instance in this repository of the same shape: a claim in prose with
nothing checking it.

## What the probes can and cannot say

A gap column has to stay readable, so a probe may now be **appended** to prose
after a `·` rather than replacing the cell. A row forced to choose between
being legible and being checked would simply not be checked.

Probes are found in **any** column. The first attempt read `cells.at(-2)`,
which is the evidence column of the architecture table but the *Risk* column
of the scorecard — so it found `Low`, reported a malformed probe, and would
have gone on failing on correct rows. A rule that depends on a table's shape
breaks when a column is added, and breaks silently, because a probe that is
not found is a claim that cannot fail.

The probes added are the **refusals**, because those are the rows where a
document going stale is a safety claim going stale:

| Row | Refusal | Probe |
| --- | --- | --- |
| 2 | no CKYCRR integration | `absent:grep:cersai,ckycindia,…` |
| 8 | no broker connector | `absent:grep:kite.zerodha,api.zerodha,…` |
| 11 | ABDM is architecture only | `absent:grep:abdm.gov,abha.*api,…` |

Each was mutation-tested by planting a plausible fetch in `js/data/schema.js`.
All three fire.

**`absent:grep:` cannot tell a refusal from an implementation.** The first
CKYCRR probe was `absent:grep:ckycrr`, and it failed immediately — on the
comment in `js/data/schema.js` that reads *"This is not a CKYCRR integration
and must never become one by accident."* The word appearing in a refusal is
the opposite of a violation. The probe now names things only a real
integration would carry: the registry operator, a hostname, a fetch.

## What was not done

Row 25's count now carries a `live:unroutedStrings` marker, so
`tools/self-description.mjs` holds it rather than a person. That is the right
instrument for a number. Probes remain for claims of *absence*, which is what
they can check.

No row's **percentage** is checked by anything, and none can be: the weighting
is a judgement, and a tool that scored it would be inventing certainty.
Phase 2 moved 80 → 88 and Phase 7 76 → 84 because their stated gaps were not
real, and both remain MOSTLY_COMPLETE.
