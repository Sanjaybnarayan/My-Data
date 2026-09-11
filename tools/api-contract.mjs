#!/usr/bin/env node
/**
 * The contract between the application and its backend, checked both ways.
 *
 *   node tools/api-contract.mjs           write docs/API_CONTRACTS.md
 *   node tools/api-contract.mjs --check   fail if it has gone stale
 *
 * ## Why this is a tool and not a document
 *
 * FamilyOS and its Apps Script backend are two codebases that have to agree
 * about one list, and they are deployed separately — the browser gets a new
 * client the moment a deploy lands, and the backend changes only when somebody
 * pastes it into script.google.com. So they drift in a particular way: a client
 * that calls an action the deployed backend does not serve gets a 400 with
 * "unknown action", once, in a household's face.
 *
 * They agree today. Both sides name the same sixteen actions, which is the
 * reason to check it rather than a reason not to: it holds by care, and care is
 * what runs out. `tools/policy.mjs` makes the same argument about the access
 * rules and generates them for the same reason.
 *
 * A hand-written API document would have been the other option, and this
 * repository has now found four separate hand-maintained lists that drifted
 * from a derivable one. This is the derivable one.
 *
 * ## What it cannot check
 *
 * Whether the *deployed* backend is the one in this repository. `apps-script/`
 * is source that somebody has to paste, and nothing here can reach the
 * deployment to ask what it is running. `verify` and `ping` exist so the
 * application can ask at runtime; this only checks the two source trees.
 *
 * ## Payload field names, added later, and why
 *
 * This file used to say it checked action names and nothing else: *"a payload
 * that has grown a field fails somewhere further in, and pretending otherwise
 * would be the overclaiming this codebase spends its time avoiding."* That was
 * honest about what it did and wrong about what it could do.
 *
 * The field names are derivable from both sides, the same way the action names
 * are. The client's are the keys of the object literal at each `.call(...)`
 * site; the backend's are the `payload.x` reads in the `dispatch` case, plus
 * those in whatever function that case hands the payload to. So they are
 * checked now, in both directions:
 *
 *   - **the client sends a field the backend never reads** — a request for
 *     something that silently does not happen;
 *   - **the backend reads a field the client never sends** — a capability that
 *     cannot be reached, or a default quietly standing in for a real value.
 *
 * They agreed on all sixteen when this was written, which is the reason to
 * check it rather than a reason not to — the same argument the action names
 * already carried one paragraph up.
 *
 * ## What it still cannot check
 *
 * Whether the *deployed* backend is the one in this repository. `apps-script/`
 * is source that somebody has to paste, and nothing here can reach the
 * deployment to ask what it is running. `verify` and `ping` exist so the
 * application can ask at runtime; this only checks the two source trees.
 *
 * And **names are not shapes**. That a field is called `changes` on both sides
 * says nothing about it being a list, or its elements being objects — which is
 * exactly the defect LIST-01 was, one level in from here. Types and
 * required-ness are not derived, and this does not pretend to.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = join(ROOT, 'apps-script', 'Code.gs');
const DOC = join(ROOT, 'docs', 'API_CONTRACTS.md');

/** Every action the backend's dispatch actually handles. */
export function served(source = readFileSync(BACKEND, 'utf8')) {
  const dispatch = /function dispatch\([\s\S]*?\n}/.exec(source)?.[0] ?? '';
  return [...dispatch.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]).sort();
}

function jsFiles(dir = join(ROOT, 'js'), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(path, out);
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Every action the application asks for, and where it asks. */
export function called(files = jsFiles(), read = readFileSync) {
  const found = new Map();
  for (const path of files) {
    const source = String(read(path, 'utf8'));
    for (const match of source.matchAll(/\.call\(\s*'([a-zA-Z]+)'/g)) {
      const where = relative(ROOT, path).replace(/\\/g, '/');
      if (!found.has(match[1])) found.set(match[1], new Set());
      found.get(match[1]).add(where);
    }
  }
  return found;
}

/**
 * The object literal that starts at `from`, as its top-level key names.
 *
 * Brace-matched rather than matched by a fixed window, because a call site may
 * run to several lines and a window that guesses wrong is a ratchet that cries
 * drift. Returns `null` when there is no literal to read — `call('x', args)`
 * with a variable — which the caller must treat as "cannot tell", never as
 * "sends nothing".
 */
export function objectKeys(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== '{') return null;

  const keys = [];
  let depth = 0;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') { depth += 1; continue; }
    if (c === '}') { depth -= 1; if (depth === 0) return keys; continue; }
    if (depth !== 1) continue;
    // `a,` `a:` `a}` at the top level is a key. `wrapped.key` is not — the
    // identifier before a dot is an object being read, not a field being sent.
    // Only at a token boundary, and never after a dot: `wrapped.key` reads a
    // field off an object, it does not send one. Nothing is skipped by hand —
    // advancing past a match landed mid-identifier and produced `ersonId`.
    if (/[A-Za-z0-9_$.]/.test(source[i - 1] ?? '')) continue;
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*[,:}]/.exec(source.slice(i));
    if (m) keys.push(m[1]);
  }
  return keys;
}

