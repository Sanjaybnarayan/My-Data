# Phase 0.5 — Report

**Trust & Governance foundation. Partial by design — see "Not started".**

## The judgement call, stated

Phase 0 ended blocked on one question: serverless, server, or hybrid? That
question was not answered before this phase began, so the work was chosen to
be **decision-independent**: classification is a property of the schema, and it
derives, masks and validates identically whether the schema later lives in
IndexedDB or PostgreSQL.

What was *not* attempted is the part that genuinely depends on the answer:
RBAC/ABAC enforcement. That remains advisory and browser-side, exactly as
Phase 0 found it, and no claim to the contrary has been added anywhere.

## Completed

**Data classification** — `js/data/classification.js`

- Six levels, derived from signals the schema already carries
- `classify`, `classificationOf`, `isKnownField`, `classified`, `census`,
  `mask`, `atLeast`, `assertSound`
- Wired into `privacyReport()` and a new `mostSensitive()`

## Files changed

| File | Change |
| --- | --- |
| `js/data/classification.js` | new |
| `js/domain/privacy.js` | reports classification; adds `mostSensitive()` |
| `sw.js` | precache the new module |
| `tests/classification.test.mjs` | new — 22 checks |
| `docs/DATA_CLASSIFICATION.md` | new |

No entity, field, record or migration was changed. **No stored data was
touched**, because classification is derived at read time and not persisted.

## Database changes

None. No migrations.

## Tests

| Check | Before | After |
| --- | --- | --- |
| Unit | 637 | **659** |
| Browser | 142 | **142** |
| Build | 88 modules | **89 modules, 487 exports** |

Every invariant was mutation-tested:

| Mutation | Result |
| --- | --- |
| `encrypted` no longer implies `HIGHLY_SENSITIVE` | 3 named tests fail |
| Unknown field returns `PRIVATE` again | 1 named test fails |
| `reveal` opens a `CRITICAL_SECRET` | 1 named test fails |

## Security review

One real bug found and fixed **during** the phase, before it shipped: the
first draft returned `PRIVATE` for a field it could not find. A misspelt key
would have come back as "safe to display" — a silent failure in the one
direction this module must never fail in. Unknown now returns
`CRITICAL_SECRET`, and `isKnownField()` distinguishes a secret from a typo.

Checked and clean: all three `password`-typed fields (`vaultItem.password`,
`vaultItem.totpSecret`, `digitalAsset.licenceKey`) are encrypted. No secret is
in the search index.

## Privacy review

**The finding of this phase: 108 fields classify at `HIGHLY_SENSITIVE` or
above, and 80 of them are stored in the clear.**

Not automatically wrong — a searchable field cannot be ciphertext, and each
trade is named per field by `whyPlain()`. But it is the number that "6.6%
encrypted" was standing in for, and it is now visible.

## Data-integrity review

No records touched. Classification is derived, never stored, so there is
nothing to migrate and nothing that can drift out of step with the schema —
the derivation *is* the schema read differently.

## Compliance-applicability review

Not started. No regulation has been assessed and no compliance claim has been
added. Classification is a prerequisite for that work, not a discharge of it.

## Known issues

1. **Masking is available but not applied by the UI.** `mask()` exists and is
   tested; no list column, detail view, search result or export calls it yet.
   Until it does, classification changes what a report says and not what a
   person sees.
2. Authorization is still advisory and browser-side.
3. `person` fields all derive `HIGHLY_SENSITIVE` because the entity sits in the
   identity module. Defensible but coarse — `person.nickname` is not a PAN.
   A declared `classification:` on the mild ones would sharpen it.

## Not started, from the Phase 0.5 scope

Consent engine · provenance · lineage · retention policies · deletion
propagation · processor registry · AI privacy gate · device trust.

Classification was taken first because Phase 0's audit named it as the
prerequisite: masking, export rules, AI gating and retention all need
something to key off, and most are incoherent without it.

## Next

Two candidates, in order of value:

1. **Apply masking in the UI** — finishes the loop this phase opened, and is
   the first point at which classification protects anything.
2. **Consent + provenance** — the next two items the audit named, both
   decision-independent.

**Stopping here. Awaiting explicit instruction.**
