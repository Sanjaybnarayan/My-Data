/**
 * The household's questions, as MCP tools.
 *
 * ## The architectural finding, before the code
 *
 * Phase 7 lists MCP as not started, and measuring what "starting" it would mean
 * turned up something worth writing down rather than working around.
 *
 * **There is nowhere in this architecture for an MCP server to run.** The
 * records live on the device, in IndexedDB, behind a key the browser holds. The
 * only server this application has is the Apps Script deployment, and the gate
 * decided — deliberately, and it is the whole of the privacy claim — that it
 * *never holds household records*. So a hosted MCP server would either have no
 * data to answer from, or would be given the data, which is the one thing the
 * design refuses.
 *
 * That is not a gap to be filled by trying harder. It is what the answer to the
 * gate question costs, and it was accepted knowingly.
 *
 * ## What is honest, and is here
 *
 * MCP is a protocol, not a hosting model. A **client running on the same
 * device** — a desktop assistant the household already trusts with their files
 * — can be handed a tool surface that answers from the local database and
 * never transmits a record. That is the same bargain `ai/assistant.js` already
 * makes, and this is its tool-shaped face:
 *
 *   - the tools are **derived from the intent registry**, not written twice, so
 *     a new question is a tool the same day and neither list can drift;
 *   - answers come back as **sentences and figures**, never as records — the
 *     assistant's own contract;
 *   - anything a tool returns has been through the same masking the screens
 *     use, so a document number cannot leave by this door either.
 *
 * ## What this deliberately is not
 *
 * It is **not a server**, and nothing here opens a port or speaks to a model.
 * `tools()` and `callTool()` are the two halves of the surface; wiring them to a
 * transport is a decision about where a household's data may go, and that
 * belongs to whoever deploys it rather than to this file.
 */

import { intents, exampleQuestions } from './intents.js';
import { Assistant } from './assistant.js';

/**
 * Sensitive shapes, refused on the way out.
 *
 * The assistant returns sentences it composed, so this should never fire — and
 * that is exactly why it is here. A door that is checked only when somebody
 * expects trouble is a door that gets left open when a new intent is added by
 * somebody who did not read this file.
 */
const NEVER_LEAVES = [
  // PAN, Aadhaar, an account number long enough to transact with.
  /\b[A-Z]{5}[0-9]{4}[A-Z]\b/,
  /\b\d{4}\s?\d{4}\s?\d{4}\b/,
  /\b\d{12,18}\b/,
];

/** An intent id, as a tool name. */
export function toolName(intentId) {
  return `household_${String(intentId).replace(/-/g, '_')}`;
}

/**
 * The tool list, derived from the intents rather than written beside them.
 *
 * Every tool takes the same argument — the question, in words — because that is
 * what the intent engine matches on. Giving each tool a bespoke schema would be
 * a second parser to keep in step with the first, and the first is the one
 * that has tests.
 */
export function tools() {
  return intents.map((intent) => ({
    name: toolName(intent.id),
    description: `${describeIntent(intent)} Answered from records on this device; `
      + 'no request leaves it.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: `The question, in words. For example: ${intent.examples[0]}`,
        },
      },
      required: ['question'],
    },
  }));
}

function describeIntent(intent) {
  const [first] = intent.examples ?? [];
  return first ? `Answers questions like “${first}”.` : `Answers ${intent.id} questions.`;
}

/**
 * Run a tool, and refuse to return anything that should not leave.
 *
 * @param {string} name
 * @param {{question?: string}} args
 * @param {{answer: (q: string) => Promise<object>}|{db: object, clock?: () => number}} host
 *   anything that can answer a question — an `Assistant`, or the database to
 *   build one from
 */
export async function callTool(name, args, host) {
  const intent = intents.find((candidate) => toolName(candidate.id) === name);
  if (!intent) {
    return { error: `no such tool: ${name}`, isError: true };
  }

  const question = String(args?.question ?? '').trim();
  if (!question) {
    return { error: 'ask a question in words', isError: true };
  }

  // The assistant does the work. This adds a door, not a second brain: every
  // rule about what an answer may contain already lives there, and a parallel
  // implementation would be a second set of them to keep in step.
  // Anything that can answer a question. `Assistant` is the one that does in
  // the application; taking the capability rather than the class is what lets
  // this door be tested without standing a database up behind it, and the door
  // is the part with the rules on it.
  const answerer = /** @type {any} */ (host);
  const assistant = typeof answerer?.answer === 'function' ? answerer : new Assistant(answerer);
  const result = await assistant.answer(question);
  const text = String(result?.text ?? '');

  // The refusal is on the way *out*, not on the way in. What a question asks
  // for matters less than what an answer carries, and only the answer can be
  // checked against what it actually contains.
  const leaked = NEVER_LEAVES.find((pattern) => pattern.test(text));
  if (leaked) {
    return {
      error: 'that answer carried something that does not leave this device',
      isError: true,
    };
  }

  return {
    // Sentences and figures. Never the records themselves — a caller wanting
    // those is asking for a copy of the household's data, which is the request
    // this whole application exists to make unnecessary.
    text,
    intent: result?.intent ?? null,
    // What it was worked out from, by name and count only. Enough to say "this
    // came from eleven transactions" and not enough to reconstruct them.
    from: Array.isArray(result?.records)
      ? { count: result.records.length }
      : null,
  };
}

/** What to tell a client that asks what this can do. */
export function describeSurface() {
  return {
    tools: tools().length,
    examples: exampleQuestions(),
    // Said in the manifest, not only in a document. A client integrating this
    // should be told the boundary by the thing it is integrating.
    boundary: 'These tools answer from records held on this device and return '
      + 'sentences and figures only. No record, document number or identifier '
      + 'is returned, and no request is made to any server.',
  };
}
