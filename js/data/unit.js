/**
 * A unit of work: several writes, across several entities, that either all
 * happen or none of them do.
 *
 * ## What was already atomic, and what was not
 *
 * A single write has been atomic since the beginning, and the repository says
 * why in its own comment: the record, its search entry, its audit row and its
 * outbox entry go in one IndexedDB transaction, so a crash between them cannot
 * produce a change that never syncs.
 *
 * What was never atomic is **two writes**. `repo('transaction').create(...)`
 * followed by `repo('economicEvent').create(...)` is two transactions. If the
 * second is refused — a validation error, a permission error, a full disk —
 * the first stands. The household is left with a payment recorded and the
 * event it belongs to missing, and nothing anywhere knows the pair was meant
 * to be a pair.
 *
 * Nothing in the application does that yet, which is exactly why this is the
 * moment to build it: the economic-event work that Phase 5 needs is the first
 * caller, and adding the primitive afterwards means retrofitting it to code
 * already written the other way.
 *
 * ## The order that makes it safe
 *
 *   stage every operation → then open one transaction → then apply them all
 *
 * Staging does the whole of a write except the writing: permission, validation,
 * the row-level check on the finished record, encryption, and building the
 * audit and outbox rows. So a refusal happens **before** the transaction opens,
 * rather than half way through it. That is the property worth having — an
 * operation that cannot succeed never starts, instead of being rolled back
 * after the fact.
 *
 * ## What it does not do
 *
 * **It is not a lock.** Nothing stops another tab writing the same record
 * between staging and commit. IndexedDB gives no way to hold a read across a
 * gap, and inventing one with a flag in a store would be a lock this code
 * could not release if the tab closed. What it gives is atomicity, not
 * isolation, and the difference is worth naming rather than hoping nobody
 * asks.
 *
 * **It is not a queue.** Operations are applied in the order they were staged,
 * within one transaction. There is no dependency graph and no reordering.
 */

import { AppError } from '../core/errors.js';

export class Unit {
  #db;
  #planned = [];
  #committed = false;

  constructor(db) {
    if (!db) throw new AppError('a unit of work needs a database', { code: 'no-database' });
    this.#db = db;
  }

  /** How many operations are staged. */
  get size() { return this.#planned.length; }

  /**
   * Stage a create.
   *
   * Returns the finished record — **including its id** — before anything is
   * written, which is what lets the next operation reference it. Recording a
   * payment and the economic event it belongs to needs exactly that: the event
   * has to point at a transaction that does not exist yet.
   */
  async create(entityName, input) {
    return this.#stage(await this.#repo(entityName).stageCreate(input));
  }

  /** Stage an update. */
  async update(entityName, id, patch) {
    return this.#stage(await this.#repo(entityName).stageUpdate(id, patch));
  }

  /**
   * Stage a soft delete.
   *
   * A missing record is `null` rather than an error, matching `repo.remove`,
   * and stages nothing — deleting something already gone is not a reason to
   * abandon the other four operations.
   */
  async remove(entityName, id) {
    const planned = await this.#repo(entityName).stageRemove(id);
    return planned ? this.#stage(planned) : null;
  }

  #repo(entityName) {
    return this.#db.repo(entityName);
  }

  #stage(planned) {
    if (this.#committed) {
      throw new AppError('this unit of work has already been committed', { code: 'unit-spent' });
    }
    this.#planned.push(planned);
    return planned.record;
  }

  /**
   * Write everything, in one transaction, in the order it was staged.
   *
   * @returns {Promise<object[]>} the records, as staged
   */
  async commit() {
    if (this.#committed) {
      throw new AppError('this unit of work has already been committed', { code: 'unit-spent' });
    }
    // A unit that staged nothing is a no-op rather than an error. A service
    // that decided there was nothing to do should not have to say so twice.
    if (!this.#planned.length) {
      this.#committed = true;
      return [];
    }

    // Every store any operation touches, named up front, because a transaction
    // cannot reach a store it did not declare.
    const stores = [...new Set(this.#planned.flatMap((p) => p.stores))];

    await this.#db.adapter.tx(stores, 'readwrite', async (t) => {
      for (const planned of this.#planned) await planned.apply(t);
    });

    this.#committed = true;

    // After the transaction, never inside it. A listener that reads the
    // database on being told the data changed would otherwise be reading it
    // from inside the write that has not finished.
    for (const planned of this.#planned) planned.emit();

    return this.#planned.map((p) => p.record);
  }
}

/**
 * Run a function against a unit of work and commit it.
 *
 * The shape most callers want: whatever the function stages is committed
 * together, and a throw anywhere inside means nothing is written at all.
 *
 * @example
 * await transact(db, async (unit) => {
 *   const txn = await unit.create('transaction', { ... });
 *   await unit.create('receipt', { transaction: txn.id, ... });
 * });
 */
export async function transact(db, fn) {
  const unit = new Unit(db);
  await fn(unit);
  return unit.commit();
}
