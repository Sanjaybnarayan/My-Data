# What A Lock Screen May Say

`js/domain/automation.js`, `js/locale/en.js`, `tests/tree.test.mjs`.

## The rule this breaks

v8.0: **no sensitive info in URL, console logs, analytics, notifications,
browser title.**

## What was found

`notificationFor` built the body of a system notification from the full
reminder sentence:

```js
if (reminders.length === 1) {
  return { title: 'FamilyOS', body: describeReminder(reminders[0]), tag: reminders[0].id };
}
```

`describeReminder` is a good function and says everything, deliberately. Its
own comment on the money branch:

> *"The amount is the reason a bill is worth interrupting somebody for, so it
> is in the sentence."*

That is right for the assistant and right for a screen. **It is wrong for a
lock screen**, and the two were the same string.

The tests asserted the leak rather than catching it. Verbatim, from what they
required to pass:

```
"KA01AB1234: PUC expiry expired 3 days ago"      ← a vehicle registration number
"Rent is due in 1 day (₹35,000.00)"              ← a payee and an amount
```

**A notification is read off a lock screen by whoever is holding the phone.**
This application has a PIN and locks itself — `js/auth/lock.js` exists and the
enrolment keypad is the first thing the browser suite tests — which is a
statement that its contents require authentication. It was then posting a
registration plate and a household's rent, with the figure, outside that.

## Was the path live?

Yes, and it had not been. `js/modules/settings/privacy.js` records that
`requestNotificationPermission` carried the comment *"only ever asked from a
click in Settings"* and **no such click existed anywhere**, so
`Notification.permission` stayed `default` and `canNotify()` was always false.
That click was later added. A household that taps *Ask* and grants permission
gets these notifications, so this is a live disclosure and not a latent one.

## What changed

The notification now says **how many and how urgent, and never what**:

> 3 things need attention — 1 already lapsed. Open FamilyOS to see what.

> 1 thing needs attention — The next one is due in 5 days. Open FamilyOS to see
> what.

`describeReminder` is untouched. The assistant and every screen still get the
whole sentence, because they are behind the lock. What is lost from the
notification is nothing a person needs from one: its job is to get somebody to
open the application, and the application then tells them everything.

`tag` still carries the record id for a single reminder. A tag is the browser's
key for replacing an earlier notification and is never displayed, so it
discloses nothing.

## How it is checked

`tests/tree.test.mjs`, four cases, mutation-tested three ways:

```
M1  the lapsed body names the thing again (the original)
      FAIL  a notification says how many and how urgent, never what
      FAIL  but it still tells somebody whether to hurry
M2  the money body names the payee and amount again
      FAIL  and an amount never reaches it
M3  the body is a constant
      FAIL  and an amount never reaches it
      FAIL  but it still tells somebody whether to hurry
```

M3 is why the third test exists: a body reduced to a constant discloses
nothing at all and passes every negative check, while making the notification
useless. The urgency has to survive.

The fourth case asserts that `describeReminder` still names the payee — the
narrowing is of one call site, not of the vocabulary.

One test was **rewritten rather than added**. `one thing gets a sentence,
several get a digest` asserted `single.body` contained `'expired 3 days ago'`
over a fixture titled `KA01AB1234`; that is a test requiring a registration
plate to reach the lock screen. It now asserts the opposite and says so in a
comment, because a test that pinned the defect in place is worth naming.

## The rest of the rule, measured

| Surface | Finding |
| --- | --- |
| **Browser title** | Clean. `index.html` carries `<title>FamilyOS</title>` and nothing assigns `document.title` anywhere in `js/`. The many `document.title` hits are a local variable named `document` holding a document *record*, not `window.document`. |
| **Console logs** | Already covered. `tools/lint.mjs` has a zero-count `no-console-log` rule, and its stated reason is this exact risk. `console.error` is permitted and named as the exception. |
| **URL** | Routes are `{module, entity, id}` — opaque record ids, no values. |
| **Analytics** | There is none to leak into. |
| **Notifications** | The finding above. |

## What this does not establish

**No notification is known to have been seen by anybody.** Whether any
household has granted the permission is not something this repository can
know. What was wrong is that the path was live and the wording assumed an
audience that had unlocked the phone.
