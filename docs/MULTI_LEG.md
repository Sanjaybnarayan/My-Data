# A movement with more than two legs

Phase 5's last open item. The roadmap carried it four times as *"`EconomicEvent`
still wanted for movements with more than two legs"* — and nobody had printed
what those movements currently do.

## What was measured

```
  split — ₹50,000 out of HDFC, ₹30,000 into ICICI, ₹20,000 into SBI
    proposals 0   unmatched 3   moved ₹0

  sweep — ₹30,000 and ₹20,000 out, ₹50,000 in
    proposals 0   unmatched 3   moved ₹0

  control — ₹50,000 out, ₹50,000 in
    proposals 1   probable      moved ₹50,000
```

The household moved ₹50,000 and the application reported **nothing moved and
three loose ends**. `proposeTransfers` pairs one leg with one leg, so a movement
landing in two pieces is invisible to it.

Worth being precise about the severity: this was **not a wrong number**. The
three rows were reported as unmatched, and the honest sentence *"one side of a
movement with no partner"* was already on the screen. Unlike most of what the
earlier phases turned up, nothing here was claiming something false. It was a
gap, and the roadmap had called it one.

**Two of my own measurements were wrong before they were right**, both fixture
errors of the same kind that has recurred all through this work: the first
harness left `direction` off every row, so `isLooseLeg` rejected all of them and
even the two-leg control reported nothing. A measurement that makes the control
fail is measuring the harness.

## Why `proposeMultiLeg` sits beside `proposeTransfers`

The same shape as `datesInRange` beside `expiryReminders`, and `billsInRange`
beside `upcomingBills` — this repository's third instance of it. The pairwise
question is correct and this is a **different** question, so the answer is a
second function with a test pinning the difference, not a change to the first.

It runs only on the legs the pairwise pass left **unmatched**. That is not tidy
housekeeping: searching every loose leg instead would find `30 + 20 = 50` beside
an already-paired `50 → 50` and propose that the same debit went somewhere else
entirely, contradicting the pairing. A mutation proves the point, and a test now
pins it.

## The rules, which are the pairwise rules

- **Exact only.** A set is proposed when its legs sum to the counterpart
  *exactly*. There is no near-miss version: subset-sums are numerous enough that
  an approximate one would find a coincidence in any statement.
- **Ambiguity is not a match.** If two different groups close the same amount,
  neither is probable — the same rule, for the same reason, as one debit
  matching two credits equally well. An ambiguous set is a question, so its
  amount is **not** in the total and its rows stay on the loose list.
- **A leg is spent once.** ₹20,000 that closes one set must not also close
  another, or the same money is reported as moved twice.
- **Bounded, and honest when it gives up.** Subset-sum is exponential, so the
  candidate pool is capped at twelve. Past the cap the answer is *"too many
  rows could be part of this movement"*, reported as such — a search that
  quietly stopped early would report "no movement" for a movement that is there.
- **Nothing is written.** As with everything in `domain/events.js`, a proposal
  is an opinion about a coincidence of amounts and dates.

## No confirm button, deliberately

`linkFor` writes one `toAccount`. A split has several destinations, so there is
nothing in the schema a confirmation could write without inventing a shape that
does not exist. The set is **shown** and named; it is not made confirmable by a
button that would do the wrong thing quietly. Giving multi-leg movements a
record of their own is the `EconomicEvent` entity proper, and it is still not
built.

## What the mutation testing caught

**7 of 10 mutations of the rules, and 4 of 4 of the service wiring** — but the
first pass caught only 5 of 10, and the three that mattered were all my tests
being weak rather than the code being right:

- *"a leg can close two sets"* survived because the fixture had no second set
  to close. Replaced with amounts where one genuinely exists (`30 + 20 = 50`
  and `20 + 15 = 35`, sharing the ₹20,000).
- *"runs over paired legs too"* survived because the fixture had no spare legs
  for a set to be built from.
- *"an ambiguous set hides its rows"* survived because the assertion was
  `unmatched.length > 0`, which the two spare credits satisfied on their own.
  It now names all five rows.

Three survivors remain and are **stated rather than tested**, because a test
for them would be theatre:

