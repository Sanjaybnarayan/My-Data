# What A Vehicle Does To A Litre

`js/domain/fuel.js`, `js/services/vehicles.js`, drawn above the list in
`js/modules/vehicles.js`. Tested in `tests/fuel.test.mjs` and in the browser.

Phase 10's fuel intelligence.

## The fields were being collected and thrown away

`fuelLog.litres` and `fuelLog.fullTank` were both on the field-coverage
inventory: stored, and read by nothing. The only thing anything did with a fuel
log was sum `amount` into a cost report.

So a household ticked "full tank" and typed the litres at every fill-up, and
the application never once used either. The inventory pointed straight at the
gap, which is the second time it has done that — `will.testator` was the first.

## Why a single fill-up says nothing

The obvious calculation is `distance ÷ litres` on one row. It is meaningless:
the litres that went in at a fill-up are what the tank took **afterwards**, not
what was burned getting there. And the odometer at one fill, with no earlier
reading, has no distance attached to it at all.

## A stretch runs from one full tank to the next

With a full tank at both ends, the fuel burned over the distance between them
is exactly the fuel put in *after* the first one — because the tank started
full and ended full. That is the whole trick, and it is why `fullTank` matters
more than any other field here.

```
2026-05-01  odo 10000  35 l  full
2026-05-20  odo 10420  30 l  full   ->  420 km on 30 l  =  14.00 km/l
2026-06-10  odo 10850  32 l  full   ->  430 km on 32 l  =  13.44 km/l
```

Partial fills **inside** a stretch are counted, since their fuel burned too.
Partial fills at the ends are not usable, because a tank that was not filled
has an unknown amount left in it.

## What it refuses

| Situation | Why |
| --- | --- |
| Fewer than two full tanks | There is no stretch, so there is no figure |
| A fill in the stretch with no litres | The total would be short by an unknown amount and the mileage would come out flatteringly high |
| A full tank with no odometer | No distance |
| An odometer that goes backwards | A replaced instrument or a typing error, and neither is kilometres |
| An odometer that did not move | No distance |

A refused stretch does not stop the measurable ones. Each is listed with its
reason rather than silently dropped.

## Total distance over total fuel, not the mean of the ratios

The overall figure pools the kilometres and the litres. On uneven stretches the
two rules disagree sharply:

```
   40 km on  4 l  =  10.00 km/l
 1000 km on 50 l  =  20.00 km/l

 mean of the ratios   15.00 km/l
 pooled               19.26 km/l
```

Averaging would let a 40 km stretch count as much as a 1000 km one.

**This is the opposite rule to `domain/profile.js`, deliberately.** There, the
household figure averages each person's percentage rather than pooling their
sections, because each person is a separate subject and pooling would weight
them by how much they own. Here the stretches are repeated measurements of one
physical quantity, so pooling answers the question directly. A car is not
several cars.

## A missed entry cannot be detected

If a household forgets to record a fill-up, the stretch spans two tanks of fuel
while counting one, and the mileage comes out roughly **twice** what it should
be. Nothing here can tell that from a genuinely economical stretch.

So every stretch is reported individually rather than only as a total — an
outlier is visible to somebody who knows their own car — and the card says so
in as many words rather than leaving it in the source.

## Two things the tests did not catch

**The mileage result was spread over the vehicle record.**
`{ vehicle, ...mileage(vehicle.id, logs) }` — and `mileage` returns its own
`vehicle` key holding the *id*, so the spread replaced the vehicle object with
a string. Every row rendered as "Vehicle" with a broken link. **The type
checker found it; no test did.**

**Then the browser check that was supposed to catch it did not.** Asserting the
registration appeared on the page passed either way, because the vehicle list
below the banner prints it regardless. It counts occurrences now: **once** with
the bug, twice without. That is the third time in this project a browser check
has asserted text the page produces for another reason, and the fix is always
the same — assert something only the thing under test can produce.
