# Reading a `.docx`, and filling it in

`js/domain/docxtemplate.js`, tested in `tests/docxtemplate.test.mjs`. One of the
eight documents Phase 0 required and never wrote, and the deliverable Phase 3
asks for and never had.

## What existed, and what did not

`reports/docx.js` has **written** documents since Phase 3. Nothing had ever
**read** one — which is the whole of the prompt's DOCX engine:

> User uploads a DOCX template. System reads DOCX, detects editable fields,
> creates template, displays fields, allows editing, generates new DOCX,
> preserves original.

Both halves it needed already existed. `reports/xlsx.js` has `zip`, and
`data/pdf-read.js` has `inflate` — written for a PDF's compressed streams and
exactly what a `.docx` entry needs, since both are DEFLATE. So this cost no
dependency, the same way the DOCX writer did.

## The problem that makes a naive version silently wrong

Word does not store `{{Name}}` as one piece of text. It stores **runs**, split
wherever formatting, spell-check state or an editing session happened to change:

```xml
<w:r><w:t>{{Na</w:t></w:r><w:r><w:t>me}}</w:t></w:r>
```

That is one placeholder, and a template a person has edited almost always has
some. A reader that searches each `<w:t>` on its own finds **none of them**,
reports *"no fields"*, and looks like it worked.

So the runs are joined before anything looks for a placeholder, and a value is
written back into the **first** run of the group with the remainder emptied —
preserving the formatting of the run the placeholder started in, and never
leaving half a placeholder behind. Half a placeholder in a finished document
reads as corruption; a whole one reads as an omission.

## What it refuses

- **The original is never modified.** The prompt says so twice; this returns new
  bytes and a test asserts the input is byte-identical afterwards.
- **An unfilled field keeps its placeholder.** A silent hole where a name should
  be is worse than a visible marker.
- **A value carrying XML cannot break the document** — it is escaped.
- **A document with no `{{fields}}` says so** rather than reporting an empty
  template as read. Nothing guesses which words are meant to be editable.
- **Parts it does not understand travel untouched** — styles, numbering, images,
  relationships.

## Verification

**8 of 8 mutations caught**, including *fields searched per run rather than
across them*, *the remainder of a split placeholder left behind*, *an unknown
field blanked instead of kept*, and *the runs rebuilt front to back so the
offsets stop being valid*.

One survived the first pass and was a genuine gap. The zip reader takes the
name and extra lengths from each **local** header rather than the central
directory, because a real Word file puts fields there — timestamps, Zip64 — that
the directory does not carry, and reading the wrong lengths lands a few bytes
into the data and shifts every part. Our own `zip` writes both alike, so the
fixtures could not tell the guard from its absence. The test now builds a zip by
hand with a local extra field.

`npm test` 1563, browser 259, typecheck 181/181, architecture 49 claims, UI→database 61/61.

## On the screen, in the same tranche

Recorded as a gap and closed rather than left. The Reports screen — where
documents are already produced, beside the rent receipts that generate `.docx` —
takes an uploaded template, lists the fields it found, and generates the filled
document.

The screen carries the refusal too: *"a field left empty keeps its marker, so
you can see which"*.

**Four browser checks**, driving a real `.docx` through the real file input,
including one that asserts the **run-split placeholder** appears as a field —
which is the entire difficulty, and the case a naive reader silently misses. The
fixture is built with the application's own `zip`, so the check exercises the
reader rather than a fixture the reader was written around.

The wiring was mutated: removing the card from the screen fails the suite.

## Still not done

- **No versioning, no PDF, no Drive upload**, all of which the prompt asks for.
- **Only `{{field}}` markers.** Word content controls and `MERGEFIELD` are the
  other two conventions and neither is read.
- **No `DocumentTemplate` or `DocumentField` entity**, so a template cannot be
  saved and re-used — it is read, filled and generated in one pass.
