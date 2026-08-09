#!/usr/bin/env node
/**
 * Fold FamilyOS into one HTML file.
 *
 *   node tools/bundle.mjs [out.html]
 *
 * The app is served as native ES modules, which is the right shape for a thing
 * you deploy and the wrong shape for a thing you hand somebody. This produces a
 * single file that opens on any HTTPS origin with no server, no build step at
 * the other end and nothing fetched at runtime — for previewing the app, and
 * for handing it to someone who should not have to clone a repository first.
 *
 * ## How
 *
 * Not a general bundler, and it does not try to be. It relies on three facts
 * that are true of this codebase and checked rather than assumed:
 *
 *   - every import is a static relative path or a literal dynamic `import()`;
 *   - the only export forms are `function`, `const`, `class` and `export {}` —
 *     no default exports and no `export *`;
 *   - the static import graph has no cycles.
 *
 * Each module becomes a factory in a registry, instantiated on first require.
 * Laziness is what makes the dynamic imports work unchanged: a route loaded
 * with `import('./modules/finance.js')` becomes a resolved promise over the
 * same registry, so the router keeps its shape.
 *
 * ## What the single file gives up
 *
 * The service worker, and therefore offline. A worker has to be its own file
 * at its own URL — that is the whole mechanism — so a one-file build cannot
 * have one, and `sw.js` is deliberately left out rather than half-included.
 * Everything else works: the encryption, IndexedDB, the importer, reports.
 *
 * This is a preview build. Real records belong in a real deployment, where the
 * worker exists and the browser storage is the household's own.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'js/app.js';

/* ------------------------------------------------------------- collecting */

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const id = (from, specifier) => normalize(join(dirname(from), specifier)).replace(/\\/g, '/');

/* ------------------------------------------------------------ transforming */

/**
 * Rewrite one module into a registry factory.
 *
 * The rewrites are deliberately narrow. Anything this does not recognise is
 * left alone and then caught by the audit below, because a bundler that
 * silently half-understands a file produces a page that loads and then behaves
 * differently from the application it claims to be.
 */
