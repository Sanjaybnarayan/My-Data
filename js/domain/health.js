/**
 * What a household's health records disagree about, and what they cannot say.
 *
 * ## These are records, not a health assessment
 *
 * Everything here is something a person wrote down after being told it: a
 * consultation, a prescription, a jab, an appointment. None of it is measured
 * by this application and none of it is checked by anybody. So this file
 * derives exactly one kind of finding — **places where the records contradict
 * themselves or have run past a date they set** — and nothing that would read
 * as a medical opinion.
 *
 * The distinction matters more here than anywhere else in this repository. A
 * wrong figure on the finance screen costs somebody an afternoon with a
 * statement. A wrong inference about a medicine could cost more than that, and
 * the honest answer to almost every clinical question is that this application
 * does not know.
 *
 * ## Why "open questions" and not "problems"
 *
 * A medication marked ongoing whose end date passed last month is not a
 * medical problem. It is a record saying two things at once, and the only
 * person who can settle it is the household. Every finding below is phrased as
 * a question with a specific thing to check, because a screen that said
 * "overdue" about somebody's tablets would be making a claim about their
 * treatment from a tick box nobody remembered to untick.
 *
 * ## What is deliberately not derived
 *
 * No adherence figure. Nothing in the schema records a dose being taken, so
 * "82% adherence" would be arithmetic on data that does not exist.
 *
 * No interaction checking between medications. That needs a drug database this
 * application does not have, and a household seeing two medicines listed side
 * by side might reasonably assume something checked them. `CANNOT_SHOW` says
 * on the screen that nothing did.
 *
 * No score of any kind. There is no honest way to turn four kinds of record
 * into a number about somebody's health, and a number is exactly what people
 * remember.
 *
 * ## The one schema change, and why it is here rather than in `schema.js`
 *
 * `medication.endsOn` now carries `expiry: true` with a seven-day lead. Three
 * of the four health dates already reached the reminders — a follow-up, a next
 * dose, an appointment — and the tablets running out did not, which is the one
 * a household has to act on *before* the day arrives rather than after it.
 *
 * The reasoning lives in this file because `js/data/schema.js` is at its
 * size ceiling: `tools/module-size.mjs` freezes the six crowded files and
 * three lines of comment there would have failed the gate. The rule is to
 * move prose out rather than raise the number, so the change there is one
 * edited line and the explanation is here.
 */

import { daysUntil } from '../core/dates.js';

/** The kinds of question the records can raise, and what each one is about. */
export const QUESTION = Object.freeze({
  STILL_TAKING: 'stillTaking',
  STOPPED_WHEN: 'stoppedWhen',
  DID_THEY_GO: 'didTheyGo',
  NEXT_DOSE: 'nextDose',
  FOLLOWED_UP: 'followedUp',
});

/**
 * What a medication record says about itself, including saying two things.
 *
 * `ongoing` defaults to true and `endsOn` is optional, so the common shape of
 * a stale record is a course that finished in March still ticked as ongoing.
 * That is a contradiction in one record, not a judgement about whether
 * somebody should still be taking it.
 *
 * @param {{ongoing?: boolean, endsOn?: string, startedOn?: string}} row
 * @param {{clock?: () => number}} [options]
 */
export function medicationState(row, { clock = Date.now } = {}) {
  const ongoing = row?.ongoing !== false;
  const ends = row?.endsOn || '';
  const left = ends ? daysUntil(ends, clock) : null;

  if (ongoing && ends && Number.isFinite(left) && left < 0) {
    return { state: 'contradiction', question: QUESTION.STILL_TAKING, days: left };
  }
  if (!ongoing && !ends) {
    return { state: 'contradiction', question: QUESTION.STOPPED_WHEN, days: null };
  }
  if (!ongoing) return { state: 'ended', question: null, days: left };
  if (ends && Number.isFinite(left)) return { state: 'running', question: null, days: left };
  // Ongoing with no end date is the ordinary shape of a repeat prescription.
  // It is not a contradiction and must not be listed as one.
  return { state: 'open', question: null, days: null };
}

/**
 * What an appointment record says, including one that has quietly gone past.
 *
 * `status` starts at `scheduled` and nothing moves it. An appointment last
 * Tuesday still marked scheduled is the record not knowing whether anybody
 * went — which is worth asking, and is not the same as "missed". Only a person
 * can say that, and `missed` is a value they can choose.
 *
 * @param {{date?: string, status?: string}} row
 * @param {{clock?: () => number}} [options]
 */
export function appointmentState(row, { clock = Date.now } = {}) {
  const status = row?.status || 'scheduled';
  const days = row?.date ? daysUntil(row.date, clock) : null;

  if (status !== 'scheduled') return { state: status, question: null, days };
  if (!Number.isFinite(days)) return { state: 'undated', question: null, days: null };
  if (days < 0) return { state: 'unanswered', question: QUESTION.DID_THEY_GO, days };
  if (days === 0) return { state: 'today', question: null, days };
  return { state: 'upcoming', question: null, days };
}

