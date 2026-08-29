# The envelope knew all along

*Every message in this application has carried the sender twice since chat was
written. One copy is typed into a row. The other is proven by mathematics.
Nothing ever compared them.*

## The two copies

`message.sender` is a plain reference to a person. It is what the screen draws
under a bubble, and it is deliberately in the clear so a conversation list can
be attributed without decrypting anything. **Anything that can write a row can
write it** — a member's own synced client, a hand-edited sheet, a second client
built against the same backend.

The sealed envelope carries `from`: the public half of the device key that
sealed it. `js/security/e2ee.js` derives the wrapping key by ECDH between the
sender's private key and each recipient's public key, and says so plainly:

> only the sender's private key can produce that secret, a wrapped key that
> opens is also evidence the message came from the sender's device — so there
> is no separate signing key.

So an envelope that opens *is* a proof of authorship. The proof was produced on
every message ever sent, and discarded on every message ever read.

## What the join needed

Nothing. `deviceKey` already maps `publicKey → person`, with an index on both.
No new field, no new entity, no schema version, no backend change, no redeploy.
The two halves of the answer were in the same database the whole time.

That is the shape this repository keeps finding: a value present, a second
value that could check it, and no line of code joining them.

## Three answers, not two

A boolean would have been wrong in the direction that costs somebody something.

- **confirmed** — the key that sealed it is recorded against the person the row
  names.
- **disputed** — the key is recorded against somebody else. The finding.
- **unknown** — the key is in no record this household holds.

`unknown` is not `disputed`. A device enrolled on a phone since wiped, or a
`deviceKey` row deleted, proves nothing either way — and a warning drawn on
those messages would train people to scroll past the warning that matters. It
is not `confirmed` either: nothing was checked.

This is the same shape as `WHAT_IS_NOT_KNOWN` in `domain/otp.js`, arrived at
for the same reason, one commit apart. An unread value reported as an answer is
the fault this codebase has now found seven times.

## Two things that would have made it lie

**A message that did not open.** `attributionOf` takes `opened` as an argument
and refuses to infer it. Without that, a message this device cannot read would
be attributed by comparing `row.sender` against a key nothing verified — and
where the untrusted field happened to be right, it would report `confirmed`.
Attribution on the strength of the field the whole exercise exists to distrust.

**A retired phone.** Revocation here is forward-only; `ChatService.revoke` says
a key that has been used cannot be un-used. So revoked and deleted device rows
still count for attribution. Excluding them would turn every message from an
old handset into an accusation.

## What escaped, and what it cost

Five mutations of the domain function; four died. The fifth — deleting the
`claimed !== ''` guard, so that two empty strings read as agreement — **passed
every test**.

The test written for that guard used a device recorded against a real person,
so the comparison failed for an ordinary reason and the guard was never
reached. The comment on that test claimed it covered the case. It did not.
The case is a `deviceKey` row with no person and a message row with no sender:
two absences agreeing that a message came from nobody in particular.

That is the second time in two commits that a test's stated reason was wrong
about which branch it exercised, and both were found by mutation rather than by
reading. Mutation testing is not a formality here.

Three further mutations of the wiring — reporting `opened: true` always,
passing no devices, and replacing the verdict with the claimed sender — all
died. **8 of 8 caught**, after the one that escaped was fixed.

## What this does not do

**It detects; it does not prevent.** A rewritten row still reaches every
device. Each device now says so on the message.

Prevention is the server refusing to store a row whose sender is not the
caller, and that is **blocked**: `admit()` returns `personId: ''` for the
household's owner, so the backend does not know which person the owner is. The
obvious rule would reject every message the owner ever sends.
`docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` carries that correction, including the
fact that the audit's first draft implied a two-line fix that does not exist.

**It does not prove a person.** Only that a message came from a device recorded
against them. A device somebody else is holding is still that device — which is
what safety numbers and `verifiedAt` are for, and this is not.
