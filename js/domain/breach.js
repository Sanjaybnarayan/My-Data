/**
 * What a household would need if they thought their records had got out.
 *
 * ## What was measured before this was written
 *
 *     audit records exports   : true
 *     audit records refusals  : true
 *     audit chain verifiable  : true
 *     device list lives       : on the backend, not locally
 *
 *     is there anything that tells a household a breach may have happened?
 *       -> NO — no module, and no answer to "who would I have to tell"
 *
 * Every signal already existed. Nothing brought them together, and nothing
 * answered the question that actually matters afterwards.
 *
 * ## This is not breach detection, and the word is avoided deliberately
 *
 * **No application can detect that a copy of a household's records was taken.**
 * A stolen phone, a shared Drive link, a photograph of a screen — none of them
 * produce an event on this device. Anything calling itself breach detection
 * here would be a widget that says "all clear" about a question it never
 * asked, which is worse than saying nothing.
 *
 * So this reports **indicators**: facts that already exist, that would matter
 * if somebody had reason to suspect something. Each one says what it means and
 * what it does not, because "an unrecognised device synced" is a fact with an
 * innocent explanation most of the time.
 *
 * **The absence of indicators is not evidence that nothing happened.** That
 * sentence is in the module, in the document, and on the screen.
 *
 * ## The half that software can actually do
 *
 * DPDP asks a data fiduciary to notify the Board and the affected people.
 *
 * Notifying a regulator is not something this application should attempt. It
 * has no standing, no submission channel, and generating a filing from a
 * household's guess would be worse than useless.
 *
 * **Who is affected** is different, and this application genuinely knows it —
 * it holds the records. Since the household now keeps records *about* other
 * people, staff and children, that question has a real answer and somebody
 * would otherwise have to work it out under pressure from a list they do not
 * have. That is the half built here.
 */

export const SEVERITY = Object.freeze({
  /** Something that should be looked at now. */
  URGENT: 'urgent',
  /** Worth knowing, usually innocent. */
  NOTABLE: 'notable',
});

/**
 * Facts that would matter if somebody suspected their records had got out.
 *
 * Pure: everything is passed in, so this is testable without a database and
 * the caller decides how much to read.
 *
 * @param {{chain?: object, audit?: object[], devices?: object[],
 *          now?: string, exportWindowHours?: number}} sources
 */
export function indicators({
  chain = null, audit = [], devices = [], now = new Date().toISOString(),
  exportWindowHours = 24,
} = {}) {
  const found = [];

  // The strongest signal available, and the only one that is not ambiguous:
  // the audit log is chained, so it not adding up means entries were altered
  // or removed after they were written.
  if (chain && chain.ok === false) {
    found.push({
      kind: 'auditAltered',
      severity: SEVERITY.URGENT,
      what: 'The audit log does not add up.',
      meaning: 'Entries were changed or removed after they were written.',
      notMeaning: 'It does not say who did it, or that anything left this '
        + 'device. Somebody who can unlock FamilyOS could also rebuild the '
        + 'chain, so this catches carelessness rather than a determined person.',
    });
  }

  for (const device of devices ?? []) {
    if (device?.revokedAt && device?.lastSeenAt && device.lastSeenAt > device.revokedAt) {
      found.push({
        kind: 'revokedStillActive',
        severity: SEVERITY.URGENT,
        what: `A device you signed out — ${device.label || device.deviceId} — has synced since.`,
        meaning: 'Either the sign-out did not take effect, or something is '
          + 'using credentials that should have stopped working.',
        notMeaning: 'It does not say what it read.',
        deviceId: device.deviceId ?? null,
      });
    } else if (device && !device.revokedAt && !device.verifiedAt) {
      found.push({
        kind: 'unverifiedDevice',
        severity: SEVERITY.NOTABLE,
        what: `${device.label || device.deviceId} has never been checked.`,
        meaning: 'Nobody has confirmed this device is one of yours.',
        notMeaning: 'Most unchecked devices are simply devices nobody got '
          + 'round to checking.',
        deviceId: device.deviceId ?? null,
      });
    }
  }

  const since = new Date(new Date(now).getTime() - exportWindowHours * 3_600_000)
    .toISOString();
  const exports = (audit ?? []).filter((e) => e.action === 'export' && e.at >= since);
  if (exports.length > 2) {
    found.push({
      kind: 'manyExports',
      severity: SEVERITY.NOTABLE,
      what: `${exports.length} exports in the last ${exportWindowHours} hours.`,
      meaning: 'Records were taken out of the application in a readable form.',
      notMeaning: 'Exporting is a normal thing to do, and this counts your '
        + 'own exports too — it cannot tell yours from anybody else’s.',
    });
  }

  const refusals = (audit ?? []).filter(
    (e) => e.action === 'permission-denied' && e.at >= since,
  );
  if (refusals.length > 3) {
    found.push({
      kind: 'repeatedRefusals',
      severity: SEVERITY.NOTABLE,
      what: `${refusals.length} actions were refused in the last ${exportWindowHours} hours.`,
      meaning: 'Somebody signed in as one person tried repeatedly to reach '
        + 'records that person may not see.',
      notMeaning: 'A child tapping around their own device produces this too.',
    });
  }

  // Ordered so the unambiguous one is first. A list that buries the audit
  // chain under four unchecked devices is a list somebody stops reading.
  return found.sort((a, b) => (a.severity === b.severity ? 0
    : a.severity === SEVERITY.URGENT ? -1 : 1));
}

/**
 * Who would have to be told, and who is somebody else's to tell.
 *
 * The distinction is the point. A household member finding out their own
 * records got out is a conversation. A member of staff or a child is a person
 * whose data the household holds on somebody else's behalf, and they are the
 * ones the obligation is actually about.
 *
 * @param {{people?: object[], staffPersonIds?: string[]}} household
 */
export function whoIsAffected({ people = [], staffPersonIds = [] } = {}) {
  const staff = new Set(staffPersonIds ?? []);
  const rows = [];

  for (const person of people ?? []) {
    if (!person?.id) continue;

    const why = staff.has(person.id) ? 'works for you'
      : person.role === 'child' ? 'a child whose records you keep'
        : 'a member of the household';

    rows.push({
      id: person.id,
      name: person.name ?? person.id,
      why,
      // The two that are not the household's own business to weigh.
      othersData: staff.has(person.id) || person.role === 'child',
    });
  }

  return rows.sort((a, b) => Number(b.othersData) - Number(a.othersData));
}

/**
 * The whole answer, including the parts this application cannot do.
 *
 * `cannot` is returned rather than written on one screen, so any surface that
 * shows this has to carry the limits with it.
 */
export function readiness(sources = {}, household = {}) {
  return {
    indicators: indicators(sources),
    affected: whoIsAffected(household),
    cannot: [
      'Detect that a copy of your records was taken. Nothing on this device '
      + 'sees a stolen phone, a shared Drive link, or a photograph of a screen.',
      'Tell you that nothing happened. No indicators means no indicators.',
      'Notify a regulator. That is your act, not this application’s, and a '
      + 'filing generated from a guess would be worse than none.',
    ],
  };
}
