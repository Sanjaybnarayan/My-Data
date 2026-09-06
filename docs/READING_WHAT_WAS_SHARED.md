# A picker that offered five formats and read one

Two questions, asked together: *does the app read a document somebody uploads
and fill in its fields, and can somebody share a file into it at all?*

Measured rather than guessed, and the answers were different.

| | before |
| --- | --- |
| Share a PDF from Gmail, WhatsApp, Files | **impossible** — FamilyOS was not in the share sheet |
| Pick a PDF with a text layer | **read**, kind detected, fields suggested |
| Pick a `.docx` or `.xlsx` | **never attempted** |
| Pick a `.txt` or `.csv` | **never attempted** |
| Tap **Scan**, or pick an image | **not read on the device**; read by Drive's OCR when it syncs |
| Pick a scanned PDF | same |

Everything in that last pair is now read on the device too — see *Pictures of
text* below. The rest of this document is the order the work happened in, and
the OCR came last because it was the piece I first argued could not be built.

## The picker invited what the reader refused

`js/modules/documents.js` offers
`accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt'`.

`js/domain/filing.js` answered:

```js
export function canReadText(mimeType) {
  return String(mimeType ?? '') === 'application/pdf';
}
```

Five of the six kinds the screen invited were filed with nothing read out of
them. A `.txt` — a file that is already text — was treated exactly like a
photograph.

## The `.docx` case is the sharp one

`js/domain/docxtemplate.js` has unzipped Word files and lifted their text runs
**since Phase 3**, to fill in report templates. `unzip` and `textRuns` are
exported and tested. `js/data/pdf-read.js` exports `inflate`, because a zip
entry and a PDF stream are both deflate.

Every piece was in the repository, working, with tests over it. Proven before a
line was written, by building a `.docx` with the application's own `zip` and
pushing it through the parts that already existed:

```
text lifted: "BESCOM Electricity Bill  Bill Number: 40021998
              Amount Payable: Rs. 2,340.00  Due Date: 18/10/2026"
kind:        bill
fields:      { biller: "BESCOM", amount: 234000, dueDate: "2026-10-18" }
suggestions: { expiresOn: "2026-10-18", category: "financial", title: "BESCOM" }
```

The only reason none of that happened is that one function said no. This is the
repository's most frequent finding — *the engine exists and nothing calls it* —
in the one place where the engine and the caller were both already written.

## Then the reader wrote four rupees

Widening what gets read widens what the extractor writes onto records, so the
extractor was checked first. `readAmount` takes the first number within forty
characters of its label:

```
"Premium due on 04/03/2027. Premium Rs. 12,500"  ->  premium = ₹4.00
```

The document says twelve and a half thousand. The reader took the **day of the
month** and wrote four rupees, confidently, from a label that was genuinely
there. Not a near miss and not a failure to find — a wrong answer where the
right one was in the same sentence.

`js/domain/extract.js` states the rule this broke, in its own header: *nothing
is inferred from a number's mere shape without a label near it, and a field
that cannot be found is absent rather than guessed.*

Dates are now blanked out of the text `readAmount` searches — with spaces of
the same length, because collapsing them would shorten the gap and let a label
reach *further* into the next sentence than the forty characters it is allowed.
Only there: `readDate` reads the same string and needs every one of them.

    "Premium due on 04/03/2027"                       ->  null   (was ₹4.00)
    "Premium due on 04/03/2027. Premium Rs. 12,500"   ->  ₹12,500 (was ₹4.00)
    "Annual Premium: Rs 18,400 payable on 04/03/2027" ->  ₹18,400 (unchanged)

## The split the ratchet asked for

Adding that pushed `js/domain/extract.js` from 859 lines to 897, and
`tools/module-size.mjs` refused it: *"No crowded file may grow and none may
join. Move code out rather than raising the number."*

The seam it pointed at is real. `js/domain/extract-values.js` reads a
**scalar** — a date, an amount, the value beside a label. `extract.js` keeps
reading a **document** — what kind it is, which of those to ask for, what to
suggest. 859 → 731, off the crowded list entirely, and the recorded budget
falls from five files to four.

