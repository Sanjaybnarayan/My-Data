# The account that was nobody

*An account the household owner had not yet matched to a person could read and
write every record that named nobody — including health records, on entities
whose access list denies the role outright. Binding the account to a person
took that access away. The control ran backwards.*

## The rule, and the two empty strings

`js/security/rbac.js` has a rule the module header states plainly: *"A child
sees their own record. A twelve-year-old can look at their own vaccinations
and their own school fees, and nobody else's."* One table says which field on
each entity names the person a record is about, and one function compares it
to the caller:

```js
// before
function isAbout(actor, entityName, record) {
  const field = SUBJECT_FIELD[entityName];
  if (!field) return false;
  return record[field] === actor.personId;
}
```

Two facts about this application meet on that last line.

**An account not yet matched to a person carries `personId: ''`.** That is the
documented state `admit()` returns for a member the owner has not bound, and
it is the state every account is in until somebody opens Settings → Household
and chooses. It is not an edge case; it is the default.

**Every optional reference left blank is stored as `''`.** Not `undefined` —
`js/data/validate.js:35` normalises it:

```js
ref: (v) => (EMPTY(v) ? '' : String(v).trim()),
```

So an unassigned task stores `assignee: ''`, a note with no author stores
`createdBy: ''`, and a health record naming nobody stores `person: ''`.

`'' === ''` is `true`. Every such row was "about" every unbound account.

## Measured

Through the real validator and the real authorization function:

```
stored assignee                       : ""
unbound child READ  unassigned task   : true
unbound child WRITE unassigned task   : true
bound   child READ  unassigned task   : false
healthRecord person                   : ""
unbound child WRITE health record     : true
```

The third line is the shape of it. **Matching an account to a person made it
more restricted.** An account with no identity at all had more access than one
with an identity, on precisely the entities this rule exists to protect.

And it was not confined to the predicate. `rowFilter` delegates to the same
function, so list queries returned those rows too. Through the repository —
which the module header calls the control, as against the view's *"courtesy"*:

```
created assignee                : ""
unbound child list()            → 1 row
unbound child update()          → ALLOWED
```

A task the household made, listed and rewritten by an account the owner had
never matched to anybody.

## The backend already refused it

`tools/policy.mjs` generates the server's copy of these tables from
`rbac.js`, so the two layers cannot drift on *which* entity has *which*
subject field. The comparison itself is not generated — it is written once in
the template, and it carries the guard:

```js
function ownRecordAllows(personId, entityName, record) {
  if (!personId) return false;
  var field = OWN_RECORD[entityName];
  if (!field) return false;
  return Boolean(record) && record[field] === personId;
}
```

`if (!personId) return false;` — the exact line the client did not have. So
the generated backend was **stricter than the source it was generated from**,
and the hand-written half of the template was silently compensating for a hole
in the half that everything else is derived from. Two layers, one of them
right, and no test comparing them.

## The fix

```js
// An account the owner has not yet matched to a person carries
// `personId: ''`, and `validate.js` normalises every optional `ref` left
// empty to `''` as well. Without this guard those two met as `'' === ''`…
if (!actor.personId) return false;
```

One line, in the one function both `can()` and `rowFilter()` route through,
mirroring the backend's wording so there is one definition of the rule and not
two. Nothing else changed: no table, no access list, no generated policy —
`tools/policy.mjs --check` reports `Policy.gs` up to date.

## What this changes for a household

An account that has not been matched to a person now sees none of its own
records, because the application does not know whose they are. That is the
same answer the server has always given, and the same answer the chat rule
gives: *"this account has not been matched to a person, so it cannot send
messages — the household owner sets that in Settings, Household."* The remedy
was already written and already surfaced; the client was simply not asking.

## Why nothing caught it

2,925 tests passed with the hole open, and all 2,925 still pass with it
closed — so nothing legitimate depended on it, and nothing looked at it.
The existing role tests are careful and thorough, and every one of them gives
its actor a real `personId`:

```js
const child = { personId: 'p3', role: 'child' };
```

The rule was tested against identities that exist. The state where an identity
does not exist yet — the state every account starts in — was never the subject
of a test. Both ends covered, the join between them not: the same sentence
this repository has now written three times.

## Tests

Four, in `tests/security.test.mjs`:

1. An unbound account is about nothing — records built through the **real
   validator**, so the test asserts on the shape the application stores rather
   than one invented for the occasion.
2. No own-record entity lets an unbound account in — iterated from
   `SUBJECT_FIELD` rather than a list beside it, so a new entity is covered
   the day it is added.
3. Matching the account to a person is what grants their own rows — the other
   direction, so the guard cannot be "fixed" by refusing everybody.
4. The repository refuses it, not merely the predicate. *A test of a function
   nothing calls proves the function works and says nothing about the
   application* — this repository's own sentence, and the reason this one goes
   through `db.repo('task')`.

## Mutations

| Mutation | Caught by |
| --- | --- |
| Remove the guard — the original code | 1, 2 and 4 |
| `return false` after it — refuse everybody | 3, plus six existing tests |
| Guard only `null`/`undefined`, missing `''` | 1 and 2 |
| `assert.throws` message changed to one no error carries | 4 fails, so the assertion is not vacuous |

The second mutation is the one worth noting: over-tightening is caught by six
tests that were already there — the staff member reading their own employment
record, the filtered list, the identity review. The door this guard closes is
narrow, and the tests prove it did not close a wider one.
