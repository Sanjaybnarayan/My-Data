# "No Transactions Are Recorded" — When There Were Some

`js/ai/assistant.js`, `tests/ai.test.mjs`.

## The rule this breaks

v6.0: **never silently ignore sync, AI-extraction or reconciliation errors**,
and **AI confidence is not verification**.

## What was found

`Assistant.load` read a store and swallowed every failure:

```js
try {
  rows = await this.#db.repo(entityName).list({ limit: 10_000 });
} catch {
  rows = []; // no permission: the answer is computed without it
}
```

The comment names one cause and the code catches all of them. A role that may
not read transactions legitimately contributes nothing, and answering without
it is the design — `PermissionError` is a fact about what somebody is allowed
to see. A decryption failure, a corrupt row, or IndexedDB refusing is not an
absence of records. It is an inability to read the ones that exist.

Computing over `[]` turns that into a statement about the household's money.
Measured, with `list` throwing a decryption error:

```
Q: How much did we spend this year?
A: No transactions are recorded between 1 Jan 2026 and 31 Dec 2026.
```

False, confident, and **word for word what a household with no records is
told**. Nothing in the `Answer` shape could have said otherwise: it is
`{ text, intent, ... }`, and the only caveat anywhere in the file is about
valuations.

## What changed

The two are already distinguishable — `core/errors.js` gives `PermissionError`
the code `'permission'`. A refusal still yields an empty list and an answer.
Anything else is recorded in `#unreadable`, and `answer` **refuses**:

> I could not read your transaction records, so I cannot answer that. This is
> not the same as having none — something went wrong reading them.

Refuses rather than caveats, deliberately. A number computed over records that
could not be read is not a number a household should weigh, and this is the
file whose whole premise is that confidence is not verification.

## How it is checked

`tests/ai.test.mjs`, five cases in two directions:

- a read failure is refused, not answered;
- it says which records it could not read;
- and that this is not the same as having none;
- a **permission refusal still answers**, because that empty is real;
- a household with genuinely no records is still told so.

The last two are not decoration. Without them the guard is satisfied by
refusing every question, which would break the design where a restricted role
still gets an answer from what it may see.

Mutation-tested both ways:

```
swallow both again (the original)     3 FAIL  the three refusal cases
refuse on every failure, permission   1 FAIL  a permission refusal still answers
```

## What this does not establish

Whether any of the failures this now catches actually happen. No decryption
error has been observed on a household's device; the fault is that if one
occurred, the application would have reported an absence of money rather than
an inability to read it. This makes the failure loud, not less likely.

The refusal covers what an intent loads through `load`. An intent reaching the
database another way — `search`, or a service of its own — is outside it, and
`this.#db.search` is one such path.
