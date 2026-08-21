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

**The tenth stale line was the numbering itself.** Reading the master prompt
directly — it is not in this repository, and had never been read against this
document — showed that **Phase 6, SMS Intelligence, was skipped without record**,
shifting every later number by one. A missing row is worse than a stale one: a
stale row wastes a measurement, a missing row silently deletes a phase.

The same reading found that this document's *"all ten financial tests pass"* was
measured against a list of ten it had assembled itself, where the prompt asks
eleven — four of which need SMS.

**Every phase should begin by re-reading this row rather than trusting it.**

**And the master architecture document no longer relies on anybody doing so.**
Audited after Phase 9, thirteen of its rows still said `missing` about things
built phases earlier — including `EconomicEvent`, which it called the largest
single piece of Layer 4 work. Every row there now carries a probe that CI runs,
and the one architectural invariant the project admits is broken — screens
reaching the repository directly — is a **counted ratchet, now at 58** rather than a
sentence of regret — it has only ever moved down, and moving it down is what
`--update` is for. See `docs/ARCHITECTURE_DRIFT.md`. This roadmap has no such
check, which is the obvious next thing to want.

**And that document can now claim a screen calls a thing**, not merely that the
thing exists — `wired:<path>#<term>`, added because *"the engine exists and no
screen calls it"* is the finding this repository makes most often and no probe
could catch it. See `docs/MOVEMENTS_SCREEN.md`.

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
tranche, and the same again for the three subscription fields. 78 of 369 remain
unread and most of them should be, so the inventory is names only, and adding to
it is a deliberate act.

**This sentence used to justify that with "a nominee needs no derivation", and
it was wrong.** Four fields came off the list in one tranche when the claim was
finally tested — the three nominees and `digitalAsset.legacyInstruction`, whose
form label is *"On my death, do this"*. See `docs/NOMINATIONS.md`, and note that
the reasoning which produced the wrong example is still available for every name
left on the list. See also `docs/FIELD_COVERAGE.md`, `docs/ENTERED_CATEGORIES.md`,
`docs/FAMILY_TREE.md`, `docs/HOUSEHOLD_LEDGER.md`, `docs/CARD_BILLS.md` and
`docs/COMMITMENTS.md`.

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
| 0.5 | Trust, privacy, governance, consent, lineage | **complete** — six tranches, merged in #19. Lineage was complete and unreachable for the one entity rule 57 is about; see `docs/EXPLAINABILITY.md` |
| 1 | Database, API, auth, RBAC/ABAC | **in progress** — service layer, typecheck, row-level server authorization and the device registry done; ABAC is own-record rules only; **no API layer exists**, and the prompt's relational database is deliberately not built (see the gate) |
| 2 | Family, people, identity, family tree, CKYC 2.0, profile completion | **partial** — tree reads the person form (`docs/FAMILY_TREE.md`), CKYC built as a local record with no registry (`docs/KYC.md`), conflict engine including the shared-identifier case (`docs/IDENTITY_CONFLICTS.md`) and on the screen (`docs/IDENTITY_SCREEN.md`). profile completion built over configurable sections, with a not-applicable answer so the figure can reach a hundred for a household that rents (`docs/PROFILE_COMPLETION.md`); `KYCVersion`/`KYCConflict` are derived at read time by design |
| 3 | Document AI, OCR, document management, DOCX engine | **largely done** — OCR pre-existed in `apps-script/Drive.gs`; extraction at 89%; receipt reader; DOCX writer (`docs/DOCX.md`) and DOCX **template reader** handling run-split placeholders (`docs/DOCUMENT_AI.md`). a generated document is filed like a scan, with the template it came from named on it and Drive's own revisions behind its version count (`docs/GENERATED_DOCUMENTS.md`). Word's own `MERGEFIELD` and content controls are read and filled (`docs/WORD_FIELDS.md`). **No template versioning, no PDF output from a filled template** |
| 4 | Gmail, Drive, Calendar | **done** — including Google Calendar sync, never run against the live API (`docs/CALENDAR.md`) |
| 5 | Financial foundation, statements, transfer matching, economic events, reconciliation | **done** — `EconomicEvent` is an entity, multi-leg movements, settlement, reconciliation that refuses to lie (`docs/STATEMENT_FORMATS.md`, `docs/MULTI_LEG.md`) |
| **6** | **SMS Intelligence** | **started, having been skipped without acknowledgement** — reader, 25 categories, OTP gate that runs before any field is read, dedupe and statement reconciliation (`docs/SMS_INTELLIGENCE.md`); `smsMessage` stored and linked to the statement row it matches, with a schema that has nowhere to put a one-time code (`docs/SMS_STORAGE.md`). kept messages listed under Finance with the cross-source findings above them (`docs/MESSAGES_SCREEN.md`); the three-way link across statement, email receipt and message is built (`docs/THREE_SOURCES.md`). **No native ingestion, and none is possible in a browser**; `SMSEvent`/`SMSProcessingRecord`/`SMSSource` are mapped onto `economicEvent`, the audit trail and the connector status rather than built — see the doc for why. See below for how the phase was lost |
| 7 | Credit cards, loans, EMI, FD, RD, family ledger | **done** (`docs/ACCRUAL.md`, `docs/CARD_BILLS.md`, `docs/HOUSEHOLD_LEDGER.md`, `docs/COMMITMENTS.md`) |
| 8 | Investments, broker, Zerodha, MCP, P&L, net worth | **done bar brokers** — XIRR, cost basis (`docs/COST_BASIS.md`), MCP measured and answered (`docs/MCP.md`). Brokers remain architecture-only, correctly |
| 9 | Financial insights, forecast, goals, Family CFO, anomaly detection | **mostly done** — insights (`docs/STATEMENT_FORMATS.md`), anomaly detection with seasonality (`docs/UNUSUAL_SPENDING.md`), forecasting (`docs/CASH_RUNWAY.md`). goals read from the accounts and holdings that fund them, refusing a figure where two goals claim the same money (`docs/GOALS.md`). a Family CFO page assembling the prompt's ten figures, each naming its source, over the last complete month (`docs/FAMILY_CFO.md`) |
| 10 | Insurance, vehicles, fuel, property, tenants, purchases, warranty, subscriptions, travel | **entities exist, intelligence does not** — no fuel OCR, no warranty extraction, no tenant rent tracking |
| 11 | Health, medical records, ABDM architecture | entities exist; **no ABDM connector** |
| 12 | Legal, estate, digital life, crypto metadata | **started** — digital life existed; nominations, gaps and legacy instructions are now read across accounts, investments and policies, with the nominee-is-not-an-heir refusal, on the dashboard (`docs/NOMINATIONS.md`, `docs/SEALED_VALUES.md`). `legalDocument`, `will` and `beneficiary` exist, and a will's bequests are read against the nominations already on file — both names, no verdict (`docs/LEGAL_AND_ESTATE.md`). **`Nominee` stays a field rather than an entity** |
| 13 | Household staff | **not started** |
| 14 | Family chat, media, sharing, E2EE | **not started** |
| 15 | Location, safe zones, geofencing, SOS | **not started** — and correctly refused for a PWA |
| **16** | **Notifications, tasks, reminders, automation** | **already built** — `runAutomations` runs on every launch, and money now reaches a notification (`docs/NOTIFICATIONS.md`) |
| 17 | Knowledge graph, universal search, family timeline, what changed | search exists; every record says what has happened to it (`docs/RECORD_HISTORY.md`), and the activity feed groups the log into things that happened, names the record and marks what is new (`docs/ACTIVITY_STORIES.md`). **No knowledge graph, and no timeline screen of its own — the feed is a dashboard widget eight stories deep** |
| 18 | AI family assistant, AI governance, AI privacy | assistant exists; **governance and the AI Privacy Gate are one outbound pattern check** |
| 19 | Advanced analytics, Family CFO, forecasting, risk detection | forecasting done; **no Family CFO, no risk detection** |
| 20 | Security hardening, privacy hardening, compliance evidence | **not started** — but the applicability review it depends on is done: `js/domain/compliance.js` holds nineteen regimes and sixty-six controls, every evidenced status cites a file that exists, nothing is `VERIFIED`, and all twenty `docs/COMPLIANCE/` documents are written (`tools/compliance.mjs`) |
| 21 | Backup, restore, portability, recovery | export exists; **no encrypted backup, no sandboxed restore** |
| 22 | PWA optimisation | **done throughout** — installable, offline shell, sync queue, precache ratchet |
| 23–25 | Android companion, iOS companion, internationalisation | **not started** |

