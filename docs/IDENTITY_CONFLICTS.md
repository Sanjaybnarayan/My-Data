# One Identifier, Two People

Phase 2, third tranche. `js/domain/kycconflict.js`, tested in
`tests/kycconflict.test.mjs`.

## What could not be asked

`docs/KYC.md` built `kycRecord` and `domain/kyc.js`, which compares **one
person** across the institutions holding their KYC and does it well.

Every function in that file takes a person. So the prompt's sharpest identity
test —

> Same CKYC assigned to two people: **CRITICAL IDENTITY CONFLICT**

— is not a question `domain/kyc.js` can be asked, in any argument order. It is a
question about the household at once. The roadmap said so plainly and had said
so for three tranches: *"No conflict engine"*.

A KIN appearing against a husband and a wife is either a bank's data error or
somebody's identity being used twice. Both matter more than any single-person
drift, and neither was detectable.

## What it now reports

The measurement, on a retyped household — two people, three institutions:

```
CRITICAL  one CKYC identifier is recorded against 2 different people. That is
          either an institution's error or somebody's identity being used
          twice, and nothing here will merge them. It is held against Sanjay
          and Meera.

HIGH      Axis holds a date of birth that does not match your own record:
          theirs is “1980-04-05”, yours is “1980-05-04”. Nothing here changes
          either.

NORMAL    HDFC holds an address that may not match your own record: theirs is
          “No. 12, Residency Rd, Bengaluru”, yours is “12 Residency Road,
          Bengaluru 560025”. Nothing here changes either.

NORMAL    Axis holds a name that may not match your own record: theirs is
          “S Narayan”, yours is “Sanjay Narayan”. Nothing here changes either.
```

Four findings, ordered worst first, from three records. The Axis record's
mobile number matches and is not mentioned at all.

## The prompt's three identity tests

| Test | Where it runs |
| --- | --- |
| Same CKYC against two people → CRITICAL | `sharedIdentifiers`, and the first assertion in the suite |
| Different DOB at one institution → KYC CONFLICT | `personConflicts`, naming **which** institution |
| A role without permission → ACCESS DENIED | `can({role:'child'}, 'read', 'kycRecord')` — the repository already gated it; the test now says so |

The third needed no new code. It is asserted here anyway, because a permission
that is enforced but never checked in a test is one refactor from not being
enforced.

## Four answers, and why `UNKNOWN` is not a soft conflict

`MATCH`, `POSSIBLE_MATCH`, `CONFLICT`, `UNKNOWN` — the prompt's vocabulary.

A field nobody recorded is a **gap**. Calling it a disagreement would fill the
screen with rows saying an institution's copy of a gender the household never
entered does not match, and noise trains people to stop reading a list. So a
missing value on either side is `UNKNOWN` and is never reported.

`POSSIBLE_MATCH` exists for the two fields where a person and a machine
genuinely disagree about what "the same" means:

- **Names.** `Sanjay Narayan` against `S Narayan` shares a surname and differs
  in the given name. That is not a match and it is not nothing — it is exactly
  the pair a person should look at, and exactly the pair an automatic answer
  gets wrong in both directions.
- **Addresses.** Half the words in common is somebody abbreviating, not
  somebody living elsewhere.

Everything else — a date, a PAN, a mobile number — is exact or it disagrees.
There is no near-miss reading of a date of birth, and inventing one would be the
application deciding a conflict away.

## Nothing is merged, and the reason is not obedience

The prompt says *never automatically merge*. The reason is worth stating rather
than following blindly: a conflict between two identity records is evidence that
**something is wrong somewhere else** — at a bank, in a registry, or in what
somebody was told. Merging them makes this application's copy tidy and destroys
the only signal that the disagreement ever existed.

Every function here reports. None writes, none picks a winner, and the
severities say how loudly to report — never what to do about it. Both figures
appear in every sentence, because which copy is right is the household's to
settle and neither this file nor the institution is presumed correct.

## The identifier is never in the report

