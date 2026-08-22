# If a household thinks their records have got out

## What was measured first

```
audit records exports   : true
audit records refusals  : true
audit chain verifiable  : true
device list lives       : on the backend, not locally

is there anything that tells a household a breach may have happened?
  -> NO — no module, and no answer to "who would I have to tell"
```

Every signal already existed. Nothing brought them together, and nothing
answered the question that actually matters afterwards.

## The word "detection" is avoided, deliberately

**No application can detect that a copy of a household's records was taken.** A
stolen phone, a shared Drive link, a photograph of a screen — none of them
produce an event on this device.

Anything here calling itself breach detection would be a widget that says *"all
clear"* about a question it never asked, which is worse than saying nothing at
all. A browser check asserts the phrases `no breaches detected`, `breach
detection` and `all clear` appear nowhere on the screen.

## What it does instead

Reports **indicators**: facts that already existed and would matter if somebody
had reason to suspect something. Each carries what it means **and what it does
not**, because most of them have an innocent explanation.

| Indicator | Severity | And what it does not mean |
| --- | --- | --- |
| the audit log does not add up | urgent | not who did it, and not that anything left the device — somebody who can unlock FamilyOS can rebuild the chain |
| a signed-out device synced since | urgent | not what it read |
| a device nobody has checked | notable | most unchecked devices are simply unchecked |
| a burst of exports | notable | exporting is normal, and it counts your own |
| a run of refused actions | notable | a child tapping around their own device produces this |

The audit-chain break is listed first because it is the only unambiguous one. A
list that buries it under four unchecked devices is a list somebody stops
reading.

**The absence of indicators is not evidence that nothing happened.** That
sentence is in the module, in the control, and on the screen, and there is a
test for each.

## The half software can actually do

DPDP asks a data fiduciary to notify the Board and the affected people.

**Notifying a regulator is refused outright.** This application has no
standing, no submission channel, and a filing generated from a household's
guess would be worse than none.

**Who is affected** is a different question, and this application genuinely
knows the answer because it holds the records. Since the household now keeps
records *about* other people — staff, and children — that list has people on it
whose data is not the household's own to weigh, and those are sorted first and
badged as such.

Working that out under pressure, from a list nobody has, is the part worth
having ready.

## Where the pieces live

`js/domain/breach.js` is pure: everything is passed in, so it is testable
without a database and says nothing about where the facts came from.
`js/data/incident.js` is the half that knows — the chain, the log, the device
list, and who the household holds records about. The Settings screen reading
all four itself took UI→database past its budget, which is how the split got
made.

## Status

`DPDP/breach-notice` moves from `NOT_STARTED` to **`DESIGNED`**, and
deliberately no higher. The control asks for two things and only one of them is
software's job; detection is absent by design and notification is refused.

**This leaves no control at `NOT_STARTED`, and that is exactly the moment to be
careful.** It does not mean the application is compliant. Two tests now guard
that reading directly: no control may be `VERIFIED` — none is, because nobody
qualified has checked any of this against an obligation and signed their name —
and no regime may claim the application complies.

**10 of 10 mutations caught** on the indicators, including *a chain break not
reported*, *a healthy chain reported as broken*, *a revoked device that stopped
still reported*, *the export window ignored*, *urgent no longer sorted first*,
and *the limits dropped from the answer*. Two more against the guards: marking
a control `VERIFIED`, and a regime claiming compliance.
