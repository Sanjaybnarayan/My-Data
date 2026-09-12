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

The links alone say nothing about the **end** of a log: delete the last few
entries and what remains still adds up from the beginning. The head each device
records in `meta` is what closes that, by saying how far the chain should have
reached — see "The head, and why it lives in `meta`" below, which is now also
why it is read back.

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

That list was written before the head was read back, and three of its five
entries take the shape the links could not see. A sync that drops rows drops
the newest ones; a restore that half-completes stops partway; and the line
somebody wants gone is usually the last one they wrote. The claim held for the
middle of a log and not for its end, which is where all three land.

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

## Who the log says did it, and who actually did

A row's `actorId`, `actorRole` and `deviceId` are **what the device claimed**.
They are in the signed list above, which is exactly why they are still written
unaltered: a backend that corrected them would break every chain it touched,
and a verifier that fires on honest rows is the cry-wolf failure this whole
design is arranged to avoid.

For most of this project's life they were also all the tab held. `admit` states
the rule — a role and a `personId` "travel with the identity, from here, and
are never taken from the request. A caller telling the backend what role it has
would be a caller granting itself one" — and the audit log was the one place
that rule was not applied. Any member with a token could append a row
attributing a deletion to the owner, from a device id that was never theirs,
and the record meant to say who did what would carry it.

So the deployment now writes its own answer beside the claim:

| column | means |
|---|---|
| `actorId`, `actorRole`, `deviceId` | what the device said, hashed into its chain |
| `seenActor`, `seenRole`, `seenDevice` | who the request actually authenticated as, from the token and the membership list the owner controls |
| `seenAt` | when this deployment received the entry |
| `disputed` | the fields where the two disagree, named |

Neither half substitutes for the other. The chain proves a device's own record
was not edited after the fact; the `seen` columns prove who the backend
actually let in. A row with `disputed` empty is not proof of anything — it
means nothing the server could check disagreed.

Two things are deliberately **not** disputed. `at` is the device's and is
compared with nothing: a phone that wrote an entry an hour before it synced is
the ordinary case, and a column that fires on every honest row is a column
nobody reads. The gap is visible because `seenAt` is written down, not because
it is called an accusation. And an empty `seenActor` — which is what the owner
has until they say which person they are — is "I cannot tell", never "these
differ".

The `seen` columns are outside the chain, because they are not the device's to
sign. That is also their limit: a household that does not trust its own
deployment gains nothing from them.

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

**That sentence was false when it was written, and is true now.** The client
had been sending `id`, `prev` and `hash` on every push since the chain was
built; `auditAppend` wrote nine columns and dropped all three. So the
comparison described here could not have been written — nothing to compare,
and nothing to match a row to the entry it came from — and the paragraph
proposing this tab as the anchor rested on material the backend was throwing
away. The tab carries seventeen columns now, and one made before them is
widened on the next push rather than left behind.

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
