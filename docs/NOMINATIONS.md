# A Nominee Needs No Derivation

Phase 12, first tranche. `js/domain/estate.js`, tested in
`tests/estate.test.mjs`.

## The claim in the title is this repository's, and it is wrong

Two documents say it, in the same words:

> *most of them should be unread — a nominee needs no derivation*

`docs/IMPLEMENTATION_ROADMAP.md` and `docs/FIELD_COVERAGE.md`, both listing
`account.nominee`, `holding.nominee` and `policy.nominee` among the fields
nothing reads, and both offering the nominee as the example of a field that is
*correctly* unread.

By this repository's own rule — *a refusal is a claim about the codebase, and it
goes stale like any other* — that claim was worth testing. Measured against a
household with three accounts, two investments and two policies, the
application could not answer any of:

| Question | Before |
| --- | --- |
| Which of these have no nominee? | nothing answers it |
| What is nominated to Meera? | nothing answers it |
| Is `meera` the same person as `M Narayan`? | nothing answers it |
| What happens to the flat? | `property` carries no nominee field at all |

Every one of those is a derivation, and the nominee field is the input to all
of them. A field being reference data **on a form** does not make it reference
data **to the household**. The two documents now say so.

## What it reports

```
A nominee is who an institution may pay, not who inherits. That is settled by a
will or by succession law, and the two often differ. Nothing here decides who
is entitled to anything.

NOMINATED
  HDFC Savings (HDFC) is nominated to Meera.
  SBI Joint (SBI) is nominated to “meera”, which may be Meera. Nothing here decides that.
  Nifty index fund (mutual fund) is nominated to “M Narayan”, which may be Meera. Nothing here decides that.
  Term life (LIC) is nominated to Meera.

GAPS — 3 records, ₹5,62,000 known at stake, 1 whose value is not recorded here
  ICICI Salary (ICICI) has no nominee recorded.
  SBI FD 2029 (fixed deposit) has no nominee recorded.
  Family health (Star) has no nominee recorded, and its value is not recorded here either.

NO NOMINEE FIELD AT ALL
  1 × Property — a property passes by will or succession, not by nomination
  1 × Vault item — credentials are not property, and nothing here should tell anybody to use them

LEGACY INSTRUCTIONS: 1 recorded, 1 not
```

## The sentence that governs the whole file

**A nominee is not an heir.** A nomination says who an institution may pay; it
does not say who is entitled to keep the money. Who inherits is settled by a
will or by succession law, and the two answers routinely differ — a nomination
made at account opening twenty years ago against a will written last year.

So nothing here says *"this goes to X"*. `NOMINEE_IS_NOT_HEIR` is on the screen
rather than in a comment, the way `docs/KYC.md`'s registry refusal is, and a
test reads every sentence the module can produce and fails on the words
*inherit*, *goes to*, *will receive*, *entitled* and *heir*.

This application does not adjudicate succession, and a screen that lists three
nominated accounts and stops there would imply that it had.

## What it refuses

**It never resolves a nominee to a person.** `Meera Narayan`, `meera` and
`M Narayan` may be one person or three, and the household knows which. A
possible match is offered and never applied — the same refusal, and literally
the same `compareValue`, as `domain/kycconflict.js`.

**It never ranks gaps by money.** An unnominated account becomes an unclaimed
deposit whatever its balance, and sorting the list by size tells a household
that the small ones matter less. The total at stake is reported separately, and
so is the count of records whose value is not known here — because *an unknown
amount is a gap, not a zero*, and `atStake` adding the two would be a figure
claiming to be a total.

**It never invents a nominee field.** Property, vehicles, loans and vault items
carry none, and the honest answer to *"what happens to the flat?"* is that a
nomination is not how a property passes and this application has no will, no
executor and no beneficiary. Saying that beats a screen that shows what it
happens to have.

## Two defects in shipped code, both found by the fixture

### A middle initial was a KYC conflict

`compareValue('name', 'Sanjay B Narayan', 'Sanjay Narayan')` returned
**`CONFLICT`**.

Every word is shared. The counts are equal — because an initial is not a word,
and the old tokeniser dropped it. The rule required `shared < max(left, right)`
to call something a possible match, so equal-and-fully-shared fell through to
the conflict branch. A household would have been told a bank holds the wrong
name because one record carries a middle initial and the other does not, on the
screen built to flag identity fraud.

Any overlap at all is now a possible match.

### Every relative was a possible nominee

The first run of the fixture printed:

> `Nifty index fund is nominated to “M Narayan”, which may be Sanjay or Meera or Aarav.`

Which is not an answer. Initials were being dropped, so in a household where
everybody shares a surname `M Narayan` matched all three people on `narayan`
alone. Initials are now kept, and an initial standing in for a name the other
side spells out differently is evidence **against** the pair.

The first version of that check was too eager and caused the middle-initial
conflict above to persist: it asked merely whether any word began with the
initial. It now tests the initial against the words the other side has *left
over* — where nothing is left over, an initial is extra detail, not a
disagreement.

## One inconsistency, fixed

The same fact, classified three ways:

```
account.nominee   encrypted: true    HIGHLY_SENSITIVE
holding.nominee   encrypted: false   SENSITIVE
policy.nominee    encrypted: false   SENSITIVE
```

It is the same person's name in all three. `holding` and `policy` now carry
`encrypted: true` as well, and it costs no migration: `decryptRecord` skips a
value that is not sealed, so rows written before this read back unchanged and
are encrypted on their next save. Neither field is a list column and neither is
searchable, so nothing on screen becomes ciphertext.

## What mutation testing found

Eleven mutations, all eleven caught.

| Mutation | Caught by |
| --- | --- |
| **A deleted record is a gap** | *a deleted record is neither a nomination nor a gap* |
| **A matured deposit is a gap** | *a closed holding is not a gap anybody can fix* |
| **A possible match is applied** | *“meera” is offered as her, not recorded as her* |
| **An unrecorded value counts as zero** | *an unrecorded value is not counted as zero* |
| **Gaps are sorted by money** | *gaps are not ranked by money* |
| **Whitespace is a nominee** | *whitespace is not a nominee* |
| **The notice is dropped** | *the sentence is on the screen, not in a comment* |
| **All spellings merge into one group** | *two spellings that may be one person are still two groups* |
| **A kind nobody owns is still listed** | *nothing is reported for a kind the household does not own* |
| **Digital assets with no instruction are hidden** | *a legacy instruction is reported as written* |
| **The sentence says somebody inherits** | *no sentence it produces says anybody inherits anything* |

A twelfth was a bad mutation of mine — a length guard no fixture could reach —
and is not counted. It tested nothing.

## The ratchets

- **Field coverage moved 82 → 78.** Four fields left the inventory:
  `account.nominee`, `holding.nominee`, `policy.nominee` and
  `digitalAsset.legacyInstruction`, whose form label is *"On my death, do
  this"* and which had been recorded since the schema was written and read by
  nothing.
- Typecheck held at 181; policy drift, lint and architecture clean.
- The precache check required `js/domain/estate.js`.

## What is still not built

No screen, no will, no executor, no beneficiary, and no `Asset` entity of the
kind Phase 12's scope names. This is the reading of what the application
already stores. Legal and estate documents — the rest of Phase 12 — remain
untouched, and nothing here is legal advice or claims to be.
