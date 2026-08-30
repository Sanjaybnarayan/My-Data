/**
 * The sync engine.
 *
 * One run is: push what is queued, pull what has changed, resolve anything
 * that collided, advance the cursors. It is safe to interrupt at any point —
 * every step is idempotent, and an interrupted run is repeated rather than
 * repaired.
 *
 * ## Push before pull
 *
 * Deliberate. Pulling first would apply the server's version of a record this
 * device has already edited, and the local edit would then look like a change
 * to the newly-pulled value — losing the base of the merge. Pushing first
 * means a collision is detected by the server, which returns its version, and
 * the merge has all three sides.
 *
 * ## Cursors
 *
 * One high-water mark per store, being the largest `updatedAt` the server has
 * confirmed. Advanced only after the batch it describes is committed, so an
 * interruption re-fetches a few rows rather than skipping them.
 *
 * ## Never blocks a read
 *
 * Nothing in the application awaits this. `run()` is called on a timer, on
 * regaining connectivity, and on the user's request; the UI reads local data
 * throughout.
 */

import { Outbox } from './outbox.js';
import { merge, conflictRecord } from './conflict.js';
import { entities, sheetManifest } from '../data/schema.js';
import { indexEntry, indexKey } from '../data/search.js';
import { schemaFingerprint } from '../data/migrations.js';
import { unsyncedAudit } from '../data/audit.js';
import { refused } from '../data/consent.js';
import { config } from '../core/config.js';
import { record as recordDiagnostic, KIND } from '../data/diagnostics.js';
import { t } from '../core/locale.js';
import { bus, TOPIC } from '../core/bus.js';
import { TransportError } from '../core/errors.js';

const CURSOR_KEY = 'sync.cursors';
const FINGERPRINT_KEY = 'sync.schemaFingerprint';
const LAST_RUN_KEY = 'sync.lastRun';

export const SYNC_STATE = Object.freeze({
  idle: 'idle',
  running: 'running',
  offline: 'offline',
  blocked: 'blocked',
  error: 'error',
});

export class SyncEngine {
  #db;
  #transport;
  #outbox;
  #batchSize;
  #clock;
  #running = null;
  state = SYNC_STATE.idle;
  lastError = null;

  /**
   * The document store, attached from outside so uploads drain on the same
   * schedule as records.
   *
   * Declared here because it was not: `app.js` did `sync.documents = store` and
   * `#run` read `this.documents`, so a field that is part of this class's
   * contract existed only as two references in two files. The type checker
   * found it — nothing was broken, but nothing said where it came from either.
   *
   * @type {{flush: (options?: {limit?: number}) => Promise<{uploaded?: number}>}|null}
   */
  documents = null;

  /**
   * @param {{db: import('../data/database.js').Database, transport: object,
   *          batchSize?: number, clock?: () => number, random?: () => number}} options
   */
  constructor({ db, transport, batchSize = 500, clock = Date.now, random = Math.random }) {
    this.#db = db;
    this.#transport = transport;
    this.#outbox = new Outbox(db.adapter, { clock, random });
    this.#batchSize = batchSize;
    this.#clock = clock;
  }

  get outbox() {
    return this.#outbox;
  }

  get isRunning() {
    return this.#running !== null;
  }

