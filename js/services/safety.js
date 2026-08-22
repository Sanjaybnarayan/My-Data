/**
 * Recording a position, and answering where everybody was.
 *
 * The domain decides what a reading means; this is the only place that knows a
 * reading is a `locationPing`, that a zone is a `safeZone`, and that reading
 * one costs a permission prompt.
 *
 * Two things happen on every write and neither is optional.
 *
 * **The zone is resolved and stored by name.** The coordinates are encrypted,
 * so a screen listing a week of readings would otherwise decrypt every row to
 * discover it says "school" six times. The name is a convenience and the
 * coordinates remain the record — `lastKnown` recomputes the zone rather than
 * trusting the stored one, because a zone can be moved after the fact.
 *
 * **Old readings are deleted.** The household chose to keep a history, and a
 * history nobody ends is a permanent record of where a family goes.
 * `data/retention.js` cannot do it — that governs how long a deletion is held
 * open, not how long a live row lives — so the pruning is here, on the write
 * path, where it cannot be forgotten by a household that never opens Settings.
 */

import { Service } from './service.js';
import { read as readPosition, describeRefusal } from '../core/position.js';
import { zoneFor } from '../domain/geo.js';
import { expired, lastKnown, transitions, describeLastKnown, sosMessage, RETAIN_DAYS } from '../domain/safety.js';
import { t } from '../core/locale.js';

/** Enough history for the retention window without reading the whole table. */
const PING_LIMIT = 2000;

export class SafetyService extends Service {
  async zones() {
    return this.repo('safeZone').list({ limit: 200 });
  }

  async pings({ limit = PING_LIMIT } = {}) {
    return this.repo('locationPing').list({ limit });
  }

  /**
   * Read this device's position and record it against a person.
   *
   * Returns the refusal rather than throwing when there is no position: being
   * told no is an ordinary outcome of asking for a location, and a screen
   * needs the reason to say anything useful about it.
   */
  /**
   * @param {string} personId
   * @param {{geolocation?: object, now?: number, source?: string}} [options]
   */
  async record(personId, { geolocation = undefined, now = Date.now(), source = 'device' } = {}) {
    const result = await readPosition({ geolocation });
    if (!result.ok) return { ok: false, why: result.why, message: describeRefusal(result.why) };

    const fix = result.fix;
    const zones = await this.zones();
    const zone = zoneFor(fix, zones);

    const saved = await this.repo('locationPing').create({
      person: personId,
      recordedAt: fix.recordedAt,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyMetres: fix.accuracyMetres,
      zoneName: zone?.name ?? '',
      zone: zone?.id ?? '',
      source,
    });

    const forgotten = await this.forgetOld({ now });
    return { ok: true, ping: saved, zone, forgotten };
  }

  /**
   * Delete readings past the retention window.
   *
   * Separate and public so Settings can show what it does and a test can call
   * it without recording a position first.
   */
  async forgetOld({ now = Date.now(), retainDays = RETAIN_DAYS } = {}) {
    const rows = await this.pings();
    const ids = expired(rows, { now, retainDays });
    for (const id of ids) await this.repo('locationPing').remove(id);
    return ids.length;
  }

  /** Where each person was last seen, with how old that is. */
  async whereEveryone({ now = Date.now() } = {}) {
    const [people, zones, pings] = await Promise.all([
      this.repo('person').list({ limit: 200 }),
      this.zones(),
      this.pings(),
    ]);

    return people
      .filter((p) => !p.deletedAt)
      .map((person) => {
        const known = lastKnown(pings, person.id, { now, zones });
        return {
          person,
          known,
          line: describeLastKnown(known, person.name ?? t('safety.somebody')),
        };
      });
  }

  /** Zone crossings across the household, newest first. */
  async crossings({ limit = 50 } = {}) {
    const [zones, pings] = await Promise.all([this.zones(), this.pings()]);
    return transitions(pings, zones).reverse().slice(0, limit);
  }

  /**
   * Raise an SOS: record it, attach a position if one can be had, and compose
   * the message. Sending is the person's job — see `domain/safety.js`.
   */
  /**
   * @param {string} personId
   * @param {{reason?: string, geolocation?: object, contacts?: string[]}} [options]
   */
  async raise(personId, { reason = '', geolocation = undefined, contacts = [] } = {}) {
    const attempt = await readPosition({ geolocation });
    const fix = attempt.ok ? attempt.fix : null;

    const alert = await this.repo('sosAlert').create({
      person: personId,
      raisedAt: new Date().toISOString(),
      reason,
      latitude: fix?.latitude ?? null,
      longitude: fix?.longitude ?? null,
      accuracyMetres: fix?.accuracyMetres ?? null,
      contacts,
      sentVia: 'not sent',
    });

    const people = await this.repo('person').list({ limit: 200 }).catch(() => []);
    const person = people.find((p) => p.id === personId);
    const zone = fix ? zoneFor(fix, await this.zones()) : null;

    return {
      alert,
      // Named so a screen can say why there is no map link, rather than
      // showing a message with a hole in it.
      positionWhy: attempt.ok ? null : attempt.why,
      message: sosMessage(alert, { personName: person?.name ?? t('safety.somebody'), zone }),
    };
  }
}
