# The Ten, Run Rather Than Claimed

`tests/prompt.test.mjs`. The roadmap's Phase 5 table replaced.

## What this tranche is

Not a bug fix. The roadmap called the prompt's financial tests 1–10 *"the
sharpest specification in the whole document"* and then carried a **prose
table** of their pass/fail status — a table written before Phases 5 and 6 did
any work on the things it described.

By my own rule, recorded in that same document after the recurring-deposit
tranche: *a refusal is a claim about the codebase, and it goes stale like any
other.* So were these.

## What re-running them found

Measured against the code as it stands, **all ten pass**. Three rows of the
table were wrong:

| Test | The table said | Actually |
| --- | --- | --- |
| 1 — HDFC debit + ICICI credit → one transfer | **fails** — "no matching engine" | passes — `domain/events.js` has one |
| 2 — same amount a day apart → potential match | **fails** — "no matching engine" | passes |
| 4 — bank → credit card = settlement | **partial** — "categorised, not evented" | passes |

Tests 6, 7 and 8 were marked *"partial"* and were fixed during Phase 5's
balances tranche (`docs/BALANCES.md`), which the table never caught up with.
Test 3 was marked *"passes vacuously — nothing matches anything"*, which is no
longer why it passes: near amounts are now offered as *possible* and `linkFor`
refuses to confirm one, so it passes for the reason it was meant to.

**No `EconomicEvent` entity was needed for any of them.** The table asserted
that tests 1, 2 and 4 required one. Nothing in the ten turned out to. One is
still wanted for movements with more than two legs, which none of these are.

## Two fixture errors of my own, both caught by measuring

Worth recording, because both would have produced a false finding:

**Test 6 "failed" on the first run.** I built a single row carrying *both* a
`direction` and a `toAccount` — the confirmed-pairing shape — with its incoming
leg missing. `docs/BALANCES.md` says plainly that direction wins where it
exists, precisely so a confirmed pairing does not credit the destination twice.
Re-run across all three transfer shapes, the total is preserved in every one.
The test now checks all three rather than the one I happened to type.

**Test 10 "failed" too.** My message came from `orders@shop.example`, which the
merchant registry does not know, so `readReceipt` correctly returned null and
there was no receipt to deduplicate. The fixture now uses a merchant the
registry recognises.

Neither was an application bug. Both looked exactly like one for a minute.

## What mutation testing found

Five mutations against the guards the ten exist to protect, four caught.

| Mutation | Caught by |
| --- | --- |
| **A near amount becomes confirmable** | test 3 |
| **The account is dropped from the fingerprint** | test 9 |
| **The mailbox is dropped from the receipt key** | test 10 |
| **Known receipts are written again** | test 10 |
| **The narration is dropped from the fingerprint** | **survived** — now caught |

The survivor is the one the fingerprint's own comment calls the most important:

> *three ATM withdrawals of the same amount at the same machine on the same day
> differ only in a trailing reference number, and truncating the narration
> merges them into one — a silent loss of two real withdrawals*

My test distinguished two rows by the `reference` **field**, which is a
different discriminator and left the narration untested. The real shape is a
bank putting the machine's reference *inside the narration text* and leaving the
reference column empty. The test now differs only in the narration.

## Why this is worth a file

These ten are the closest thing the project has to an acceptance suite, and
until now the only record of whether they held was a paragraph somebody had to
remember to update. They are cheap to run and they answer the one question a
prose table kept answering wrongly: *does the application do the thing it was
asked to do?*

They do not replace the detailed tests. `tests/events.test.mjs`,
`tests/settlement.test.mjs` and `tests/domain.test.mjs` hold the edge cases, the
refusals and the arithmetic. This file states the ten headline scenarios once,
at the level the prompt states them.

## Not done

- **`EconomicEvent` still does not exist.** Not needed by the ten; wanted for a
  movement with more than two legs — a salary split across two accounts, a
  purchase part-paid by card and part by cash.
- **Test 2's confidence is `probable`, not a third level.** The prompt says
  "potential match"; the application offers it with a confirm control and writes
  nothing until somebody clicks. That is a defensible reading and it is stated
  here rather than left implicit, because a stricter reading would want a
  distinct middle confidence.
- **The browser does not drive these.** They are domain-level, as the prompt
  states them. The screens that surface each are covered separately.
