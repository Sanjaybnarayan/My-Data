# What the application interrupts you for

## The line that was stale, and the one that was not

The roadmap collapsed Phases 9–23 into *"Automation … internationalisation"*,
and the repository holds no fuller list than that — so **Phase 9 being
"Automation" is an inference from an elision, not something recorded.** Said
plainly here because the rest of this document depends on it.

Automation itself turned out to be built and wired: `runAutomations` runs from
`js/app.js` on every launch, advances overdue recurring payments, creates the
next instance of a completed repeating task, and sends at most one notification
a day. That is the ninth roadmap line to be found already done.

## Two suspicions that were my own fixture

Measuring is only useful if the measurement is trusted, so both of these are
recorded rather than quietly dropped:

- **"Overdue things nag forever."** `notifiableReminders` filters `days <= 7`
  with no lower bound, which looks like a policy lapsed in 2024 notifying every
  day for ever. It does not: `expiryReminders` already drops anything more than
  30 days past, with a comment saying why. **Not a bug.**
- **"The notification body is ungrammatical and unnamed"** — it read
  *"Identity document: expires on in 6 days"*. The title falls back to the
  entity label when `def.title(record)` is empty, and `identityDocument`'s title
  is `r.kind`, which my fixture had not set. **My harness, not the application.**

## The one that was real

The notifier reads records for thirteen entity types. **Not one of them carries
a bill.**

```
policy, vehicle, document, identityDocument, subscription, digitalAsset,
holding, property, certificate, person, importantDate, task, appointment
```

No `recurringPayment`. No `loan`. So on a household with ₹53,500 a month of
committed outflow — rent due tomorrow, an EMI three days later — the application
sent this:

```
FamilyOS
Passport: expires on in 6 days
```

and said nothing whatever about the money. Every bill the Finance screen knows
about, every EMI, every renewal: invisible to every notification the application
sends.

**That is the third appearance of one shape.** Money reached no calendar square
(`docs/CALENDAR.md`), then reached exactly one square a year, and now reaches no
notification. Each time the surface was built, correct about what it did cover,
and simply never given the money.

## Why `moneyReminders` sits beside `allReminders`

`allReminders` answers *"which dated records need attention?"*. It has four
callers, and two of them — the dashboard and the report builder — already show
bills through a widget of their own. Folding money into it would have those two
count every bill twice.

The notifier asks a different question: *"what is worth interrupting somebody
for?"*, and the answer plainly includes ₹35,000 of rent due tomorrow. So this is
a second function beside the first, with a test pinning the difference — the
same remedy `datesInRange` and `billsInRange` took, for the same reason, and the
fourth time that pattern has been the right answer.

It calls **`upcomingBills`, not `billsInRange`**. The question is "what is due
soon", which is the one `upcomingBills` actually answers; the other fills a
calendar window. Choosing correctly between a pair this project created on
purpose is the point of having created it.

## The bug this design caught, in my own change

The first version added `recurringPayment` and `loan` to the notifier's existing
entity list, so both sources saw the same records. The digest then read:

```
3 things need attention
Rent: next due on in 1 days
```

**`recurringPayment.nextDueOn` is an `expiry` field in the schema**, so
`allReminders` was already reporting every bill — as an expiry, phrased in the
expiry sentence, with no amount — the moment it was handed the records. Two
sentences about one bill, one of them worse.

The fix is that money is loaded into a separate bag. Two sources, two inputs, no
overlap, and a test that fails if either half starts reporting the other's
records.

## Two smaller things the same measurement found

- **The digest was not sorted.** `notificationFor` shows the first reminder, and
  the caller composes two already-sorted lists — which does not make a sorted
  list. The notification led with a passport six days out while ₹35,000 of rent
  fell due tomorrow. Sorting now happens in `notifiableReminders`, where every
  caller gets it.
- **"is due in 1 days."** Fixed, and pinned by a test that fails on the plural.

## What a bill with no amount says

A credit card bill with no statement day has a date and no amount. It is carried
through as `null` — the way `billsTotal` already tells the two apart — and the
sentence says *"(amount not known yet)"* rather than printing a zero, because a
notification claiming a bill is free is worse than one admitting it does not
know.

## Verification

- **6 of 6 mutations caught**, including *money never reaching a reminder at
  all*, *the amount left out of the sentence*, *an unknown amount reading as no
  amount*, *the digest not sorted across the two sources*, and *"1 days"*.
- One survived the first pass and was a genuine gap: the `days` default is 45,
  and every call in the application passes 7 explicitly, so nothing exercised
  it. Pinned rather than removed.
- `npm test` 1446, browser 243, typecheck 181 against a budget of 181,
  field-coverage 83, policy and lint clean.

## Still not done

- **No browser check drives a real notification.** `Notification` requires a
  permission this suite cannot grant headlessly, so the composition is covered
  by unit tests and the delivery is not. That is a real gap and is stated rather
  than papered over: the same class of silence that hid the receipt-match panel
  for a whole tranche.
- **A card bill still notifies without an amount** where no statement day is
  recorded. It says so, which is the honest half, but the useful half needs the
  statement day.
- **Nothing notifies about a repeating charge no record explains**, which
  `docs/COMMITMENTS.md` now detects. A household could be told about a
  subscription it forgot; it is not, yet, and connecting the two is a decision
  about how often this application is allowed to interrupt somebody rather than
  a missing function.

## UI-10: the badge that disagreed with the list it was in

`expiryReminders` decides a row is worth showing using the window the **schema
declares for that field** — 180 days for a passport, 3 for an appointment, 45
for a policy renewal. Twenty-two of those windows are declared.

The dashboard then re-decided urgency with a flat thirty days.

So a passport 100 days from expiry appeared under **"Expiring & due"** wearing
a **green** badge. The screen contradicting itself about the row it had just
chosen to show.

### Why nothing caught it

Every unit test of `expiryReminders` was right. Every unit test of `dueBadge`
was right. The disagreement lived in the gap between them, which only a
rendered row can be looked at in.

### The fix is to stop deciding twice

`expiryReminders` now returns the `lead` it used, and the screens pass that to
`dueBadge`. Severity and badge agree by construction rather than by two people
choosing the same number.

`leadFor(entity, field)` reads the declared window in one place.
`js/modules/documents.js` had `60` typed in three times beside the `60` on
`document.expiresOn` — four copies of one number, agreeing until one changed.
`walletLead()` from UI-9 collapsed into it too.

### The ratchet

The fix is worth nothing if the next screen types the number in again.
`leadDays` is the argument that carries this decision, so a numeric literal
passed to it anywhere in `js/modules/` fails the suite.

**538 browser checks, 2546 unit tests. 1 of 1 mutation caught** — restoring the
flat thirty days fails the ratchet, the badge check, and its control.
