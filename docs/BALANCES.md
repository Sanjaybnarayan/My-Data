# Money Arriving By Transfer Was Being Subtracted

Phase 5, fifth tranche. `js/domain/finance.js`, tested in `tests/domain.test.mjs`.

## What I set out to measure, and what I found instead

The plan was prompt tests 6–8 — bank → broker as funding, broker → stock as an
investment, bank → FD as an allocation — all listed *"partial"* in the roadmap.
Measuring them first, as the last four tranches established, turned up something
larger underneath.

`accountBalances` subtracted for **every** transfer, whatever its direction:

```js
} else if (t.kind === 'transfer') {
  balances.set(t.account, balances.get(t.account) - amount);
  if (t.toAccount) balances.set(t.toAccount, balances.get(t.toAccount) + amount);
}
```

An imported transfer is **two rows** — each bank reports its own side — so the
incoming leg carries `direction: 'in'` and no `toAccount`. It was subtracted.

```
HDFC     ₹4,00,000   ✓
Zerodha –₹1,00,000   ✗   should be +₹1,00,000
```

**₹2,00,000 wrong on one account, from one transfer.** Every household that
imports statements from two of their own accounts had it, and it reached
everything downstream: account balances, liquid cash, the ledger's running
balance, and net worth.

## Why it made 6, 7 and 8 fail

Funding a broker, buying a stock and opening a fixed deposit all move money from
one of the household's own accounts to another. None of them is spending, and
none should change net worth. Measured before the fix, moving ₹1,00,000 from a
bank to a demat account **destroyed ₹1,00,000 of net worth**.

The defect had nothing to do with investments. It was in transfer handling, and
it affected every transfer the household ever imported.

Measured after:

| Test | Assets | Truth |
| --- | --- | --- |
| 6 + 7 — bank → broker → stock | ₹5,30,000 | ₹5,30,000 |
| 8 — bank → fixed deposit | ₹5,00,000 | ₹5,00,000 |

Investments were already kept out of spending by the categoriser
(`investment-out` has kind `internal`), so that half was never wrong.

## The rule

**`direction` wins where it exists.**

| Shape | Where from | Handling |
| --- | --- | --- |
| Two rows, each with a `direction`, no `toAccount` | imported statements | out subtracts from its account, in **adds** to its own |
| One row naming both ends, no `direction` | entered by hand — `direction` is hidden from the form | subtract from `account`, add to `toAccount` |

The second rule cannot be applied to the first shape. After a transfer pairing
is confirmed (#23) the outgoing leg carries **both** a direction and a
`toAccount`, while the incoming leg is still there — so applying the `toAccount`
as well would credit the destination twice, once from each row.

## 864 tests passed with this broken

None of them looked. The existing balance test used the hand-entered shape —
one row, `toAccount`, no `direction` — which is the path that always worked.

That is the lesson worth keeping: a test suite that only exercises the shape a
form produces will never see the shape an importer produces, and this
application's whole design assumes people import statements.

## What mutation testing found

Three mutations, all three caught:

| Mutation | Caught by |
| --- | --- |
| The original bug, restored | *an imported transfer credits the account the money arrived in* |
| `toAccount` applied even when a direction exists | *a confirmed pairing does not credit the destination twice* |
| Outgoing legs fall through to the hand-entered path | same |

## Not done

- **No browser check.** Loose transfer legs come only from imports — the same
  constraint recorded in `ECONOMIC_EVENTS.md` — so the shape that was broken
  cannot be produced through a form. The unit tests drive it directly.
- **Prompt tests 6–8 needed no work of their own** once this was fixed, and no
  `EconomicEvent` entity was required to make them pass. One is still wanted for
  events with more than two legs.
