# Implementation Roadmap

Sequenced against the master prompt's phases, adjusted for what this
repository already has. **Nothing past Phase 0 is authorised to start.**

## Gate — answered

**Hybrid, with a policy-only server.** The server holds identity, roles, device
registry and policy, and answers authorization questions. It **never holds
household records** — those stay on the device and in the household's own
Google account.

That second sentence is the whole of the decision. It preserves the claim the
application already makes and can already defend — *nobody else has a copy, not
the people who wrote this and not whoever hosts it* — while making rules 46/47
(server-side authorization is authoritative) satisfiable, which they were not
under a purely serverless design.

What it costs: the server cannot answer questions that need to read records, so
search, reporting and cross-device queries stay client-side. That is a real
constraint and it is accepted deliberately.

## Re-ordering proposed

Two changes to the prompt's order, both for the same reason — later phases
multiply the cost of skipping them:

1. **A domain-service layer belongs in Phase 1, not implied later.** Screens
   currently call the repository directly, so every module added before the
   service layer exists is another caller to migrate. What that layer is *for*
   was mis-stated in the Phase 0 audit and corrected at the start of Phase 1 —
   it is not an authorization hole (the repository already gates every read and
   write); it is that assembly can only be tested through a browser and
   cross-entity operations have nowhere to live.
2. **Lint and typecheck belong in Phase 1.** 25,000 untyped lines with no
   linter. `tests/modules.test.mjs` catches syntax errors only.

**A pattern worth naming, after two phases of finding it.** Every wrong number
so far has had the same shape: a figure with a date attached that nothing ever
re-reads. `loan.outstanding` never falls, `holding.currentValue` never rises,
`holding.invested` never grows — and all three understate what they are for.
The roadmap called each of them *"partial"*, and each turned out to be a live
wrong number rather than a missing feature. The next one will probably look the
same, so **measure before building** stays the rule: every tranche since Phase 5
has begun by printing what the application actually reports.

The rule applies to this document's own refusals too. Phase 6's first tranche
declined to value recurring deposits because "the payment schedule is not
recorded here"; the second measured it and found 24 dated instalments sitting in
the database, already being read by `domain/portfolio.js`. **A refusal is a
claim about the codebase, and it goes stale like any other.**

Phase 3 made the point a third time. This table said *"OCR new"*; OCR had been
implemented in `apps-script/Drive.gs` for some time, through Drive's own
converter. Phase 4 made it a fourth: *"Calendar new"*, over a 321-line calendar
module that had been drawing a month grid for some while — and drawing a third
of what it promised. **Every phase should begin by re-reading this row rather
than trusting it.**

**This application collects more than it reads.** Nine fields were filled in on
a form and read by nothing downstream — `transaction.category`,
`person.relationship`, `transaction.person`, `importantDate.remindDaysBefore`,
`account.statementDay`, `account.dueDay`, `subscription.autoRenew`,
`subscription.cancelUrl` and `digitalAsset.annualCost` — and all nine are now
wired up. Each looked like a missing feature and was a wiring gap: the data
present, structured and ignored.

**The last three were worse than a gap.** The Finance screen printed *"₹79,590
a month is already committed to bills, EMIs and subscriptions"* over a figure
that had never seen a subscription, and five renewals inside the next thirty
days appeared nowhere among the upcoming bills. Every other wrong number found
here has been silent; that one made a claim about its own contents. See
`docs/COMMITMENTS.md`.

Three of the nine were found by accident while measuring something else. The
others were **audited for**: `tools/field-coverage.mjs` holds the set of fields
nothing reads by name, and the suite fails in *both* directions — when the set
grows, and when a field on it starts being read. The second half is what
reported *"account.dueDay, account.statementDay are read now"* during the card
tranche, and the same again for the three subscription fields. 86 of 369 remain
unread and most of them should be — a nominee needs no derivation — so the
inventory is names only, and adding to it is a deliberate act. See
`docs/FIELD_COVERAGE.md`, `docs/ENTERED_CATEGORIES.md`, `docs/FAMILY_TREE.md`,
`docs/HOUSEHOLD_LEDGER.md`, `docs/CARD_BILLS.md` and `docs/COMMITMENTS.md`.

**The form/importer seam has produced three separate bugs**, in Phase 5's
transfer directions, Phase 5's balances, and Phase 6's entered categories. Each
time, the whole suite passed because every fixture was built the way the
importer writes records. A record created by a form and a record created by an
importer are different shapes, and any behaviour tested against only one of them
is untested against the other. See `docs/BALANCES.md` and
`docs/ENTERED_CATEGORIES.md`.

