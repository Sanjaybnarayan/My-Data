# KYC Without A Registry

Phase 2, second tranche. `js/data/schema.js` (`kycRecord`), `js/domain/kyc.js`,
`js/modules/identity.js`, tested in `tests/kyc.test.mjs` and in the browser
suite.

## What was asked, and what was built

Phase 2's scope names CKYC 2.0. There is no authorised CKYCRR access and none
can be fabricated, so the choice was between a connector that reports
`NOT_SUPPORTED` and does nothing, or **a document-shaped local record**. This is
the second.

Unlike the last four tranches, this one fixes no wrong number. Nothing
CKYC-shaped existed, so there was nothing to measure first — and saying so
plainly matters more than dressing it up as a discovery.

## Why it earns its place without any connectivity

A household's address changes once. Their bank, their broker, their insurer and
their fund registrar find out at four different times, or never. Nothing tells
them which of the four is stale, and every one of those institutions believes
its own copy.

`kycRecord` is the household's note of what one institution holds — typed in
from a statement, a portal page, an account-opening form or a letter, with a
`source` field saying which, because *"printed on my statement"* and *"somebody
told me on the phone"* are different kinds of evidence and only the household
can say which this was.

`domain/kyc.js` reads those notes against each other and against the person's
own record, and reports where they differ.

## What it never does

**Contact the registry.** Nothing here does, no value comes from it, and the
screen says so above everything else:

> These are your own notes on what each institution holds, taken from
> statements, portals and letters. Nothing here is fetched from the Central KYC
> Records Registry, and nothing here is verified — only compared.

That sentence is on the screen and asserted by a browser check, not left in a
comment nobody using the application will read. Removing it fails the suite.

**Decide which copy is right.** It never is one: the household's own record can
be the stale one, and an institution can be holding an address they moved out
of years ago. Every difference is reported as a difference, named on both sides,
and left for a person to settle. A test asserts the sentence contains no *out of
date*, *incorrect* or *should be*.

**Call a well-formed identifier valid.** A CKYC identifier is usually fourteen
digits, and `kinNote` says so as a note — never a rejection. Two reasons, and
the second is the one that matters: a household copying a number off a letter
must not be blocked by this application's idea of a format, and **format is not
existence**. A validator implying otherwise would be claiming a lookup that
never ran. A test asserts the words *valid*, *verified*, *confirmed* and
*registered* appear nowhere in what it says.

## Versions and conflicts are not entities

The prompt's model names `IndividualCKYC`, `KYCVersion` and `KYCConflict`. Only
the first is a record here.

A **version** is what you get by recording the same institution again on a later
date — the history is the rows, and `latestPerInstitution` reads the newest.
Two records from one bank are a history, not a disagreement.

A **conflict** is derived at read time, like classification, provenance and
accrual before it, so correcting one record fixes every comparison it takes part
in rather than leaving stored findings behind.

## Comparison is normalised, never corrected

`12/A, 4th Cross` and `12/a 4th cross` are the same address written twice.
Comparing them raw would report a difference nobody can act on, and noise trains
people to stop reading a list. So values are normalised — case, punctuation,
spacing; a mobile on its last ten digits; a PAN on case — **for the comparison
only**. Nothing is written back.

## A masking gap, measured and fixed

`data/classification.js` decides masking from the *shape of the key*: anything
ending `number`/`no`/`id`/`code`, plus a short explicit list of Indian
identifiers that carry no such suffix.

`kin` matched none of them. Measured the moment the entity existed:

```
kin            masked: false
pan            masked: true
```

A CKYC identifier would have been printed in full. `kin` joined the explicit
list, where the design says such identifiers belong.

**The test is positional, and that is a hazard worth naming.** `pan` matches and
`heldPan` would not, so an identifier can be hidden from it by prefixing. The
fields on `kycRecord` are named bare (`kin`, `pan`) for exactly this reason,
while the `held` prefix is used only where the field is not an identifier and
the prefix is what carries the meaning.

The record's `subtitle` is `recordedOn` rather than either identifier: a
projection reaches record headers, list subtitles, search results and reference
pickers, none of which pass through the field renderer that masks — the same
trap that once printed a passport number on every one of those surfaces.

## What mutation testing found

Twenty-one mutations across three files, all twenty-one caught. The ones worth
naming:

| Mutation | Caught by |
| --- | --- |
| **The CKYC identifier is not treated as an identifier** | *the KIN and the PAN are masked on screen by default* |
| **The KIN is printed in the record subtitle** | *neither reaches a projection* |
| **The KYC record is readable by every adult** | *it is owners-only, both ways* |
| **Where the value came from becomes optional** | *where the value came from is recorded and required* |
| **Every snapshot argues, not only the latest** | *an old snapshot does not argue with the one that replaced it* |
| **The sentence stops saying the registry was never involved** | *and says the registry was never involved* |

Removing the provenance note from the screen fails a browser check.

## Two checks that caught this tranche on their own

Both were written in earlier tranches and both fired without being asked:

- **The policy drift check** failed the moment `kycRecord` was added, because
  `apps-script/Policy.gs` no longer matched the schema. Regenerating it derived
  `owners only, both ways` from the entity's `acl` with no second decision.
- **The service-worker precache check** — added in `docs/ACCRUAL.md`'s tranche
  after `domain/privacy.js` was found missing — failed on `js/domain/kyc.js`
  before anybody could forget it.

## One general change

`listSection` gained a `banner` option: a node rendered above the table and
rebuilt on every load. Some entities carry an answer the table cannot show, and
a comparison *across* rows is not a column in one.

## Not done

- **No CKYCRR connector exists, in any state.** Not even a stub reporting
  `NOT_SUPPORTED` — that was the other option and it was not the one chosen.
- **Nothing reads a KYC record back into the person record**, deliberately. The
  household's own copy is one of the compared sides, not the destination.
- **The address comparison is textual.** `4th Cross` and `4th Cr.` are reported
  as different, which is a false positive a household can dismiss but still
  noise. Doing better needs address parsing, which is a larger thing than this.
- **`stale` uses a fixed 24 months**, not configurable.
- **No reminder is raised** when a record goes stale; it is reported when the
  screen is opened.
