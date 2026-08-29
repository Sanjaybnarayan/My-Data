# A Report Is Kept

`js/reports/build.js`, `tests/reports.test.mjs`.

## The rule this breaks

v6.0: **never silently ignore** errors; **never silently lose data**. And the
one this file makes concrete — a report is the artefact a household hands to
somebody else.

## What was found

`gather` loads every entity a report needs:

```js
try {
  data[name] = await db.repo(name).list({ limit: 20_000 });
} catch {
  data[name] = [];
}
```

No comment, no distinction, no record. A store that could not be read became an
empty list, and the report was built over it.

Then `renderCsv` said it out loud:

```js
if (!built.sections.length) blocks.push('No records fall in this period.\r\n');
```

**A report whose every store failed to read printed exactly that sentence into
a file a household keeps.** Not a screen that can be reloaded — a dated CSV,
XLSX or PDF, downloaded, possibly sent to an accountant, and read again a year
later with no memory of the moment it was made. Of every place this fault has
appeared in the audit, this is the one whose output outlives the failure.

This is the **fifth** instance of one shape: *an absence asserted from a read
error.* The others are `docs/A_READ_ERROR_IS_NOT_AN_ABSENCE.md`,
`docs/AN_AMOUNT_THIS_DEVICE_CANNOT_READ.md`,
`docs/MAIL_THAT_NEVER_ARRIVED.md` and
`docs/A_BARE_TAB_IS_NOT_A_QUIET_ONE.md`.

## What changed

`gather` returns `{ data, unreadable }`. The empty list is still produced — a
report that throws is worse than a short one — but the shortfall travels with
it, and `produce` puts a line at the **top** of `summary`:

> **Incomplete** — 2 record type(s) could not be read on this device
> (account, asset). This report is missing them — it is not a statement that
> there are none.

In `summary` rather than `note`, deliberately: `summary` leads all three
formats and `note` is rendered only by the PDF. A household that exports a CSV
is exactly as entitled to know the file is short.

And "No records fall in this period." is now printed only when nothing could
have been missed.

**A permission refusal stays silent.** A role that may not read loans
contributes none, and that is the design rather than a fault —
`core/errors.js` gives `PermissionError` the code `'permission'`, which is what
tells the two apart. Without that, every report a restricted household member
exported would carry a warning about the records they are not allowed to see.

## How it is checked

`tests/reports.test.mjs`, six cases, mutation-tested five ways:

```
M1  never record the failure (the original)
      FAIL  a read failure is carried out of gather
M2  a permission refusal counts as unreadable
      FAIL  a permission refusal is not a read failure
M3  print the sentence regardless
      FAIL  a CSV missing a record type does not say no records fall
M4  never print the sentence
      FAIL  but a genuinely empty period still says so
M5  the warning is never produced
      FAIL  the warning says it is not a statement that there are none
      FAIL  a CSV missing a record type does not say no records fall
```

M4 is the one worth pointing at. Suppressing the sentence outright satisfies
M3's test and leaves a household with a file that explains nothing — the
failure mode of a fix written only in the direction of the bug.

## The survey behind it, and what was deliberately not done

Measured across `js/`: **31 places** substitute an empty collection, a zero or
an empty object for a failed read — 26 as `.catch(() => [])` and five as a
`catch` block assigning `[]`.

A lint rule was considered and **rejected**. Most of those 31 are lookups, not
subjects: `js/services/timeline.js` and `js/services/health.js` catch a failed
`person` list so that rows appear without a name attached. An empty lookup
degrades presentation; an empty *subject* is a false statement. No regex can
tell those apart, and `tools/lint.mjs` says why that matters in its own words —
*"a rule whose every finding is wrong is worse than no rule — people learn to
skip the output."*

So the distinction is written down rather than automated, and the instances
where the swallowed read is the **subject** of the answer are fixed one at a
time. Still outstanding, measured and not fixed here:

| Where | What an unreadable store produces |
| --- | --- |
| `js/modules/dashboard.js:199` | a widget showing nothing, same as a household with nothing |
| `js/domain/automation.js:209,226` | a reminder that is never raised — and `app.js` discards the result entirely, so there is nowhere to report it |
| `js/services/health.js:80` | a health screen with no records |

The automation one needs a place on a screen to say it, which is a design
decision and not a loose end to tidy while fixing a renderer.

## What this does not establish

**No report is known to have been produced short.** No read failure has been
observed on a household's device. The fault is that if one happened, the
application handed somebody a document asserting there were no records. This
makes the shortfall visible on the artefact itself; it does not make the
failure rarer.
