# Tamper-evidence for the audit trail

## What was measured first

Against the real database, before any of this existed:

```
audit entries      : 2
after tampering    : 1 entries
altered entry actor: somebody-else
anything notices?  : NO VERIFIER EXISTS
```

One entry rewritten to name a different person, another deleted outright, and
nothing anywhere could tell. `docs/COMPLIANCE/ELECTRONIC_RECORDS.md` had said so
all along: the audit trail established **history**, not **tamper-evidence**.

## What this is, in one sentence

Each audit entry carries the hash of the entry before it from the same device,
so altering one, deleting one, or inserting one can be **detected afterwards**.

## What it does not do — read this before repeating the claim anywhere

**It does not prevent anything.** It makes tampering visible. The word is
*evidence*, never *proof*.

**It is defeated by one specific attacker: somebody who can write to this
database and recompute the chain.** That is anybody who can unlock the
application, because nothing here is signed with a key such a person would not
also have. A hash chain inside the same database it is protecting cannot do
better than this, and no amount of extra hashing would change it.

What it *does* defend against is everything else, which is most of what
actually happens: a careless edit, a buggy migration, a sync that drops rows,
a restore that half-completes, and somebody quietly deleting the line that
records what they did without realising it is chained.

`tests/chain.test.mjs` asserts the limit as well as the capability. One test
recomputes a chain around an altered entry and requires verification to
**pass** — so if that ever starts failing, the claim here is understated rather
than wrong, and somebody will notice.

## One chain per device

Audit entries are written on every device and synced. A single global chain
would need a global write order, and two phones appending offline do not have
one — the chain would break every time somebody used a second device.

A verifier that cries wolf is a verifier nobody reads, so each device chains
its own entries. `deviceId` was already on every row. `verify()` reports each
device separately, and one broken device does not clear the others.

## What is hashed, and what deliberately is not

Signed: `id`, `at`, `action`, `entity`, `recordId`, `actorId`, `actorRole`,
`fields`, `detail`, `deviceId` — plus the previous hash, so an entry's
*position* is signed too, not only its content.

Not signed:

- **`synced`** flips from false to true after the entry is written. Hashing it
  would break every chain the first time it synced — the same cry-wolf failure
  as one global chain.
- **`hash` and `prev`**, because an entry cannot contain its own hash.

Key order is fixed by an explicit list rather than `Object.keys`, and `detail`
has its keys sorted, because the same detail built in two orders would
otherwise hash two ways and an honest entry would read as tampered.

## The head, and why it lives in `meta`

The head is written **in the same transaction as the entry**. That is the point
of it being there rather than a field on the database object: a transaction
that rolls back must not leave the head pointing at an entry nobody has, or the
next honest entry chains to nothing and an untampered log reads as broken.

The in-memory head is dropped when a transaction fails, so the next write
re-reads the committed one.

A mutation caught a real hole here. The test named "a refused write does not
leave a gap" did not reach that rollback at all: an integrity refusal throws
*before* the entry is planned, so the head never moves. The case that matters —
planned, head advanced, transaction then failed — needed a test that makes the
transaction itself fail, and now has one.

## Entries written before this existed

Counted and reported as `unchained`, not condemned. They cannot be verified,
which is a different fact from having been altered, and a verifier that calls
every older database tampered tells nobody anything.

## What would make this worth more

An **anchor outside the device**: the head hash written somewhere the same
person cannot rewrite. Then a local rewrite is detectable by comparison, and
the attacker this chain cannot stop would have to reach two places instead of
one.

The natural anchor already half exists. Audit entries replicate to an
append-only `_Audit` tab where nothing in the client ever issues an update or a
delete, and they now carry their hashes with them. Comparing a local chain
against that copy would close most of the gap.

**It is not built.** Doing it properly means deciding what happens when the two
disagree — which is a question about trust between a household's devices and
its own backend, not a question about hashing — and it would touch the sync
contract that `tools/api-contract.mjs` checks. Until it is built, this document
claims exactly what the code does and no more.

## Status

`ELECTRONIC_RECORDS/tamper-evidence` moves from `NOT_STARTED` to **`TESTED`**,
with the gap above recorded on the control itself.

It is **not** `VERIFIED`, and cannot be. Verification means somebody qualified
checked the control against the obligation and signed their name to it. Nobody
has, `tools/compliance.mjs` refuses a `VERIFIED` row, and no control in this
repository is one.

**12 of 12 mutations caught**, including *the previous hash dropped from the
digest*, *`actorId` dropped from the signed fields*, *the orphan, fork and
no-beginning checks removed*, *one global chain instead of one per device*, and
*the head not rolled back after a failed transaction* — which survived the
first round and named a test that was not testing what its name said.
