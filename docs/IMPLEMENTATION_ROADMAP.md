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

| Phase | Prompt scope | Position here |
| --- | --- | --- |
| 0 | Repository audit | **complete** |
| 0.5 | Trust, privacy, governance, consent, lineage | **complete** — six tranches, merged in #19 |
| 1 | Database, API, auth, RBAC/ABAC | **in progress** — service layer first, then lint/typecheck, then the server |
| 2 | Family, identity, tree, CKYC 2.0 | family/identity partly exist; CKYC entirely new |
| 3 | Document intelligence, OCR, DOCX templates | extraction exists; OCR and DOCX new |
| 4 | Gmail, Drive, Calendar | Gmail + Drive exist; Calendar new |
| 5 | Financial foundation, transfer matching, economic events | **largest real gap** — see below |
| 6 | Cards, loans, EMI, FD/RD, family ledger | entities exist; settlement semantics new |
| 7 | Investments, brokers, MCP | investments exist; brokers architecture-only |
| 8–23 | Insights … internationalisation | not started |

## Phase 5 is the one to look at first after the gate

The prompt's financial tests 1–10 are the sharpest specification in the whole
document, and this repository passes some of them already:

| Test | Today |
| --- | --- |
| 1 — HDFC debit + ICICI credit → one internal transfer | **fails** — categorised as two transfers, not one event |
| 2 — same amount a day apart → potential match | **fails** — no matching engine |
| 3 — ₹50,000 vs ₹49,950 → no automatic match | **passes vacuously** — nothing matches anything |
| 4 — bank → credit card = settlement | **partial** — categorised, not evented |
| 5 — card → merchant = expense | **passes** |
| 6 — bank → broker = funding | **partial** |
| 7 — broker → stock = investment | **partial** |
| 8 — bank → FD = asset allocation | **partial** |
| 9 — statement imported twice → duplicate | **passes** — fingerprint |
| 10 — attachment imported twice → duplicate | **passes** — receipt key per mailbox |

Tests 1, 2 and 4 need `EconomicEvent` and a matching engine with explicit
confidence that never forces an uncertain match. That is the work.

## What is deliberately not scheduled

- **Location, geofencing, SOS, screen time** — cannot be delivered by a PWA.
  Architecture only until a native companion exists (Phase 22).
- **E2EE chat** — not to be claimed until key management, device verification,
  attachment encryption and recovery are implemented and reviewed.
- **DigiLocker, CKYCRR, ABDM, Account Aggregator, brokers** — architecture and
  connector states only, until authorised access genuinely exists.
