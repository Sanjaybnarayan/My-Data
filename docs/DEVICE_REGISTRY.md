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

## Still not done

- **No screen.** The registry is reachable over the API and nothing in the
  browser lists devices or offers a revoke button. An owner would have to call
  the endpoint themselves, which is not a feature a household has.
- **Last-seen is not shown anywhere**, so "which of these is my old phone" is
  answered by an opaque id.
- **A revoked device keeps its local copy.** This refuses it the *backend*;
  records already on that device stay there, and only the lock screen stands
  between somebody and them. Remote wipe is not something a PWA can do, and
  claiming otherwise would be the kind of promise this project refuses to make.
