# A tradebook is a file, not a connection

*Phase 8's engines have existed for months and nothing but typing could feed
them. This is the missing input, and it is deliberately not a broker API.*

## What was actually wrong

`holding`, `investmentTransaction`, `costbasis.js` and `portfolio.js` were all
built and all working. The statement importer — `domain/import.js`,
`domain/statement.js`, `domain/tabular.js` — produces `transaction` rows and
**only** `transaction` rows.

So a household with a year of trades had a portfolio engine, a cost-basis
engine, an XIRR calculation, and no way to get a trade into any of them except
by typing it. Phase 8 sat at 42 with the gap recorded as "no broker connector",
which was true and was also not the only thing missing.

## Why not a connector

`docs/PHASE_STATUS.md` caps Phase 8 because fabricating a broker integration is
forbidden, and an `absent:` probe fails the build the moment a broker endpoint
appears anywhere in `js/` or `apps-script/`.

A tradebook the household downloads from their own broker is a different kind
of thing. It is a file. Nobody has to be integrated with, no credential is
held, nothing logs in on anybody's behalf — the same relationship the
application already has with a bank statement.

## Generic, because a parser would be a claim nothing checks

There are no per-broker parsers and there will not be. Nobody working on this
has a real tradebook from any broker to test against — the household's own
exports are deliberately kept out of the repository — so a parser announcing
that it understands a particular broker's columns would be exactly the
unverified claim this repository spends its time removing.

Instead the household maps the columns once, sees what the file yielded, and
agrees to it before anything is written. The mapping is *guessed* from the
headings as a convenience and is entirely theirs to correct: a heading is not a
promise about what a column holds.

## The bug that mattered most

Money is stored in minor units. `readAmount` returns paise, because every
`money` field in the schema does.

The first draft read `units` with it too.

Ten shares became a thousand. `units × pricePerUnit` came out in
paise-squared — a ₹15,000 purchase recorded as ₹15,00,000. A holding inflated
a hundredfold is not a rounding error; it is a portfolio saying something
untrue about somebody's money, feeding a cost basis and a capital-gains
position.

`readUnits` exists because of it, and `tests/tradebook.test.mjs` states the
paise convention in a named helper rather than burying it, so the next person
to touch this sees the trap before falling in it.

## What it refuses

**It never writes a bank transaction.** Money moving from a bank to a broker is
not an expense — rule 5 — and `domain/categorise.js` already files those
transfers as internal. A trade that also produced a `transaction` row would
count the same rupees twice in opposite directions, and tell the household they
had spent their savings.

**It never invents a holding.** An unmatched symbol is reported by name.
Creating one would guess a name, a kind and a currency from a ticker.

**It never picks between two holdings.** The same instrument in two folios is
two genuinely different positions, and choosing one would put a year of trades
against the wrong cost basis. Never force an uncertain match.

**It never reads a broken row as a zero.** An unreadable date or amount is
counted and named — the "absence asserted from a read error" fault, which here
would land in a P&L calculation.

**It never fills in the settlement account.** The field exists and means
"settled through"; a tradebook does not say which bank account paid, and
filling it from the household's only account would be a guess written into a
financial record.

## Two identical fills are two trades

Partial fills of one order print identically — same instrument, day, price and
size. Collapsing them would understate a holding permanently.

So the broker's own trade id is used when the file has one, and when it does
not, a row's position among its identical twins is part of its fingerprint:
re-importing the same file matches three against three, and a file with a
fourth adds exactly one. `domain/import.js` makes the same argument about not
truncating a bank narration.

## What this does not do

- **No prices.** Nothing here fetches a quote; `currentValue` remains a figure
  somebody types.
- **No holdings created.** The household adds the holding, then imports.
- **No broker is named anywhere**, including in this file's own source, because
  the `absent:` probe scans source text and cannot tell a comment from a call —
  which is correct, and which the first draft of `domain/tradebook.js` tripped
  by quoting the hostnames it promised never to use.

## Checked

`wired:js/modules/investments.js#tradeimport` fails the build if the screen
stops reaching the importer — the "an engine exists and nothing calls it" fault
this repository has found more often than any other.

**7 of 7 mutations caught**: units read as money again, an unrecognised
direction defaulting to a buy, an unreadable amount becoming zero, an ambiguous
symbol picking the first candidate, identical fills collapsing to one, a
derived total passed off as one the file stated, and unmatched rows dropped
without report.
