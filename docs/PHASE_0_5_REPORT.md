# Phase 0.5 — Report

**Trust & Governance foundation. Partial by design — see "Not started".**

Five tranches, each checkpointed separately:

| # | Tranche | Module | Doc |
| --- | --- | --- | --- |
| 1 | Classification | `js/data/classification.js` | `DATA_CLASSIFICATION.md` |
| 2 | Masking in the UI | `table.js`, `crud.js`, `schema.js` | (same doc) |
| 3 | Provenance | `js/data/provenance.js` | `DATA_PROVENANCE.md` |
| 4 | Lineage | `js/data/lineage.js` | `DATA_LINEAGE.md` |
| 5 | Retention and erasure | `js/data/retention.js` | `DATA_RETENTION.md` |
| 6 | Consent and processors | `js/data/consent.js` | `DATA_CONSENT.md` |

## The judgement call, stated

Phase 0 ended blocked on one question: serverless, server, or hybrid? That
question has still not been answered, so every tranche here was chosen to be
**decision-independent**. Classification, provenance, lineage and retention are
all properties of the schema and of records; they derive identically whether
the schema later lives in IndexedDB or PostgreSQL.

What was *not* attempted is the part that genuinely depends on the answer:
RBAC/ABAC enforcement. That remains advisory and browser-side, exactly as
Phase 0 found it, and no claim to the contrary has been added anywhere.

## Completed

**1. Data classification** — six levels derived from signals the schema already
carries. `classify`, `classificationOf`, `isKnownField`, `classified`,
`census`, `atLeast`, `assertSound`. Wired into `privacyReport()` and a new
`mostSensitive()`.

**2. Masking on screen** — a `maskable()` predicate narrower than
classification, because masking on level alone would hide `person.name`. 18
fields mask; all 18 are already `encrypted: true`. Applied in the table
renderer and routed through the existing `reveal()` control in `crud.js`.

**3. Provenance** — where a figure came from, one hop. A `READERS` table per
entity, `provenanceOf`, `traceable`, `isUnderstood`, `explain`, `coverage`.
`verification` is the constant `UNVERIFIED`, because **nothing in this
application records a human sign-off** and a field that always said "verified"
would be a lie with a schema.

**4. Lineage** — the whole chain, across hops. Origin edges are **declared, not
inferred**: the schema has 47 `ref` edges and only 3 of them mean "came from".
Chains stop at something outside the application that can be named but not
fetched.

**5. Retention and erasure** — four policies derived from module and
classification; a purge that reports what it would do before doing it; and an
explicit list, returned with every plan, of what erasing **cannot** reach.

**6. Consent and the processor registry** — six purposes, three processors, an
append-only decision log, a Settings card that **is** the moment of asking, and
a gate in `sync/engine.js` and `sync/drive.js` that honours an explicit no.

The first five tranches produced engines with no callers, which I flagged as
this phase's own known issue. This one is wired end to end: recorded in
Settings, read by two egress paths, and checked in the browser.

## A correction to the Phase 0 audit

The Phase 0 audit stated that deletion does not propagate. **That was wrong.**
A soft delete drops the search entry in the same transaction
(`repository.js`), queues `op: 'delete'` to the backup spreadsheet
(`sync/engine.js`), and trashes the Drive file (`documents.js`).
`docs/PROJECT_AUDIT.md` now carries the correction prominently.

The real gap was different: **nothing was ever hard-deleted.** A vault entry
deleted two years ago still held its password in IndexedDB. That is what
tranche 5 addresses.

## Files changed

| File | Change |
| --- | --- |
| `js/data/classification.js` | new |
| `js/data/provenance.js` | new |
| `js/data/lineage.js` | new |
| `js/data/retention.js` | new |
| `js/data/consent.js` | new |
| `js/domain/privacy.js` | reports classification; adds `mostSensitive()` |
| `js/ui/components/table.js` | masks maskable columns at render |
| `js/modules/crud.js` | routes maskable fields through `reveal()` |
| `js/modules/settings.js` | the consent card — the moment of asking |
| `js/sync/engine.js` | refuses to sync when backup consent was withdrawn |
| `js/sync/drive.js` | same, for documents, before the bytes are read |
| `js/domain/mailboxes.js` | exports `MAILBOXES_KEY`, now read by two screens |
| `js/modules/receipts.js` | uses that key instead of its own copy |
| `js/data/schema.js` | `identityDocument.subtitle` no longer the number |
| `sw.js` | precache the five new modules |
| `tests/{classification,provenance,lineage,retention,consent}.test.mjs` | new — 101 checks |
| `tests/browser.mjs` | masking and consent checks |
| `docs/DATA_{CLASSIFICATION,PROVENANCE,LINEAGE,RETENTION,CONSENT}.md` | new |
| `docs/PROJECT_AUDIT.md` | audit correction |

No entity, field, record or migration was changed. **No stored data was
touched** — classification, provenance and lineage are all derived at read
time, retention only ever acts on records already soft-deleted, and consent
records are new rows in the local meta store.

## Database changes

None. No migrations.

## Tests

| Check | Phase 0 | Now |
| --- | --- | --- |
| Unit | 637 | **738** |
| Browser | 142 | **155** |
| Build | 88 modules | **93 modules, 524 exports** |

The browser suite needs `PLAYWRIGHT_CHROMIUM_PATH` set on this container:
Playwright wants chromium revision 1234 and the image ships 1194 at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Without it the run does
not fail — it hangs for ten minutes attempting a download the proxy blocks.

