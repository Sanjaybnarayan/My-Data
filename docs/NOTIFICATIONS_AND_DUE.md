# What Is Due, Said Once And Said Correctly

`js/domain/duewords.js`, `js/domain/reminders.js`, `js/domain/automation.js`,
`js/services/attention.js`, `js/modules/settings/privacy.js`. Tested in
`tests/duewords.test.mjs`, `tests/merge.test.mjs`, `tests/attention.test.mjs`
and the browser suite.

Four faults, found by measuring rather than by reading. Two were visible on the
Notifications tab today; two were the reason nothing was ever visible anywhere
else.

## 1. "X: expires on expires today"

`describeReminder` built its line by pasting the schema's field *label* in
front of a verb. An expiry label is already a phrase — "Expires on", "Next due
on", "Next dose on" — so every one of the nineteen dated entities produced at
least one sentence like these:

    X: expires on expires today
    X: next due on expired 3 days ago
    X: matures on expires today

Two were not merely clumsy, they were **false**. A follow-up date passing is
not something expiring, and a vaccination's next dose does not expire — the
appointment for it may be missed, which is a different claim and not one this
application is in a position to make.

`js/domain/duewords.js` now holds a phrase per expiry field in three tenses,
and the sentence is built from that instead of conjugating a verb onto a label.
`nextDueOn` reads "next due" ahead, "due today" on the day and "was due"
behind, which no rule could derive from the words "Next due on".

A test asserts every field the schema marks `expiry: true` has phrases, so a
new dated field fails the suite rather than quietly rendering "whatever on
expires today". A second asserts none of the sentences for `nextDoseOn`,
`followUpOn`, `date`, `nextServiceOn` or `nextFeeDueOn` contains the word
"expire" in any tense.

`SHARED` declares which field keys more than one entity uses, checked against
the schema, so a key picked up by a new entity fails and somebody decides
whether one phrase still fits both. Comparing *labels* was the first attempt
and was worse than useless: it flagged `Expires On` against `Expires on` and
`Renewal date` against `Renews On` — the same idea spelled differently — while
it could never have caught a key that genuinely acquired a second meaning.

## 2. One renewal, counted twice

A subscription renewing on the 18th produced two rows on the Notifications tab
and counted two against its badge:

    expiry  subscription:s1:renewsOn          Netflix renews in 3 days
    money   bill:subscription:s1:2026-06-18   Netflix is due in 3 days (₹649.00)

`subscription` and `digitalAsset` carry a `renewsOn` the schema marks as an
expiry **and** are read by `upcomingBills`. The comment in
`js/domain/automation.js` says the two bags were kept apart precisely so this
could not happen — and it worked for `recurringPayment`, which is in only one
of them, while these two were in both.

`mergeReminders` drops an expiry row that a bill already covers for the same
entity, record and date. The money row is the one kept, because it carries the
amount, and the amount is the reason a renewal is worth interrupting somebody
for. It lives in the domain because `attentionFrom` and the notification digest
both compose these lists, and a dedupe in one of them would have been a third
opinion about what needs attention.

Matched on entity, record **and** date. A policy can carry a renewal and a
separate expiry, and those are two things to know.

The guard that keeps incomplete rows out of the match had a twin, and the pair
was untestable: either half alone prevented the fault, so removing either broke
nothing and no check could fail. It is one guard now.

## 3. The notification that could never fire

`runAutomations` runs at boot, works out what is due, and builds a digest —
then gates on `canNotify()`, which requires `Notification.permission ===
'granted'`. The only function that could ever grant it,
`requestNotificationPermission`, was **called by nothing**. Its own comment
reads *"Only ever asked from a click in Settings"*, and that click did not
exist anywhere in the application.

So permission stayed `default` forever and no reminder has ever produced a
notification on any device. The digest wording, the once-a-day guard, the
`notified` counter: all built, all unreachable. The same fault as the
screen-time stack, for the third time.

`notificationsCard` in Settings is that click. What it must not claim is as
important as what it does:

- **These are not push notifications.** There is no server and no push
  subscription, so nothing arrives while the application is closed. They are
  raised when it is next opened, at most once a day.
- **Only `default` gets a button.** `requestPermission()` resolves immediately
  with the stored answer once one exists and a browser will not re-prompt after
  a refusal, so a button offered to somebody who already said no does nothing
  when tapped. The card names the browser's own site settings instead.
- **The platform may have none at all.** A WebView can be built without the
  Notification API; that is said rather than shown as a button that does
  nothing.

## 4. Seven dated entities that could never notify

The notify block held a hand-written list of thirteen entity names beside
`datedEntities()`, which derives exactly that — the fault this repository has
found more times than any other, and one the dashboard's own loader carries a
comment about learning.

Missing from it: `vehicleService`, `healthRecord`, `medication`, `vaccination`,
`education`, `warranty`, `tenant` and `recurringPayment`. A car service, a
health follow-up, a course of medicine, a next dose, a school fee, a warranty
and a tenancy could not have produced a notification even once permission was
granted.

It is derived now, and the two bags are allowed to overlap because
`mergeReminders` handles it — which is what the old comment was arranging by
hand, and only managed for one of the three entities that needed it.

`datedEntities` and `BY_NAME` moved from `js/services/attention.js` down to
`js/domain/reminders.js`: both are pure derivations over the schema, and a
domain module reaching up into a service for them would be the dependency
pointing the wrong way. The service re-exports them, so every existing caller
is unchanged.

That move broke `AttentionService.everything()` — `export … from` forwards a
name without binding it in the module — and **the whole suite stayed green**,
because nothing had ever called the method the Notifications tab is built on.
Adding a matching `import` beside the re-export fixed that and broke the
single-file build instead, where flattening turned the pair into two
declarations of one name. It imports once and re-exports the local bindings
now, and `tests/merge.test.mjs` calls the method.

## And one security wiring, found the same way

`safeUrl` in `js/security/sanitize.js` was written, exported, tested — and
imported by nothing. `js/modules/crud.js` rendered a stored `url` field
straight into an anchor's `href`.

The form path *is* defended: `js/data/formats.js` refuses `javascript:` and
`data:` when a URL is typed in, with a comment saying exactly why. But that is
not the only way a value reaches the store. `Repository.applyRemote` writes a
row arriving from the household's own Google Sheet with **no validation at
all** — deliberately, because a sync that rejected a row would lose it, and
silent data loss is the worse failure. So a value typed into the spreadsheet
reached the anchor unchecked.

Being accurate about what that is worth: it needs somebody who can already
write to that spreadsheet, and browsers block `javascript:` in `target=_blank`
navigations. It is a defence-in-depth gap with a real path to it, not a
demonstrated exploit. The fix is to call the function that was written for it.

The value is still shown as text when it is refused, so a household can see
what is actually in the record rather than an empty cell where a bad value is.

A browser check writes a hostile URL through `applyRemote`, exactly as a sync
would, asserts it really did reach the store — otherwise the check would pass
against a screen that had never been given anything bad — then opens the record
and requires no anchor to carry it.

## Not fixed here, and worth knowing

`sanitizeHtml` is also called by nothing, and the same file's header says notes
"store HTML by design… parsed and rebuilt from an allow-list". `innerHTML`
appears nowhere else in `js/`, so notes render as text and there is no hole —
the *claim* is what is wrong, not the protection.

`escapeForSheet` is likewise unused, and the formula-injection defence it
describes is real and implemented server-side in `apps-script/Sheets.gs` as
`defuse`/`restore`. The two regexes are identical today, so this is latent
drift rather than a defect.
