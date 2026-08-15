# The policy server, and the field it never read

Phase 1's last open item, and the gate's last unbuilt piece.

## What was measured

The gate says the server *"holds identity, roles, device registry and policy,
and answers authorization questions"*. Measured against `apps-script/Code.gs`,
three of those four were already there and had been for some time:

| Gate | State before this |
| --- | --- |
| Identity | the token is verified with Google before anything is answered |
| Roles | the member list carries them, and **the role travels with the identity, never from the request** |
| Policy | `Policy.gs`, generated from the schema, authoritative over the browser's advisory copy |
| Device registry | **`deviceId` was parsed on line 64 and never looked at again** |

That is the **seventh** roadmap line to go stale on measurement — *"the
policy-only server still open"*, over a backend that had been doing three
quarters of the job. And the missing quarter was not absent so much as
**ignored**: `deviceId` has arrived on every request since the first version of
this backend, structured and unread.

The same shape as every other defect this repository has turned up — a value
present and nothing reading it — except that this one is in the layer that
decides who may reach a household's records.

## What it buys

A phone is lost. Before this, the only remedy was to remove the person from the
member list, which also locks out the laptop they still have. Now an owner
revokes **one device** and the rest keep working — which is the whole point, and
is pinned by a test.

## The rules

- **Refused before the action runs, not after.** A revoked device allowed to
  write and then refused the reply would still have written. A test asserts the
  member list is byte-identical after a revoked device attempts a write.
- **403, not 401.** The token is fine and signing in again will not help. The
  message says to ask the owner rather than leaving somebody retrying.
- **You cannot revoke the device you are asking from** — it would lock you out
  of the reply to your own request.
- **A person sees their own devices; only the owner sees or revokes anybody
  else's.** The ability to sign another person out is the ability to lock them
  out, which is why it sits with the same account that owns the member list.
- **No device id is still allowed.** Older clients do not send one, and locking
  them out on an upgrade would be a denial of service dressed as a security
  improvement. The member list still gates them exactly as before.
- **Bounded at twenty**, newest kept, so a client minting a fresh id per request
  cannot fill the store.
- **Revoking a device that does not exist is a 404.** Silence would read as
  "done" and leave somebody believing they had signed out a phone they had not.

## What it deliberately does not hold

Per the gate: no household records. An email, an opaque id the client generated,
a version string and two timestamps — and a test asserts that exact field list,
so a later addition of anything richer fails rather than passes.

Nothing here records what a device *did*, only that it called.

## Mutation testing

**8 of 8 caught**, after a first pass that caught 7. The miss was that revoking
an unknown device reported success — which would leave somebody believing a lost
phone had been signed out.

## Making it a feature rather than a capability

The tranche above left two things recorded, and together they meant the registry
**could not actually be used**: it was reachable over the API and nowhere else,
and it answered in opaque ids. An owner facing three `dev_01M0…` could not tell
which was the lost phone, and had no button to press even if they could.

### A name, treated as the guess it is

Each device reports a coarse label worked out from its user-agent — *iPhone ·
Safari*, *Windows · Edge*. Deliberately coarse: platform and browser family,
**no version, no screen size, no language**. Those are the ingredients of a
fingerprint, and this only needs to tell a phone from a laptop. Two identical
phones share a label and are told apart by their ids and first-seen dates, which
is the right trade.

It is a **guess**, and is handled as one everywhere:

- the screen says the names were worked out from the browser and can be wrong;
- any device can be renamed to something a person will recognise;
- **a reported name never overwrites a typed one** — somebody who called their
  old laptop *"the one in the study"* does not find it renamed *Mac · Safari*
  the next time it syncs;
- clearing a name lets the reported one come back.

User-agent strings have been unreliable by design for twenty years. Ordering the
checks is what keeps Android from reading as Linux and Edge from reading as
Chrome, and each of those is pinned by a test.

### The sentence under the list

> Signing a device out stops it reaching this backup. It does not erase anything
> already on it.

Said under the button rather than in a tooltip, because it is what somebody most
needs to know at the moment they press it. **A screen implying remote wipe would
be the most dangerous kind of comfort — somebody would stop looking for the
phone.** It also says to change the Google password, which is the thing that
actually helps.

The device being used has no sign-out button at all. The backend refuses it, and
a button that always errors is worse than no button.

### What the mutation testing caught

**7 of 7**, after a first pass that caught 6. The survivor was the transport
never sending the label — and it survived because **`AppsScriptTransport` had no
tests at all**. `FakeTransport` was tested; the real one, whose request body is
the contract with `apps-script/Code.gs`, was pinned nowhere. `tests/transport.test.mjs`
exists because of that mutation.

A second thing surfaced the same way: the device methods had been added to
`FakeTransport` only, because the two classes carry the same method names and
the edit landed in the wrong one. Nothing would have caught that either.

## Still not done

- **A revoked device keeps its local copy.** This refuses it the *backend*;
  records already on that device stay there, and only the lock screen stands
  between somebody and them. Remote wipe is not something a PWA can do, and
  claiming otherwise would be the kind of promise this project refuses to make.
- **Nothing tells a person a new device signed in.** They find out by opening
  this screen, which means an unrecognised device sits unnoticed until somebody
  looks.
- **The list is not browser-checked past rendering.** With no backend configured
  there is nothing to list, so the check confirms the card appears and explains
  itself; revoking and renaming are covered against the real backend in Node.
