/**
 * The household's questions, as MCP tools — and the boundary they sit behind.
 *
 * Phase 7 listed MCP as not started. Measuring what starting it would mean
 * turned up an architectural fact worth writing down rather than working
 * around: **there is nowhere in this design for an MCP server to run.** The
 * records are on the device, and the only server this application has is the
 * one the gate decided never holds household records. A hosted MCP server would
 * either have nothing to answer from or would be given the data, which is the
 * single thing the design refuses.
 *
 * So what exists is a tool *surface* for a client on the same device. These
 * checks are mostly about what it will not hand over.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { tools, callTool, toolName, describeSurface } from '../js/ai/mcp.js';
import { intents } from '../js/ai/intents.js';

setSuite('mcp');

/** An assistant stub: the door is under test, not the brain behind it. */
const host = (text, extra = {}) => ({
  answer: async () => ({ text, intent: 'net-worth', ...extra }),
});

describe('the tools are the intents', () => {
  test('every intent is a tool, and no tool is invented', () => {
    // Derived rather than written twice, so a new question is a tool the same
    // day and the two lists cannot drift.
    assert.equal(tools().length, intents.length);
    assert.deep(tools().map((t) => t.name).sort(),
      intents.map((i) => toolName(i.id)).sort());
  });

  test('each names itself in a way a model can pick', () => {
    for (const tool of tools()) {
      assert.ok(/^household_[a-z_]+$/.test(tool.name), tool.name);
      assert.ok(tool.description.length > 20, tool.name);
      assert.deep(tool.inputSchema.required, ['question']);
    }
  });

  test('and says on every one that nothing leaves the device', () => {
    // A client integrating this should be told the boundary by the thing it is
    // integrating, not only by a document it may never read.
    for (const tool of tools()) {
      assert.ok(/no request leaves it/.test(tool.description), tool.name);
    }
    assert.ok(/no request is made to any server/.test(describeSurface().boundary));
  });
});

describe('what a tool will not hand over', () => {
  const call = (text) => callTool('household_net_worth', { question: 'net worth' }, host(text));

  test('a PAN in an answer stops the answer', async () => {
    // This should never fire — the assistant composes its own sentences. That
    // is exactly why it is here: a door checked only when somebody expects
    // trouble is one left open by whoever adds the next intent.
    const out = await call('Your PAN is ABCDE1234F.');
    assert.ok(out.isError, JSON.stringify(out));
    assert.ok(/does not leave this device/.test(out.error), out.error);
  });

  test('an Aadhaar number does too', async () => {
    assert.ok((await call('It is 1234 5678 9012.')).isError);
  });

  test('and a full account number', async () => {
    assert.ok((await call('Account 123456789012345 has money in it.')).isError);
  });

  test('an ordinary answer comes through', async () => {
    const out = await call('Family net worth is ₹42,00,000.');
    assert.not(out.isError, JSON.stringify(out));
    assert.ok(out.text.includes('42,00,000'), out.text);
  });

  test('a year is not mistaken for an identifier', async () => {
    // The guard must not be so eager that it refuses ordinary sentences.
    const out = await call('You spent ₹12,000 in 2026 on fuel.');
    assert.not(out.isError, JSON.stringify(out));
  });

  test('records are counted, never returned', async () => {
    // A caller wanting the records is asking for a copy of the household's
    // data, which is the request this application exists to make unnecessary.
    const out = await callTool('household_net_worth', { question: 'net worth' },
      host('Family net worth is ₹1.', { records: [{ id: 'a', pan: 'ABCDE1234F' }, { id: 'b' }] }));

    assert.deep(out.from, { count: 2 });
    assert.equal(out.records, undefined);
    assert.not(JSON.stringify(out).includes('ABCDE1234F'), JSON.stringify(out));
  });
});

describe('asking for something that is not there', () => {
  test('an unknown tool is refused by name', async () => {
    const out = await callTool('household_everything', { question: 'all of it' }, host('x'));
    assert.ok(out.isError);
    assert.ok(/no such tool/.test(out.error), out.error);
  });

  test('a tool called with no question is refused', async () => {
    const out = await callTool('household_net_worth', {}, host('x'));
    assert.ok(out.isError);
  });

  test('and with only whitespace', async () => {
    assert.ok((await callTool('household_net_worth', { question: '   ' }, host('x'))).isError);
  });
});