| Mutation | Why it survives |
| --- | --- |
| `pool.length < 2` → `< 1` | unreachable: a single counterpart of exactly the right amount differs by nought, so the pairwise pass always claims it first |
| `chosen.length >= 2` → `>= 1` | the same reason |
| `found.length >= 2` → `>= 3` | performance only — with three closing sets or thirty, the verdict is identical |

The first two stay because the rule they state — a set is at least two rows — is
a property of the answer rather than an accident of what the pairwise pass
happens to catch.

## Not done

- **`EconomicEvent` as an entity.** Still not built, and now for a sharper
  reason than before: a split has no single `toAccount`, so recording one needs
  a record with many legs rather than a field on a transaction.
- ~~A fee leg is not used as evidence.~~ **Done** — see below.
- **The screen path is not browser-checked.** A loose leg is an import-only
  state by design — the validator refuses a hand-entered transfer with no
  destination — so the browser suite cannot create one through a form. The
  service layer is covered against a real database; the rendering is not.


# The charge that explains a near-match

The tranche above recorded this as the obvious next one. Measuring it turned up
**two** things, and the second was worse than the one being looked for.

## The one that was looked for

₹50,000 leaves HDFC, ₹49,950 arrives at ICICI, and a ₹50 bank charge sits on the
HDFC statement the same day. The arithmetic closes exactly. The application said:

> The amounts differ by 5000 — a fee would explain it, and so would these being
> two unrelated payments. **Nothing here can tell which.**

Something here could. The row that tells was in the same array.

## The one that was found on the way

Look at that sentence again. **"differ by 5000"** — for a ₹50 fee.

Everything in this application is in minor units, and this sentence interpolated
them raw. A household reads five thousand rupees where the truth is fifty: a
hundredfold overstatement, in the one sentence that exists to help somebody
decide whether two rows are the same movement. **Nothing had ever pinned that
sentence** — the whole suite passed with it wrong, and it took writing a test
about fees to look at it.

The convention elsewhere in the codebase is a `money` parameter defaulting to
`String(n)`, which is safe where every caller passes a real formatter. Here no
caller *could*, because `why` is built inside the module. So the default now at
least moves the decimal point, and the service passes `core/money.js`'s `format`
for the rupee sign and the grouping. Both halves are tested, because a default
that silently prints paise is exactly how this happened.

## What counts as an explanation

A charge is named only when it is **exactly** the difference. "About right" would
find a coincidence on any statement busy enough, and this sentence is read by
somebody about to make a decision.

| Rule | Why |
| --- | --- |
| Either account | a bank fee is charged where the money left, an inward-remittance fee where it arrived |
| Inside the window | the same three days the pairing itself allows |
| Not a transfer leg | a third loose leg of the right size is a candidate for its own pairing — explaining one movement by consuming another is not an explanation |
| Not deleted | — |
| Two that fit is a question | *"2 separate charges would each account for it exactly"*, and which belongs is not something the figures can say |

**The pairing stays `possible`.** Unequal amounts never match automatically, and
that rule does not bend because the evidence got better. A charge of the right
size on the right day is strong evidence and is still not somebody having
checked. What changed is that the person deciding is now shown the row.

## What the mutation testing caught

**10 of 11**, after a first pass that caught 8 — the three misses were all my
tests rather than the code:

- *"empty narration prints as empty quotes"* survived because the fixture
  blanked `narration`, `payee` and `category` at once, so `||` and `??` gave the
  same answer. An empty narration with a real payee is the case that separates
  them, and it is what a statement importer actually produces.
- *"service stops passing the rupee formatter"* survived because no test looked
  at the sentence through the service. One does now, and it asserts the ₹.
- *"evidence hunted for an exact pairing too"* survives and is **stated rather
  than tested**: `chargesExplaining` is only ever called from the `!exact`
  branch, so a zero difference cannot reach it. The guard stays because "there
  is no gap to explain" is a property of the question rather than of the one
  caller that happens to ask it.

## Not done

- **Nothing writes the fee link.** The charge is named in the sentence and
  carried on the proposal as `evidence`; no field records that this row explains
  that movement, because there is nowhere in the schema to put it. That is the
  same `EconomicEvent` shortfall as the split above, from a different direction.
- **The screen shows the sentence, not the row.** A household reads that a
  charge accounts for the difference; they cannot click through to it.
