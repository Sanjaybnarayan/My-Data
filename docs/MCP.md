# MCP, and where it cannot run

Phase 7 lists MCP as not started. Measuring what *starting* it would mean turned
up an architectural fact worth writing down rather than working around.

## There is nowhere in this design for an MCP server to run

The records live on the device, in IndexedDB, behind a key the browser holds.
The only server this application has is the Apps Script deployment, and the gate
decided — deliberately, and it is the whole of the privacy claim — that it
**never holds household records**.

So a hosted MCP server would either have nothing to answer from, or would be
given the data. The second is the one thing this design refuses.

That is not a gap to be filled by trying harder. **It is what the answer to the
gate question costs**, and it was accepted knowingly when that answer was given.
An MCP server that shipped a household's medical and financial records to a
model would be a different application with the same name.

## What is honest, and is built

MCP is a protocol, not a hosting model. A client running on the **same device**
— a desktop assistant a household already trusts with their files — can be
handed a tool surface that answers from the local database and transmits
nothing. That is the same bargain `ai/assistant.js` already strikes, and this is
its tool-shaped face.

- **The tools are derived from the intent registry**, not written beside it. All
  thirteen, and a test asserts the two lists are the same length and the same
  names — so a new question becomes a tool the same day, and neither can drift.
- **Every tool takes one argument: the question, in words.** A bespoke schema
  per tool would be a second parser to keep in step with the first, and the
  first is the one with tests.
- **Answers are sentences and figures.** Records are counted, never returned —
  `{ count: 11 }` and not the eleven transactions. A caller wanting those is
  asking for a copy of the household's data, which is the request this whole
  application exists to make unnecessary.

## The door is checked on the way out

`NEVER_LEAVES` refuses an answer carrying a PAN, an Aadhaar number or an account
number long enough to transact with.

This should never fire — the assistant composes its own sentences from figures.
**That is exactly why it is there.** A door checked only when somebody expects
trouble is a door left open by whoever adds the fourteenth intent without
reading this file. And the check is on the *answer* rather than the question,
because what a question asks for matters less than what a reply carries, and
only the reply can be inspected for what it actually contains.

A test also pins the guard is not so eager that *"You spent ₹12,000 in 2026 on
fuel"* is refused. A boundary that blocks ordinary answers gets switched off.

## What this is not

**Not a server.** Nothing here opens a port or speaks to a model. `tools()` and
`callTool()` are the two halves of a surface; wiring them to a transport is a
decision about where a household's data may go, and that belongs to whoever
deploys it rather than to this file. The boundary is stated in the manifest
itself, not only here — a client integrating this is told the terms by the thing
it is integrating.

## What the mutation testing caught

**8 of 8**: the leak guard removed, each of the three patterns defeated, the
records returned instead of counted, an unknown tool answered anyway, an empty
question answered, and the tool list no longer tracking the intents.

## Still not done

- **No transport.** Nothing serves these tools to anything. That is the honest
  state, and the paragraph above says why it is a deployment decision rather
  than a missing feature.
- **Read-only, and only the thirteen.** There is no tool that writes, and there
  will not be one by accident: every tool here is an intent, and no intent
  writes.
- **Brokers remain architecture-only**, as the roadmap has always said, and for
  the same reason as DigiLocker and the Account Aggregator: authorised access
  does not exist, and a connector that pretended otherwise would be the kind of
  claim this project refuses to make.
