# Family chat, and exactly what its encryption is worth

> **This document was called "Phase 14 Cannot Deliver E2EE".** That was true of
> the key model it measured, and the measurement below is kept because the
> reasoning still holds: on **one household key**, end-to-end encryption is not
> possible, and building chat on that key and calling it encrypted would have
> been the largest false claim in this repository.
>
> What changed is the key model, not the argument. `js/security/e2ee.js` adds
> per-**device** ECDH keypairs alongside the household key, and messages are
> sealed to those. The original measurement follows the current position.

## What the encryption does

A message is encrypted with a fresh random content key. That key is wrapped
once per recipient **device**, using ECDH P-256 between the sender's device key
and the recipient's, run through HKDF-SHA-256 into an AES-GCM wrapping key.

| Who | Can they read it? |
| --- | --- |
| The devices in the conversation | Yes — that is the point |
| Google, holding the synced Sheet | **No** |
| A household member not in the conversation | **No**, even with the app unlocked |
| The household data key | **No** — `message.body` is deliberately not `encrypted: true` |
| Whoever holds the recovery phrase | **Yes. Every conversation.** See below |

Because only the sender's private key can produce that shared secret, a wrap
that opens is also evidence of who sent it — so there is no separate signing
key. Fewer keys is fewer things to get wrong.

## What it does not do, and none of this is hedging

**The recovery phrase reads everything.** The household chose escrow, so every
message is sealed to one extra recipient: an escrow keypair whose private half
is wrapped under a key derived from the recovery phrase and **nothing else** —
not the PIN, not the household data key. A restored archive can therefore open
old conversations, and whoever holds that phrase can read every conversation,
including ones they were never part of. That is the single largest hole in the
table above. It is on the Chat screen, not only here.

**No forward secrecy.** Device keys are long-lived. Somebody who takes a
device's private key can read every message ever sent to it, past included. A
Double Ratchet is what fixes that, and an unaudited hand-rolled ratchet is
worse than not having one, so it is absent rather than approximated.

**No post-compromise security.** Same fact: a compromised device stays
compromised until its key is revoked and a new one enrolled.

**No external audit.** Standard Web Crypto, composed carefully, tested hard —
including a test whose only job is to confirm a stranger cannot read a sealed
message. It has **not** been reviewed by a cryptographer, and no claim here
should be read as though it has.

**Metadata is not hidden.** Who is in a conversation, when a message was sent
and who sent it are all in the clear, so the household can see that a
conversation exists. Hiding that from the database that stores it would be a
different design and a claim this cannot support.

**Revocation is forward-only.** Revoking a device stops future messages being
sealed to it. Messages already sealed to it stay sealed to it — a key that has
been used cannot be un-used, and any screen suggesting otherwise would be
dangerous.

**Chat is in no export.** `message.body` is hidden, so no CSV or spreadsheet
carries it at any setting. That is correct rather than a gap: the body is
ciphertext an export path holds no key for. The encrypted archive carries the
rows as stored, and a restored device with its key can still read them.

## Verifying a device

`safetyNumber()` hashes both public keys, sorted so the two ends agree, and
renders 60 digits in 12 groups — digits because the number is read aloud over a
phone call. A substituted key produces a different number, which is the whole
purpose. `verifiedAt` records that a person says they compared it; the
application cannot check that claim, which is precisely why it is worth
recording who made it.

---

## The original measurement, kept



The build prompt's rule is unambiguous: **never claim E2EE without real
implementation and testing.** This document is what checking looks like.

## What was measured

```
js/security/keyring.js   one data key, wrapped once per unlock method
                         (pin | webauthn | recovery), stored in `meta`
js/security/escrow.js    a fourth wrapping, in the household's Google Drive
grep publicKey|privateKey|keyPair  js/security/*.js js/sync/*.js  → nothing
```

There is **one data key per household**. It is wrapped several times — by a
PIN, by a fingerprint, by a recovery phrase, optionally by Google — and every
wrapping unwraps *the same key*. No per-person keypair exists anywhere in the
application.

## Why that settles it

End-to-end encryption means a message is readable by its recipients and by
nobody else — including other people on the same system. That requires a key
each recipient holds and others do not.

With one household key, a message encrypted with it is readable by **everyone
who can unlock the app**. That is encryption *at rest*: it protects the family
from a stolen laptop, a compromised Drive account or a curious sync service.
It does not protect one household member from another, and calling it
end-to-end would be false in the one direction people assume it is true.

## The deeper tension, which is not a bug to fix

