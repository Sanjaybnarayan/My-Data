# Getting your records out, and back

Written after a claim in this repository turned out to be false, and after a
document I had just added repeated it.

## The short answer

**FamilyOS can export your records. It cannot restore them.** Those are
different things, and only the first one exists.

If you sync to your own Google Sheet and Drive, that is your backup, and it is
a real one: a new device signs in and pulls everything down. If you do not sync
— because you turned on local-only, or because you are running the Android or
iOS build, where signing in does not work at all — then there is no backup,
and the export screen is not a substitute for one.

## What an export is

Reports → Export raw data writes one entity to a CSV or an Excel file. It is
for reading your records somewhere else: a spreadsheet, an accountant, another
application. It is data portability, and at that it works.

What it is not is a copy of your records that anything can put back.

## What it carries, measured

There are 43<!--live:entities--> entities holding
519<!--live:fields--> fields between them, and an export is one file per
entity — so a complete one is forty-three files and eighty-six button presses.

Of those fields:

- **35<!--live:encryptedFields-->** are encrypted, and are left out unless you
  tick *Include encrypted fields in the clear*. Ticking it writes your document
  numbers, passwords and medical notes to a file in plain text, which is the
  right thing to offer and the wrong thing to do casually.
- **22<!--live:unexportableFields-->** are carried by no export at any setting.
  `columnsFor` drops every hidden field unconditionally. Three of them are
  `ref` fields — the links between records — so even a perfect reader would
  restore records that had forgotten what they pointed at.
- **17<!--live:attachmentFields-->** are attachment fields. A CSV carries the
  identifiers of the files, never the files. Your scanned passport is not in
  there.

## What can read one back

Nothing.

`js/reports/csv.js` has a `fromCsv`, and it is called by one test and by no
screen. Its comment used to say it was *"used by the import path in Settings"*.
There is no import path in Settings. The same comment then said, correctly,
that "an export nobody can read back is a backup nobody has" — describing the
application it was sitting in without anyone noticing.

## Why this is written down now

The Capacitor work turned Android's OS-level backup off, for a good reason:
auto-backup would copy the wrapped key material to Google's servers, and
`auth/lock.js` allows a four-digit PIN, so ten thousand candidates would be all
that stood behind it.

That change then told households to *"export from Reports on a schedule"* as
their backup instead. This document exists because that advice was wrong in the
same way the `fromCsv` comment was wrong: it describes a restore that does not
exist. A person who followed it would find out on the day their phone was
stolen.

## What a real answer needs

Not built, and listed so that nobody has to rediscover the shape of it:

1. **One file, not forty-three.** Every entity, every field — including the
   hidden ones — in a single archive with the schema version it was written
   against.
2. **Encrypted by default.** A plaintext archive of a household's entire
   records is a worse object to leave on a laptop than anything the app
   currently produces. It should be encrypted to the data key, with the
   recovery phrase able to open it — which is the one thing the recovery phrase
   would then genuinely be for.
3. **The attachments, or an honest statement that they are not included.**
4. **A restore that refuses to guess.** Into an empty store is the case that
   matters — a new phone — and is the one worth building first. Merging into a
   store that already has records is a reconciliation problem, and this
   codebase already has strong opinions about not forcing uncertain matches.
5. **A test that restores what it exported and compares**, because an export
   nobody has read back is exactly how this situation arose.

Until that exists, the honest statement to a household running the native app
is: *your records are on this device and nowhere else.*
