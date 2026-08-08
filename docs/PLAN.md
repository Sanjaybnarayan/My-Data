# FamilyOS — Build Plan

Five phases. Each ends with the suite green (`node tests/run.mjs`) and
a review pass over the diff before the next begins.

## Phase 1 — Foundation
*Architecture, storage, authentication, dashboard, offline engine.*

- `js/core` — event bus, ids, dates, currency, DOM builder, errors, logger.
- `js/data` — storage adapter interface, IndexedDB adapter, memory adapter,
  the schema registry for all sixteen modules, migrations, validation,
  the generic repository, audit trail.
- `js/security` — WebCrypto AES-256-GCM, PBKDF2 key wrapping, field
  encryption, RBAC, session timer, rate limiter, input sanitation.
- `js/auth` — PIN enrolment and unlock, WebAuthn, Google OAuth (PKCE, popup),
  family member records and roles.
- `js/sync` — outbox, backoff, conflict resolver, Apps Script transport.
- `js/ui` — shell, router, theme, and the component set.
- Dashboard with customisable widgets.
- Service worker, manifest, install prompt.

**Exit:** app installs, unlocks, stores an encrypted record offline, survives a
reload, queues the write, and drains the queue when a stub server appears.

## Phase 2 — Everyday modules
*Finance, family, documents, tasks, notes.*

- Generic CRUD screens driven by schema (list, filter, detail, form).
- Finance: accounts, transactions, budgets, recurring payments, cash-flow and
  monthly/yearly rollups, charts.
- Family: members, relationships, family tree rendering, important dates.
- Documents: file capture, Drive upload, category/tag, expiry reminders,
  version history, full-text search over metadata.
- Tasks: projects, recurrence, priority, calendar integration.
- Notes: rich text, attachments, links.

**Exit:** every Phase 2 module round-trips through the repository and the
outbox; reminders fire; search returns across modules.

## Phase 3 — Asset modules
*Investments, property, vehicles, insurance, health.*

- Investments: holdings, transactions, allocation, P&L, XIRR, dividends.
- Property, vehicles, insurance, health, education — schema-driven, with the
  module-specific summaries (renewals due, service history, portfolio value)
  that feed the dashboard and net worth.
- Net worth consolidation across cash, investments, property, minus loans.

**Exit:** net worth is computed from real records; every renewal date in the
system produces a reminder.

## Phase 4 — Intelligence
*AI assistant, analytics, reports, automation.*

- Intent registry and natural-language parser over local data.
- Report writers: CSV, XLSX (hand-rolled ZIP + SpreadsheetML), PDF
  (hand-rolled writer, core fonts), all dependency-free.
- Dashboard analytics and the chart library.
- Automation: recurring transaction materialisation, reminder scheduling,
  backup verification.

**Exit:** the six example queries in the brief are answered from stored data;
each report type opens in its native application.

## Phase 5 — Hardening
*Testing, optimisation, deployment, documentation.*

- Full suite, mutation-checked.
- Lazy module loading, virtual lists, index tuning.
- Apps Script deployment guide, Google Cloud OAuth client setup, PWA hosting.
- Setup, operations and recovery documentation.

---

## What is deliberately not built

Stated plainly so nothing is mistaken for finished:

- **No LLM.** The "AI Assistant" is a deterministic intent parser over local
  data. It answers the queries in the brief and says so when it cannot parse
  one. Wiring it to a hosted model is a transport swap in `ai/assistant.js`,
  not a redesign — but no model is called today.
- **OCR** is not implemented. The `ocrText` field exists and is searched when
  populated; nothing populates it yet. Apps Script could OCR on upload through
  Drive's own conversion, and that is where it would go.
- **Market prices** for stocks/mutual funds/crypto are entered manually or
  refreshed through an Apps Script `GOOGLEFINANCE` bridge for the instruments
  Sheets supports. No third-party price API is bundled.
- **Voice notes and drawings** capture and store the blob; there is no
  transcription and no drawing editor beyond a canvas surface.
