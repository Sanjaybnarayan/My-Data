/**
 * Session lifetime and unlock throttling.
 *
 * Two independent protections, both against someone holding the device:
 *
 *   - **Idle timeout.** After the configured quiet period the data key is
 *     dropped and the app relocks. The timer is driven by real interaction,
 *     not by a `setInterval` that a backgrounded tab will throttle into
 *     uselessness — every wake-up recomputes elapsed time from a timestamp.
 *
 *   - **Attempt throttling.** A token bucket over wrong PINs. Five tries, then
 *     a cooling-off that doubles each round. Without it, six hundred thousand
 *     PBKDF2 rounds still fall to a script trying ten thousand four-digit PINs
 *     overnight.
 *
 * The lockout deadline is persisted, so closing the tab does not clear it.
 */

import { bus, TOPIC } from '../core/bus.js';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'visibilitychange'];

export class Session {
  #timeoutMs;
  #onExpire;
  #lastActivity;
  #timer = null;
  #clock;
  #detach = [];
  active = false;

  constructor({ timeoutMinutes = 15, onExpire, clock = Date.now } = {}) {
    this.#timeoutMs = timeoutMinutes * 60_000;
    this.#onExpire = onExpire ?? (() => {});
    this.#clock = clock;
    this.#lastActivity = clock();
  }

  start() {
    this.active = true;
    this.touch();
    this.#schedule();
    return this;
  }

  /** Watch real interaction. Separate from `start` so tests need no DOM. */
  observe(target = globalThis) {
    if (!target?.addEventListener) return this;
    for (const type of ACTIVITY_EVENTS) {
      const handler = () => {
        // Returning to a tab counts as activity; leaving it does not, so a
        // phone put in a pocket still times out on schedule.
        if (type === 'visibilitychange' && target.document?.hidden) return;
        this.touch();
      };
      target.addEventListener(type, handler, { passive: true });
      this.#detach.push(() => target.removeEventListener(type, handler));
    }
    return this;
  }

  touch() {
    this.#lastActivity = this.#clock();
  }

  get remainingMs() {
    return Math.max(0, this.#timeoutMs - (this.#clock() - this.#lastActivity));
  }

  get expiresAt() {
    return this.#lastActivity + this.#timeoutMs;
  }

  #schedule() {
    clearTimeout(this.#timer);
    if (!this.active) return;
    const remaining = this.remainingMs;
    if (remaining === 0) {
      this.expire();
      return;
    }
    // Re-check rather than firing blind: a throttled background timer can
    // arrive late, and one that arrives early must not lock a busy user out.
    this.#timer = setTimeout(() => this.#schedule(), Math.min(remaining, 30_000));
    this.#timer.unref?.();
  }

  expire() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    bus.emit(TOPIC.locked, { reason: 'timeout' });
    this.#onExpire('timeout');
  }

  stop() {
    this.active = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    for (const off of this.#detach) off();
    this.#detach = [];
  }

  /** For tests and for the "lock now" button. */
  tick() {
    this.#schedule();
  }
}

/* ---------------------------------------------------------- attempt limits */

export class AttemptLimiter {
  #max;
  #baseLockoutMs;
  #storage;
  #key;
  #clock;

  constructor({
    max = 5, lockoutSeconds = 60, storage, key = 'familyos.unlockAttempts',
    clock = Date.now,
  } = {}) {
    this.#max = max;
    this.#baseLockoutMs = lockoutSeconds * 1000;
    this.#storage = storage ?? memoryStorage();
    this.#key = key;
    this.#clock = clock;
  }

  #state() {
    try {
      return JSON.parse(this.#storage.getItem(this.#key) ?? '') || { failures: 0, until: 0, rounds: 0 };
    } catch {
      return { failures: 0, until: 0, rounds: 0 };
    }
  }

  #write(state) {
    this.#storage.setItem(this.#key, JSON.stringify(state));
  }

  /** Milliseconds until another attempt is allowed; 0 when it is allowed now. */
  lockedForMs() {
    const { until } = this.#state();
    return Math.max(0, until - this.#clock());
  }

  get attemptsLeft() {
    return Math.max(0, this.#max - this.#state().failures);
  }

  /** Call before checking the PIN. Throws the wait, in seconds, when locked. */
  assertAllowed() {
    const waitMs = this.lockedForMs();
    if (waitMs > 0) {
      const error = new Error(`too many attempts — wait ${Math.ceil(waitMs / 1000)}s`);
      error.code = 'locked-out';
      error.retryAfterSeconds = Math.ceil(waitMs / 1000);
      throw error;
    }
  }

  recordFailure() {
    const state = this.#state();
    state.failures += 1;
    if (state.failures >= this.#max) {
      // Each successive lockout is twice as long, capped at an hour: an
      // attacker's cost grows, a legitimate user's mistake does not compound
      // beyond a nuisance.
      state.rounds += 1;
      const wait = Math.min(this.#baseLockoutMs * 2 ** (state.rounds - 1), 3_600_000);
      state.until = this.#clock() + wait;
      state.failures = 0;
    }
    this.#write(state);
    return state;
  }

  recordSuccess() {
    this.#write({ failures: 0, until: 0, rounds: 0 });
  }

  reset() {
    this.recordSuccess();
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

export { memoryStorage };
