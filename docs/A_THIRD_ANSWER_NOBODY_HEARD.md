# A third answer nobody heard

*`geo.js` opens by insisting there are three answers and not two. It computes
all three. The screen reported two, and a reading too coarse to place a child
was shown as "away from every saved zone" — a claim of absence made on
evidence that could not tell absence from presence.*

## The insistence

```
 * So there are three answers here, not two: `INSIDE`, `OUTSIDE`, and
 * `UNCERTAIN`. The third is not a failure. It is the honest reading of a fix
 * …
```

And `placeAgainst` delivers on it. A fix 150 m from the centre of a 200 m zone
with a 120 m accuracy circle straddles the boundary in both directions:

```js
if (distance + accuracy <= radius) return WHERE.INSIDE;
if (distance - accuracy > radius) return WHERE.OUTSIDE;
return WHERE.UNCERTAIN;
```

## Where it was lost

`zoneFor` asks only one of the three questions:

```js
if (placeAgainst(fix, zone) !== WHERE.INSIDE) continue;
```

Its comment says why that is acceptable:

> *"Returns null when nothing is decidably inside, which reads the same as
> 'outside everything' and is deliberately not distinguished here. What was
> uncertain is reported by `placements`, **for a caller that needs to say
> why**."*

```
$ grep -rn 'placements\b' js/ tests/
tests/location.test.mjs   the only importer
```

There was no such caller. `lastKnown` returned `zone: zoneFor(...)`, and
`describeLastKnown` had two branches for three states:

```js
const place = zone ? t('safety.atZone', { zone: zone.name }) : t('safety.awayFromZones');
```

```js
'safety.awayFromZones': 'away from every saved zone',
```

## Measured

Two fixes that could not be more different — one straddling the school
boundary, one five kilometres away with 20 m accuracy:

```
placeAgainst      : uncertain
zoneFor           : null
placements        : School=uncertain

  Asha was away from every saved zone 2 hours ago.
  Asha was away from every saved zone 2 hours ago.    <- genuinely outside
```

Identical sentences. On the screen a household uses to find a child, and in
the worst direction for the error: the reading that should have prompted "look
at the school" said the opposite.

## The fix

`lastKnown` now calls `placements` — which is what the comment always said
would happen — and carries the zones the fix could not decide:

```js
const undecided = placements(latest, zones)
  .filter((row) => row.where === WHERE.UNCERTAIN)
  .map((row) => row.zone)
  .sort((a, b) => Number(a.radiusMetres) - Number(b.radiusMetres));
```

Smallest first, mirroring `zoneFor`'s own rule: the tighter zone is the more
specific thing to be unsure about, and "near the school" says more than "near
Indiranagar".

`describeLastKnown` gains a third sentence, guarded on there being no decided
zone — being squarely inside one zone while another overlapping zone is
undecided is still "at school", not a hedge:

```
Asha was near School 2 hours ago, and the reading is too coarse to say
whether they were inside it.
```

Both new strings are routed through the locale layer, so the unrouted ratchet
holds at 3,276. Whole sentences rather than fragments, for the reason the
neighbouring comment already gives: a language that orders "was near the
school but cannot say whether inside" differently cannot build it from parts.

## Not changed

`placeAgainst`, `zoneFor` and `sosMessage`. No geometry is different and no
threshold moved. `zoneFor` still answers only INSIDE, which is correct for
what it is asked. `sosMessage` already omitted the zone line when there was no
zone rather than asserting absence, so it was never making this mistake.

Nothing else regressed: the whole suite passed with the fix in place before a
single new test was written, which also means nothing was depending on the
old sentence.

## Tests

Five, in `tests/location.test.mjs`:

1. A reading too coarse to decide is not reported as away.
2. A reading that really is outside still says so.
3. Being inside a zone is not being unsure about it.
4. A decided zone still wins when another zone is undecided.
5. The tighter of two undecided zones is the one named.

## Mutations

| Mutation | Caught by |
| --- | --- |
| Never report the uncertain case — the original behaviour | 1 |
| Drop the `!zone` guard — a decided fix hedges too | **escaped**, then 4 |
| Sort widest-first | **escaped**, then 5 |
| `undecided` includes plainly-outside zones | 2 |

Both escapes were fixtures that could not exercise what they claimed to.
Test 3 originally had a fix with nothing undecided about it, so the guard was
never reached; test 5 used the 3 km neighbourhood zone, which that fix is
decidably **inside**, leaving one entry in a list whose ordering the test
asserted. A single-element list is sorted whatever the comparator says. Both
fixtures now assert their own preconditions with `placeAgainst` before
testing anything, so a fixture that stops exercising the case fails instead of
passing quietly.
