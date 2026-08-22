# Getting your records out, and back

Written after a claim in this repository turned out to be false, and after a
document I had just added repeated it.

## The short answer

**Settings → Backup writes one encrypted file holding everything, and restores
it onto a new device.** Reports → Export raw data is a different thing: CSVs
for reading your records somewhere else, which nothing reads back.

If you sync to your own Google Sheet and Drive, that is also a backup, and a
real one: a new device signs in and pulls everything down. If you do not sync —
because you turned on local-only, or because you are running the Android or iOS
build, where signing in does not work at all — the backup file is the only copy
of your records that exists anywhere but this device.

> This section said the opposite until the backup was built, and the check
> written to stop that happening did not fire. It watched `fromCsv` for a
> caller, and the restore that arrived does not use `fromCsv` — a guard keyed
> to one implementation rather than to the claim it was guarding. It is keyed
> to the claim now.

## What an export is

Reports → Export raw data writes one entity to a CSV or an Excel file. It is
for reading your records somewhere else: a spreadsheet, an accountant, another
application. It is data portability, and at that it works.

What it is not is a copy of your records that anything can put back.

## What it carries, measured

There are 50<!--live:entities--> entities holding
594<!--live:fields--> fields between them, and an export is one file per
entity — so a complete one is forty-three files and eighty-six button presses.

Of those fields:

- **40<!--live:encryptedFields-->** are encrypted, and are left out unless you
  tick *Include encrypted fields in the clear*. Ticking it writes your document
  numbers, passwords and medical notes to a file in plain text, which is the
  right thing to offer and the wrong thing to do casually.
- **22<!--live:unexportableFields-->** are carried by no export at any setting.
  `columnsFor` drops every hidden field unconditionally. Three of them are
  `ref` fields — the links between records — so even a perfect reader would
  restore records that had forgotten what they pointed at.
- **21<!--live:attachmentFields-->** are attachment fields. A CSV carries the
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
their backup instead. That advice was wrong in the same way the `fromCsv`
comment was wrong: it described a restore that did not exist. A person who
followed it would have found out on the day their phone was stolen.

## The backup

`js/domain/archive.js` decides what an archive is; `js/services/archive.js`
fills one and puts it back; Settings has the two buttons.

1. **One file, not forty-three.** Every entity, every field including the
   hidden ones, the keyring, the audit history and the documents themselves.
2. **The rows exactly as the database holds them.** Encrypted fields stay in
   their `enc:v1:` envelopes, and the keyring travels with them, so the same
   PIN and phrase open the same records on the other side. Nothing is decrypted
   to be archived, so a restore cannot quietly change what a record says.
3. **Encrypted as a whole, with the recovery phrase.** The rows carry plaintext
   payees, amounts and dates — a search index over ciphertext finds nothing —
   so the file encryption is the only thing in front of them. The phrase is
   generated rather than chosen, is already written down, and is checked
   against the keyring *before* anything is sealed: a backup sealed with a typo
   is one nobody can open, and it fails silently.
4. **Only an owner may take one.** The repository filters rows by role, so an
   adult would produce a file missing six entities' worth of records with
   nothing saying so. Measured: owner 43 of 43, adult 37, child 13, member and
   guest none.
5. **A restore that refuses to guess.** Onto an empty device only. Merging into
   a store that already holds records is a reconciliation problem — two records
   with one id, an edit on each side — and the sync engine solves that with a
   shadow copy and a three-way merge that an archive has no equivalent of.
6. **A test that restores what it exported and compares** — including that an
   encrypted field opens again afterwards. That check found two defects the
   moment it existed: a restore that skipped the keyring passed everything
   else, and `Keyring` cached its wrapped keys so the restored ones were
   ignored.

7. **It reads the file back before handing it over.** Sealing can go wrong in
   ways nothing else here would notice — a truncated write, an encoder that
   mangled a surrogate pair in somebody's name — and a file written and never
   re-opened is the same mistake as an export with no reader. The bytes are
   decrypted again with the same phrase and counted against what went in, at
   the cost of one more derivation.

The card says when the last backup was taken, or that none ever has been. A
backup nobody remembers to take is close to a backup nobody has.

## What it still does not do

- **Merge.** A device that already holds records is refused, not reconciled.
- **Run on a schedule.** Somebody has to press the button, and nothing nags.
- **Prove the file on disk.** The bytes are verified in memory before the
  download; what the browser or the share sheet actually wrote is not read back,
  and cannot be from inside the page.
- **Survive a forgotten recovery phrase.** The phrase is the only key to the
  file. That is the point, and it is also the whole risk: lose it and the
  backup is as unreadable to the household as to anybody else.
