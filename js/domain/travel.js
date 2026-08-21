/**
 * Whether a household can actually go.
 *
 * A trip entity on its own is a diary entry. The question worth answering the
 * month before is the one nobody remembers to ask: **does everyone going have
 * a passport that is still valid when they come back?**
 *
 * ## Why the return date and not the departure date
 *
 * A passport valid on the day you fly and expired on the day you return is not
 * a valid passport — you would be refused at check-in for the outbound leg.
 * Most destinations go further and require validity for **six months beyond
 * the date of entry**, which is why that margin is the default rather than
 * zero. It is a default and not a law: it varies by destination, and this says
 * which rule it applied rather than implying it knows the destination's.
 *
 * ## What it refuses
 *
 * Every refusal is named, because "no problems found" from a check that could
 * not run is the failure this codebase spends its time avoiding.
 *
 *   - a trip with nobody named on it — there is no one to check
 *   - a trip with no return date — no window to check validity against
 *   - a traveller with no passport recorded — that is a gap, not a pass
 *
 * A domestic trip is not checked at all, and says so. Asking an Indian
 * household for passport validity before a train to Pune would train them to
 * ignore the warning that matters.
 */

export const WHY = Object.freeze({
  DOMESTIC: 'a domestic trip needs no passport',
  NO_TRAVELLERS: 'nobody is named on this trip',
  NO_RETURN: 'no return date, so there is nothing to check validity against',
});

export const FINDING = Object.freeze({
  MISSING: 'no passport recorded',
  EXPIRED: 'passport expires before the trip returns',
  MARGIN: 'passport expires within the margin most destinations ask for',
});

/** What most destinations ask for beyond the date of entry. */
export const MONTHS_BEYOND = 6;

const asDay = (value) => (value ? String(value).slice(0, 10) : '');

function addMonths(day, months) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {object} trip
 * @param {{people?: object[], documents?: object[], monthsBeyond?: number}} world
 *   `documents` are `identityDocument` rows; only passports are consulted.
 */
export function passportReadiness(trip, {
  people = [], documents = [], monthsBeyond = MONTHS_BEYOND,
} = {}) {
  if (!trip?.international) return { checked: false, why: WHY.DOMESTIC, findings: [] };

  const travellers = Array.isArray(trip.travellers) ? trip.travellers.filter(Boolean) : [];
  if (!travellers.length) return { checked: false, why: WHY.NO_TRAVELLERS, findings: [] };

  const returns = asDay(trip.returnsOn);
  if (!returns) return { checked: false, why: WHY.NO_RETURN, findings: [] };

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const margin = addMonths(returns, monthsBeyond);

  const passports = documents.filter((d) => String(d.kind).toLowerCase() === 'passport' && !d.deletedAt);
  const findings = [];

  for (const id of travellers) {
    const who = nameOf.get(id) ?? id;
    const held = passports
      .filter((d) => d.person === id)
      .map((d) => asDay(d.expiresOn))
      .filter(Boolean)
      .sort();

    // The latest one, because a person renewing early holds two and the old
    // one expiring says nothing about whether they can travel.
    const expires = held[held.length - 1] ?? '';

    if (!expires) { findings.push({ person: id, who, finding: FINDING.MISSING }); continue; }
    if (expires < returns) {
      findings.push({ person: id, who, finding: FINDING.EXPIRED, expires, needed: returns });
      continue;
    }
    if (margin && expires < margin) {
      findings.push({ person: id, who, finding: FINDING.MARGIN, expires, needed: margin });
    }
  }

  return { checked: true, findings, returns, margin, travellers: travellers.length };
}

/** One line a screen can print, or '' when there is nothing to say. */
export function describeReadiness(readiness) {
  if (!readiness.checked) return readiness.why;
  if (!readiness.findings.length) {
    return `${readiness.travellers === 1 ? 'The traveller has' : 'All travellers have'} `
      + `a passport valid past ${readiness.margin}`;
  }
  return readiness.findings
    .map((f) => `${f.who}: ${f.finding}${f.expires ? ` (expires ${f.expires})` : ''}`)
    .join(' · ');
}

/**
 * Trips under way or still to come, soonest first.
 *
 * A trip whose return date has passed is history and belongs on a list nobody
 * has to scroll past. One that has departed and not returned is *current*, and
 * is the one a household most wants at the top.
 */
export function upcoming(trips = [], today = new Date().toISOString().slice(0, 10)) {
  return trips
    .filter((t) => t && !t.deletedAt)
    .map((t) => ({
      trip: t,
      current: asDay(t.departsOn) <= today && (!asDay(t.returnsOn) || asDay(t.returnsOn) >= today),
      past: Boolean(asDay(t.returnsOn)) && asDay(t.returnsOn) < today,
    }))
    .filter((row) => !row.past)
    .sort((a, b) => String(a.trip.departsOn).localeCompare(String(b.trip.departsOn)));
}
