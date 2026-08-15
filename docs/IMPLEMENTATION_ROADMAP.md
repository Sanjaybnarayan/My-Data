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

   **Both are now done, and the lint half turned out to be nearly nothing.**
   Measured before writing any of it: one `noImplicitReturns` finding in the
   whole codebase, three loose comparisons (all `!= null`, which is the idiom),
   no `var`, no `console.log`, no `debugger`, no `eval`, no `innerHTML`. So
   there is deliberately **no linter** — a large dependency tree, in a
   repository with three devDependencies and no build step, against findings
   already counted at nearly zero. `tools/lint.mjs` holds five rules a type
   checker structurally cannot see, every one at zero, and the value is in the
   direction it fails.

**A pattern worth naming, after two phases of finding it.** Every wrong number
so far has had the same shape: a figure with a date attached that nothing ever
re-reads. `loan.outstanding` never falls, `holding.currentValue` never rises,
`holding.invested` never grows — and all three understate what they are for.
The roadmap called each of them *"partial"*, and each turned out to be a live
wrong number rather than a missing feature. The next one will probably look the
same, so **measure before building** stays the rule: every tranche since Phase 5
has begun by printing what the application actually reports.

**A second shape has now appeared three times**: a function returning the right
answer to a *different* question. `expiryReminders`
answers "how long before I am nagged?" and the grid asked it "what falls in
September?"; `upcomingBills` answers "what is due soon?" and the grid asked it
the same thing about money. Both were correct where they were written and wrong
where they were called, and neither failed loudly — the screen simply drew less
than it promised. The fix in both cases was a second function beside the first,
with a test pinning the difference, rather than a change to either. Phase 5's
`proposeTransfers` made it a third — it pairs one leg with one leg, which is the
right answer to "which two rows are this movement?" and no answer at all to
"which rows are", so a movement landing in three pieces was invisible
(`docs/MULTI_LEG.md`).

The rule applies to this document's own refusals too. Phase 6's first tranche
declined to value recurring deposits because "the payment schedule is not
recorded here"; the second measured it and found 24 dated instalments sitting in
the database, already being read by `domain/portfolio.js`. **A refusal is a
claim about the codebase, and it goes stale like any other.**

Phase 3 made the point a third time. This table said *"OCR new"*; OCR had been
implemented in `apps-script/Drive.gs` for some time, through Drive's own
converter. Phase 4 made it a fourth: *"Calendar new"*, over a 321-line calendar
module that had been drawing a month grid for some while — and drawing a third
of what it promised. Phase 4 again made it a fifth, recording recurrence as open
while eleven of twelve months read *nothing due*.

**Phase 1 supplied the sixth and the seventh.** *"The policy-only server still
open"* was carried over a backend that already verified identity with Google,
took the role from the member list rather than the request, and enforced a
generated policy table — three quarters of the gate, for months.

**Phase 9 supplied the ninth**, and mildly: *"Automation"* was carried over a
module that had been running on every launch for some while. The finding was not
that it was missing but that money had never been given to it — the third time
one shape has appeared, after the calendar's squares and the calendar's
recurrence (`docs/NOTIFICATIONS.md`).

**Phase 8 supplied the eighth, and it is the one that best justifies the rule.**
*"Insights: not started"* was carried over a working Insights screen — and
measuring it found something worse than a stale line, because the screen was
running and *wrong*. Had the line been trusted, the work would have been to
build a second insights surface beside a broken one. See
`docs/STATEMENT_FORMATS.md`.

**The lint line is the plainest of the eight.** *"25,000 untyped lines
with no linter"* was carried from the Phase 0 audit as a live risk for the whole
of this work. Measured: one implicit return, and nothing else worth a rule. The
answer was not to install a linter but to say so.

**Every phase should begin by re-reading this row rather than trusting it.**

