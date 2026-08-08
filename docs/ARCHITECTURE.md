# FamilyOS — Architecture

FamilyOS is an offline-first Progressive Web App that holds a household's
records: who the family are, what they own, what they owe, what expires when,
and where the paperwork lives. It runs entirely in the browser. Google Apps
Script, Google Sheets and Google Drive are the backing store, reached only when
the network is there.

The whole design follows from two constraints:

1. **The device is the primary store.** Every read is served from IndexedDB.
   The network is a replication channel, never a dependency. A reload on a
   plane shows the same data as a reload at home.
2. **The server is a spreadsheet.** Sheets has no transactions, no foreign
   keys and no row locks. So integrity, validation, referential rules and
   conflict resolution all live in the client, and the server is a
   dumb-but-careful append-and-patch surface with an audit trail.

---

## 1. Layers

```
                       ┌───────────────────────────────┐
  presentation         │  shell · router · components  │
                       │  modules/*.js  (view + edit)  │
                       └───────────────┬───────────────┘
                                       │ intents, never raw storage
                       ┌───────────────▼───────────────┐
  domain               │ schema · validation · money    │
                       │ portfolio · rbac · reports     │
                       └───────────────┬───────────────┘
                       ┌───────────────▼───────────────┐
  repository           │ Repository<T> — one per entity │
                       │ soft delete · audit · revisions│
                       └───────────────┬───────────────┘
              ┌────────────────────────┼────────────────────────┐
   ┌──────────▼─────────┐   ┌──────────▼─────────┐  ┌───────────▼────────┐
   │ StorageAdapter     │   │ crypto (WebCrypto) │  │ sync engine        │
   │  idb | memory      │   │ AES-256-GCM        │  │ outbox · conflicts │
   └────────────────────┘   └────────────────────┘  └───────────┬────────┘
                                                     ┌──────────▼────────┐
                                                     │ Apps Script API   │
                                                     │ Sheets · Drive    │
                                                     └───────────────────┘
```

Dependencies point downward only. Nothing under `js/data`, `js/security`,
`js/domain` or `js/reports` touches `document` or `window`, which is what makes
them testable in Node without a browser or a DOM shim.

## 2. The schema is the program

Sixteen modules with hand-written list views, forms, validators, sheet
definitions and sync mappings would be sixteen copies of the same bug. Instead
every entity is described once, declaratively, in `js/data/schema.js`:

```js
{
  name: 'vehicle', module: 'vehicles', sheet: 'Vehicles',
  labels: { one: 'Vehicle', many: 'Vehicles' },
  fields: [
    { key: 'registration', type: 'text', required: true, list: true },
    { key: 'insuranceExpiry', type: 'date', expiry: true },
    { key: 'chassisNumber', type: 'text', encrypted: true },
  ],
  acl: { read: ['owner','spouse','adult'], write: ['owner','spouse'] },
}
```

From that one declaration the system derives:

| Derived thing | Built by |
| --- | --- |
| IndexedDB object store + indexes | `data/migrations.js` |
| Field-level validation | `data/validate.js` |
| List columns, filters, sort | `ui/components/table.js` |
| Add/edit form + input types | `ui/components/form.js` |
| Which fields are encrypted at rest | `security/fieldcrypto.js` |
| Google Sheet tab + header row + column order | `apps-script/Schema.gs` |
| Expiry/renewal reminders | `domain/reminders.js` |
| CSV / XLSX / PDF report columns | `reports/*` |
| What the AI assistant can answer questions about | `ai/intents.js` |

Adding a module means adding a schema entry and, if it needs more than CRUD, a
small module file with the extra views. That is the difference between this
being buildable and it not being buildable.

## 3. Record envelope

Every stored record carries the same envelope, whatever the entity:

```js
{
  id: 'flr_01J8…',        // ULID-like: sortable by creation time
  rev: 7,                  // increments on every local write
  createdAt, updatedAt,    // ISO-8601 UTC
  createdBy, updatedBy,    // family member id
  deletedAt: null,         // soft delete; never a hard row removal
  origin: 'dev_a3f…',      // device that made the last write
  schemaVersion: 3,        // entity schema version the record was written at
  …fields
}
```

