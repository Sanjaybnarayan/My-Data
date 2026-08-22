# Server-Side Authorization

Phase 1, fourth tranche. `apps-script/Policy.gs` (generated),
`apps-script/Code.gs`, `apps-script/Sheets.gs`, `tools/policy.mjs`, tested in
`tests/policy.test.mjs`.

This is the tranche the §0 gate was blocking. Rules 46/47 — *server-side
authorization is authoritative* — could not be satisfied while every check
lived in a browser the household controls.

## The gap it closes

The Phase 0 audit put it exactly: **the backend admits by membership and applies
no role.** Anybody the owner added could push and pull every entity. `rbac.js`
refused the same writes on the device, and anybody who opened devtools could
make it stop.

So the rule the architecture document named and could not enforce —

> a family relationship must not automatically grant data access

— was, until this tranche, false.

## Where the server is

**The Apps Script deployment already is one.** It runs on Google's servers,
under the household's own authorisation, from source they deployed. It verifies
the caller's token with Google and admits by address. It is not a service
anybody else operates, and it needs no new hosting.

That is what makes the hybrid decision affordable: a *policy-only server* that
holds identity, roles and policy, and never holds records — except that in this
case it also happens to be the thing that writes the workbook, which is the
household's own storage rather than ours.

## What changed

**Members gained a role.** `["a@x.com"]` became
`[{ email: "a@x.com", role: "adult" }]`. Deployments written before roles
existed are read forward in place — an old bare-string entry takes the role it
always behaved as, and no write is needed to migrate.

**`admit()` returns the role**, and the role travels with the verified identity.
For a period it travelled only as far as `admit()`: `doPost` built the dispatch
context without `role` or `personId`, so `Sheets.gs` read `'guest'` for
everybody and refused every push and pull. Everything on this page was true of
the design and false of the running system, which is the most expensive kind of
documentation there is. `tests/backend.test.mjs` now drives both through
`doPost`, so the claim on this page is checked rather than stated.
It is never read from the request: a caller telling the backend what role it has
would be a caller granting itself one.

**`sheetPush` refuses what the role may not write**, per row rather than per
batch — one change a child may not make should not throw away the fourteen they
may. Refusals come back through `rejected`, the same channel validation failures
already use, so the client learns which and why.

**`sheetPull` never opens a sheet the role may not read.** Not sent and then
hidden by the client: a row that reached the device would be in IndexedDB, in
the search index and in an export, whatever a screen chose to draw. The cursor
for a skipped entity is deliberately left alone — advancing it would mean that
promoting somebody later showed them only what changed after the promotion, with
the history silently missing.

**A missing role is `guest`, not owner.** The failure that would matter most is
a context that lost its role on the way through being read as unrestricted.

## Generated, not copied

The rules live in `js/data/schema.js`, which Apps Script cannot import. There
were three ways across and two are wrong:

- **Send them with the request** — the browser telling the server what the
  browser may do. Not authorization; a suggestion with extra steps.
- **Write them out by hand** — two tables describing one set of rules, which
  will disagree, and the disagreement discovered by somebody reading a screen
  that is wrong.
- **Generate one from the other, and fail the build when they differ.**

`tools/policy.mjs` writes `apps-script/Policy.gs`; `node tools/policy.mjs
--check` runs in CI, and a test regenerates it in memory and compares.

## Two facts about the schema this surfaced

**A child may write nothing at all.** Every `write` list is owner/spouse or
owner/spouse/adult, so the child role is read-only across all 50<!--live:entities--> entities —
including the 13 it can read. Not a bug, but not obviously intended either, and
it was not written down anywhere before.

**A guest may read nothing through the backend.** `GUEST_READABLE` in `rbac.js`
lets a guest see emergency contacts on the device; the schema's own `acl.read`
does not include `guest` for any entity, and the backend follows the schema. A
guest therefore syncs nothing. That difference between the two layers is real
and is left as-is rather than papered over — see below.

## What this does **not** protect

**The workbook itself.** These checks gate the backend's API. If the owner
shares the Google Sheet directly, anybody with the link reads every tab
regardless of role. The backend cannot police Google Sheets' own sharing, and a
household that shares the file has bypassed this entirely.

**Row-level rules.** `rbac.js` also enforces that a child sees only records
*about them*. The backend cannot: it knows email → role, not email → `personId`.
Entity-level enforcement is what shipped. A child is refused the vault; a child
who may read tasks is sent every task, not only their own.

~~**The two layers do not agree, and the browser is the looser one.**~~
**Mostly done — see `docs/OWN_RECORDS.md`.** The own-record half is reconciled:
the server now has the rule, generated from `rbac.js` by `tools/policy.mjs`, and
an owner-controlled `personId` on each member entry to enforce it with. Two
divergences remain deliberately — `guest` reading `emergencyContact`, which is a
decision about widening what leaves the workbook, and `person`, which must not
be reconciled because it is the mapping that identifies the caller.

**Encryption is unaffected.** Sensitive fields were already ciphertext in the
workbook and stay so. This decides who may *reach* rows, not who can read the
sealed fields inside them — that has always been the data key, which never goes
near Google.

## What mutation testing found

Eight mutations. **Two survived the first run, and they were the two that
mattered most** — removing the pull enforcement entirely, and defaulting a
missing role to owner.

Both survived for the same reason: my stub workbook had no `sheetMap`, so
`entityForSheet` returned null and the pull loop `continue`d **before reaching
the policy check**. The tests were passing on a code path that never ran. The
same gap made the push tests reject rows for "no sheet named X" rather than for
the policy.

Fixed by seeding the map and giving each fake sheet a real header row and a real
data row, and by pairing every negative assertion with a positive one — *an
owner is sent the vault, and a child is not*. Asserting only that a child gets
nothing passes against a stub that returns nothing to anybody.

That is the fourth tranche running where the tell was the same: **the test
passed on the first run.**
