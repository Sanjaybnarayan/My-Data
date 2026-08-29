# A picker nobody was listening to

*Settings → Household has had a control for choosing which person each account
belongs to. The choice reached the backend and was thrown away. Finding that
was the whole cost of CHAT-02.*

## What the audit said, and why it was wrong

The audit recorded CHAT-02 — *the server never checks that a message's sender is
the caller* — as blocked, because `admit()` returns `personId: ''` for the
owner. Measuring it before writing anything showed a bigger problem.

```js
// manageMembers, before
clean.push({ email: email, role: role });
```

```js
// members(), unchanged, reading a field nothing wrote
personId: entry.personId ? String(entry.personId) : '',
```

The reader carries a careful comment: *"Which person in the household this
account **is** … Absent on every entry written before this existed, and absent
means no own-record access."*

It was absent on **every** entry, because the writer dropped it. So
`ownRecordAllows` — the rule that lets a child reach their own health record on
the server, tested, documented, and believed in — **could never fire for
anybody**.

## Why nothing caught it

`tests/policy.test.mjs` builds its own caller context:

```js
{ role: 'child', personId: 'p-me' }
```

So the rule was tested thoroughly and the *supply* of its input never was. Both
ends covered, the wiring between them not.

That exact sentence is already in this repository. `doPost` carries a long
comment about `role` and `personId` having been missing from the context it
passed to `Sheets.gs`, ending: *"Both ends covered, the wiring between them
not."* This is the other half of that same bug, left behind when the first half
was fixed.

## The shape, twice in one audit

| Where | The fault |
| --- | --- |
| `otpDirectory` | Read by `otpPersonFor`, **written by nothing**. No code was ever sent to anybody. |
| `members[].personId` | **Written by a UI**, dropped by the server, read by `members()`. No own-record access ever granted. |

One is a reader with no writer; one is a writer whose value is discarded. Both
present as a feature that exists, is documented, and does nothing.

## What was built

**The picker's value is kept**, validated as a record id — anything else came
from a client that built its own request, and a `personId` is what *widens*
access.

**The owner gets a binding of their own.** They are deliberately never in the
member list: `manageMembers` refuses to store them so that nobody can remove the
owner or downgrade their role by editing a list. That protection is precisely
why their `personId` needed somewhere else to live. It is a property, set from
the same screen, and a call that does not mention it leaves it alone — a client
saving the member rows must not silently unbind the owner.

**`sheetPush` refuses a message whose `sender` is not the caller.**

## The first rule there that refuses

Everything else in that path widens. `policyAllows` decides by role;
`ownRecordAllows` can only add, and says so in its own comment — *"never a way
to refuse something the blanket policy allowed."* `impersonation` is a new kind
of rule, so it is a named function with the argument written down rather than a
condition slipped into the existing one.

**An unbound caller is refused, not waved through.** "Check it only where we
can" is the tempting shape, and it stops applying to exactly the accounts nobody
has bound yet — the owner among them, who can do the most. So the refusal names
where the fix is made, and the screen says so in red until the owner answers.

**A row with no sender is left alone.** Withdrawing a message names nobody;
refusing it would break a different feature to protect this one.

## What this is worth, honestly

CHAT-01 already made a forged attribution visible on any device that opens the
message. This stops the row reaching the backup at all. Neither is redundant: a
client that never syncs can still lie to itself, and a row that syncs before
anybody looks at it would otherwise stand unchallenged.

**It requires a redeploy.** `apps-script/` is source somebody pastes into
script.google.com. Until it is pasted, none of this is running — and nothing in
this repository can reach a deployment to check.

**9 of 9 mutations caught**, across both halves.

`apps-script/Code.gs` — dropping the personId again; removing the validation;
making the validation reject everything; ignoring the owner's binding; clearing
that binding on a save that never mentioned it; accepting an unvalidated one.

`apps-script/Sheets.gs` — the rule never firing; waving unbound callers through;
applying the rule to every entity instead of messages.

**One escaped on the first pass.** Making `admit()` return `''` for the owner
again broke nothing, because every test that involved the owner's binding set
it directly rather than through `manageMembers`. The wiring from the screen to
`admit` — which is the entire point of this commit — was the part nothing
covered. Fixed, and it is now two tests.

*(An earlier draft of this file said "7 of 7". It listed seven and nine were
run, which is the safe direction to be wrong in and still wrong. Corrected
here rather than left, for the same reason as everything else in this
document.)*