| Phase | Prompt scope | Position here |
| --- | --- | --- |
| 0 | Repository audit | **complete** |
| 0.5 | Trust, privacy, governance, consent, lineage | **complete** — six tranches, merged in #19 |
| 1 | Database, API, auth, RBAC/ABAC | **in progress** — service layer, typecheck and **row-level server authorization** done (`docs/OWN_RECORDS.md`); lint and the policy-only server still open |
| 2 | Family, identity, tree, CKYC 2.0 | **tree now reads the person form** (`docs/FAMILY_TREE.md`); **CKYC built as a local record, with no registry** (`docs/KYC.md`) |
| 3 | Document intelligence, OCR, DOCX templates | **OCR already existed** (Drive's own, `apps-script/Drive.gs`) — that line was stale; extraction measured at **89% with zero wrong fields**; **the identifier a scan finds now reaches the encrypted field instead of being dropped** (`docs/DOCUMENT_INTELLIGENCE.md`). A receipt reader and DOCX remain |
| 4 | Gmail, Drive, Calendar | Gmail + Drive exist; **a calendar screen already existed and drew 3 of 9 dated things** — its 400-day horizon was silently capped by each field's reminder lead, and money due never reached a square at all (`docs/CALENDAR.md`). **Google Calendar sync is genuinely absent** and is the real remaining work |
| 5 | Financial foundation, transfer matching, economic events | **all ten prompt tests pass**, locked in `tests/prompt.test.mjs` — see below. `EconomicEvent` still wanted for movements with more than two legs |
| 6 | Cards, loans, EMI, FD/RD, family ledger | loans and EMI done in Phase 5; **FD and RD accrual done** (`docs/ACCRUAL.md`); **who-paid done, who-owes-whom refused for a stated reason** (`docs/HOUSEHOLD_LEDGER.md`); **card bills now due-dated from the statement, not the current balance** (`docs/CARD_BILLS.md`); **subscriptions are in the committed figure that had always named them** (`docs/COMMITMENTS.md`) |
| 7 | Investments, brokers, MCP | investments exist and XIRR is right; **`holding.invested` never moved, so a fund fed a SIP reported 162% gain where its own transactions said 24.61%** (`docs/COST_BASIS.md`). Brokers still architecture-only; MCP not started |
| 8–23 | Insights … internationalisation | not started |

## The prompt's ten financial tests

The sharpest specification in the whole document — and the table that used to
sit here was **prose, and had gone stale**. It was written before Phases 5 and
6 touched any of it, and by the time anybody re-ran the ten, three of its rows
were wrong: two claimed failure and one claimed "partial" for behaviour that had
been working for several tranches.

They now live in `tests/prompt.test.mjs`, where a row that stops being true
fails the suite on the next commit rather than on the next audit. **All ten
pass.** What each one rests on:

| Test | Rests on |
| --- | --- |
| 1 — HDFC debit + ICICI credit → one internal transfer | `domain/events.js` pairing, offered as *probable* with a confirm control |
| 2 — same amount a day apart → potential match | the same, within a three-day window |
| 3 — ₹50,000 vs ₹49,950 → no automatic match | near amounts are *possible* at most, and `linkFor` refuses to confirm one |
| 4 — bank → credit card = settlement | `domain/settlement.js`, which names the double count rather than silently correcting it |
| 5 — card → merchant = expense | the categoriser |
| 6 — bank → broker = funding | `accountBalances`, checked in all three transfer shapes — see `docs/BALANCES.md` |
| 7 — broker → stock = investment | `investment-out` is `internal`, not spending |
| 8 — bank → FD = asset allocation | the same |
| 9 — statement imported twice → duplicate | the fingerprint, which keeps the whole narration |
| 10 — attachment imported twice → duplicate | the receipt key, which includes the mailbox |

**No `EconomicEvent` entity was needed for any of them.** The earlier table
assumed one; nothing in tests 1–10 turned out to require it. One is still wanted
for movements with more than two legs, which none of these are.

## What is deliberately not scheduled

- **Location, geofencing, SOS, screen time** — cannot be delivered by a PWA.
  Architecture only until a native companion exists (Phase 22).
- **E2EE chat** — not to be claimed until key management, device verification,
  attachment encryption and recovery are implemented and reviewed.
- **DigiLocker, CKYCRR, ABDM, Account Aggregator, brokers** — architecture and
  connector states only, until authorised access genuinely exists.