/**
 * Whether a next dose has been given, answered from the records rather than
 * from the date alone.
 *
 * A vaccination whose `nextDoseOn` was in March is not outstanding if a later
 * dose of the same vaccine, for the same person, was recorded in April. Asking
 * only "is the date in the past" would raise a question the household already
 * answered — and a screen that keeps asking answered questions is one people
 * stop reading.
 *
 * Vaccine names are compared case-folded and trimmed, which is as far as this
 * goes: `Hepatitis B` and `Hep B` are not matched, because guessing that they
 * are the same vaccine is a clinical judgement.
 *
 * @param {{id?: string, person?: string, vaccine?: string, nextDoseOn?: string,
 *          date?: string}} row
 * @param {readonly object[]} all every vaccination on record
 * @param {{clock?: () => number}} [options]
 */
export function doseOutstanding(row, all = [], { clock = Date.now } = {}) {
  const due = row?.nextDoseOn || '';
  if (!due) return { outstanding: false, days: null, laterDose: null };

  const days = daysUntil(due, clock);
  if (!Number.isFinite(days)) return { outstanding: false, days: null, laterDose: null };

  const key = String(row.vaccine ?? '').trim().toLowerCase();
  const later = all.find((one) => one
    && one.id !== row.id
    && one.person === row.person
    && String(one.vaccine ?? '').trim().toLowerCase() === key
    && one.date
    && one.date >= due);

  return { outstanding: !later && days < 0, days, laterDose: later ?? null };
}

/**
 * A follow-up date that has passed, and nothing recording whether it happened.
 *
 * There is no "followed up" field, so this cannot say the follow-up was
 * missed. It says the date went by and the records are silent, which is the
 * true statement.
 *
 * @param {{followUpOn?: string}} row
 * @param {{clock?: () => number}} [options]
 */
export function followUpState(row, { clock = Date.now } = {}) {
  const due = row?.followUpOn || '';
  if (!due) return { state: 'none', days: null };
  const days = daysUntil(due, clock);
  if (!Number.isFinite(days)) return { state: 'none', days: null };
  if (days < 0) return { state: 'passed', days };
  return { state: 'ahead', days };
}

/**
 * Everything the records raise, in one list, worst first.
 *
 * Ordered by how long the question has been unanswered rather than by kind: a
 * prescription that ran out yesterday and one that ran out in January are not
 * the same thing to look at, and grouping by entity would bury the second
 * under whichever kind happened to be listed first.
 *
 * @param {{medications?: readonly object[], appointments?: readonly object[],
 *          vaccinations?: readonly object[], records?: readonly object[]}} sources
 * @param {{clock?: () => number}} [options]
 */
export function openQuestions(sources = {}, { clock = Date.now } = {}) {
  const out = [];

  for (const row of sources.medications ?? []) {
    const said = medicationState(row, { clock });
    if (said.question) {
      out.push({
        question: said.question, entity: 'medication', id: row.id,
        person: row.person, subject: row.name ?? '', days: said.days,
      });
    }
  }

  for (const row of sources.appointments ?? []) {
    const said = appointmentState(row, { clock });
    if (said.question) {
      out.push({
        question: said.question, entity: 'appointment', id: row.id,
        person: row.person, subject: row.title ?? '', days: said.days,
      });
    }
  }

  const vaccinations = sources.vaccinations ?? [];
  for (const row of vaccinations) {
    const said = doseOutstanding(row, vaccinations, { clock });
    if (said.outstanding) {
      out.push({
        question: QUESTION.NEXT_DOSE, entity: 'vaccination', id: row.id,
        person: row.person, subject: row.vaccine ?? '', days: said.days,
      });
    }
  }

  for (const row of sources.records ?? []) {
    const said = followUpState(row, { clock });
    if (said.state === 'passed') {
      out.push({
        question: QUESTION.FOLLOWED_UP, entity: 'healthRecord', id: row.id,
        person: row.person, subject: row.title ?? '', days: said.days,
      });
    }
  }

  /*
   * Longest unanswered first, and a stable tie-break.
   *
   * `days` is negative and every entry here has one, so ascending order puts
   * the oldest at the top. Sorting on `days` alone left two questions from the
   * same day in whatever order the repositories happened to return them, which
   * made a screenshot check flap; the id settles it.
   */
  return out.sort((a, b) => (a.days ?? 0) - (b.days ?? 0)
    || String(a.id).localeCompare(String(b.id)));
}

/**
 * What a phone's health application shows and this one cannot.
 *
 * On the screen, not only in this comment. Somebody who has seen a health app
 * before will look for these, and the difference between "not built" and
 * "cannot be built from what this holds" is the difference between a missing
 * feature and a promise this application must not make.
 */
export const CANNOT_SHOW = Object.freeze([
  'health.absent.sensors',
  'health.absent.vitals',
  'health.absent.cycle',
  'health.absent.interactions',
  'health.absent.adherence',
  'health.absent.advice',
]);
