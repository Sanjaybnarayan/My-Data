/**
 * The outbox.
 *
 * Local writes are queued by the repository inside the same transaction that
 * stores the record. This file drains that queue.
 *
 * ## Ordering
 *
 * Entries drain in `seq` order, and a store with a failing entry stops rather
 * than skipping ahead. Two edits to the same record must reach the server in
 * the order they were made — applying the second and then the first would
 * leave the server holding the older value.
 *
 * ## Backoff
 *
 * Doubling, from one second to five minutes, with ±20% jitter so a family's
 * three devices coming back online together do not retry in lockstep. Eight
 * attempts, then the entry parks as `failed` and is surfaced in Settings →
 * Sync rather than retried forever.
 *
 * ## What is not retried
 *
 * A rejection is not a failure to deliver. A 400 means the server will say
 * the same thing next time, so the entry parks immediately with the reason
 * attached. Retrying those is how a queue stops draining and every later
 * change is stranded behind them.
 */

import { isRetryable } from '../core/errors.js';
import { bus, TOPIC } from '../core/bus.js';

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 300_000;

/** Delay before attempt number `attempts` (1-based), with jitter. */
export function backoffMs(attempts, random = Math.random) {
  const exact = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  const jitter = 1 + (random() - 0.5) * 0.4;
  return Math.round(exact * jitter);
}

export class Outbox {
  #adapter;
  #clock;
  #random;

  constructor(adapter, { clock = Date.now, random = Math.random } = {}) {
    this.#adapter = adapter;
    this.#clock = clock;
    this.#random = random;
  }

  /** Entries ready to send now, oldest first, at most `limit`. */
  async ready(limit = 100) {
    const now = this.#clock();
    const all = await this.#adapter.query('outbox', { index: 'bySeq' });

    const out = [];
    const blocked = new Set();
    for (const entry of all) {
      if (entry.state === 'failed') {
        // Everything queued after a parked entry for the same store waits:
        // sending later edits past an unapplied earlier one reorders them.
        blocked.add(entry.store);
        continue;
      }
      if (blocked.has(entry.store)) continue;
      if (entry.nextAttemptAt > now) {
        blocked.add(entry.store);
        continue;
      }
      out.push(entry);
      if (out.length >= limit) break;
    }
    return out;
  }

  async pending() {
    return this.#adapter.query('outbox', { filter: (e) => e.state !== 'failed' });
  }

  async failed() {
    return this.#adapter.query('outbox', { filter: (e) => e.state === 'failed' });
  }

  async size() {
    return (await this.#adapter.query('outbox', {})).length;
  }

  /**
   * Remove a delivered entry and mark the record synced — one transaction, so
   * a crash cannot leave a record marked synced with its entry still queued
   * (which would send it twice) or the reverse (which would never send it).
   */
  async settle(entry) {
    await this.#adapter.tx(['outbox', entry.store, 'shadow'], 'readwrite', async (t) => {
      await t.delete('outbox', entry.id);

      const stored = await t.get(entry.store, entry.recordId);
      // Only clear the flag if nothing was written since this entry was
      // queued; a newer revision has its own entry still in the queue.
      if (stored && stored.rev === entry.rev) {
        await t.put(entry.store, { ...stored, syncState: 'synced' });
        await t.delete('shadow', `${entry.store}:${entry.recordId}`);
      }
    });
  }

  /** Record a transient failure and schedule the next attempt. */
  async defer(entry, error) {
    const attempts = entry.attempts + 1;
    const permanent = !isRetryable(error) || attempts >= MAX_ATTEMPTS;

    const next = {
      ...entry,
      attempts,
      state: permanent ? 'failed' : 'pending',
      nextAttemptAt: permanent ? 0 : this.#clock() + backoffMs(attempts, this.#random),
      lastError: String(error?.message ?? error).slice(0, 300),
      failedAt: permanent ? new Date(this.#clock()).toISOString() : '',
    };
    await this.#adapter.write('outbox', next);

    if (permanent) {
      bus.emit(TOPIC.syncState, {
        state: 'blocked', store: entry.store, recordId: entry.recordId, error: next.lastError,
      });
    }
    return next;
  }

  /** Put a parked entry back in the queue — the Settings "retry" button. */
  async revive(id) {
    const entry = await this.#adapter.read('outbox', id);
    if (!entry) return null;
    const next = { ...entry, state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: '' };
    await this.#adapter.write('outbox', next);
    return next;
  }

  async reviveAll() {
    const parked = await this.failed();
    for (const entry of parked) await this.revive(entry.id);
    return parked.length;
  }

  /**
   * Abandon a change the server will never accept. The local record keeps
   * whatever it has — dropping the queue entry does not undo the edit, and
   * silently reverting the user's typing would be worse than a stuck queue.
   */
  async discard(id) {
    await this.#adapter.remove('outbox', id);
  }

  /** What the sync panel shows. */
  async summary() {
    const all = await this.#adapter.query('outbox', {});
    const now = this.#clock();
    return {
      total: all.length,
      pending: all.filter((e) => e.state === 'pending' && e.nextAttemptAt <= now).length,
      waiting: all.filter((e) => e.state === 'pending' && e.nextAttemptAt > now).length,
      failed: all.filter((e) => e.state === 'failed').length,
      oldest: all.length ? all.reduce((a, b) => (a.seq <= b.seq ? a : b)).queuedAt : null,
    };
  }
}
