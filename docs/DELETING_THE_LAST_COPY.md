# Deleting The Last Copy

`js/sync/drive.js`, `tests/prune.test.mjs`.

## The rule this touches

v6.0: **preserve source data; never overwrite original documents**, and
**never silently lose data**.

## What was found

Two things, and they are worth keeping apart.

### 1. An unverified safety claim

`DocumentStore.pruneUploaded` frees device storage by deleting the local copy
of a document. Its justification was written into the method's own comment:

> Only ever removes a blob whose upload is confirmed — the point of the cache
> is that the original still exists somewhere.

That was inferred from `blob.uploaded` — one flag, on the blob, set by `flush`.
The flag says an upload happened. It does not say the file is still
**reachable**. Recovery goes through `fetchFromDrive`, which needs
`document.driveFileId`, and that pointer lives on a *different record*:

```js
async fetchFromDrive(documentId) {
  const document = await this.#db.repo('document').get(documentId);
  if (!document?.driveFileId) return null;
```

Sync can replace that record wholesale — `applyRemote` writes the server's copy
over the local one rather than merging field by field. A blob can therefore be
`uploaded: true` while the only record of *where* it went is gone, and pruning
it deletes the household's last copy of a passport scan.

### 2. Nothing calls it

Measured across `js/`, excluding `drive.js` itself, callers per public
`DocumentStore` method:

```
storageUsed        1    js/modules/documents.js:172
identifiersIn      1    js/modules/documents.js:428
receiptMatchesIn   1    js/modules/documents.js:475
discard            1    js/modules/documents.js:393
fetchFromDrive     1    js/modules/documents.js:586
pruneUploaded      0    —
```

`pruneUploaded` is the only method on the class with no caller in what ships —
and it is the one that deletes originals. (After this change it has five, all
in `tests/prune.test.mjs`.) It is a storage feature that was written and never
wired. That is why the claim above went untested for so long.

## What changed

The pointer is checked rather than assumed:

```js
const document = await this.#db.repo('document').get(blob.documentId);
if (!document?.driveFileId) { kept += 1; continue; }
```

A blob whose document can no longer say where the file is **stays on the
device**, however old it is and however full the phone. Storage is cheaper than
a passport. The return value gained `kept` so a caller — if one is ever written
— can tell "there was nothing left to free" from "there was, and freeing it
would have been losing it".

## How it is checked

`tests/prune.test.mjs`, five cases, mutation-tested in both directions:

```
--- M1: drop the pointer check (the original) ---
  FAIL  keeps one whose document has lost the pointer
  FAIL  and keeps one whose document is gone entirely
  FAIL  a full device still frees what it safely can

--- M2: keep everything ---
  FAIL  frees a blob whose document can still say where the file is
  FAIL  a full device still frees what it safely can
```

The third case fails under **both** mutations, which is the point of including
it: a guard that refuses to free anything would satisfy M1's tests and destroy
the feature.

## What this does not establish

**The dangerous state was not demonstrated to arise.** `flush` is ordered
safely — it writes `repo('document').update(...)` with the `driveFileId`
*before* it marks the blob `uploaded: true`, so a crash mid-upload cannot
strand a pruneable blob without a pointer. The reachable route to the bad state
is a subsequent `applyRemote` overwriting the document record, and that has not
been observed on a household's device.

So this is a **hardening of an unverified claim on dead code**, not the repair
of an observed data loss. It is worth doing because the claim was load-bearing
prose with nothing checking it, and because the cost of being wrong is a
document the household cannot get back.

**Wiring `pruneUploaded` up is not done here.** Deciding when an application
may delete a family's documents off their own device — on what trigger, with
what warning, with what consent — is a product decision, not a loose end to
tidy while fixing a comment.
