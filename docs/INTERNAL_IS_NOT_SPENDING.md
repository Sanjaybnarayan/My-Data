# Five Real Merchants That Vanished From Spending

`js/domain/categorise.js`, `tests/ledger.test.mjs`.

## The rule this breaks

v6.0: **an account transaction is not an economic event**, and internal
movement is not spending. `js/domain/categorise.js` holds that correctly —
`investment-out`, `investment-in`, `self-transfer` and `sweep` carry
`kind: 'internal'`, and `summarise` keeps internal out of both spending and
income. Moving your own money between your own pockets is not consumption.

Which means a false positive on an internal rule does not mis-file a payment.
**It deletes it.** The money leaves the household's spending total, nothing
errors, and the number is simply smaller than what they spent.

## What was found

`classify` matches `RULES` in order, first match wins, and the internal rules
sit near the top by design — mistaking a transfer for spending is the error
they exist to prevent. Two of them matched on bare tokens that are also
ordinary words. Run against real Indian merchant names:

```
UPI/KITE CAFE BENGALURU/Payment      →  investment-out   (broker: `kite`)
POS/KITEX GARMENTS LTD               →  investment-out   (broker: `kite`)
UPI/NIPPON PAINT INDIA/paint         →  investment-out   (mutual-fund: `nippon`)
UPI/AMC FOR AIR CONDITIONER/service  →  investment-out   (mutual-fund: `\bamc\b`)
NEFT/BANDHAN BANK LTD/rent           →  investment-out   (mutual-fund: `bandhan`)
```

A restaurant meal, a clothing purchase, a tin of paint, an air-conditioner
service contract and a month's rent — each removed from spending because its
name contained a substring. `AMC` in an Indian bank statement is more often an
**annual maintenance contract** than an asset management company. `Kite` is
Zerodha's platform and also an ordinary English word. `Nippon` and `Bandhan`
are fund houses and also a paint company and a bank.

A sixth, in a spending rule rather than an internal one, so it mis-filed
rather than deleted: `POS/DIGITAL XEROX CENTRE` → `insurance`, because `digit`
matched inside `DIGITAL`.

## What changed

`kite` is gone from the broker rule. It is Zerodha's platform and `zerodha` is
already there, which is what a bank actually writes in the narration.

A fund-house name now has to appear **with a fund word within two words**, so
`NIPPON INDIA MF` still matches and `NIPPON PAINT INDIA` does not. Bare `amc`
is gone for the same reason; `HDFC AMC` still matches through the same
construction.

`digit` became `\bdigit\b`, which matches the insurer Go Digit and not
`DIGITAL`.

Verified in both directions — the five above are spending again, and
`ZERODHA`, `NIPPON INDIA MF SIP`, `HDFC MF`, `GROWW` and `INDIAN CLEARING
CORP` all still classify as internal.

## How it is checked

`tests/ledger.test.mjs`, fourteen cases in two directions, because one
direction alone is not a check:

- eight real merchant narrations that must **not** be internal;
- five real investment narrations that must **still** be internal;
- and the premise: exactly three rules — `broker`, `mutual-fund`, `sweep` —
  can produce an internal category at all, so a fourth is met by a failing
  test rather than by nobody noticing.

Mutation-tested both ways:

```
bare kite / amc / fund-house names restored   5 FAIL
   the five merchants classify internal again

broker and mutual-fund rules deleted          6 FAIL
   every real investment counted as spending, and the premise check
```

The second is the one that matters. Deleting the rules would have satisfied a
guard written only in the first direction, and would have moved every real
investment *into* spending — the same error pointing the other way.

## What this does not establish

The remaining tokens are a judgement about Indian merchant names, not a proof.
`franklin`, `tata`, `axis` and `icici` are all fund houses and all also
something else; they are safe only because a fund word must appear beside
them. A household whose broker is not in the list still has its transfer
counted as spending — that is Phase 8's open gap, and no narration regex
closes it.

Nothing here ran against the household's real statements. The narrations above
are typed from the shapes Indian banks write, not copied from anybody's data.
