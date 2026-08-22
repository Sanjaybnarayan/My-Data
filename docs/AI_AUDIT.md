# AI Audit

**Base:** `1c8d97d` · 22 August 2026.

## What the AI is

Four files — `js/ai/assistant.js`, `intents.js`, `mcp.js`, `summary.js` — and
**no model**.

| Question | Answer | Evidence |
| --- | --- | --- |
| Model provider | **None** | no `fetch`, no HTTP, no SDK anywhere in `js/ai/` |
| Prompts | **None** | it is a deterministic intent parser, not a prompted model |
| Data passed to AI | **None leaves the device** | there is nowhere for it to go |
| AI memory | None | |
| AI actions | **Read-only** | see below |
| AI → direct database write | **Does not exist** | |
| Confidence | Present on extraction, never treated as verification | `js/domain/extract.js` |
| Human review | Extraction results are proposals a person confirms | |
| Audit | Assistant queries are not written to the audit trail | gap, P3 |

## The write path, checked directly

Every repository call under `js/ai/`:

```
js/ai/assistant.js:68   rows = await this.#db.repo(entityName).list({ limit: 10_000 });
```

That is the complete list. **No `.create`, no `.update`, no `.remove`.** The
path the specification asks to be flagged —

```
AI  →  DIRECT DATABASE WRITE
```

— **does not exist in this repository.**

## Prompt injection

Not applicable in the usual form: there is no prompt, no system message and no
model to inject into. `intents.js` matches user text against a fixed set of
recognised questions and answers `"I do not understand that one"` for anything
else (`js/ai/assistant.js:129`). A document containing hostile instructions
cannot alter behaviour because no document text is ever interpreted as an
instruction.

## Safeguards by domain

- **Financial** — every figure the assistant reports shows the rows behind it;
  `js/domain/explain.js` carries provenance.
- **Identity** — masking applies to assistant output through the same
  `js/data/classification.js` path as the screens.
- **Health / legal** — reads go through `db.repo()`, so RBAC and row filtering
  apply exactly as they do to the UI. The assistant cannot read what its actor
  cannot read.

## MCP

`js/ai/mcp.js` exposes recognised intents as MCP tools, described as *"Answered
from records on this device; no request leaves it."* Still read-only — the tool
surface is the intent surface.

## The honest limitation

This scores **55%** on Phase 18 not because it is unsafe but because it is
narrow: it answers the questions it recognises about spending, income, net
worth, investments, bills, budgets, expiries, tasks and where documents are, and
says so plainly when it cannot parse one. For medical and financial records that
is the correct failure mode, and the repository argues so in
`docs/STATUS.md`. Wiring it to a hosted model would be a transport swap in
`ai/assistant.js` — and would require a decision about what leaves the device
that nobody has made.
