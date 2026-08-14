# The Two Authorization Layers Now Agree

Phase 1. `js/security/rbac.js`, `tools/policy.mjs`, `apps-script/Policy.gs`,
`apps-script/Code.gs`, `apps-script/Sheets.gs`, tested in `tests/policy.test.mjs`
and `tests/backend.test.mjs`.

## The gap, as the earlier tranche recorded it

`docs/SERVER_AUTHORIZATION.md` closed with this, unfixed:

> **The two layers do not agree, and the browser is the looser one.**
> `rbac.js` has `GUEST_READABLE` and `OWN_RECORD_ENTITIES` rules with no server
> counterpart. […] Reconciling them is real work and is not done.

Measured across all 35 entities and 5 roles, the blanket rules disagreed in
exactly **one** place. The real divergence only appears once a *record* is in
hand — the own-record rule — and there it is fourteen combinations:

```
  entity                 action  browser  server   consequence
  person                read    allow    deny     shown on screen, never syncs down
  person                write   allow    deny     written locally, never syncs up
  healthRecord          read    allow    deny     shown on screen, never syncs down
  healthRecord          write   allow    deny     written locally, never syncs up
  medication            read/write   allow    deny
  vaccination           read/write   allow    deny
  appointment           write   allow    deny
  education             write   allow    deny
  certificate           write   allow    deny
  task / note / event   write   allow    deny
```

## It was not silent, and saying so matters

The first thing I wrote down was "silent data loss". Checking the sync before
claiming it showed that is **wrong**: a rejected push is not retried, it parks
with the server's reason attached, and Settings → Sync shows a *Stuck* count, a
*See what is stuck* button and each entry's `lastError`.

So the honest finding is narrower and still bad: **the browser offered an action
the server would always refuse.** A child recording their own medication got a
row that lived on one device forever and surfaced in a diagnostics screen. Not
loss — a guaranteed dead end.

## Why the server could not enforce it

It had nothing to enforce it *with*. `admit()` establishes the caller's email
and role from the members list, and stops there. An own-record rule needs
`record.person === <the caller's person>`, and the server had no idea which
person a Google account was.

That is the root of the divergence, and it is why widening the ACLs would have
been the wrong fix — the rule is per-row, not per-role.

## What was built

**One description, generated across.** `OWN_RECORD_ENTITIES` and
`SUBJECT_FIELD` were already in `rbac.js`; they are now exported, and
`tools/policy.mjs` emits them into `Policy.gs` beside the ACL table. The
existing drift check fails when the copy goes stale, exactly as it does for the
ACLs — the same reasoning that file already gives for why generating beats
sending or hand-writing.

**An owner-controlled identity binding.** A member entry gains `personId`,
settable only by the owner, because only the owner can write that list. It
travels with the identity out of `admit()` and is never read from the request —
the same rule the role already follows, and for the same reason: *a caller
naming the person they are would be a caller claiming somebody else's records.*
An entry written before this existed has none, and absent means **no**
own-record access rather than all of it.

**Enforcement in both directions.** Push consults the own-record rule where the
blanket policy refuses. Pull no longer skips the entity wholesale; it filters
per row, so a child's own health record reaches their device and a sibling's
does not.

**It only ever widens.** Nothing in the new rule can refuse what the blanket
policy allowed. An owner still reads every row, and a test asserts it.

## `person` is deliberately excluded from the server rule

The security property, and the one piece of asymmetry that stays.

The server maps an email to a person id through the members list. If somebody
could edit their own `person` row through the own-record rule, they could edit
the thing that identifies them, and the mapping would stop being
owner-controlled. So the browser lets a person open their own record and the
backend does not carry that across. Two tests assert it — that `person` is
absent from the generated table, and that `ownRecordAllows` refuses it.

## What mutation testing found

Seven mutations, six caught.

| Mutation | Caught by |
| --- | --- |
| **Push ignores the own-record rule** (the original gap) | *a child may push their own health record* |
| **Push accepts any row once the entity is own-record** | *and a sibling's is still refused* |
| **Pull sends every row, not only the caller's** | *pulled their own rows and not a sibling's* |
| **Own-record narrows the blanket rule instead of widening it** | *an owner still reads everything* |
| **`person` becomes reachable through the rule** | *the person record is deliberately not reachable* |
| **`personId` defaults to something other than empty** | **survived** — now caught |
| **Pull falls back to sending everything with no subject column** | **survived** — kept and annotated |

The first survivor was a real coverage gap: nothing asserted that `admit()`
carries the person id *from the list*. A test now pins both halves — a bound
member gets theirs, an older entry gets `''`.

The second is genuinely redundant today: with the guard removed,
`values[r][-1]` reads as `undefined` and matches nobody, so the outcome is the
same. That is an accident of a loose comparison rather than a rule, and it
would stop holding the moment somebody made the comparison lenient — so the
guard stays, annotated with why it looks dead.

## Two fixture errors, both of which looked like failures

**The push test failed with `setValues is not a function`.** That was the fix
working: the row got *past* authorization and reached the sheet write, which the
fake sheet could not do. The fake is writable now.

**A `createdBy` check looked like a finding.** `SUBJECT_FIELD` names
`createdBy` for notes and events, and it is not a schema field — which briefly
looked like a browser rule that could never match. It is an *envelope* key the
repository writes from `actor.personId`, so it works and travels in the payload.
No finding; I was looking in the wrong place.

## Still divergent, deliberately

- **`guest` may read `emergencyContact` on the device and the server will not
  send it.** The browser rule exists so somebody in the house during an
  emergency can see contacts, and it works locally. Making the server send them
  widens what leaves the workbook for the least-trusted role, which is a
  decision worth taking on its own rather than as a side effect of this.
- **`person`**, for the reason above. This one should not be reconciled.

## Not done

- **No migration binds existing members to people.** Every entry starts with no
  `personId`, so nothing changes until an owner sets one on the Settings screen.
  That is the safe direction, and it does mean the feature is inert on upgrade
  until somebody opts in.
- **The browser does not know about the server's `person` exclusion.** It will
  still offer a child their own person record, and that push will still park.
  One divergence remains, now with a reason attached.
- **Nothing verifies the backend end to end.** `tests/policy.test.mjs` evaluates
  the real `.gs` files against stubs, which is as close as this repository gets
  without a deployment.
