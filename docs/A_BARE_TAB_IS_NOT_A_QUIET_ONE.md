# A Bare Tab Is Not A Quiet One

`js/ui/shell.js`, `js/app.js`, `css/base.css`, `js/locale/en.js`,
`tests/profile.test.mjs`.

## The rule this breaks

v6.0: **never silently ignore** errors. v8.0: **never rely only on colour.**

## What was found

The bottom bar's Notifications tab carries a badge — a count of things actually
late, which the code is careful to say is not a count of unread items. It is
filled in on boot and on every data change:

```js
const refreshAttention = () => new AttentionService(db).everything()
  .then(({ pressing }) => shell.setBadge('notifications', pressing))
  .catch(() => {});
```

And the badge element is created hidden:

```js
const badge = h('span', { class: 'nav-badge', hidden: true, 'aria-hidden': 'true' });
```

So when `AttentionService.everything()` throws — a decryption failure, a
corrupt row, IndexedDB refusing — `setBadge` is **never called** and the tab
stays bare. Bare is exactly what "nothing needs attention" looks like.

**A household then reads "you are up to date" off a check that failed, on the
bar they look at first.** A badge has two obvious states, a number and nothing,
and nothing was doing the work of two different facts.

This is the fourth instance of one shape in this audit: `Assistant.load`
swallowing a read failure and reporting "no transactions are recorded";
amounts this device cannot parse counted as zero; a Gmail scan losing messages
and reporting a smaller mailbox; and now a failed check that looks like a quiet
one. **An absence asserted from a read error** is this codebase's signature
fault, and it is worth naming as such rather than fixing case by case.

## What changed

A third state. `attentionBadge(count, label)` is pure and exported:

```
a number   things are late, and how many
nothing    nothing is late
null       the count could not be worked out
```

`app.js`'s catch now passes `null` rather than swallowing. The badge shows a
mark instead of a number, and the tab's accessible name says it in words:

> Notifications, how many things need attention could not be worked out

**Not by colour.** A different colour would be the easy answer and is not an
answer — a household that cannot tell red from grey gets nothing from it. So
the character changes (`!`, and it is asserted to contain no digit), the shape
changes (`border-radius: 4px` against the pill), and the accessible name
carries the whole sentence. Any one of the three is enough on its own.

The label became three locale keys carrying the tab's own name — a language
that orders *"Notifications, 3 things need attention"* differently cannot build
it from a comma and two fragments.

## How it is checked

`tests/profile.test.mjs`, four cases, mutation-tested four ways:

```
M1  null falls through to the numeric path (the original)
      FAIL  a count that could not be worked out does not look like nothing
      FAIL  and it does not look like a count either
M2  the unknown badge shows a digit
      FAIL  and it does not look like a count either
M3  every count becomes the unknown state
      FAIL  a count that could not be worked out does not look like nothing
      FAIL  a real count still reads as one, singular and plural
M4  an empty tab says the count failed
      FAIL  a count that could not be worked out does not look like nothing
      FAIL  a real count still reads as one, singular and plural
```

M3 is why the fourth test exists. A guard that returned the unknown state for
*everything* satisfies the first three and destroys the feature — the failure
mode of a check written only in the direction of the bug.

The decision was pulled out of the shell's closure into a pure function
specifically so it could be mutated. Inside `setBadge` it could only have been
tested through a built shell and a browser, where none of the four mutations
above would have been cheap to run.

## What this does not do

**It does not say what failed.** The tab says the count could not be worked
out, not why. `AttentionService.everything()` aggregates several stores and the
badge has room for one character; naming the store belongs on the Notifications
screen, which this does not touch.

**It does not establish that the check has ever failed** on a household's
device. No such failure has been observed. The fault is that if one happened,
the application said "nothing needs attention" — this makes it visible, not
less likely.

**The `.catch` in `app.js` is not itself mutation-tested.** It is one line of
wiring in the boot path, outside what the unit suite can reach; the browser
suite exercises the badge but not a thrown `AttentionService`. What is held is
the decision, not the call site.
