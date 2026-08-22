/**
 * Screen time, and the decision about whether anyone may look.
 *
 * `js/core/screentime.js` reports what the device will say. This decides
 * whether to ask it, and the answer is no unless the person whose phone it is
 * has a recorded consent decision.
 *
 * ## The first purpose that actually gates
 *
 * `js/data/consent.js` opens by saying it gates nothing — that recording a
 * decision makes a gap visible rather than stopping anything, because a gate
 * on an application that already works turns an upgrade into data loss.
 *
 * That argument is right for wages and school records: the household already
 * holds them, and refusing to show them to their owner helps nobody. It does
 * not hold here. Screen time is not a record the household already has — it
 * is a reading this application would go and take, about a person, from a
 * device that will hand it over without them noticing. There is nothing to
 * lose by refusing, and something specific to lose by not.
 *
 * So `PURPOSES.screenTime` carries `withoutStops: true`, and this is where it
 * is enforced. A refusal returns `asked: false` with the reason, and the
 * native call is never made.
 */

import { Service } from './service.js';
import { t } from '../core/locale.js';
import { hasConsent, refused, PURPOSES } from '../data/consent.js';
import { usage as deviceUsage, status as deviceStatus } from '../core/screentime.js';

/** Why a reading did not happen. */
export const WITHHELD = Object.freeze({
  NO_PERSON: t('screentime.withheld.noPerson'),
  UNASKED: t('screentime.withheld.unasked'),
  REFUSED: t('screentime.withheld.refused'),
});

export class ScreenTimeService extends Service {
  /**
   * What the device would allow, and what consent allows, kept apart.
   *
   * A screen that collapsed them would tell a household "not available" when
   * the truth is "you have not asked them yet" — which is a thing they can
   * fix, and a thing they should have to do on purpose.
   */
  async readiness(personId) {
    const device = await deviceStatus();
    if (!personId) {
      return { device, permitted: false, why: WITHHELD.NO_PERSON };
    }
    if (await refused(this.db, 'screenTime', personId)) {
      return { device, permitted: false, why: WITHHELD.REFUSED };
    }
    if (!(await hasConsent(this.db, 'screenTime', personId))) {
      return { device, permitted: false, why: WITHHELD.UNASKED };
    }
    return { device, permitted: true, why: null };
  }

  /**
   * Totals per application, for one person, over a window.
   *
   * @param {string} personId whose phone this is
   * @param {{days?: number, clock?: () => number}} [options]
   */
  async forPerson(personId, { days = 7, clock = Date.now } = {}) {
    const ready = await this.readiness(personId);
    if (!ready.permitted) {
      // The native call is not made. Not "made and discarded" — a reading
      // taken and then thrown away is still a reading that happened.
      return { asked: false, why: ready.why, apps: [], device: ready.device };
    }
    if (!ready.device.permitted) {
      return { asked: false, why: ready.device.why, apps: [], device: ready.device };
    }

    const to = clock();
    const from = to - days * 86_400_000;
    const said = await deviceUsage({ from, to });
    return {
      asked: said.ok,
      why: said.ok ? null : said.why,
      apps: said.apps,
      device: ready.device,
      from,
      to,
    };
  }

  /** The purpose, so a screen can show what it is asking about. */
  purpose() {
    return PURPOSES.screenTime;
  }
}