/**
 * A conditional spread — `...(email ? { email } : {})` — puts a real field one
 * level down, so those are read too. `devices` sends `email` this way and
 * nothing else would see it.
 */
function spreadKeys(source, from) {
  const body = balanced(source, from);
  if (body === null) return [];
  const out = [];
  for (const m of body.matchAll(/\.\.\.\([^)]*?\{([^{}]*)\}/g)) {
    for (const k of m[1].matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*[,:}]?/g)) {
      if (k[1]) out.push(k[1]);
    }
  }
  return out;
}

/** The `{...}` starting at `from`, text and all, or null. */
function balanced(source, from) {
  let i = from;
  while (i < source.length && /\s/.test(source[i])) i += 1;
  if (source[i] !== '{') return null;
  const start = i;
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  return null;
}

/**
 * Per action, the payload fields the application sends — and whether every
 * call site could be read at all.
 *
 * `unreadable` is the part that matters: an action whose payload is built
 * somewhere this cannot see must stop the run rather than be reported as
 * sending nothing, which would make every field the backend reads look like
 * drift. The mutation ratchet learned the same lesson from a typo'd suite name.
 */
export function sends(files = jsFiles(), read = readFileSync) {
  const fields = new Map();
  const unreadable = new Set();
  for (const path of files) {
    const source = String(read(path, 'utf8'));
    for (const match of source.matchAll(/\.call\(\s*'([a-zA-Z]+)'\s*,/g)) {
      const action = match[1];
      if (!fields.has(action)) fields.set(action, new Set());
      const at = match.index + match[0].length;
      const keys = objectKeys(source, at);
      if (keys === null) { unreadable.add(action); continue; }
      for (const k of [...keys, ...spreadKeys(source, at)]) fields.get(action).add(k);
    }
  }
  return { fields, unreadable };
}

/**
 * Per action, the payload fields the backend reads: those named in the
 * `dispatch` case itself, plus those in any function the case hands the whole
 * payload to.
 */
export function reads(source = readFileSync(BACKEND, 'utf8'), extra = backendSources()) {
  const all = source + '\n' + extra;
  const dispatch = /function dispatch\([\s\S]*?\n}/.exec(source)?.[0] ?? '';
  const out = new Map();

  const cases = [...dispatch.matchAll(/case '([a-zA-Z]+)':([\s\S]*?)(?=\n    case '|\n  }|$)/g)];
  for (const [, action, body] of cases) {
    const found = new Set([...body.matchAll(/payload\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]));
    /*
     * `handler(payload,` or `handler(payload)` — the case hands the WHOLE
     * payload on, so its reads are this action's reads too.
     *
     * `payload` followed by anything else is a different thing and must not
     * match: `sheetPush(payload.changes, ...)` passes one field, and following
     * it read every `payload.x` inside `sheetPush` — where `payload` is a
     * *record's* payload, not the request's. That reported `_origin` as a
     * field the application fails to send.
     */
    for (const call of body.matchAll(/([a-zA-Z_$][A-Za-z0-9_$]*)\(\s*payload\s*[,)]/g)) {
      for (const f of fieldsRead(all, call[1])) found.add(f);
    }
    out.set(action, found);
  }
  return out;
}

/** Every `payload.x` inside one backend function. */
function fieldsRead(all, fn) {
  const at = all.indexOf('function ' + fn + '(');
  if (at === -1) return [];
  const rest = all.slice(at + 1);
  const end = rest.indexOf('\nfunction ');
  const body = end === -1 ? rest : rest.slice(0, end);
  return [...new Set([...body.matchAll(/payload\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) => m[1]))];
}

/** The other `.gs` files, where most handlers actually live. */
function backendSources(read = readFileSync) {
  return readdirSync(join(ROOT, 'apps-script'))
    .filter((f) => f.endsWith('.gs') && f !== 'Code.gs')
    .map((f) => String(read(join(ROOT, 'apps-script', f), 'utf8')))
    .join('\n');
}

/** Where the two sides disagree about a payload's field names. */
export function fieldDrift(backendReads = reads(), client = sends()) {
  const problems = [];
  for (const [action, read] of backendReads) {
    if (client.unreadable.has(action)) continue;
    const sent = client.fields.get(action);
    if (!sent) continue;
    for (const f of [...sent].sort()) {
      if (!read.has(f)) problems.push(`'${action}' sends '${f}', which the backend never reads`);
    }
    for (const f of [...read].sort()) {
      if (!sent.has(f)) problems.push(`'${action}' reads '${f}', which the application never sends`);
    }
  }
  return problems;
}

/**
 * Everything wrong with the contract, in one list.
 *
 * Exported so a check can drive it. The CLI used to assemble this inline,
 * which meant a check could call `fieldDrift` directly and pass while the
 * command CI actually runs had stopped consulting it. The mutation ratchet
 * found exactly that and refused to call the control held.
 */
export function problems(backend = served(), client = called(),
  backendReads = reads(), payloads = sends()) {
  const { unserved, uncalled } = drift(backend, client);
  return [
    ...unserved.map((a) => `the application calls '${a}', which the backend does not serve`),
    ...uncalled.map((a) => `the backend serves '${a}', which nothing calls`),
    ...fieldDrift(backendReads, payloads),
  ];
}

export function drift(backend = served(), client = called()) {
  const names = [...client.keys()];
  return {
    unserved: names.filter((a) => !backend.includes(a)).sort(),
    uncalled: backend.filter((a) => !client.has(a)).sort(),
  };
}

function document(backend, client, payloads = sends(), backendReads = reads()) {
  const rows = backend.map((action) => {
    const callers = [...(client.get(action) ?? [])].sort();
    return `| \`${action}\` | ${callers.length ? callers.map((c) => `\`${c}\``).join('<br>') : '—'} |`;
  });

  const fieldRows = backend.map((action) => {
    const fields = [...(backendReads.get(action) ?? [])].sort();
    return `| \`${action}\` | ${fields.length ? fields.map((f) => `\`${f}\``).join(' ') : '—'} |`;
  }).join('\n');

  const skipped = [...payloads.unreadable].sort();
  const uncompared = skipped.length
    ? `**Not compared for ${skipped.map((a) => `\`${a}\``).join(' and ')}.** At least one\n`
      + 'call site builds the payload from a variable rather than a literal, so this\n'
      + 'cannot read the field names — and says so rather than assuming there are none.\n\n'
    : '';

  return `# The backend contract

Generated by \`tools/api-contract.mjs\`. Do not edit — run the tool.

The application and \`apps-script/\` are two codebases that must agree about one
list of action names, and they are deployed separately: a browser gets a new
client the moment a deploy lands, while the backend changes only when somebody
pastes it into script.google.com. A client calling an action the deployed
backend does not serve gets \`unknown action\` and a 400, once, in a household's
face.

Every request is one POST to the deployment's \`/exec\`:

\`\`\`
{ action, token, deviceId, clientVersion, payload }
\`\`\`

## The ${backend.length} actions, and who asks for them

| Action | Called from |
|---|---|
${rows.join('\n')}

## Payload fields, per action

Derived from both sides and checked in both directions: the keys of the object
literal at each \`.call()\` site, against the \`payload.x\` reads in the
\`dispatch\` case and in whatever function that case hands the payload to. A
field present on one side and missing from the other fails the run.

| Action | Fields |
|---|---|
${fieldRows}

${uncompared}## What this does not tell you

**Whether the deployed backend is this one.** \`apps-script/\` is source that
somebody pastes into a script editor; nothing in this repository can reach the
deployment to ask what version it is running. \`ping\` and \`verify\` exist so the
application can ask at runtime.

**Names are not shapes.** That a field is called \`changes\` on both sides says
nothing about it being a list, or its elements being objects — which is exactly
what LIST-01 turned out to be, one level in from here. Types and required-ness
are not derived, and this does not pretend to.
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const backend = served();
  const client = called();
  const payloads = sends();
  const wrong = problems(backend, client, reads(), payloads);

  if (wrong.length) {
    console.error('The application and the backend disagree:\n');
    for (const one of wrong) console.error(`  ${one}`);
    process.exit(1);
  }

  // Said rather than skipped silently. An action whose payload is built from a
  // variable at some call site cannot be compared, and a reader is entitled to
  // know which ones this tool is not covering.
  if (payloads.unreadable.size) {
    console.log(`fields not compared for ${[...payloads.unreadable].sort().join(', ')}`
      + ' — built from a variable at a call site');
  }

  const text = document(backend, client);

  if (process.argv.includes('--check')) {
    const current = (() => { try { return readFileSync(DOC, 'utf8'); } catch { return ''; } })();
    if (current !== text) {
      console.error('docs/API_CONTRACTS.md is stale — run `node tools/api-contract.mjs`');
      process.exit(1);
    }
    console.log(`docs/API_CONTRACTS.md is up to date — ${backend.length} actions`);
  } else {
    writeFileSync(DOC, text);
    console.log(`wrote docs/API_CONTRACTS.md — ${backend.length} actions, `
      + `${[...client.values()].reduce((n, s) => n + s.size, 0)} call sites`);
  }
}
