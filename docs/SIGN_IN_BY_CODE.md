# Signing in with a code, and what it costs

*A household asked for a one-time code to replace the recovery phrase on a new
device. This is what that decision buys, what it gives up, and where in the
code each half lives.*

## The short version

**When signing in by code is on, the household's Apps Script deployment can
decrypt their records.**

That is not an implementation flaw to be fixed later. It is arithmetic. A new
device starts with nothing — no PIN, no wrapping, no key. For a six-digit code
to end with that device holding the data key, something the code reaches has to
hold both the wrapped key *and* the secret that unwraps it. The only thing a
code reaches is the backend. So the backend holds both.

The recovery phrase does not have this property. It is generated on the device,
shown once, and stored nowhere — not in the repository, not in the deployment,
not in Drive. Nothing can leak what nothing keeps. Replacing it with a code is a
real trade and this document exists so it is made with open eyes.

## Who can read what, once it is on

| Who | Before | After |
| --- | --- | --- |
| Whoever holds the recovery phrase | everything | everything |
| Whoever knows a device PIN | that device's data | that device's data |
| Whoever can open the Apps Script project | nothing readable | **everything** |
| Whoever can read the enrolled inbox or SIM | nothing | **everything** |

The last two rows are the change. The Apps Script project belongs to the Google
account that deployed it, so "whoever can open it" includes anyone that account
is shared with and anyone who phishes it.

## It is off until somebody turns it on

Per person, by the owner, from Settings → Security. The backend refuses the
`signin` action for anybody else (`otpEscrowManage`), for the same reason
`manageMembers` does: escrowing the household's data key is a decision about
everybody's records, not the enroller's own.

Every person for whom it has not been turned on gets the behaviour this feature
started as — a code confirms which household member you are and unlocks
nothing. `otpVerify` says which of the two happened in its reply, using
`grants: 'identity-only'` or `grants: 'identity-and-unlock'`, so a second client
built against this backend cannot infer authorisation from the shape of a
response.

## Where it lives

| Piece | File |
| --- | --- |
| Storing and releasing the escrow | `apps-script/Otp.gs`, from `otpEscrowKey` |
| The `signin` action | `apps-script/Code.gs` |
| The client escrow | `js/security/codeescrow.js` |
| Adopting the key on a new device | `js/auth/google-unlock.js`, `unlockFreshDevice` |
| The lock-screen path | `js/auth/lock.js`, `withCode` |
| Turning it on and off | `js/modules/settings/security.js` |
| Which sentences a screen may show | `js/domain/otp.js`, `limitsFor` |

`unlockFreshDevice` is shared with the Continue-with-Google path rather than
copied. The two arrive at the same place — a device with no keyring, an escrow
holding the key and the wrapping — and the part worth having in one copy is the
rollback: a wrapping that is adopted and then fails to open leaves a device
permanently unopenable *and* claiming to be enrolled, so the adoption is undone.

## The claims this changed

Three sentences in the application asserted that a code unlocks nothing. They
were true, and for a household that leaves this off they still are. They are
false for one that turns it on, and a screen still reciting them would be
reassuring somebody about a protection they no longer have.

So `limitsFor` picks the wording from what the device's own keyring says, and
there is a third answer for a screen that could not find out. Guessing was tried
first and neither guess is safe: guessing "it does not unlock" is a false
reassurance, and guessing "it does" is an alarm about nothing. An unread value
reported as an answer is the fault this repository has now found six times, and
it was not going to be introduced deliberately in the place where the stakes are
highest.

The code email and SMS changed for the same reason. The old body told the reader
a code "does not unlock anything on its own", which is exactly what somebody
receiving an unexpected code needs *not* to be told when it does.

## What this does not claim

- **Not end-to-end encrypted, for a household that turns this on.** The backend
  can decrypt. Anywhere this repository describes the data as readable only on
  enrolled devices, that description holds for PIN, fingerprint and recovery
  phrase, and stops holding for this.
- **SMS is inert** until `otpSmsEndpoint` and `otpSmsToken` are set in script
  properties, and in India a transactional message also needs the sender id and
  template registered under DLT before any gateway will deliver it. Nothing here
  shortcuts that; `otpSendSms` refuses with a 501 that names the reason.
- **Nothing about the deployed backend.** `apps-script/` is source somebody has
  to paste into script.google.com. Nothing in this repository can reach a
  deployment to ask what it is running.

## Turning it off

Settings → Security, "Stop signing in by code". The backend property is deleted
first and the local wrapping second, so a failure part-way leaves the key gone
from the deployment rather than sitting there after the household believed they
had removed it.

A new device then needs the recovery phrase again, which is the arrangement this
replaced.