**And the master architecture document no longer relies on anybody doing so.**
Audited after Phase 9, thirteen of its rows still said `missing` about things
built phases earlier — including `EconomicEvent`, which it called the largest
single piece of Layer 4 work. Every row there now carries a probe that CI runs,
and the one architectural invariant the project admits is broken — screens
reaching the repository directly — is a **counted ratchet at 71** rather than a
sentence of regret. See `docs/ARCHITECTURE_DRIFT.md`. This roadmap has no such
check, which is the obvious next thing to want.

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
| 1 | Database, API, auth, RBAC/ABAC | **in progress** — service layer, typecheck and **row-level server authorization** done (`docs/OWN_RECORDS.md`); **lint measured and answered — there is deliberately no linter, and `tools/lint.mjs` says why** (see above); **the policy-only server turned out to be three quarters built** — identity, roles and policy were already server-side and authoritative, and the missing device registry was a field parsed on every request and never read (`docs/DEVICE_REGISTRY.md`) |
| 2 | Family, identity, tree, CKYC 2.0 | **tree now reads the person form** (`docs/FAMILY_TREE.md`); **CKYC built as a local record, with no registry** (`docs/KYC.md`) |
| 3 | Document intelligence, OCR, DOCX templates | **OCR already existed** (Drive's own, `apps-script/Drive.gs`) — that line was stale; extraction measured at **89% with zero wrong fields**; **the identifier a scan finds now reaches the encrypted field instead of being dropped** (`docs/DOCUMENT_INTELLIGENCE.md`). **a receipt reader now exists** — receipts were routed through the bill reader and yielded *nothing*, 0 of 8 amounts and dates across four real layouts, while filling `biller` with the name of the person who **paid** (`docs/DOCUMENT_INTELLIGENCE.md`). **DOCX now exists too** — a `.docx` is a ZIP of XML parts and the xlsx writer already had the ZIP, so it cost no dependency; the harder half was deciding that a rent receipt may only be issued for rent **received**, never for rent paid, because a receipt is a statement by whoever took the money (`docs/DOCX.md`). Reading a `.docx` remains, and nothing yet files a receipt against the payment it records |
| 4 | Gmail, Drive, Calendar | Gmail + Drive exist; **a calendar screen already existed and drew 3 of 9 dated things** — its 400-day horizon was silently capped by each field's reminder lead, and money due never reached a square at all. **Bills then reached exactly one square each**: a household paying ₹80,239 a month saw it in September and read *nothing due* for the other eleven months of the year (`docs/CALENDAR.md`). **Calendar entries now carry a stable identity and export as RFC 5545 iCalendar**, which Google Calendar and Apple Calendar both read — a snapshot the household saves, not a sync. **Google Calendar sync now exists**, on `calendar.app.created` — the narrowest scope Google offers, reaching only calendars this application created and nothing else in the account. Idempotent by construction, one-way, and **not verified against the live API**, which is said rather than glossed (`docs/CALENDAR.md`) |
| 5 | Financial foundation, transfer matching, economic events | **the importer knew one bank** — real ICICI and Axis statements produced zero transactions from thousands of readable rows, and a statement with no opening balance was never checked at all (`docs/STATEMENT_FORMATS.md`). **A PhonePe export read as zero rows, and spans four accounts at once — a payment app's row is a bank row seen from the other side, linked by the UTR** (`docs/PAYMENT_APPS.md`). **all ten prompt tests pass**, locked in `tests/prompt.test.mjs` — see below. **a movement landing in more than one piece is now proposed as one event** — ₹50,000 out arriving as ₹30,000 and ₹20,000 reported 0 proposals and 3 loose ends before it (`docs/MULTI_LEG.md`). **a charge that closes a near-match exactly is now named as evidence** — and the sentence that offers it was printing minor units raw, so a ₹50 fee read as *“differ by 5000”* (`docs/MULTI_LEG.md`). **a multi-leg movement can now be confirmed**, threading one id through every leg — `toAccount` names one destination and a split has several, so these had been proposed with nothing a button could write (`docs/MULTI_LEG.md`). **`EconomicEvent` is now an entity**, built once two tranches had made it the blocking gap: a movement can say what *kind* it is, and the charge that explains a near-match finally has somewhere to live — recorded as a fee rather than a leg, and reported beside the amount rather than inside it (`docs/MULTI_LEG.md`) |
| 6 | Cards, loans, EMI, FD/RD, family ledger | loans and EMI done in Phase 5; **FD and RD accrual done** (`docs/ACCRUAL.md`); **who-paid done, who-owes-whom refused for a stated reason** (`docs/HOUSEHOLD_LEDGER.md`); **card bills now due-dated from the statement, not the current balance** (`docs/CARD_BILLS.md`); **subscriptions are in the committed figure that had always named them** (`docs/COMMITMENTS.md`) |
| 7 | Investments, brokers, MCP | investments exist and XIRR is right; **`holding.invested` never moved, so a fund fed a SIP reported 162% gain where its own transactions said 24.61%** (`docs/COST_BASIS.md`). Brokers still architecture-only. **MCP measured and answered: there is nowhere in this design for an MCP *server* to run** — the records are on the device and the only server this application has never holds them, which is what the gate's answer costs. A local tool surface derived from the thirteen assistant intents exists instead, returning sentences and counts rather than records (`docs/MCP.md`) |
| 8 | Insights | **the screen already existed** — `insights()` over categorised rows, on the Ledgers screen — and that line was the eighth to go stale on measurement. What it *said* was wrong: on an ICICI statement every UPI payment, in both directions, grouped under one counterparty called `unknown`, because the payee was taken from a fixed field position and `DR`/`CR` sits there instead. Rent, Netflix and a backup plan read as **one charge of ₹1,180 repeating weekly**, and the screen reported *"2 payments repeat on a schedule"* to a household that had five (`docs/STATEMENT_FORMATS.md`). **The two halves of the household's own money now meet**: the records say ₹53,500 a month is committed, the statements show ₹55,329 a month actually leaving on a schedule, and the ₹1,829 difference — two subscriptions nobody wrote down — is named beside the figure rather than folded into it (`docs/COMMITMENTS.md`) |
| 9 | Automation | **already built and wired** — `runAutomations` runs on every launch, advances overdue bills, repeats completed tasks and notifies once a day. The ninth line found already done. What it did *not* do was money: the notifier read thirteen entity types, **none of which carries a bill**, so a household with ₹53,500 a month committed was told its passport expires in six days and nothing about the rent due tomorrow (`docs/NOTIFICATIONS.md`) |
| 10–23 | Sharing … internationalisation | not started — and the repository holds no list of what they are beyond this elision, so the names here are inference, not record |

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
