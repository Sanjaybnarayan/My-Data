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

## What it is not asked about, and why

`js/ai/coverage.js` names every entity the assistant will not answer about and
the reason for each. It is a registry rather than a comment because a test
reads it: an entity that is neither reachable by a question nor named there
fails the build, so a new record type cannot be added without somebody deciding
which side of the line it is on.

Ten entities are on the refusing side. Six are barred by rule 53 and the
end-to-end encryption — `smsMessage`, `vaultItem`, `message`, `conversation`,
`deviceKey`, `locationPing`. Four carry the `secret` ACL and are read on the
screen that can show their provenance beside them rather than summarised into a
sentence — `will`, `beneficiary`, `legalDocument`, `kycRecord`. A second check
sweeps the whole of `js/ai/` for those names, so the registry cannot be
satisfied by an entry that a code path then contradicts.

## The honest limitation

It is narrow, and the narrowness is not the coverage figure. Every entity is
now accounted for — 43 answerable, 10 refused with a reason — but that measures
which *records* a question can reach, not which *questions* the parser knows.
There are 25 patterns, they were written by hand, and two of them did not match
their own examples until a check compared the ids. A household phrasing
something a third way gets the refusal, which for medical and financial records
is the correct failure mode and is what `docs/STATUS.md` argues.

Wiring it to a hosted model would be a transport swap in `ai/assistant.js` —
and would require a decision about what leaves the device that nobody has
made.