`rev` + `origin` give conflict resolution a deterministic tie-break when two
devices write in the same millisecond. `deletedAt` means a delete replicates
like any other change, and a device offline for a month still learns about it.
`schemaVersion` lets a record written by an older client be upgraded lazily on
read instead of requiring a stop-the-world migration.

## 4. Offline engine

### Reads
Always local. `Repository.list()` reads IndexedDB via an index and never awaits
the network. There is no loading spinner tied to connectivity.

### Writes
1. Validate against the schema. Reject before anything is stored.
2. Encrypt fields marked `encrypted`.
3. Write to IndexedDB in one transaction with an outbox entry — same
   transaction, so a crash between them is impossible.
4. Emit a change event; the view re-renders from local state.
5. The sync engine drains the outbox when online.

### The outbox
```
{ id, seq, op: 'put'|'delete', store, recordId, payload,
  attempts, nextAttemptAt, state: 'pending'|'inflight'|'failed' }
```
Drained in `seq` order per store so causally-ordered edits stay ordered.
Failures back off exponentially with jitter (1s → 2s → 4s … capped at 5min,
8 attempts) then park in `failed` for manual retry, surfaced in Settings →
Sync. A 4xx from the server is permanent and parks immediately; a 5xx or a
network error is transient and retries.

### Conflicts
Pull returns the server record's `rev`, `updatedAt` and `origin`. Resolution
is in `sync/conflict.js` and is pure, so it is unit-tested exhaustively:

- Identical `rev` and `origin` → no conflict, already converged.
- One side deleted → delete wins over edit (a delete is intentional; an edit
  to a deleted record is usually a stale device).
- Otherwise **field-level three-way merge** against the last synced base:
  fields changed on only one side take that side; fields changed on both take
  the later `updatedAt`, breaking ties on higher `rev`, then on lexically
  greater `origin` so every device reaches the same answer without talking.
- Any field that had to be arbitrated is recorded in a `conflicts` store so
  the user can see and reverse the machine's choice.

### Pull cursors
Per-store high-water mark of server `updatedAt`, stored in `meta`. Pull asks
for everything after it, applies, then advances the mark. Re-running a pull is
idempotent, so an interrupted sync is safe to repeat.

## 5. Security model

| Concern | Mechanism |
| --- | --- |
| Data at rest | AES-256-GCM (WebCrypto) on fields marked `encrypted`, and on every vault item wholesale |
| Key hierarchy | Random 256-bit DEK → wrapped by a KEK derived from the PIN with PBKDF2-SHA-256, 600 000 iterations, per-install salt |
| Unlock methods | PIN, WebAuthn platform authenticator, Google identity — each wraps the *same* DEK, so adding or changing one never re-encrypts data |
| Transport | HTTPS to Apps Script; bearer Google OAuth access token |
| Authorization | RBAC in `security/rbac.js`, enforced in the repository, not the view |
| Session | Idle timeout (default 15 min) zeroes the DEK from memory; the app relocks to the PIN screen |
| Injection | No `innerHTML` anywhere in application code — the `h()` builder sets `textContent`. Sheets writes are prefixed to defuse formula injection (`=`,`+`,`-`,`@`) |
| Rate limiting | Token bucket on unlock attempts (client) and per-user request quota (Apps Script `CacheService`) |
| Audit | Every mutation appends to a local `audit` store and replicates to an append-only `_Audit` sheet |

The threat model is explicit: an attacker with the unlocked device is out of
scope; an attacker with the *locked* device, or with read access to the Google
Sheet, sees ciphertext for anything marked sensitive.

## 6. Google backend

One Apps Script web app, deployed as "execute as user accessing", so Sheets and
Drive access uses the signed-in family member's own Google account. There is no
service account and no shared secret to leak.

```
POST /exec  { action, payload, clientVersion, deviceId }
  action: bootstrap | pull | push | schema | upload | link | audit
```

- `bootstrap` — creates the workbook, the per-entity tabs, the Drive folder
  tree, and returns their ids.