A shared-identifier finding carries `identifier: 'kin'` — the **field name**,
not the value. The record ids are enough to find it, and a conflict is not a
reason to copy an encrypted, masked identifier into a new place.

The first version of that test compared exact case and passed while a mutation
put the identifier straight into the report: the leaked form is normalised to
lower case, so `includes('KIN-SECRET-0001')` missed it entirely. The test now
lower-cases the JSON and checks the digits too.

## A latent defect found by the type checker

`describeConflict` originally chose its sentence by **severity**:

```js
if (conflict.severity === SEVERITY.CRITICAL) { ...conflict.people.map(nameOf)... }
```

That works only while nothing but a shared identifier is ever critical. Raise a
field disagreement to that severity — a mismatched PAN is an obvious candidate —
and the branch reaches for `people` on a record that has none, printing
`undefined` at a household.

It surfaced as a type finding, not a failing test: `identityConflicts` returns a
union of two shapes and the suite asked one of them for `institution`. Rather
than widening the shape or raising the budget, the two shapes now carry a `kind`
and `describeConflict` branches on **what the conflict is** instead of **how
loud it is**. Severity is left to mean only what it says.

A test asserts the sentence for a field conflict artificially marked `CRITICAL`,
and the mutation restoring the severity branch fails it.

## `a address`

Printed on screen until it was measured. The label is interpolated, six labels
exist, and two of them start with a vowel. Fixed with an article, asserted by a
test — the sort of thing a suite that only checks structure never sees.

## What mutation testing found

Eleven mutations. Ten were caught; **one survived**, and it was the most
valuable result in the tranche.

| Mutation | Caught by |
| --- | --- |
| **A deleted record still joins a conflict** | *a deleted record is not part of a conflict* |
| **One person's two records count as two people** | *one person holding the same identifier twice is not a conflict* |
| **A missing value is a CONFLICT rather than UNKNOWN** | *a missing value is UNKNOWN, never a conflict* |
| **The identifier value is put into the finding** | *the identifier itself is never put into the report* |
| **A date of birth gets a near-miss reading** | *a date of birth has no near-miss reading* |
| **The sentence is chosen by severity** | *a sentence is chosen by what the conflict is, not by how loud it is* |
| **`personConflicts` ignores whose record it is** | **nothing — 1582/1582 still passed** |

### The survivor

Deleting the ownership check in `personConflicts` —

```js
if (!record || record.deletedAt || record.person !== person.id) continue;
```

— changed no assertion at all. Every fixture in the suite happened to give the
record the same person as the person being compared, and the one test that
passes a mixed set asserts what the list *contains* rather than what it does
not.

In a real household that mutation reports a wife's bank record as a
disagreement about her husband's date of birth, on the very screen built to
detect two people sharing one identity. The remedy is a test that hands
`personConflicts` a record belonging to somebody else and expects nothing back.

This is the fourth kind of survivor this codebase has produced, and the first
kind: a genuinely missing test. It is worth saying that the mutation only
survived because the fixtures were *convenient* — a default `person: 'p1'` on
the record helper, matching the `p1` in every person literal.

## The ratchets

- **Field coverage moved 83 → 82**, and it was the ratchet firing in its
  *second* direction that said so: `person.gender` had been stored and never
  read by name, and is now compared. The inventory fails when the number falls
  as well as when it rises, so a field leaving the list has to be acknowledged
  rather than quietly absorbed.
- **Typecheck held at 181.** The union finding above was fixed, not budgeted.
- The service-worker precache check required `js/domain/kycconflict.js` before
  anybody could forget it.

## What is still not built

No screen. This tranche is the engine and its tests; `js/modules/identity.js`
does not yet show a conflict banner, and the roadmap's *"no profile completion,
no `KYCVersion`/`KYCConflict` entities"* remains true — `docs/KYC.md` explains
why the last two are derived at read time rather than stored.

**The screen was built in the next tranche** — `docs/IDENTITY_SCREEN.md`. This
paragraph is left as written, because it is the finding this codebase makes
most often and it is worth seeing it made and answered in consecutive
documents rather than quietly edited away.
