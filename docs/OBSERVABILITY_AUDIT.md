# Observability, Audited

Phase 0's only remaining gap read **"No observability audit"**. This is it.

`docs/OBSERVABILITY.md` already describes what `js/data/diagnostics.js` *is*
and, carefully, the two words it is not. What neither said is **how much of
the application it can see.** A record of failures is worth exactly the
fraction of failures that reach it, and nobody had counted.

## The measurement

```
catch sites in js/                            207
sites that record a diagnostic                  3
```

Three. `js/data/repository.js`, `js/data/connectors.js`, `js/sync/engine.js`.

So the store that exists to answer *"has this been happening?"* can answer it
for **a write, read or parse that went through the repository; a connector
that could not be read; and a sync attempt that did not complete.** Nothing
else. A failure caught in a service, a domain module or a screen is invisible
to it.

That is not three careless omissions — those three are the seams every write
and every sync passes through, and instrumenting them was the right first
move. But *"the application has an operational record"* and *"the application
records 3 of its 207 failure paths"* are different claims, and only the second
is measured.

### What this session found sitting in that blind spot

Every read-error fault found in this audit was caught somewhere with no
diagnostic:

| Where | Recorded? |
| --- | --- |
| `Assistant.load` swallowing a decryption failure | no |
| Amounts this device cannot parse | no |
| A Gmail scan losing messages to a rate limit | no |
| `AttentionService.everything()` throwing | no |
| A report built over a store that could not be read | no |
| `explainEvent` returning null for an unreadable movement | no |

Each of those now **tells the household on the screen where it matters**,
which is the more important half. None of them tells the diagnostics store,
so none can answer *"has this been happening for a week?"* — the question
`OBSERVABILITY.md` says the store exists for.

## The defect the audit found

`KIND.storage` — documented as *"the device is running out of room"* — **could
never be produced.**

```
KIND.error      1 emitter
KIND.refusal    1
KIND.sync       1
KIND.connector  1
KIND.storage    0
```

`idb.js` raises `StorageError` with `code: 'storage'` on a quota failure. It
reaches the repository's catch, which classified two ways only —
`ValidationError`/`forbidden` → refusal, everything else → error — so a full
disk was filed as a generic fault. `summarise` groups by kind, so the storage
row was permanently empty and **a household out of room read as an application
that was broken.** Different problems, different people, different fixes.

The classifier is now a named, exported `diagnosticKind(error)` — pulled out
of the catch block so the three-way decision can be tested without making a
real write fail in a real way. Four tests, three mutations, all caught,
including *"everything is a storage failure"*, which passes the new test and
destroys the refusal/error distinction the old ones were about.

## What is deliberately not done

**The other 204 catch sites are not instrumented.** Recording every caught
error would be the wrong fix: most of those catches are correct and
uninteresting — a dismissed share sheet, a permission refusal that is the
design, an optional lookup that failed. A diagnostics card listing all of them
is a card nobody reads, and `tools/lint.mjs` already argues that case about
findings in general.

What would be right is instrumenting the ones where **the application tells a
household something because a read failed** — the six in the table above. That
is a real piece of work with a design question in it (a household should not
see the same failure twice, once as a screen message and once as a
diagnostic), and it is named here rather than done quietly.

**No scoring changed for other phases.** `PHASE_STATUS.md` already refuses to
add observability points to twenty-seven rows for one module, and an audit of
that module does not change the arithmetic either. Phase 0's gap is closed
because the audit now exists; Phase 20 keeps the diagnostics credit it already
had.

## What this does not establish

**No failure is known to have gone unrecorded on a household's device**,
because that is precisely what an unrecorded failure means. The 3-of-207 figure
is about reach, not about incidents. It is the number that was missing from
`docs/OBSERVABILITY.md`, and stating it is the audit.
