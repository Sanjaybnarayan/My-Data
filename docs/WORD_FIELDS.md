# The Fields Word Actually Writes

`js/domain/docxtemplate.js`, tested in `tests/docxtemplate.test.mjs`. The
paragraph `docs/GENERATED_DOCUMENTS.md` closed with, answered.

## What a Word-built template reported

`{{Name}}` is what a person types into a document. It is not what Word's own
field UI writes, and a template built the way Microsoft documents carries no
braces anywhere. Measured against three shapes before any of this existed:

```
MERGEFIELD (simple)    fields: []
MERGEFIELD (complex)   fields: []
content control        fields: []

filling a mergefield changes nothing: true
```

Zero fields, honestly reported, and useless. A household who built their rent
receipt in Word — with Insert → Quick Parts → Field, which is the way anybody is
told to do it — would upload it and be told there was nothing in it.

## The three shapes

**`<w:fldSimple w:instr=" MERGEFIELD Tenant ">`** — one element, the easy case.

**The complex form** — the same field, written as five runs: a `begin`
`fldChar`, a run holding the `instrText`, a `separate`, the text Word displays,
and an `end`. This is what Word writes most of the time, and it is why joining
run text does not help: the joined string contains the field's own
*instruction*, so a naive reader would offer the household a field called
`MERGEFIELD`.

**A content control** — `<w:sdt>` — named by `w:tag`, with `w:alias` as the
label the author sees. The tag is preferred and the alias is the fallback,
because a template whose controls carry only an alias is still a template
somebody built on purpose.

## A filled field becomes static text

Every one of the three is replaced **whole** by an ordinary run.

That is a decision rather than an implementation detail. A `<w:sdt>` that kept
its control would produce a document Word offers to edit as a form; a
`fldSimple` that survived would produce one that re-merges against a data source
this application has no part in. Generating means producing a **document**, and
the template is untouched either way — `generate` returns new bytes and always
did.

## What it refuses

**A field that is not a `MERGEFIELD`.** ` PAGE `, ` DATE ` and ` TOC ` are Word
fields too. Filling them would be this application overwriting a document's page
numbers with whatever a household typed into a box, so the instruction must name
a merge field or the span is not ours. A test fills a ` PAGE ` field with `99`
and asserts the document is returned byte-identical.

**An unfilled field.** It keeps its placeholder — `«Tenant»` stays visible —
exactly as an unfilled `{{brace}}` does. A document with a silent hole where a
name should be is worse than one that shows which name is missing.

## The one structural assumption, stated

A complex field's `begin` and `end` `fldChar` elements each sit as the first
child of their own run. That is what Word writes. A field nested some other way
is **not matched**, so it keeps its placeholder and stays visible rather than
being half-replaced — which is the failure mode worth designing against, because
half a replaced field is a corrupt document rather than an obvious omission.

## What mutation testing found

Five mutations, all five caught:

| Mutation | Caught by |
| --- | --- |
| **Any field instruction counts, not only MERGEFIELD** | *a field with no MERGEFIELD instruction is not one of ours* |
| **Spans replaced front to back** | *two fields in one paragraph are both replaced* |
| **An unknown field is blanked** | *an unfilled Word field keeps its placeholder* |
| **A control with only an alias is ignored** | *an alias stands in when a control carries no tag* |
| **Word fields are not reported at all** | the three shape tests, and the mixed-template one |

The front-to-back mutation is the one worth naming: replacing an earlier span
first invalidates every later offset, so the second field in a paragraph is
written into the middle of the first one's replacement. Two fields in one
paragraph is the smallest fixture that catches it, and a template with one field
per line never would.

## What is still not built

**PDF output** from a filled template, and **template versioning** — each
generation is a separate document record related only by the template name it
carries. Both are named in `docs/GENERATED_DOCUMENTS.md`.

Nothing here reads a `w:dropDownList` or a date-picker control's constraints: a
content control is treated as a place a value goes, and the fact that its author
restricted it to three options is not enforced. A household typing a fourth gets
their fourth, in a document that no longer carries the control that would have
objected.