`tests/extract.test.mjs` imports the moved functions from where they now live
rather than through a re-export, so the seam is visible there too.

## What is read now

`readerFor(mimeType, fileName)` returns `pdf`, `ooxml`, `plain` or `none`.

**The file name matters**, and that is not a convenience. A file arriving
through Android's share sheet frequently carries `application/octet-stream` or
nothing at all, because the sending app never set a type. Judging by the
declared type alone would read a `.docx` picked from storage and refuse the
identical file shared from Gmail.

A declared **image** is refused before the name is consulted, or `photo.txt`
would be opened as text and filed as read-and-empty.

`.doc` and `.xls` — the pre-2007 binary formats — are deliberately `none`. They
are not zip archives and nothing here can open them. Being told a file was not
read is better than having it filed as read with nothing in it.

## Pictures of text

An image and a scanned PDF carry pictures of text. The first version of this
document called that "a documented dependency rather than a gap", because both
went to **Drive's OCR** when they synced and the screen said so.

That answer was too comfortable. It is a network round trip and a connected
Drive, in an application whose first claim is that it works offline — and it
made the **Scan** button, the obvious thing to press while standing over a
bill, produce nothing at all until the phone had signal.

### The engine, and the one that was rejected

**ML Kit Latin text recognition, bundled into the APK.** It runs entirely on
the device and needs no Play Services — which matters, because this is a
sideloaded build. The Play Services variant downloads its model on first use
and would put the network back in the path this removes.

It is not cheap. Measured on the two CI builds either side of the change, the
APK went from **5.4 MB to 23.9 MB** — the recogniser and its model add about
**18.5 MB**, and nothing else in that release is large enough to matter. An
earlier draft of this page, the comment in `android/app/build.gradle` and the
docblock in `js/core/ocr.js` all said "roughly 4 MB", which was an estimate
nobody had checked against a built APK. Downloading four times the application
to read a photograph is a real cost to a household on a metered connection,
and it is the reason this is worth stating in the place the decision is
recorded rather than discovering it on a phone.

`tesseract.js` was the alternative, and it was rejected on grounds that have
nothing to do with size. `package.json` states *"The application itself has no
dependencies and no build step"*; there is no bundler to load a WASM module
through, and the CSP is `script-src 'self'` with no `wasm-unsafe-eval`. It
would have been a JavaScript dependency, and a vendored build artefact, in an
application that has neither.

The size argument would now run the other way — roughly fifteen megabytes of
vendored engine and language data against ML Kit's eighteen and a half — so it
is not offered here. It was offered in an earlier draft, resting on the four-
megabyte estimate, and that comparison was wrong.

### Scanned PDFs, by a different route

`data/pdf-read.js` is a text extractor with no rasteriser. Android has had one
since API 21, so `OcrPlugin` renders each page with `PdfRenderer` and
recognises the bitmap.

Three details that would otherwise have been found on a phone:

- **A PDF page has no background of its own.** Rendered onto the default
  transparent bitmap, every unpainted pixel is black once flattened, and
  black-on-black recognises as *nothing* — which reads exactly like a page with
  no text on it. It erases to white first.
- **A PDF that already carries text is never rasterised.** Recognition would
  replace an exact answer with a model's reading of a picture of it, silently.
  Removing that guard fails four checks that predate this work.
- **Ten pages, at roughly a second each.** A two-hundred-page policy would hang
  the capture for minutes, and `indexableText` caps the stored text anyway.

### And one that would only have been found on a large file

`String.fromCharCode(...bytes)` spreads one argument per byte. On the
two-megabyte photographs this exists for it throws `RangeError: Maximum call
stack size exceeded` — and never on the small buffers a test reaches for. The
encoder chunks, and has its own check at two megabytes.

## What recognition still will not do

**Latin script only.** A Kannada or Devanagari document comes back empty rather
than wrong. That is the right failure and it is still a failure.

**No handwriting.** **No layout** — a table is read as the lines it looks like,
which is enough for "Due Date: 18/10/2026" and is not a spreadsheet.

