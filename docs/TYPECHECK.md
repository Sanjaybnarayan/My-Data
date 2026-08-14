# The Type Check

Phase 1, second tranche. `tsconfig.json`, `tools/typecheck.mjs`, and a `types`
job in CI.

## Checked, never compiled

TypeScript is here as a checker. `noEmit` is on, nothing is transpiled, and
**not one byte of what a browser receives passes through it**. FamilyOS still
ships the JavaScript in this repository as native ES modules with no build step.
Types are expressed in the JSDoc the code already carried.

`typescript` and `@types/node` are `devDependencies`. The application still has
none.

## What the first run found

**500 findings across 25,000 lines that had never been checked.** They were not
500 bugs, and saying so is the point of this document.

| Cause | Count | What it was |
| --- | --- | --- |
| Component JSDoc did not describe its own options | ~300 | Real, and a documentation defect |
| `h()` returns `HTMLElement \| SVGElement` | ~40 | Not a defect — see below |
| Test fixtures pass partial objects | ~100 | Low value |
| Missing `@types/node` | 80 | Configuration |
| Unused imports | 10 | **Real dead code** |
| Undeclared public field on `SyncEngine` | 3 | **Real, and worth fixing** |
| Untyped tuple tables (`[RegExp, string][]`) | ~8 | Documentation |

### The component finding, which was the big one

The checker infers a destructured parameter's type from whichever properties
carry a default. So

```js
export function button(label, { variant, iconName, onClick, type = 'button' })
```

was read as *"an object with an optional `type`, and nothing else"* — and every
one of the ~300 calls passing `variant` was reported as an error. Not a fault in
the calls: a gap in what nine components said about themselves. They now carry
`@param` types, which is better documentation regardless of the checker.

### `SyncEngine.documents`

`app.js` did `sync.documents = store`; `#run` read `this.documents`. A field
that is part of the class's contract existed only as two references in two
files, declared nowhere. Nothing was broken. Nothing said where it came from
either. It is now a declared field with a type.

### The one place `any` is used on purpose

`h()` now returns `any`. The honest signature is `HTMLElement | SVGElement`, and
it was that — but a union is not narrowed by the tag string, so every
`node.value`, `node.click()` and `node.hidden` in the application was reported
against `SVGElement`. Forty of them, none a real defect, all in code that cannot
be wrong: an `input` created two lines above genuinely does have a `value`.

Casting at forty call sites adds noise to working code to satisfy a checker.
Overloading `h` per tag means writing out the HTML element map by hand. So the
seam is drawn in one place, in the open, with the cost written next to it: a
misspelt `node.valeu` will not be caught.

## A budget, not zero

500 → **203**. What remains is mostly test fixtures handing partial objects to
functions that want whole ones.

There were two honest ways to finish and one dishonest one. The dishonest one is
to loosen the config until it reports nothing and call the codebase typechecked.
The honest ones are to fix all 203 now, or to write the number down and refuse
to let it rise.

`tools/typecheck-budget.json` holds the number. CI fails if the count goes up,
and prints the worst files. `node tools/typecheck.mjs --update` lowers it, and
raising it is a diff somebody has to justify.

**What the ratchet will not catch:** a new file with errors of its own, as long
as somebody else removed as many elsewhere. A per-file budget would close that
and would be a hundred numbers to maintain. If the count starts drifting
sideways rather than down, that is the trade to revisit.

A configuration error exits `2` and is never budgeted — the check not running is
worse than the check failing.

## `strict` is off, deliberately

`strict` and `noImplicitAny` produce thousands of "implicitly any" complaints
that are true of every untyped parameter and tell nobody anything.
`noUnusedLocals` and `noFallthroughCasesInSwitch` are different in kind: each
finding is a mistake rather than a missing declaration, and they found ten
pieces of dead code on the first run.

## Not done

- **No linter.** The other half of the roadmap's Phase 1 item. The typechecker
  covers the correctness rules that matter most here (`no-unused-vars`,
  `no-undef`, `no-fallthrough`); what a linter would add on top is style
  consistency, which this codebase already has by hand.
- **`sw.js` is not checked.** `dom` and `webworker` cannot both be in `lib` —
  they declare `self` and `onmessage` with different types, which produces 400
  errors inside TypeScript's own libraries. Checking it needs a second config.
- **`apps-script/` is not checked.** It runs on Google's runtime, not Node's.
