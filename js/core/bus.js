/**
 * Event bus.
 *
 * The repository layer knows nothing about views, and views never poll. A
 * write publishes `data:changed`, and whatever is on screen re-reads what it
 * needs. This is the only channel between the two, which is what keeps the
 * dependency arrow pointing one way.
 *
 * Handlers are isolated: one that throws is logged and the rest still run,
 * because a broken widget must not stop a save from reaching the outbox.
 */

export class Bus {
  #handlers = new Map();
  #onError;

  constructor(onError = (err, topic) => console.error(`bus:${topic}`, err)) {
    this.#onError = onError;
  }

  /** @returns {() => void} unsubscribe */
  on(topic, handler) {
    let set = this.#handlers.get(topic);
    if (!set) this.#handlers.set(topic, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  once(topic, handler) {
    const off = this.on(topic, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit(topic, payload) {
    // Snapshot: a handler may unsubscribe itself, or subscribe another.
    const direct = this.#handlers.get(topic);
    if (direct) for (const h of [...direct]) this.#run(h, payload, topic);

    // `data:changed:finance` also reaches a listener on `data:changed`.
    let i = topic.lastIndexOf(':');
    while (i > 0) {
      const parent = topic.slice(0, i);
      const set = this.#handlers.get(parent);
      if (set) for (const h of [...set]) this.#run(h, payload, topic);
      i = parent.lastIndexOf(':');
    }
  }

  #run(handler, payload, topic) {
    try {
      handler(payload, topic);
    } catch (err) {
      this.#onError(err, topic);
    }
  }

  /** Resolves the next time `topic` fires, or rejects after `ms`. */
  next(topic, ms = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${topic}`));
      }, ms);
      const off = this.once(topic, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  clear() {
    this.#handlers.clear();
  }
}

export const bus = new Bus();

/** Topics, named once so a typo is a missing import rather than silence. */
export const TOPIC = {
  dataChanged: 'data:changed',
  syncState: 'sync:state',
  syncProgress: 'sync:progress',
  conflict: 'sync:conflict',
  authState: 'auth:state',
  locked: 'auth:locked',
  unlocked: 'auth:unlocked',
  route: 'ui:route',
  toast: 'ui:toast',
  theme: 'ui:theme',
  online: 'net:online',
  offline: 'net:offline',
};