**Android only.** In a browser there is no recogniser and an image still waits
for Drive. Every function in `core/ocr.js` takes an injected plugin, so the
absent case is the one most heavily tested — most installs of this application
are a browser, and a build that quietly broke there would break the common
case.

## Recognising is not reading, and the difference is kept

Text lifted out of a PDF is what the document says. Text recognised from a
photograph is a model's reading of some pixels — usually right, and a different
kind of answer.

`canReadText` therefore stays **false** for an image, and `mayRead` is the
wider question the read paths ask. A screen that could not tell the two apart
would have nothing to say about which it was showing.

## Two things that fell out, worth more than the feature

**`intake` decided "unread" from the file's format.** `readerFor(...) === NONE`
was true of every image — correct while nothing could read one, and wrong the
moment `core/ocr.js` existed: a photographed bill that recognised perfectly
would still have been reported as unreadable. It now asks whether `ocrText` is
empty, which covers a build with no recogniser, a picture with no text in it,
and a scan too poor to read — the same thing to somebody watching for their
document.

**`textState` kept its own list of readable formats**, beside the one in
`filing.js`: `image/*` here, `application/pdf` there, everything else "nothing
here can read text out of this kind of file". Once `.docx`, `.xlsx` and plain
text became readable, that sentence was false about three formats and nothing
compared the two lists — the fault this repository has found more times than
any other, in a file whose own job is explaining what was read.

It derives from `readerFor` now, and distinguishes *the reader cannot open
this* from *the reader found nothing in it*. Routing its messages through the
catalogue on the way past dropped the unrouted-strings ratchet from **3,031 to
3,024**.

## The share sheet

`android/app/src/main/AndroidManifest.xml` carried one intent-filter: `MAIN` /
`LAUNCHER`. FamilyOS did not appear in the share sheet at all.

It now registers for `ACTION_SEND` and `ACTION_SEND_MULTIPLE` on the types
`readerFor` can do something with, plus images — an image is still a document
worth keeping, and refusing the share would be a worse answer than filing it
honestly unread. No wildcard `*/*`: an app that appears in the share sheet for
every file on the phone is a worse citizen than one that appears where it can
help.

**Nothing is decided in Java.** `ShareTargetPlugin` resolves a content URI to a
name, a declared type and bytes. Which reader a file needs and what to fill in
from it are decided in JavaScript, where the tests are. A second copy of that
judgement in the language with no tests over it, going first, is the argument
`SmsInboxPlugin` already makes about message filtering.

**The share is held, not announced.** On a cold share Android starts the app
*because of* the file, so the intent is delivered before the WebView has any
listener — an event would be lost and the file silently dropped. The plugin
holds it; `take()` drains it. And because `MainActivity` is `singleTask`, a
share into a running app arrives at `onNewIntent` and never at `onCreate`:
handling only the latter gives a share target that works exactly once per
launch, and works on the first try every time somebody tests it.

A share may **capture a document and open its naming form**. Not file it under
a person — a share carries no folder, and filing it under whoever was last
looked at would invent an owner.

## This has never run on a phone

Said plainly, the way `tests/trail.test.mjs` says it for the location trail.
There is no device and no emulator here. What is driven is the JavaScript
against a fake plugin: **the intent arriving, the URI resolving and the bytes
crossing the bridge are asserted by nothing.** `docs/PHASE_STATUS.md` says so
on the row.

What that leaves genuinely checked is everything after the bridge, which is
where all the judgement was deliberately put.

## What the ratchets caught

Four, and each was right:

- **`tools/module-size.mjs`** refused the 38 lines added to `extract.js`, which
  produced the split above.
- **`tests/native.test.mjs`** refused a new plugin name until it was declared,
  and separately checks the Java `@CapacitorPlugin(name = …)` annotation
  matches the string JavaScript asks for — a mismatch there reads as a platform
  limitation rather than an error.
- **`tools/strings.mjs`** refused six new English literals. Five became locale
  keys. The sixth was a `console.warn` — which became a diagnostics record
  instead, because `docs/OBSERVABILITY_AUDIT.md` names the failures where a
  failed read changes what a household is *told*, and "somebody shared a file
  and nothing appeared" is one of them.