Every invariant was mutation-tested. The results that mattered:

| Mutation | Result |
| --- | --- |
| `encrypted` no longer implies `HIGHLY_SENSITIVE` | 3 named tests fail ✓ |
| Unknown field returns `PRIVATE` again | 1 named test fails ✓ |
| `reveal` opens a `CRITICAL_SECRET` | 1 named test fails ✓ |
| Eligibility ignores `deletedAt` | 2 named tests fail ✓ |
| Secrets get the standard retention window | 1 named test fails ✓ |
| Remove the search-index delete from `purge()` | **nothing failed** ✗ |
| Gate sync on `!hasConsent` instead of `refused` | 4 named tests fail ✓ |
| Remove the Drive consent gate | 1 named test fails ✓ |
| Consent button repaints without writing a record | 1 browser check fails ✓ |

The search-index one was the useful result. It was not a missing test but a
**test that proved nothing** — it asserted the search entry was absent after
purging, which was already true because the soft delete had removed it.
Rewritten to assert the thing with content: that a soft delete clears the
index. The line in `purge()` stays, annotated as defensive and unreachable.

That lesson shaped tranche 6's tests: the Drive gate is driven through the real
uploader rather than by asserting `refused()` returns true, and the Settings
button is checked by clicking it and reading the record back.

## Security review

Three real bugs found and fixed **during** the phase, before any shipped:

1. `classify()` returned `PRIVATE` for a field it could not find — a misspelt
   key came back "safe to display", a silent failure in the one direction this
   module must never fail in. Unknown now returns `CRITICAL_SECRET`.
2. `identityDocument.subtitle` was the document number. A **projection path**
   bypassing field-level masking entirely: the passport number appeared in
   every list row regardless of what `maskable()` said.
3. `explain()` keyed off confidence alone, telling a statement row a receipt's
   reason.

Checked and clean: all three `password`-typed fields are encrypted; no secret
is in the search index.

## Privacy review

**108 fields classify at `HIGHLY_SENSITIVE` or above, and 80 of them are
stored in the clear.** Not automatically wrong — a searchable field cannot be
ciphertext, and each trade is named per field by `whyPlain()`. But it is the
number that "6.6% encrypted" was standing in for, and it is now visible.

Erasure is now possible and its **limits are stated in the plan itself**, not
in a document: other devices, the spreadsheet's revision history, exported
files, and Drive's bin are all out of reach. "Erased" means erased from this
device.

**The consent finding: of the five purposes that send data anywhere, two had no
moment of asking at all** — `backup` and `documents`, which are the two that
matter most. Keeping a copy of every record in a household's spreadsheet is the
most consequential thing this application does, and it followed from a
deployment being configured. Nobody was ever put the question. The Settings
card is now that question, and the report marks the state `neverAsked`, which
is deliberately distinct from "asked and declined".

## Data-integrity review

No records touched. Everything here is derived except the purge, and the purge
never touches a record that is not already soft-deleted — asserted directly,
because a retention policy that could reach a live record would be a scheduled
data-loss bug with a respectable name.

## Compliance-applicability review

Not started. No regulation has been assessed and no compliance claim has been
added anywhere. Classification and retention are **prerequisites** for that
work, not a discharge of it.

## Known issues

1. **Retention has no UI.** Nothing calls `purgeable` or `purge` yet, and
   nothing runs on a schedule. Given that erasure is irreversible, a household
   should press the button — but the button does not exist.
2. **Provenance and lineage have no UI** either. Both are engines with tests;
   neither is on screen.
3. **Consent is per device.** The records live in the local meta store, which
   does not sync, so a second device starts with none. Defensible — a person
   consents in front of a screen — but "the household's consent history" is not
   something this can show.
4. **`identity`, `escrow` and `mail` are recorded but not gated.** Signing in
   happens before there is a database to read a record from; escrow and mail
   are one-time actions with a real moment of asking already, so a gate would
   sit where nobody passes twice. Recording them at their own moment is the
   next step and is not done.
5. Authorization is still advisory and browser-side.
6. Nothing records a human verification, so `verification` is a constant.
7. Lineage is record-level. A single mis-read *cell* cannot be traced.
8. `person` fields all derive `HIGHLY_SENSITIVE` because the entity sits in the
   identity module. Defensible but coarse — `person.nickname` is not a PAN.

## Not started, from the Phase 0.5 scope

AI privacy gate · device trust.

The **AI privacy gate is deliberately not built**, and that is a finding rather
than an omission. The assistant is entirely local: it matches a question against
an intent registry and answers from records already on the device. There is no
hosted model and no request. A gate in front of a network call that is not made
would be a control that changes nothing, and the honest equivalent is what was
done instead — `assistant` is listed in the purpose registry with **zero**
processors, so a future change routing a question to a hosted model would have
to edit that line.

## Next

1. **Surface tranches 3–5** — provenance, lineage and retention are still
   engines without screens. Tranche 6 shows what wiring one costs: it is small,
   and it is the point at which any of them informs anybody.
2. **Record consent at the three real moments** — sign-in, mailbox attach,
   Continue with Google — so the Settings card is not the only place a
   decision can be captured.

**Stopping here. Awaiting explicit instruction.**

Still open from before this phase: the **§0 architecture decision**
(serverless / server / hybrid), and **PR #18**, green and unmerged.
