# A Deposit Is Not a Person

The audit's Case 6. `js/domain/categorise.js`, tested in `tests/deposit.test.mjs`.

## What the audit said

> **Case 6 — bank → FD → `ASSET_ALLOCATION` · PARTIAL.** The safety-critical
> invariant holds: `summarise` counts only `categoryKind === 'spending'`, and
> `p2p-out` is `kind: 'transfer'`. **An FD booking is never reported as an
> expense.** What fails is *precision*: the `sweep` pattern matches
> `^sweep|FD PREMAT|term deposit` but not `FD BOOKING`, so a new fixed deposit
> reads as "Sent to people" rather than an asset allocation. **Wrong label,
> safe number. P2.**

The number was safe and stayed safe. But "wrong label" understates what a
household was actually shown:

```
who the people ledger says this household sent money to:
  FD BOOKING HDFC DEPOSIT      500000
  RD INSTALMENT HDFC           200000
  UPI TO RAMESH KUMAR          100000

is a fixed deposit a person?
  FD BOOKING HDFC DEPOSIT    isP2P=true   counterpartyKind=person
```

A fixed deposit appeared **in the people ledger**, among the people this
household exchanges money with, with `counterpartyKind: 'person'` written out
beside it — a field `tools/statement.mjs` dumps to CSV. That is the exact
failure `docs/HOUSEHOLD_LEDGER.md` records from an earlier tranche, where four
of five payments became person-to-person transfers and the insights told a
household that a supermarket, a landlord and a doctor had taken money that had
not come back.

## The real cause: three tables, three patterns

A deposit is a concept three separate tables in `categorise.js` each have to
recognise — the rail it travelled on, who the counterparty was, and what
category it belongs in. Each carried its own version:

```
CHANNELS      /^sweep|sweep transfer|FD PREMAT|^FD [A-Z]/i
COUNTERPARTY  /^sweep|^fd (premat|proceeds)/i
RULES         /^sweep|FD PREMAT|term deposit/i
```

Measured against real narrations, they disagreed in every combination:

```
narration                  channel   counterparty      category
FD BOOKING HDFC DEPOSIT    sweep     (raw)             p2p-out
FD PREMAT CLOSURE 4417     sweep     Fixed deposit     sweep
AUTO SWEEP DEPOSIT         other     (raw)             p2p-out
RD INSTALMENT HDFC         other     (raw)             p2p-out
TERM DEPOSIT BOOKING       other     (raw)             sweep
FD PROCEEDS 50300123       sweep     Fixed deposit     p2p-out
TD RENEWAL 12345           other     TD RENEWAL        p2p-out
```

Two rows are worth reading twice. For `FD BOOKING HDFC DEPOSIT` and
`FD PROCEEDS`, **the application already knew**: the rail table recognised the
deposit and the category table called it a person anyway. And every `sweep`
was anchored to the start of the narration, so `AUTO SWEEP DEPOSIT` matched
none of the three.

Eight of twelve deposit narrations read as "Sent to people".

This is the hand-maintained-list-beside-a-derivable-one fault for the tenth
time, in its worst form yet: not two lists, but three, none of them derived
from the others, each looking perfectly reasonable on its own line.

## One pattern

`DEPOSIT` is exported and read by all three tables. A test asserts it is read
by exactly three, and that no table has grown a fourth copy beside it.

## What it will not match

`CASH DEPOSIT` is money paid in at a machine and `SECURITY DEPOSIT` is money a
landlord is holding. Neither is the household's own savings moving to its own
deposit, and matching the bare word `deposit` would have swept up both.

The short forms all require the word that follows them, because Indian
addresses abbreviate *road* as `RD`: `MG RD BRANCH` would otherwise have
become a recurring deposit. `TD WATERHOUSE`, `RD SHARMA`, `FD ENTERPRISES`,
`CHIMNEY SWEEPS LTD` and `SWEEPSTAKES WINNINGS` are all in the negative list
and all stay out.

`FD ENTERPRISES` was added because a mutation found it missing: loosening
`\bFD\s*(?:booking|…)` to `\bFD\b` broke nothing, since no negative in the
list had a bare `FD` in it. Fifteen mutations, all caught after that.

## What did not change, deliberately

**The invariant.** `sweep` is `kind: 'internal'` and `summarise` counts only
`spending`, so a deposit was never an expense and still is not. A test asserts
the total directly, because a fix for a label that moved a number would be
worse than the label.

**No new category.** The spec names this `ASSET_ALLOCATION`, and splitting
`sweep` into a deposit-out and a deposit-in would model booking and maturity
as the different events they are. It would also mean editing four more
hand-maintained lists — `CATEGORIES`, the schema's `category` pick, the
`ENTERED_CATEGORIES` map and the importer's labels — which is the fault this
change exists to reduce. The label now reads *To and from your own deposits*,
which is true of both directions, and the split is left as a stated
not-done rather than half-done.

**`Your own deposit`, not `Fixed deposit`.** The same pattern now recognises
recurring deposits, and calling one of those fixed would have replaced one
wrong label with another.