- **`tests/run.mjs`'s precache check** caught all four new modules. A module
  that ships unprecached is a screen that works until the household goes
  offline.

## A tool that could not see its own subject

Recording that failure did not move `recordedFailures`, which stayed at 4.

`tools/self-description.mjs` counts recorders by matching a **static** import of
`data/diagnostics.js`. The new one was written as
`const { record } = await import(…)`, which the regex cannot see — so
`docs/PHASE_STATUS.md` would have gone on saying *4 of 233 catch sites* while
the truth was 5.

Both fixed: the import is static (`diagnostics.js` is already in the boot graph
through `repository.js`, so there was nothing to defer), and the tool now
recognises the dynamic form too, so the next one written that way is counted
rather than invisible.

## Three things wrong with the OCR work, found by auditing it

### A sentence that would have sent somebody to retake a good photograph

A household in Karnataka photographs a Kannada electricity bill. The bundled
model reads Latin only, so nothing comes back, and the screen said:

> no text could be recognised in this image, so nothing was filled in from it

Which reads as *the photograph was poor*. It was not — the picture was fine and
the script is not one this build reads. Somebody would retake it, in better
light, to exactly the same result.

The sentence now names the limit. And the fact was **already being reported and
read by nobody**: `OcrPlugin.available()` returned `{ available: true, scripts:
"latin" }` and nothing ever called it.

### A plugin method the JavaScript never invoked

That `available()` was dead. `core/ocr.js` answers the same question from
whether Capacitor hands back a proxy — synchronously, with no round trip — so
the Java method existed to be called by nothing.

Which is the defect this repository finds more often than any other, committed
in the middle of fixing an instance of it.

### And the check written for that one found a second, immediately

A sweep now fails on any `@PluginMethod` in a first-party plugin that no `.js`
file calls. Run for the first time it reported two: the `available()` above,
and `ShareTargetPlugin.pendingCount` — *"whether anything is waiting, without
taking it"* — written in the same sitting, called by nothing.

It sweeps all five plugin classes rather than listing known cases, so the next
plugin is covered without anybody adding a line. `checkPermissions` and
`requestPermissions` are skipped: Capacitor calls those itself.

Both places now carry a comment saying what was there and why it is not, so the
next person does not re-add it.

## Mutations

| mutation | caught by |
| --- | --- |
| `readAmount` stops masking dates | the premium tests, both halves |
| `readerFor` ignores the file name | the share-sheet case, and the end-to-end share |
| an image is read by its extension | `photo.txt` |
| Word runs joined with spaces | `12,500` split across three runs |
| a shared document is filed under a person | *none of them is filed under a person* |
| a too-large file is dropped | *is reported, not dropped* |
| the unread message claims it about all | *several say how many* |
| a PDF with text is rasterised anyway | four checks that predate this work |
| an empty recognition becomes an empty page | *a picture with no text is nothing* |
| base64 built with one spread | *a photograph large enough to blow the argument limit* |
| `canReadText` says an image is read | *recognised but not read, and not the same* |
| `textState` ignores the build's ability | *says it tried, rather than promising Drive* |
| `textState` back to its own list | *a format this device does read is not called unreadable* |
| re-add an orphan plugin method | *no plugin declares a method the JavaScript never invokes* |
| the message stops naming the Latin limit | *the sentence names the limit rather than implying a bad photograph* |

One mutation was applied to the **test file** and reverted with `git checkout`
— which failed silently, because the file was untracked. It polluted three
subsequent runs before the stray failure was traced back to it. The results
after it were still valid, because each mutation produced its own distinct
failure alongside the stray one, but that was luck rather than method.

The same trap sprang again on the last mutation in the table. `js/locale/en.js`
stores the em-dash as a `\u2014` escape and the anchor used the literal
character, so nothing was changed and the suite reported **17/17 passing** —
having been handed a file it had no reason to fail on. A `grep -c` before the
run is what tells a mutation that bit from a mutation that never happened, and
it is worth running every time rather than the times it seems necessary.
