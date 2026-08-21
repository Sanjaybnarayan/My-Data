/**
 * Making an archive, and putting one back.
 *
 * `domain/archive.js` decides what an archive is and refuses to guess about
 * restoring one. This gathers the rows for it and writes them back, and owns
 * the one rule that only a service is in a position to enforce.
 *
 * ## Why only an owner may take a backup
 *
 * The repository filters rows by role — that is the point of it — so a
 * restricted actor reading every entity does not get every record. Measured
 * against this schema:
 *
 *   owner   43 of 43 entities readable
 *   adult   37 of 43
 *   child   13 of 43
 *   member   0 of 43
 *   guest    0 of 43
 *
 * An adult taking a "backup" would get a file missing six entities' worth of
 * records, with nothing anywhere saying so, and would find out on the day they
 * restored it. That is silent data loss wearing the word backup, which is
 * worse than having no backup at all — the household would have stopped
 * worrying.
 *
 * So it refuses, and says how much would have been missing. A backup is a
 * whole-household act and the owner is the one who can perform it.
 */

import { Service } from './service.js';
import { entityNames, entity } from '../data/schema.js';
import { buildBody, planRestore, describeBody, STORES, WHY } from '../domain/archive.js';

/** Beyond the domain's own refusals: these are about who is asking. */
export const REFUSED = Object.freeze({
  NOT_OWNER: 'only an owner can take a backup of the whole household',
});

export class ArchiveService extends Service {
  /** Entities this actor could not read, so a partial file is never written. */
  unreadable(actor = this.db.actor) {
    return entityNames().filter((name) => !entity(name).acl.read.includes(actor?.role));
  }

  /**
   * Every row this archive needs, still encrypted where the store encrypts it.
   *
   * `decrypt: false` is what makes the archive faithful rather than a
   * re-recording of the records: the envelopes go in as they are and come out
   * as they were. `includeDeleted` because a deletion is a fact about the
   * household and a restore that resurrects what somebody threw away is not a
   * restore.
   */
  async gather() {
    const missing = this.unreadable();
    if (missing.length) {
      return { ok: false, why: REFUSED.NOT_OWNER, missing };
    }

    /** @type {Record<string, any[]>} */
    const stores = {};
    for (const name of entityNames()) {
      stores[name] = await this.db.repo(name).list({
        decrypt: false, includeDeleted: true, limit: Infinity,
      });
    }
    for (const name of STORES.included) {
      stores[name] = await this.db.systemStoreRows(name);
    }

    const body = buildBody({
      stores,
      entities: entityNames(),
      device: this.db.deviceId,
    });
    return { ok: true, body, summary: describeBody(body) };
  }

  /** What is on this device now, in the shape `planRestore` asks about. */
  async census() {
    let records = 0;
    for (const name of entityNames()) {
      records += await this.db.repo(name).count({ includeDeleted: true });
    }
    return { records, entities: entityNames() };
  }

  /**
   * Put an opened archive back.
   *
   * Only ever into an empty store — `planRestore` refuses anything else and
   * this does not second-guess it. Entities go through `applyRemote`, which is
   * the same path a pull from the backend uses: it writes the stored row
   * verbatim and reindexes it for search, which is why `search` is not
   * archived.
   *
   * The keyring lands last. Until it does, the envelopes in the records have
   * no key on this device that opens them; after it does, the session holding
   * the *old* device's key is wrong about everything. So this returns
   * `relock: true` and the screen reloads — there is no correct way to carry
   * on in a session whose key was replaced underneath it.
   *
   * @returns {Promise<{ok: boolean, why?: string, holding?: number,
   *                    unknown?: string[], restored?: number, system?: number,
   *                    relock?: boolean}>}
   */
  async restore(body) {
    const plan = planRestore(body, await this.census());
    if (!plan.ok) return plan;

    const system = plan.writes.filter((w) => STORES.included.includes(w.store));
    const records = plan.writes.filter((w) => !STORES.included.includes(w.store));

    for (const { store, row } of records) {
      await this.db.repo(store).applyRemote(row);
    }
    for (const store of STORES.included) {
      const rows = system.filter((w) => w.store === store).map((w) => w.row);
      if (rows.length) await this.db.writeSystemStoreRows(store, rows);
    }

    // The wrapped keys in `meta` have just been replaced. The keyring caches
    // them, so without this it would unlock to this device's *old* data key and
    // every envelope that arrived with the archive would be ciphertext nothing
    // here could open — a restore that looked like a success and lost the
    // household's document numbers, passwords and medical notes for good.
    this.db.keyring.forget();

    return { ok: true, restored: records.length, system: system.length, relock: true };
  }
}

export { WHY };
