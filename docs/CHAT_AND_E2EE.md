# Phase 14 Cannot Deliver E2EE, And Here Is The Measurement

Phase 14 is *"family chat, media, sharing, E2EE"*. The headline feature cannot
be built as written on this application's key model, and that is worth
establishing before anything is built rather than after.

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