  /**
   * Runs at most one sync at a time. A second caller gets the promise of the
   * one already in flight rather than a second pass over the same queue.
   */
  run(options = {}) {
    if (this.#running) return this.#running;
    this.#running = this.#run(options).finally(() => { this.#running = null; });
    return this.#running;
  }

  async #run({ full = false } = {}) {
    // Checked before the transport and separately from it: "no deployment
    // configured" is an accident somebody may correct by pasting a URL into
    // Settings, and this is a decision that has been made.
    if (config().localOnly) {
      this.#setState(SYNC_STATE.idle);
      return { skipped: 'local-only' };
    }
    // Somebody said no. Deliberately not "somebody has not said yes": an
    // absent record means nobody was ever asked, and stopping a household's
    // backups over a question they were never put would be a data-loss bug
    // wearing a privacy costume. A withdrawal is a decision, and it is
    // honoured here immediately.
    if (await refused(this.#db, 'backup')) {
      this.#setState(SYNC_STATE.idle);
      return { skipped: 'consent-withdrawn' };
    }
    if (!this.#transport?.configured) {
      this.#setState(SYNC_STATE.idle);
      return { skipped: 'not-configured' };
    }
    if (globalThis.navigator && globalThis.navigator.onLine === false) {
      this.#setState(SYNC_STATE.offline);
      return { skipped: 'offline' };
    }

    this.#setState(SYNC_STATE.running);
    const result = {
      pushed: 0, pulled: 0, conflicts: 0, rejected: 0, failed: 0, auditPushed: 0,
    };

    try {
      await this.#ensureSchema();

      const push = await this.pushOnce();
      Object.assign(result, push);

      const pull = await this.pullOnce({ full });
      result.pulled = pull.pulled;
      result.conflicts += pull.conflicts;

      result.auditPushed = await this.#pushAudit();

      // Files last: they are the largest payloads, and a sync that ran out of
      // time should have got the records away first.
      if (this.documents) {
        const files = await this.documents.flush({ limit: 5 });
        result.filesUploaded = files.uploaded ?? 0;
      }

      await this.#db.setMeta(LAST_RUN_KEY, new Date(this.#clock()).toISOString());
      await this.#db.logAudit('sync', { pushed: result.pushed, pulled: result.pulled });

      const parked = await this.#outbox.failed();
      this.#setState(parked.length ? SYNC_STATE.blocked : SYNC_STATE.idle);
      this.lastError = null;
    } catch (err) {
      // Counts from the half of the run that did complete, so the summary is
      // "3 of 10 sent" rather than a bare failure.
      Object.assign(result, err.partial ?? {});
      this.lastError = err;
      this.#setState(err instanceof TransportError && err.status === 0
        ? SYNC_STATE.offline : SYNC_STATE.error);
      // Not rethrown: sync failing is a normal condition in an offline-first
      // app, and a caller on a timer has nowhere useful to put the exception.
      result.error = err.message;

      // Recorded, because *one* failed sync is a normal condition and the same
      // failure every day for a week is not — and until this existed there was
      // no way to tell those apart. `lastError` holds one; this holds the run.
      await recordDiagnostic(this.#db.adapter, {
        kind: KIND.sync,
        where: 'sync.run',
        // Status first, then the code. Every transport failure carries
        // `code: 'transport'`, which distinguishes nothing — a backend that is
        // down and one that rejected the request would group together, and
        // grouping is the entire point of recording these.
        code: err.status != null ? `http-${err.status}` : (err.code ?? err.name ?? ''),
        message: err.message,
      });
    }