function transform(path, source) {
  const exported = new Map(); // exported name -> local name
  let code = source;

  // import { a, b as c } from './x.js'   →   const { a, b: c } = __req('id')
  code = code.replace(
    /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/gm,
    (_, names, specifier) => {
      const bindings = names.split(',').map((n) => n.trim()).filter(Boolean)
        .map((n) => n.replace(/\s+as\s+/, ': '))
        .join(', ');
      return `const { ${bindings} } = __req(${JSON.stringify(id(path, specifier))});`;
    },
  );

  // import * as ns from './x.js'   →   const ns = __req('id')
  code = code.replace(
    /^import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"];?/gm,
    (_, name, specifier) => `const ${name} = __req(${JSON.stringify(id(path, specifier))});`,
  );

  // export { a, b as c } from './x.js'   →   const { a, b: c } = __req('id')
  //
  // Before the plain `export {}` rule below, which would otherwise match the
  // first half of this and leave ` from './x.js';` behind as a line of its
  // own. That is a syntax error, and it is not one the audit noticed, because
  // the wreckage starts with a space and the audit only looked at column zero.
  // The whole bundle failed to parse, the page stopped at "Opening your
  // records…", and the build reported success.
  code = code.replace(
    /^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/gm,
    (_, names, specifier) => {
      const bindings = [];
      for (const part of names.split(',').map((n) => n.trim()).filter(Boolean)) {
        const [local, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
        // Re-exported under the name it arrives with, then handed on: the
        // binding has to exist locally for the factory's return to name it.
        exported.set(alias ?? local, alias ?? local);
        bindings.push(alias ? `${local}: ${alias}` : local);
      }
      return `const { ${bindings.join(', ')} } = __req(${JSON.stringify(id(path, specifier))});`;
    },
  );

  // export { a, b as c };
  code = code.replace(/^export\s*\{([^}]*)\};?/gm, (_, names) => {
    for (const part of names.split(',').map((n) => n.trim()).filter(Boolean)) {
      const [local, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      exported.set(alias ?? local, local);
    }
    return '';
  });

  // export function f / export async function f / export class C
  code = code.replace(/^export\s+(async\s+function|function|class)\s+(\w+)/gm, (_, kind, name) => {
    exported.set(name, name);
    return `${kind} ${name}`;
  });

  // export const a = …, b = …
  code = code.replace(/^export\s+(const|let|var)\s+([^\n]*)/gm, (_, kind, rest) => {
    for (const name of declaredNames(rest)) exported.set(name, name);
    return `${kind} ${rest}`;
  });

  // import('./x.js')   →   __dyn('id')
  code = code.replace(
    /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    (_, specifier) => `__dyn(${JSON.stringify(id(path, specifier))})`,
  );

  const returns = [...exported.entries()]
    .map(([name, local]) => (name === local ? name : `${JSON.stringify(name)}: ${local}`))
    .join(', ');

  return {
    exported,
    factory: `__def(${JSON.stringify(path)}, () => {\n${code}\nreturn { ${returns} };\n});`,
  };
}

/**
 * The names a `const a = …, b = …` declaration actually binds.
 *
 * Depth matters and is the whole reason this is not a regular expression.
 * `export const $ = (selector, root = document) => …` contains a second
 * `name =` inside the parameter list, and reading that as a declarator makes
 * the module claim to export a `root` it never defines — a bundle that loads
 * and then dies on the first import of it.
 */
function declaredNames(declaration) {
  const names = [];
  let depth = 0;
  let start = 0;

  const take = (clause) => {
    const name = /^\s*([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (name) names.push(name);
  };

  for (let i = 0; i < declaration.length; i++) {
    const char = declaration[i];
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === ',' && depth === 0) {
      take(declaration.slice(start, i));
      start = i + 1;
    }
  }
  take(declaration.slice(start));
  return names;
}

/**
 * Refuse to emit a bundle built on an assumption that has stopped holding.
 *
 * Every one of these would produce a file that loads and then misbehaves in a
 * way nobody would connect back to the build, which is the failure worth
 * spending a few lines to make impossible.
 */
function audit(path, code, exported) {
  const problems = [];

  // Only column zero counts. `export` also appears as an object key in this
  // codebase — `export: 'export'` in the audit-action list — and indented, so
  // anchoring to the start of the line is the difference between a real
  // statement and a property that happens to share the word.
  if (/^(import|export)\s/m.test(code)) {
    const line = code.split('\n').find((l) => /^(import|export)\s/.test(l));
    problems.push(`an import or export this build does not understand: ${line.trim()}`);
  }

  // A module specifier with nothing in front of it. Anchoring the rule above
  // at column zero is right, and it is also why this is needed: a rewrite that
  // consumes the front of a statement leaves its tail indented, so the tail of
  // a half-eaten `export {…} from './x.js'` slipped past unseen. Whatever
  // produced it, a bare `from './x.js'` is never valid JavaScript.
  const dangling = code.split('\n').find((l) => /^\s+from\s*['"][^'"]+['"];?\s*$/.test(l));
  if (dangling) {
    problems.push(`a statement this build rewrote only half of: ${dangling.trim()}`);
  }

  // Comments discuss `import()` — the router's header explains that routes are
  // loaded with one — so they are stripped before looking for a real call.
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  if (/\bimport\s*\(/.test(bare)) problems.push('a dynamic import with a non-literal specifier');

  if (!exported.size) problems.push('no exports found — the module would be empty');
  return problems.map((problem) => `${path}: ${problem}`);
}

/* ------------------------------------------------------------------ build */

const modules = walk('js');
const factories = [];
const problems = [];
let exportCount = 0;

for (const path of modules) {
  const source = readFileSync(join(ROOT, path), 'utf8');
  const { factory, exported } = transform(path, source);
  problems.push(...audit(path, factory, exported));
  exportCount += exported.size;
  factories.push(factory);
}

if (problems.length) {
  console.error('This build would not be the application it claims to be:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const css = ['tokens', 'base', 'components']
  .map((name) => readFileSync(join(ROOT, `css/${name}.css`), 'utf8'))
  .join('\n');

const icon = readFileSync(join(ROOT, 'assets/icon.svg'), 'utf8');
const shell = readFileSync(join(ROOT, 'index.html'), 'utf8');

// The body exactly as the deployed app has it, so the first paint matches.
const body = /<div id="app">([\s\S]*?)<\/div>\s*<script type="module"/.exec(shell)?.[1] ?? '';
const themeScript = /<script>([\s\S]*?)<\/script>/.exec(shell)?.[1] ?? '';

const runtime = `
/* This build is one file, so there is no worker URL to register. */
globalThis.__FAMILYOS_SINGLE_FILE__ = true;

/*
 * A module registry, not a module system. Factories are instantiated on first
 * require and cached, which is what lets a route loaded through a dynamic
 * import resolve against the same instance as a static one.
 */
const __f = new Map();
const __c = new Map();
const __def = (id, factory) => __f.set(id, factory);
function __req(id) {
  if (__c.has(id)) return __c.get(id);
  const factory = __f.get(id);
  if (!factory) throw new Error('FamilyOS bundle is missing ' + id);
  // Seeded before the factory runs so a future cycle fails loudly here rather
  // than recursing until the stack gives out.
  __c.set(id, {});
  const exports = factory();
  __c.set(id, exports);
  return exports;
}
const __dyn = (id) => Promise.resolve(__req(id));
`;

const moduleSource = `${runtime}
${factories.join('\n\n')}
__req(${JSON.stringify(ENTRY)});`;

/*
 * Does the thing we are about to write actually parse?
 *
 * The per-module audit checks assumptions about the *input*. This checks the
 * output, which is the only claim that matters and the one nothing was making:
 * a rewrite that left a half-eaten statement behind produced a bundle that
 * could not parse at all, and the build printed its module count and reported
 * success. The page loaded, showed "Opening your records…", and stopped.
 *
 * `SourceTextModule` compiles without evaluating, so this is a parse and not a
 * run. It needs `--experimental-vm-modules`, and a build should not depend on
 * a flag the person running it has to remember, so a child process supplies it.
 */
function parses(source) {
  const check = 'import vm from "node:vm";'
    + 'import fs from "node:fs";'
    + 'try { new vm.SourceTextModule(fs.readFileSync(process.env.BUNDLE_CHECK, "utf8")); }'
    + 'catch (err) { process.stdout.write(err.message); }';

  const scratch = join(tmpdir(), `familyos-bundle-${process.pid}.mjs`);
  writeFileSync(scratch, source);
  try {
    return execFileSync(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', check],
      { env: { ...process.env, BUNDLE_CHECK: scratch }, encoding: 'utf8' },
    ).trim();
  } finally {
    rmSync(scratch, { force: true });
  }
}

const failure = parses(moduleSource);
if (failure) {
  console.error(`\nThe bundle does not parse: ${failure}`);
  console.error('Nothing was written. Run `node --check` on the emitted script to locate it.');
  process.exit(1);
}

const script = `<script type="module">
${moduleSource}
<\/script>`;

/*
 * Two shapes of the same build.
 *
 * A whole document for a file somebody opens or a host serves; a fragment for
 * an embedder that supplies its own `<head>` and `<body>`. The fragment keeps
 * the theme script — the flash of white before the first paint is worth one
 * inline block either way — but has to guard the meta lookup, because the
 * theme-color tag it updates only exists in the full document.
 */
const fragment = process.argv.includes('--fragment');

const html = fragment
  ? `<title>FamilyOS</title>
<style>
${css}
</style>
<script>${themeScript.replace(
    /document\.querySelector\('meta\[name="theme-color"\]'\)/g,
    `(document.querySelector('meta[name="theme-color"]') || { setAttribute() {} })`,
  )}<\/script>
<div id="app">${body}</div>
${script}
`
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FamilyOS</title>
<meta name="description" content="A private, offline-first record keeper for your household.">
<meta name="theme-color" content="#fbfbfc">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}">
<style>
${css}
</style>
<script>${themeScript}<\/script>
</head>
<body>
<div id="app">${body}</div>
${script}
</body>
</html>
`;

const out = process.argv.find((a) => a.endsWith('.html'))
  ?? join(ROOT, 'dist', fragment ? 'familyos.fragment.html' : 'familyos.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);

console.log(`${relative(process.cwd(), out)}`);
console.log(`  ${modules.length} modules, ${exportCount} exports, ${(html.length / 1024 / 1024).toFixed(2)} MB`);