- `schema` — receives the client's schema manifest and performs **additive**
  migration: new tabs, new columns appended right, never a destructive rename
  or a column move. Column order is resolved by header name, not position.
- `pull` / `push` — incremental, cursor-based, in batches of 500 rows.
- `upload` — resumable Drive upload; metadata lands in the `Documents` sheet.

Every sheet gets `_id`, `_rev`, `_updatedAt`, `_updatedBy`, `_deletedAt`,
`_origin`, `_schemaVersion` columns first, then the entity's own columns.

## 7. Rendering

No framework. `ui/dom.js` exposes `h(tag, props, children)` returning real
DOM nodes, and components are functions returning nodes plus an optional
`update(state)`. Lists over 200 rows switch to a windowed renderer
(`ui/components/virtual-list.js`) that keeps the DOM at ~30 nodes regardless of
row count. Module code is loaded with dynamic `import()` on first navigation,
so the initial payload is the shell plus the dashboard.

## 8. Statements

The largest thing in `domain/`, and the one with the most decisions in it. Four
stages, each usable on its own:

```
data/pdf-read.js      PDF bytes    → positioned text runs, grouped into rows
domain/statement.js   rows         → transactions, with a self-check
domain/categorise.js  transactions → rails, counterparties, categories
domain/import.js      categorised  → account routing, dedup, records
```

**A statement is a table, so it is read as one.** The single fact that decides
whether money came in or went out is which column the number was printed in,
and flattening the page to text destroys it. `pdf-read.js` keeps every run's x,
and `statement.js` finds the column boundaries from the statement's own heading
row — no per-bank table, no tuning. Where positions are unavailable it falls
back to reading balance movement and *says which mode it used*, because that
fallback cannot see an overdraft and the caller deserves to know.

**The printed balance is not trusted.** Kotak prints an overdrawn balance as a
bare number, so the running balance is computed here from the opening balance
and the signed amounts, and the printed figure is used only to check it. A row
where the two disagree is reported rather than accepted: a mis-parsed statement
produces confident, wrong totals, which is worse than an admitted failure.

**Three questions are kept apart.** The rail the money moved on, who was at the
other end, and what it was for are decided separately, because a categoriser
that collapses them cannot answer "how much did I move to people this year" —
a transfer to a friend and a payment to a restaurant look identical to it. The
rules are ordered and unweighted, so every answer traces to one readable line,
and each classification carries the `rule` that produced it.

**Four kinds, not two.** Every category is `spending`, `income`, `transfer` or
`internal`. Sweeps, own-account moves and investments are internal; money
between people is a transfer. Folding those into an outgoings total is the
commonest way a statement analysis reports several times the truth.

**Re-importing is harmless.** Each transaction carries a fingerprint of what a
bank cannot restate — account, date, amount, direction, reference, narration
and balance-after. Deliberately excluded: the serial number, which restarts at
1 in every statement. Deliberately *not* truncated: the narration, because
three cash withdrawals of the same amount at the same machine in one day differ
only in a trailing reference, and a prefix merges them into one.

Two facts no rule can derive are stated rather than guessed: which accounts the
household holds — matched by the number printed on the statement, tolerating a
mask against a full number but never letting a bank name pick between two
accounts — and which businesses it owns (`meta: finance.businesses`). A firm's
account is indistinguishable from a stranger's until somebody says otherwise.

## 9. Testing

`tests/run.mjs` — no browser, no dependencies. It imports the real
source modules (they are DOM-free by construction) and runs them against a
`MemoryAdapter` that implements the same `StorageAdapter` interface as
IndexedDB. Covered: validation, envelope rules, soft delete, RBAC, conflict
resolution, outbox backoff, money arithmetic, XIRR, reminders, the CSV/XLSX/PDF
writers, statement parsing and categorisation, import routing and dedup, and
the AI intent parser.

`tests/browser.mjs` — the same application in a real Chromium: first run, the
recovery screen that cannot be skipped, a save through the actual form, a
reload that relocks, and every screen — failing on any console error, any empty
render, or any horizontal overflow at 390px.

When adding a check, break the thing it covers and confirm the check fails
before trusting it.
