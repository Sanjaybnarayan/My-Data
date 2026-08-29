# Four files called five

*`docs/SETUP.md` told a household to copy "the five files" into Apps Script and
then named four of the six. One of the two it omitted is the authorisation
rules, which `Sheets.gs` calls with no guard — so anybody following the
instructions got a backend whose sync failed on the first push.*

## The instruction

```
2. Copy in the five files from `apps-script/`:
   - `Code.gs`, `Sheets.gs`, `Drive.gs`, `Gmail.gs`
   - `appsscript.json` — click the gear icon → …
```

```
$ ls apps-script/
Code.gs  Drive.gs  Gmail.gs  Otp.gs  Policy.gs  Sheets.gs  appsscript.json
```

Six scripts. Four named. "Five" counted the manifest.

## What each omission costs

**`Policy.gs` is fatal.** `Sheets.gs:134` calls it without a guard:

```js
} else if (policyAllows(role, 'write', changes[c].store)
  || ownRecordAllows(personId, changes[c].store, changes[c].payload)) {
```

A deployment without it throws `policyAllows is not defined` on every push and
every pull. Nothing syncs at all.

That it throws is the good news. `Code.gs` guards the other one —

```js
if (typeof otpIsPublic === 'function' && otpIsPublic(request.action))
```

— so a missing **`Otp.gs`** degrades quietly: sign-in by code simply does not
exist, which is the documented default anyway. Had `Policy.gs` been reached
through a `typeof` guard too, a household would have got a backend that
skipped authorisation instead of one that refused to run. The unguarded call
is the safer shape, and it is worth saying why.

`Policy.gs` is also the easiest file to overlook, because it is the one nobody
writes: `tools/policy.mjs` generates it from `js/security/rbac.js`. It looks
like build output sitting in a source directory.

## And no way to update

`SETUP.md` had only first-time instructions. Every `.gs` fix in this
repository — the formula defence in `Sheets.gs` most recently — does nothing
until somebody pastes it in again, and the document never said how.

The trap is specific. Following Step 1's *Deploy → New deployment* again mints
a **second** web app on a **different** `/exec` URL, leaves the first serving
the old code, and the app keeps talking to the first. The change appears not
to take effect and nothing anywhere reports an error.

The update path is *Deploy → **Manage deployments** → Edit → Version: **New
version***, which keeps the URL. That is now a section of its own.

## Made self-checking

A hand-maintained list beside a derivable one, which is the fault this
repository keeps finding. `tests/docs.test.mjs` derives it:

- every script in `apps-script/` is named on the bullet somebody copies from;
- the list names nothing that is not there, so a deleted file cannot send
  somebody hunting for it;
- the count stated in the prose matches the count on disk, because the
  original got those two out of step and it is the reader counting along who
  is misled;
- the update section still says *Manage deployments* and *New version*.

## The mutation that escaped

The first version of the first test checked the **whole document** for each
filename. It passed with `Policy.gs` and `Otp.gs` deleted from the list —
because the prose underneath explains why `Policy.gs` matters, so the name was
still on the page.

A check that cannot fail for the reason it claims, written into the very test
meant to stop that. It now reads only the bullet line, which is the only text
somebody copies from.

| Mutation | Caught by |
| --- | --- |
| The original omission — `Policy.gs` and `Otp.gs` off the list | **escaped**, then the line-scoped test |
| A seventh script appears, nobody updates the doc | the list test and the count test |
| The list names a file that does not exist | the reverse-direction test |
| The "New deployment" warning removed | the update-path test |

## Not fixed here

Nothing verifies a real deployment. Nothing in this repository can reach
script.google.com, so "the household pasted all six files" remains unprovable
from here — what changed is that the instruction now names them all, and
cannot silently stop naming them.