    bus.emit(TOPIC.syncProgress, result);
    return result;
  }

  #setState(state) {
    this.state = state;
    bus.emit(TOPIC.syncState, { state, at: new Date(this.#clock()).toISOString() });
  }

  /* ------------------------------------------------------------------ push */

  async pushOnce() {
    const result = { pushed: 0, rejected: 0, failed: 0, conflicts: 0 };

    for (;;) {
      const batch = await this.#outbox.ready(this.#batchSize);
      if (!batch.length) break;

      let response;
      try {
        response = await this.#transport.push(batch.map((e) => ({
          store: e.store, op: e.op, recordId: e.recordId, rev: e.rev, payload: e.payload,
        })));
      } catch (err) {
        // One failure applies to the whole batch: defer each entry so the
        // backoff is per-entry and a single poisonous record eventually parks
        // on its own rather than taking the queue with it.
        for (const entry of batch) await this.#outbox.defer(entry, err);
        result.failed += batch.length;
        // Rethrow whether or not it is retryable. If the network is down for
        // the push it is down for the pull, and reporting the run as a clean
        // success because the pull half was skipped would tell the user their
        // changes are safely away when they are still queued.
        err.partial = result;
        throw err;
      }

      const applied = new Set(response.applied ?? []);
      const rejected = new Map((response.rejected ?? []).map((r) => [r.recordId, r.reason]));

      for (const entry of batch) {
        if (applied.has(entry.recordId)) {
          await this.#outbox.settle(entry);
          result.pushed++;
        } else if (rejected.has(entry.recordId)) {
          await this.#outbox.defer(
            entry,
            new TransportError(rejected.get(entry.recordId), { status: 400, retryable: false }),
          );
          result.rejected++;
        }
        // An entry the server neither applied nor rejected is in the conflict
        // list; it stays queued and is settled when the merge is pushed.
      }

      for (const conflict of response.conflicts ?? []) {
        await this.#resolve(conflict.store, conflict.record);
        result.conflicts++;
      }

      if (batch.length < this.#batchSize) break;
    }

    return result;
  }

  /* ------------------------------------------------------------------ pull */

  async pullOnce({ full = false } = {}) {
    const cursors = full ? {} : (await this.#db.meta(CURSOR_KEY)) ?? {};
    let pulled = 0;
    let conflicts = 0;
    /** What this pull applied, for the integrity check once it has finished. */
    const applied = new Map();

    for (;;) {
      const response = await this.#transport.pull(cursors, this.#batchSize);
      const byStore = response.records ?? {};

      for (const [store, rows] of Object.entries(byStore)) {
        if (!entities[store]) continue; // a tab this client does not know about
        for (const remote of rows) {
          const outcome = await this.#resolve(store, remote);
          if (outcome.conflicted.length) conflicts++;
          pulled++;
          if (!remote.deletedAt) {
            if (!applied.has(store)) applied.set(store, []);
            applied.get(store).push(remote);
          }
        }
      }

      Object.assign(cursors, response.cursors ?? {});
      // Written after the batch is applied, so an interruption re-fetches
      // these rows rather than losing them.
      await this.#db.setMeta(CURSOR_KEY, cursors);

      bus.emit(TOPIC.syncProgress, { phase: 'pull', pulled });
      if (!response.more) break;
    }

    const dangling = await this.#noteDangling(applied);
    return { pulled, conflicts, dangling };
  }

  /**
   * After the pull, not during it.
   *
   * `applyRemote` does not enforce referential integrity, deliberately: rows
   * arrive in whatever order the backend hands them over, so a transaction can
   * land before the account it names and refusing it would drop a row the
   * household really has. `data/integrity.js` sets that out and calls it a real
   * weakening.
   *
   * The weakening is in the *refusing*, though, and this does not refuse. It
   * waits until the pull has finished — at which point "it might still be
   * coming" has expired — and records what is still pointing at nothing, so
   * the household hears about it from the activity card instead of meeting it
   * on a screen that says "unknown".
   *
   * Deletions are not examined. A row that arrived deleted is a tombstone, and
   * a tombstone's references are nobody's problem.
   *
   * Never throws, for the same reason `recordDiagnostic` does not: an audit
   * that could fail a sync would be worse than no audit.
   */
  async #noteDangling(applied) {
    if (!applied.size) return 0;

    try {
      const broken = await this.#db.danglingAmong(applied);
      if (!broken.length) return 0;

      await recordDiagnostic(this.#db.adapter, {
        kind: KIND.reference,
        where: 'sync.pull',
        // The field, not the ids. Which reference is broken is what groups
        // usefully, and an id here would be a record identifier in a store
        // `redact` is not asked to clean. The entity has its own column, so
        // putting it in the code as well would only make the two disagree.
        code: broken[0].key ?? '',
        entity: broken[0].entity,
        message: t('sync.dangling', { n: broken.length }),
      });
      return broken.length;
    } catch {
      return 0;
    }
  }

  /**
   * Apply one server record over whatever is local, merging if both changed.
   * The whole thing is one transaction so the record, its search entry and
   * any conflict note land together.
   */
  async #resolve(store, remote) {
    const adapter = this.#db.adapter;
    const local = await adapter.read(store, remote.id);

    if (!local) {
      await this.#db.repo(store).applyRemote(remote);
      return { conflicted: [], outcome: 'new' };
    }

    if (local.syncState !== 'pending') {
      // Nothing local to lose; the server's copy wins outright.
      await this.#db.repo(store).applyRemote(remote);
      return { conflicted: [], outcome: 'fast-forward' };
    }

    const shadow = await adapter.read('shadow', `${store}:${remote.id}`);
    const outcome = merge({ base: shadow?.record ?? null, local, remote });

    if (outcome.outcome === 'converged') {
      await this.#db.repo(store).applyRemote(remote);
      return { conflicted: [], outcome: 'converged' };
    }

    const record = { ...outcome.record, syncState: 'pending' };
    const note = outcome.conflicted.length
      ? conflictRecord({
        store, local, remote, merged: record,
        conflicted: outcome.conflicted, outcome: outcome.outcome,
        at: new Date(this.#clock()).toISOString(),
      })
      : null;

    await adapter.tx([store, 'search', 'conflicts', 'outbox'], 'readwrite', async (t) => {
      await t.put(store, record);
      if (record.deletedAt) {
        await t.delete('search', indexKey(store, record.id));
      } else {
        await t.put('search', indexEntry(store, record));
      }
      if (note) await t.put('conflicts', note);

      // The merged record is new to the server too, so it has to go back up.
      await t.put('outbox', {
        id: `mrg_${store}_${record.id}_${record.rev}`,
        seq: this.#db.nextSeq(),
        op: record.deletedAt ? 'delete' : 'put',
        store,
        recordId: record.id,
        rev: record.rev,
        payload: record,
        attempts: 0,
        nextAttemptAt: 0,
        state: 'pending',
        queuedAt: new Date(this.#clock()).toISOString(),
        lastError: '',
      });
    });

    if (note) bus.emit(TOPIC.conflict, note);
    bus.emit(`${TOPIC.dataChanged}:${entities[store].module}`, {
      entity: store, id: record.id, action: 'merge',
    });

    return outcome;
  }

  /* ----------------------------------------------------------------- audit */

  async #pushAudit() {
    const entries = await unsyncedAudit(this.#db.adapter, this.#batchSize);
    if (!entries.length) return 0;
    await this.#transport.appendAudit(entries);
    for (const entry of entries) {
      await this.#db.adapter.write('audit', { ...entry, synced: true });
    }
    return entries.length;
  }

  /* ---------------------------------------------------------------- schema */

  /** Migrate the server's sheets when this client's schema has moved on. */
  async #ensureSchema() {
    const fingerprint = schemaFingerprint();
    if ((await this.#db.meta(FINGERPRINT_KEY)) === fingerprint) return false;
    await this.#transport.migrate(sheetManifest());
    await this.#db.setMeta(FINGERPRINT_KEY, fingerprint);
    return true;
  }

  /** First run: create the workbook, the tabs and the Drive folders. */
  async bootstrap() {
    const info = await this.#transport.bootstrap(sheetManifest());
    await this.#db.setMeta('google.workbookId', info.workbookId);
    await this.#db.setMeta('google.rootFolderId', info.rootFolderId);
    await this.#db.setMeta(FINGERPRINT_KEY, schemaFingerprint());
    return info;
  }

  /**
   * Compare local row counts with the server's. A backup nobody has verified
   * is a backup nobody has, so this runs weekly and is shown in Settings.
   */
  async verifyBackup() {
    const remote = await this.#transport.verify();
    const local = await this.#db.statistics();
    const rows = [];

    for (const [name, def] of Object.entries(entities)) {
      const here = local[name]?.total ?? 0;
      const there = remote.counts?.[def.sheet] ?? 0;
      rows.push({ entity: name, sheet: def.sheet, local: here, remote: there, ok: here === there });
    }

    const verified = rows.every((r) => r.ok);
    await this.#db.setMeta('sync.lastVerification', {
      at: new Date(this.#clock()).toISOString(), verified, rows,
    });
    return { verified, rows, at: new Date(this.#clock()).toISOString() };
  }

  /* -------------------------------------------------------------- schedule */

  /**
   * Sync on a timer, when connectivity returns, and when the tab becomes
   * visible again. Returns a function that stops all three.
   */
  schedule({ everyMinutes = 10 } = {}) {
    const timer = setInterval(() => this.run(), everyMinutes * 60_000);
    timer.unref?.();

    const onOnline = () => {
      bus.emit(TOPIC.online, {});
      this.run();
    };
    const onOffline = () => {
      bus.emit(TOPIC.offline, {});
      this.#setState(SYNC_STATE.offline);
    };
    const onVisible = () => {
      if (!globalThis.document?.hidden) this.run();
    };

    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    globalThis.document?.addEventListener?.('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
    };
  }

  async status() {
    return {
      state: this.state,
      lastRun: await this.#db.meta(LAST_RUN_KEY),
      lastVerification: await this.#db.meta('sync.lastVerification'),
      queue: await this.#outbox.summary(),
      error: this.lastError?.message ?? null,
    };
  }
}