It is worth naming that this is not merely an unimplemented feature.

`escrow.js` already states its own cost plainly: *"whoever can sign in as that
Google account can read everything."* The recovery phrase exists so a
household is not locked out of its own records. Both are deliberate, and both
mean **the household is the unit of trust**.

A family operating system where a parent can recover a child's records and a
chat that is end-to-end encrypted between that parent and that child are
**contradictory designs**. You can have one. Choosing which is a decision for
the household this is being built for, not something to be settled quietly by
whichever feature is implemented second.

## What could honestly be built

**Household chat, encrypted at rest, labelled as exactly that.** Messages
would use the same field encryption every other sensitive field uses, sync
through the household's own Sheet, and work offline like the rest of the
application. The screen would have to say, without hedging, that messages are
visible to anyone who can unlock this household's copy — because a chat that
*looks* private and is not is worse than one that never claimed to be.

**Media and sharing** are Phase 14's other two words and are unaffected by any
of this: documents already encrypt at rest, upload to Drive, and carry
provenance.

## What is not built, and why it is not started

No `chatMessage` entity exists, and none is added here. Adding one before the
question above is answered would mean building the screen first and deciding
what it promises afterwards — which is how a false E2EE claim gets made by
accident.

The architecture document's row still reads `Chat | missing |
absent:grep:chatMessage`, and it is accurate.

## What would have to change for real E2EE

Recorded so the size of it is visible rather than assumed:

- A keypair per person, with the private key never leaving that person's
  device — which means it cannot be escrowed to Drive and cannot be recovered
  by a phrase somebody else holds.
- Messages encrypted once per recipient.
- A decision, made explicitly, that some household data is **not** recoverable
  by the household owner. That is the part that is a product decision rather
  than an engineering one.


## Files (Phase 14, second tranche)

### What was measured first

```
a document blob is encrypted with : the HOUSEHOLD key
a chat message is sealed to       : the recipients' device keys
can chat send a file at all       : NO — there is no attachment path
```

A document's bytes are encrypted with the key every household member shares
and uploaded to Drive. That is right for a passport scan the household keeps
together, and exactly wrong for a chat attachment: it would be readable by
anyone who can unlock the application, while the card above the conversation
says the messages are end-to-end encrypted. **That sentence would have become
false the day attachments shipped.**

### How a file travels

The bytes are sealed to the same devices as the message, using the same code.
`seal` is now a thin wrapper around `sealBytes` rather than a sibling of it —
a second copy of the key-wrapping would be a second copy of the part where
being wrong is unrecoverable, and the two would drift the first time either
was touched. A test seals text and opens it as bytes to prove the two paths
agree.

**The filename is inside the seal.** `divorce-papers.pdf` names the thing the
file was meant to keep private, so it travels in a sealed envelope rather than
a column a household key could read. A test writes exactly that filename and
then searches every stored row for it.

### Its own store, and why

`attachments`, not `blobs`. They look alike and behave differently, and sharing
a store was measured to be actively dangerous: the Drive flush in
`js/sync/drive.js` picks up any un-uploaded blob, looks up its `documentId`,
finds nothing, and **deletes it as an orphan**. Every attachment would have
vanished on the first sync, silently, looking exactly like a file that was
never sent.

The sweep now also requires a `documentId` — belt and braces, and tested
through the real `flush` rather than by restating its filter in a test, which
would pass whatever the code did.

### Withdrawing takes the file

Blanking the body and leaving the bytes would be the worst of both: the message
reads as withdrawn while the photograph is still on the device, and no screen
would say so.

### The screen that did not exist

`ChatService.send` had **no caller**. The encryption was built, tested, and
unreachable from any screen — so conversations had no view, no way to send, and
no way to read. Scoring a phase for code a household cannot use is the
inflation this repository's scorecard exists to refuse, so the conversation
view came before the score: sending, reading, choosing a file, opening one, and
every unreadable message saying *why* in place.

A file is handed back through an object URL built from the decrypted bytes in
memory and released immediately. The plaintext never touches the disk, which is
the point of having sealed it.

### Unchanged, and still true

Escrow still opens everything — the recovery phrase is a key to the whole
conversation, files included, and the card says so. Nothing here has been
reviewed by a cryptographer.

### What files still do not do

- **No thumbnails, no preview, no streaming.** A file is opened whole or not
  at all.
- **No size limit and no pruning.** `pruneUploaded` only ever removes blobs
  whose upload is confirmed, and an attachment is never uploaded — so
  attachments accumulate until somebody withdraws the message.
- **They do not sync.** An attachment lives on the devices that received the
  message. A device that joins later gets `sentBefore`, the same as for text.

**9 of 9 mutations caught**, including *the file stored unsealed*, *the
filename put in a column*, *withdrawing leaving the bytes*, *the file's
description leaking to the screen as raw JSON*, and *the document sweep
reclaiming attachments as orphans*.

## UI-6: the chat, end to end

The whole messenger, as a household would use one — and every capability on
the screen traced back to something the service can actually do.

### The composer no longer takes typing it cannot use

The fault the browser suite found first. A device with no chat key drew a text
box and a Send button, accepted a message, and only then failed with an error
toast. `ChatService.send` throws `notEnrolled` before it touches anything, so
the answer was known before a single keystroke.

The conversation view now loads the identity alongside the messages. Without
one there is no box and no Send button — the card says the device has no chat
key and offers **Enrol this device**, which is the way out, in the place
somebody who wanted to say something is standing. `enrolButton` is shared with
the settings screen so the two cannot come to disagree about the three
outcomes: no linked person, enrolment failed, enrolled.

Three checks hold it: no box, the reason on screen, no Send button. All three
fail when the composer is drawn unconditionally.

### Three service methods that no screen had ever called

`markVerified`, `revoke` and `withdraw` had existed since the encryption was
written with no caller anywhere in the application — the same fault as `send`
before the conversation view, three times over.

- **Safety numbers** are computed on demand, per device, and shown in a
  monospace face. Two people read the number aloud; a face that renders `1`
  and `l` identically turns a mismatch into a shrug.
- **Revoking** asks first, and the confirmation says what it does *not* do:
  everything already sealed to that key stays readable by it. Revoked devices
  stay on the screen under a disclosure rather than disappearing — a key that
  was trusted and is not any more is something a household should see it did.
- **Withdrawing** is offered on my own messages only. The sealed body and any
  attached file are deleted; the row stays, marked withdrawn, because that row
  is how every other device learns what happened.

### The withdraw check that proved nothing

The first version asserted the screen no longer showed the text. It **passed
against a deliberately broken `withdraw` that set the flag and kept the
ciphertext** — because `read` returns `withdrawn` from the flag alone and never
looks at the body, so the screen is identical either way.

Withdrawing that leaves the text on the device is the exact failure the feature
exists to prevent, and only the stored row can say whether it happened. The
check now reads the row back and requires the body to be empty. It fails
against that mutation.

### Two stored preferences, both applied at boot

The bubble tint, and the message size — three fixed steps, not a slider,
because the browser suite sweeps overflow and tap targets at multipliers that
have actually been measured. Both are applied to the root before any chat
module loads: somebody who chose the largest size did so because the normal one
is hard to read, and showing it to them for half a second is the failure the
setting exists to prevent.

The size check measures the computed font size on a real bubble, before and
after. Its first version measured from the settings screen and read `0px` —
a "before" of zero passes for any "after" at all.

### Storage, counted

Conversations, readable messages, withdrawn messages, and attached files with
their bytes — read from the rows, not from a running total kept somewhere. A
stored total and the rows it describes are two facts that drift.

Withdrawn messages are counted **separately**, because the row survives the
body and the space does not come back. Folding the two together would tell
somebody who deleted a message that they had reclaimed something they had not.

### What the screen still refuses to claim

Unchanged, and each one on the screen rather than only in this document:

- **No read receipts and no unread counts.** `message.readBy` is declared in
  the schema and written by nothing — it appears in exactly one file, the
  schema itself.
- **Nothing reaches the notification tray.** `POST_NOTIFICATIONS` is in the
  Android manifest and the only thing that posts is the location foreground
  service.
- **No typing indicator and no online status.** Nothing observes either.
- **No invitation links.** Adding somebody is real but it is two deliberate
  steps — a person record here, a device enrolled on their own phone — because
  a link would carry a key over a channel this application does not control.
- **No screen reader has ever been run against this application.** The
  accessibility card says so itself. The roles and labels are written for one
  and checked by machine; checked markup and a tested experience are different
  claims and only the first is true here.

Escrow still opens everything, and nothing here has been reviewed by a
cryptographer.

**510 browser checks pass. 7 of 7 mutations caught** — the composer drawn
unconditionally, enrolment as a no-op, the size attribute never set, withdrawn
messages double-counted, `withdraw` keeping the ciphertext, `markVerified` not
recording, and `revoke` not recording.
