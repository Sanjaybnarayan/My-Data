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
