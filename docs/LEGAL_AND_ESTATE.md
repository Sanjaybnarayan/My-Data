# The Will, Beside What The Bank Was Told

`legalDocument`, `will` and `beneficiary` in `js/data/schema.js`; the
comparisons in `js/domain/estate.js`; drawn in `js/modules/vault.js`. Tested in
`tests/legal.test.mjs` and in the browser.

Build prompt v6.0, Phase 12 — its entity list names *LegalDocument, Will,
Beneficiary, Nominee*.

## What this could already say, and could not check

`domain/estate.js` has asserted since it was written:

> **A nominee is not an heir.** A nomination says who an institution may pay;
> it does not say who is entitled to keep the money. Who inherits is settled by
> a will or by succession law, and the two answers routinely differ — a
> nomination made at account opening twenty years ago against a will written
> last year, for instance.

It could state that and check nothing, because there was nowhere to record what
the will says. There is now, so the two go side by side:

```
The will and the nomination name different people           1

Account · HDFC Savings
Nominated to Meera Narayan · the will leaves it to Ravi Narayan (one half)
```

**Neither side is declared correct.** A nomination decides who the institution
may pay; a will decides who is entitled to keep it; which matters depends on
the asset, the statute and facts this application does not have. The row
carries both names and no verdict, and the card says so in as many words.

## What it must never become

**This is not the will.** A will is a formal instrument with requirements this
application does not meet and does not try to — no signature mechanism, no
generated text, no claim of validity. `A_NOTE_IS_NOT_THE_WILL` is on the screen
above everything else, the same way `NOMINEE_IS_NOT_HEIR` is:

> These are your notes on what the will says, kept so a family can find the
> original and see it beside what each institution was told. The will itself
> decides, and nothing here is a substitute for reading it.

Those two refusals are **different claims** and a test asserts they are not the
same string. One says a nomination does not settle who inherits. The other says
the application does not know what the will says either.

## The measurement that saved the feature

The obvious implementation reuses `compareValue` from `domain/kycconflict.js`,
which already compares names. Measured:

```
compareValue('name', 'Meera Narayan', 'Ravi Narayan')  →  POSSIBLE_MATCH
```

That function exists to spot **one person recorded differently across
institutions**, so it reads a shared surname as evidence. It is right for
identity drift and ruinous here: everyone in a household shares a surname, so
every genuine disagreement between two family members — the entire case this
comparison exists to catch — would come back as *unclear*, and the feature would
report nothing worth acting on.

`namesAgree` answers the narrower question. A difference in the **given** name
is decisive; Meera and Ravi are not the same person. What stays unclear is an
abbreviation:

| | |
| --- | --- |
| `Meera Narayan` / `Ravi Narayan` | **different** |
| `Meera Narayan` / `Meera Iyer` | **different** |
| `Meera Narayan` / `M Narayan` | abbreviated |
| `Ravi` / `Ravi Narayan` | abbreviated |
| `Meera Narayan` / `meera  narayan` | same |

Abbreviations are shown under their own heading. Sending a household to a
solicitor over an initial would be worse than saying nothing.

## Two wills, both in force

Ordinary: the 2015 will is in the bank locker, a new one is written in 2026,
and nobody marks the first revoked. Both then sit in force and **every bequest
in both is compared against the nominations as though it still stood.**

So that is reported first, above the bequest comparison, newest first, with
undated wills last and counted — "which is later" cannot be answered for a will
with no execution date. It does not decide which governs: a later will usually
supersedes an earlier one, with enough exceptions that a rule here would be
this file practising law.

A revoked will is excluded from every comparison. A superseded instruction is
not a disagreement with the current one; it is a decision already replaced.

## What the field-coverage ratchet was right about

Fourteen new fields were read by nothing. Most are reference data and fine — a
custodian's name, whether a deed was registered. Three were not:

- **`will.testator` and `will.executedOn`** unread meant two wills for one
  person went unnoticed. That became `willsInConflict`.
- **`legalDocument.supersededOn`** unread meant a power of attorney replaced
  three years ago sat in the list looking current. That became
  `currentLegalDocuments`.
- **`beneficiary.assetKind`** was simply redundant — `assetId` points at a
  record and `nominations()` already knows what kind it is. A hand-set copy
  beside it is the second source of truth this project has now found three
  times. Removed rather than accounted for.

Six remain, all genuine reference data, and they are in the inventory.

## A recovery phrase is not a recovery code

`vaultItem.kind` now offers **recovery phrase**, next to the *recovery codes*
it is not.

Recovery codes are the printed one-time strings an account hands you as a way
past two-factor. If they are lost, the provider can issue more. A recovery
phrase — twelve or twenty-four words — **is** the asset: whoever holds it holds
the wallet, and whoever does not cannot be given it later by the exchange, by
the provider, or by a court.

`digitalAsset` has offered `crypto wallet` as a kind since the schema was
written, with a `vaultItem` reference labelled *Credentials* to point at its
secret. There was nowhere for that secret to say what it was, so a phrase went
in a secure note or under the codes it is not, and both are encrypted, so
nothing was ever at risk. What was missing was the ability to say which one it
is — and for an estate that is the whole question. `legacyInstruction` asks
what to do on a death, and an instruction naming a wallet nobody can open is a
sentence rather than a bequest.

The addition is one option in an existing vocabulary. No new entity, no new
field, no migration: a wallet is still a `digitalAsset`, and its phrase is
still a `vaultItem` it points at.

### What was deliberately not added with it

**Holdings and valuation.** A crypto balance is worth what somebody will pay
today, so a figure means a price feed, and a price feed is an external
integration this application does not have. The alternative — a number typed
once and shown for years as though it were current — is the failure the build
brief names above all others. `docs/PHASE_STATUS.md` records the same refusal
for Phase 8's broker connector, and this is the same one.

That is a decision for the household rather than a gap in the code, and the
phase row says so in those terms.

## Deliberately not built

**`Nominee` is not made an entity.** The prompt names it alongside the other
three, and it already exists as `account.nominee`, `holding.nominee` and
`policy.nominee` — encrypted fields that `domain/estate.js` reads. Converting
them to rows would be a migration of live encrypted data, across three
entities, to gain nothing this tranche needs: every question asked here is
answerable from the fields. The refusal is recorded rather than left as a
silent omission.

**No succession arithmetic.** Nothing works out shares, computes a residue, or
says who gets what. `share` is free text on purpose — wills say "one third",
"the residue" and "equally between my children", and a percentage field would
force every one of those into a number the will never stated.
