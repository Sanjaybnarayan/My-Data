# One Movement, Seen From Both Ends

Phase 5, first tranche. `js/domain/events.js`, `js/services/transfers.js`,
tested in `tests/events.test.mjs` and `tests/transfers.test.mjs`, surfaced in Finance.

## An account transaction is not an economic event

A statement line is a bank telling you what it did to one account. An economic
event is what happened in the household's economy. Moving ₹50,000 from HDFC to
ICICI is **one event and two statement lines**, and treating the lines as the
events is how a household reads that they moved ₹100,000.

## What the gap actually was

The roadmap said *"categorised as two transfers, not one event"* and *"no
matching engine"*. Both true, but the shape is narrower than that suggests, and
worth tracing before building:

- The categoriser **already gets the totals right.** `self-transfer` has kind
  `internal`, and `summarise` keeps internal out of `spending` and `realIncome`.
  So *internal transfer ≠ income or expense* was already honoured.
- A `transaction` **already has a `toAccount`.** A transfer entered by hand
  fills it in and is one row.
- A transfer **imported from two statements** is two rows with
  `kind: 'transfer'`, opposite directions, and `toAccount` empty on both.

So the missing link is a field nobody filled in. `internalOut` and `internalIn`
each carry the full amount — right per account, twice per movement — and nothing
could answer *how much did we actually move*.

## The prompt's tests, and what each forced

| Test | Before | Now |
| --- | --- | --- |
| 1 — HDFC debit + ICICI credit → one internal transfer | two unlinked rows | one proposal; the total counts it once |
| 2 — same amount a day apart → potential match | nothing matched anything | probable, within a three-day window |
| 3 — ₹50,000 vs ₹49,950 → no automatic match | passed vacuously | **passes for a reason** |

Test 3 shapes the whole design. Unequal amounts **never** match automatically:
the difference is named — *a fee would explain it, and so would these being two
unrelated payments* — the pairing cannot reach the total, and `linkFor` refuses
to produce a patch for it. A difference too large to be a fee is not mentioned
at all, because offering it would train somebody to click through proposals
without reading them.

## The rule test 3 does not cover

**An ambiguous match is not a match.** If one debit pairs equally well with two
credits, *neither* is probable — both become questions.

A rule that only looked at the pair in front of it would call both certain, and
a household would find their ledger quietly rearranged. But ambiguity must not
swallow the ordinary case either: two genuine movements on the same day,
distinguished by amount, both stay probable. Both are tested.

## Confirming keeps both rows

Each row is a bank's own record of one side, with its own narration, reference
and running balance. A household that later questions the figure needs both.

So a confirmation is a **one-field patch** — the outgoing leg learns where the
money went — and nothing is deleted, zeroed or merged. Tidying a total by
destroying the evidence for it is not tidying.

## Nothing here decides anything

Every function returns a proposal. A confidence is this module's opinion about a
coincidence of amount and date; an opinion is not a fact somebody checked. The
card renders the two confidences differently on purpose: a probable pairing gets
a button, a possible one gets a sentence saying why nobody can tell and **no
button at all**. Offering a confirm control for an uncertain pairing moves the
deciding from the person to the click.

`TransfersService.confirm` refuses anything the engine did not call probable, so
the rule holds even if a future screen forgets it.

## What mutation testing found

Eight mutations, **all eight caught by the test that should catch them** — the
first tranche in five where nothing survived:

| Mutation | Caught by |
| --- | --- |
| Ambiguity ignored | two credits that fit one debit equally well |
| Unequal amounts treated as exact | ₹50,000 against ₹49,950 is never automatic |
| Any difference considered | a difference too large to be a fee |
| Total includes possibles | it never reaches the total |
| Possibles can be applied | it cannot be applied |
| Same account allowed to pair with itself | a statement quirk, not a movement |
| Date window ignored | a fortnight apart is not |
| Already-linked legs re-proposed | one that already says where it went |

## A loose leg is import-only, by design

Two independent parts of the schema say so, and both were discovered by
building against them rather than reading them:

- **`direction` is `hidden: true`.** It is not on the form at all, so a
  hand-entered transfer never has one.
- **The validator refuses a hand-entered transfer with no `toAccount`** —
  *"A transfer needs a destination account"* — and exempts one carrying an
  `importKey`, with the reason written next to it: a bank only ever shows its
  own side, and the other end is often not an account this household holds.

So the state this engine exists for can only be produced by an import. A test
fixture without an `importKey` cannot even be saved — the first draft of
`transfers.test.mjs` failed ten times at validation, which was the schema
explaining itself.

## What is and is not covered

| | |
| --- | --- |
| The pairing rules | `tests/events.test.mjs`, plain objects, 8/8 mutations caught |
| Fetch, naming, confirm, both-rows-survive | `tests/transfers.test.mjs`, real database |
| The card's rendering | **not covered** |

The browser suite cannot reach it. Loose legs come only from imports, and
producing a matched pair through the real importer needs two CSVs, two accounts
matched by number, and a confirm — a long and fragile setup for what it proves.
An attempt at it is what turned up the `direction` finding above. The service
test covers everything except the DOM, and this row says so rather than letting
a green 159/159 imply otherwise.

## Not done

- **No `EconomicEvent` entity.** The pairing is recorded in the field that
  already exists. An entity is needed for events with more than two legs, and
  for kinds beyond a transfer — settlement, funding, investment. That is the
  next tranche, and it needs a migration.
- **Tests 4 and 6–8** — bank → credit card as a settlement, bank → broker as
  funding, broker → stock as an investment, bank → FD as an allocation — remain
  partial. They are categorised correctly and not evented.
- **Only transfers are paired.** An expense has one leg and needs no partner;
  the engine does not pretend otherwise, but nor does it model the one-leg case
  as an event.
- **No cross-currency pairing.** Two amounts in different currencies are two
  amounts here.
