# A code that now opens the door

*The household asked for a one-time code to replace the recovery phrase on a
new device. This is what changed, what it cost, and the three faults found
while building it — two of them mine, introduced on the first attempt.*

## What was asked for, and what was said back

The request was "make the OTP login actually gate access". Three options were
offered and the household chose the one labelled as the downgrade: **a code
instead of the recovery phrase**.

Before any code was written, one consequence was stated that the option text
had not carried:

> A new device starts with nothing, so for a code to yield the data key, the
> server must hold something that unwraps it. That means your Apps Script
> deployment — and anyone who can read its properties — can decrypt your
> records. That's inherent to "a code instead of a phrase", not an
> implementation choice.

The household did not change their answer, so it was built. `docs/SIGN_IN_BY_CODE.md`
is the account a household reads; this one is the account of building it.

## What was already there

Measuring first turned three of the four pieces into things that already
existed:

| Needed | Already in the repository |
| --- | --- |
| A place to keep a key a new device can reach | `DriveEscrow` — same idea, different host |
| Adopting that key without orphaning anything | `keyring.adoptWrapped`, with a rollback |
| A path from "fresh device" to "unlocked" | `unlockFreshDevice` |
| A code, sent and checked | `apps-script/Otp.gs` |

So the new code is small: a second escrow with the same `read`/`put`/`drop`
shape, a `method` argument on `unlockFreshDevice`, and per-person storage on the
backend. `unlockFreshDevice` was **parameterised rather than copied**, and the
reason is the rollback inside it: a wrapping that is adopted and then fails to
open leaves a device permanently unopenable *and* claiming to be enrolled, so
the lock screen stops offering the recovery phrase that is the only remaining
way in. That is not a paragraph worth having two of.

## A feature nobody could have had

`otpDirectory` — the list of which address belongs to which person — was read by
`otpPersonFor` and **written by nothing**. Not by an action, not by a setup
script, not by anything in the repository. On any real deployment it was absent,
so no address ever matched and no code was ever sent to anybody.

The tests did not see it because the test harness supplies the property
directly. Both ends worked; the thing that fills the list did not exist. That is
the same shape as every other defect this repository has turned up, and the
`signin` action now writes it.

## Three faults found while building

### The check that came from somewhere else

Three tests asserted that only the owner may turn signing in by code on, by
posting as a member and expecting a 403. All three passed. All three still
passed with the owner check deleted — because the member's email was not in the
household list, so `admit` refused it before `otpEscrowManage` was reached. The
403 was real and came from a different rule than the one under test.

Mutation testing is the only reason this was found. The fix was one line: admit
the member, so the owner rule is what refuses.

### The unread value reported as an answer

The sign-in card shows three sentences about what a code does. Those sentences
became false for a household that turns this on, so the card has to ask which
situation it is in — and the answer arrives asynchronously, or not at all.

The first attempt defaulted to the old sentences and wrote a comment claiming
that was the safe direction. It is not. Telling somebody a code cannot open
their records when it can is a **false reassurance**, which is the direction
that costs them; the other guess is an alarm about nothing. There is no safe
default, so there is now a third answer, `WHAT_IS_NOT_KNOWN`, and a test asserts
the three sets share no key.

This is the sixth instance in this repository of *an absence asserted from a
read error*, and the first one introduced deliberately rather than found.

### The list that drifted the moment it was touched

`tools/strings.mjs` held two paths whose English is the catalogue rather than a
string escaping it. Splitting the catalogue in two was enough to make the list
wrong — every string in the new file counted as unrouted English, which is the
opposite of true. It is now a rule (`js/locale/` is a catalogue by virtue of
being `js/locale/`), which is the same fix this repository has applied eight
times to the same shape.

## What the check now is

| Claim | Checked by |
| --- | --- |
| The lock screen actually offers it | `wired:js/auth/lock.js#CODE_METHOD` |
| A screen never guesses what a code unlocks | `export:js/domain/otp.js#WHAT_IS_NOT_KNOWN` |
| Only the owner may turn it on | `tests/otp.test.mjs`, mutation-verified |
| A refused code releases nothing | `tests/otp.test.mjs` |
| A half-written escrow releases nothing | both test files |
| The Google path is unchanged | `tests/codeescrow.test.mjs` |

**16 of 16 mutations caught**, after two escaped on the first pass and were
fixed rather than argued away.

## The claim that had to be withdrawn

`docs/SECURITY.md` said:

> Wiring a code to release the escrow key would mean whoever takes over a phone
> number reads every conversation ever sent, and that trade has not been made.

It has now been made. The sentence was corrected where it stood rather than left
to be discovered, and the consequence it named is exactly the consequence. That
is the whole of the obligation: a document that describes a protection the
software no longer has is worse than no document, because somebody acts on it.
