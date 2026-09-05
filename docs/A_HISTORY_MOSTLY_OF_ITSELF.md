# A history that was mostly a record of being read

The family timeline showed 500 rows — its window cap. **496 of them said *"You
opened …"***: 99.2% of a household's history was the household's history being
drawn.

The module docblock says *"This is the audit log"*, which is true and was
taken as the explanation. It is not the explanation. Almost none of those
opens happened.

## Where they came from

`vaultItem` and `identityDocument` log a `read` when they are opened — the
whole reason read-logging exists, and the two entities that hold secrets.

`TimelineService#titles` loads a record so a story can name it. Without it the
feed says *"Sanjay changed name on an account"* and never which account, which
is the defect [ACTIVITY_STORIES.md](ACTIVITY_STORIES.md) was written about. It
resolves a record of **whatever entity a story names** — so for a vault item,
naming it went through the same `get` that a household opening it goes
through, and was written down as opening it.

That entry then lands inside the window the next render reads, gets a title of
its own, and is written again.

    #titles -> repo.get -> audit 'read' -> next render's window -> #titles

Measured on the example household, `db.activity({ limit: 5000 })` grouped by
action:

| | entries | reads |
| --- | ---: | ---: |
| after seeding, before anybody opened anything | 3,831 | **3,557** |
| …of which `identityDocument` | | 3,440 |
| …of which `vaultItem` | | 117 |
| after one more dashboard visit | 3,851 | 3,577 |
| after four more dashboard + timeline visits | 3,995 | 3,721 |

**3,440 reads of identity documents before a single one had been opened.** The
dashboard repaints as seeding runs, and each repaint titled the reads the last
one wrote. Nine screen visits added 164 rows.

Every call was traced, not guessed — `Repository.prototype.get` wrapped in the
page to tally stacks:

```
7690  at #titles (/js/services/timeline.js) <- TimelineService.recent <- loadAll (dashboard.js)
```

Two stacks, one method. Nothing else in the application reads a record whose
reads are logged.

## The screen looked fine

This is the part worth keeping. Every row on that timeline was a **true
sentence about a real log entry**. The dates were right, the names were right,
the grouping was right, the sentence *"You opened Home wifi"* was accurate
about an entry that genuinely existed. Nothing renders wrong, nothing throws,
no check fails.

The log was the thing that was false, and a screen faithfully showing a false
log looks exactly like a screen working.

## The fix

`Repository#get` takes `logRead`, default `true`:

```js
async get(id, { includeDeleted = false, logRead = true } = {})
```

`logRead: false` says **this is not a person opening the record**, and only
that. Permission is still checked, decryption still happens, the caller still
gets the whole record. What is withheld is the log entry, because the log's
claim is that somebody looked at a vault item, and a lookup made to put that
item's *name* on a log line is not somebody looking at it.

Exactly one caller passes it.

| | entries | reads |
| --- | ---: | ---: |
| after seeding | **274** | **0** |
| after nine dashboard and timeline visits | 274 | 0 |
| after opening one vault item | 275 | **1** |
| after drawing the timeline that shows it | 275 | 1 |

## Zero is the answer a broken build also gives

Deleting the read logging altogether produces every number in that table
except the last two. So the checks are written in pairs, and neither half
passes on its own:

- *opening a vault item is written to the log* — fails if the option defaults
  the wrong way.
- *and looking one up to name it is not* — fails if the option is ignored.
- A third asserts `shouldLogRead('vaultItem')` and **not** `('account')`,
  because both tests above would also pass against an entity that never
  logged reads to begin with.

In the browser, the same pairing against the real screens: six renders log
nothing, **and** the household is first shown to hold both kinds of record,
**and** the timeline is shown to have named them — if it never printed *Bank
locker combination* it never asked for a title, and a count of zero would be
measuring a walk that touched nothing. Then a real open is driven through the
router and has to appear, in the log and in words on the screen, and drawing
that screen must not add a second.

## An option that suppresses an audit entry is worth its callers

One careless `logRead: false` on a screen that really does show a vault item
and the guarantee is gone with nothing failing. So the caller list is swept
out of the source rather than written down beside it: the only two files in
`js/` allowed to contain the string are `data/repository.js`, which defines
it, and `services/timeline.js`, which passes it — once, inside `#titles`.

Mutations, all caught:

| Mutation | Caught by |
| --- | --- |
| the option is ignored | *and looking one up to name it is not* |
| the option defaults to `false` | *opening a vault item is written to the log* |
| a screen module mentions `logRead` | *only the timeline names the option* |
| the suppression moves out of `#titles` | *it is the title lookup that passes it* |

A fifth mutation — a comment added to `dashboard.js` — was written, run, and
**passed**, because the `sed` pattern never matched and the file was never
changed. `grep -c` said `0` where it should have said `1`. The suite was given
nothing to catch and reported that it caught nothing wrong. Re-run against a
verified edit, it failed as it should.

The browser block then made the same mistake in the other direction: its
cleanup called `repo().delete()`, which does not exist — the method is
`remove()`. All eight checks above it had already passed; the throw ended the
run at 250/251 and took every later check in the suite with it. The cleanup
now asserts that the removal happened, and that asking for a record that is
gone records nothing either — `get` returns `null` on a deleted row before it
reaches the audit write.

## What was deliberately not changed

**Repeat opens are not grouped.** `stories()` folds consecutive `update`s by
one person on one record into a sitting, and reads are the same shape — six
opens of one vault item in seven minutes could collapse to one line reading
*"opened it 6 times"*.

They are left as six lines. The count is the point of a read log: folding
repeated access to a secret into one row is the one summary this particular
log must not offer.