## The numbering was wrong, and this is the correction

Every phase number in this document from 6 onward was **off by one**, because
**Phase 6 — SMS Intelligence — was skipped without ever being recorded as
skipped.** What this file called Phase 6 was the prompt's Phase 7, what it
called Phase 7 was Phase 8, and the "Insights" and "Automation" work was the
prompt's Phase 9 and Phase 16.

That is the same failure this document has caught itself making nine times, in
its worst form yet: not a stale row, but a **missing row** that shifted every
row after it. A reader planning "Phase 6" would have built credit cards, which
were already done, and SMS would have stayed invisible indefinitely.

**Phase 6 is the largest unbuilt piece of this application.** The prompt gives
it a pipeline, twenty-four message categories, an extraction contract, a
security rule for OTPs, three storage modes, real-time processing, a
reconciliation model and a conflict engine — and rules **51 through 57** exist
solely to constrain it.

## The financial tests: ten run, eleven asked for

**The prompt specifies eleven, and four of them are about SMS.** This file has
been reporting *"all ten pass"* against a list that is not the prompt's list —
the four SMS tests were dropped, and the remaining seven were renumbered to ten
by splitting duplicate detection into statement and receipt cases.

What the prompt asks and this repository cannot yet answer:

| Prompt test | State |
| --- | --- |
| SMS + bank statement, same transaction → **one transaction, multiple evidence** | **cannot run** — no SMS |
| the same SMS twice → **one event** | **cannot run** |
| SMS + statement + Gmail receipt → **one economic event** | **cannot run** |
| SMS ₹5,000 against statement ₹5,500 → **CONFLICT** | **cannot run** |

The seven that are the prompt's and do pass — internal transfer, card purchase,
bank→card settlement, bank→broker, broker→stock, bank→FD, duplicate statement —
are genuinely covered. The claim that was wrong is *"all ten"*, because ten was
never the number.

## The ten this repository runs

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
