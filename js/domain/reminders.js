/**
 * Reminders.
 *
 * Every date in FamilyOS that has a deadline is marked `expiry` in the schema
 * with a lead time. This file walks the schema, not a hand-written list, so a
 * new expiry date added to any entity produces reminders the same day —
 * nobody has to remember to register it, which is how a PUC certificate ends
 * up being the one thing the system did not warn about.
 *
 * Anniversaries (birthdays, wedding dates) are handled separately: they repeat
 * yearly and are never "overdue".
 */

import { entities } from '../data/schema.js';
import { daysUntil, daysBetween, nextAnniversary, today, ageOn } from '../core/dates.js';

export const SEVERITY = { overdue: 0, urgent: 1, soon: 2, upcoming: 3 };

function severityFor(days, lead) {
  if (days < 0) return 'overdue';
  if (days <= Math.min(7, lead)) return 'urgent';
  if (days <= Math.max(14, Math.round(lead / 2))) return 'soon';
  return 'upcoming';
}

/**
 * @param {Record<string, object[]>} recordsByEntity
 * @param {{horizonDays?: number, clock?: () => number}} [options]
 * @returns {Array<{id, entity, recordId, field, label, date, days, severity, title}>}
 */
export function expiryReminders(recordsByEntity, { horizonDays = 45, clock = Date.now } = {}) {
  const out = [];

  for (const [entityName, def] of Object.entries(entities)) {
    const rows = recordsByEntity[entityName];
    if (!rows?.length) continue;

    const expiryFields = def.fields.filter((f) => f.expiry);
    if (!expiryFields.length) continue;

    for (const record of rows) {
      if (record.deletedAt) continue;
      // A cancelled policy or a closed loan should not keep reminding.
      if (record.active === false) continue;

      for (const field of expiryFields) {
        const date = record[field.key];
        if (!date) continue;

        const days = daysUntil(date, clock);
        if (!Number.isFinite(days)) continue;

        const lead = field.expiryLead ?? horizonDays;
        // Overdue items stay visible for a month, then stop nagging — a
        // permanent red badge is one people learn to ignore.
        if (days > lead || days < -30) continue;

        out.push({
          id: `${entityName}:${record.id}:${field.key}`,
          entity: entityName,
          module: def.module,
          recordId: record.id,
          field: field.key,
          label: field.label,
          title: String(def.title(record) ?? def.labels.one),
          date,
          days,
          severity: severityFor(days, lead),
        });
      }
    }
  }

  return out.sort((a, b) => a.days - b.days);
}

/**
 * Birthdays and anniversaries coming up, with the age they turn.
 *
 * `days` is the **default** lead, not a ceiling. An important date carries its
 * own `remindDaysBefore`, and until this read it that field was collected on
 * the form and ignored — a household asking to be told ninety days before a
 * visa renewal got forty-five, and one asking for two days before the bins
 * went out got nagged from twenty.
 *
 * This mirrors what `expiryReminders` above already does with `expiryLead`: the
 * per-record lead wins where there is one, and it may reach further out than
 * the caller's default, because that is what asking for it means.
 */
export function upcomingDates(people, importantDates, { days = 45, from = today() } = {}) {
  const out = [];

  for (const person of people ?? []) {
    if (person.deletedAt || !person.birthday || person.deceasedOn) continue;
    const next = nextAnniversary(person.birthday, from);
    const away = daysBetween(from, next);
    if (away > days) continue;
    out.push({
      id: `birthday:${person.id}`,
      kind: 'birthday',
      title: `${person.name}'s birthday`,
      personId: person.id,
      date: next,
      days: away,
      turning: ageOn(person.birthday, next),
    });
  }

  for (const record of importantDates ?? []) {
    if (record.deletedAt) continue;
    const next = record.recurring === false ? record.date : nextAnniversary(record.date, from);
    if (!next) continue;
    // Measured from `from`, not from the wall clock. The two agree in the
    // application, where `from` defaults to today — and disagree for any
    // caller that passes one, including `allReminders` with an injected clock,
    // which was already resolving the clock to a day for exactly this reason
    // and then losing it here.
    const away = daysBetween(from, next);
    // `??` rather than `||`: nought is a preference — "tell me on the day" —
    // and falling through to the default would overrule somebody who said so.
    const lead = record.remindDaysBefore ?? days;
    if (away < 0 || away > lead) continue;
    out.push({
      id: `date:${record.id}`,
      kind: record.kind,
      title: record.title,
      personId: record.person,
      date: next,
      days: away,
      turning: record.kind === 'anniversary' ? ageOn(record.date, next) : null,
    });
  }

  return out.sort((a, b) => a.days - b.days);
}

/**
 * One list, ordered the way a person would want to see it: what is already
 * late, then what is about to be, then the pleasant things.
 */
export function allReminders(data, options = {}) {
  const { clock = Date.now, horizonDays = 45 } = options;
  const expiries = expiryReminders(data, { horizonDays, clock });
  // `upcomingDates` works in calendar days, so the clock has to be resolved
  // to one here — passing the clock straight through would leave it using the
  // wall clock while the expiries used the injected one.
  const dates = upcomingDates(data.person, data.importantDate, {
    days: horizonDays,
    from: today(clock),
  });

  return [
    ...expiries.map((r) => ({ ...r, group: 'expiry' })),
    ...dates.map((d) => ({ ...d, group: 'date', severity: d.days <= 3 ? 'urgent' : 'upcoming' })),
  ].sort((a, b) => {
    const bySeverity = SEVERITY[a.severity] - SEVERITY[b.severity];
    return bySeverity !== 0 ? bySeverity : a.days - b.days;
  });
}

/** A sentence for a notification or the assistant. */
export function describeReminder(reminder) {
  if (reminder.group === 'date') {
    const turning = reminder.turning ? ` (turning ${reminder.turning})` : '';
    return reminder.days === 0
      ? `${reminder.title} is today${turning}`
      : `${reminder.title} in ${reminder.days} days${turning}`;
  }
  if (reminder.days < 0) {
    return `${reminder.title}: ${reminder.label.toLowerCase()} expired ${-reminder.days} days ago`;
  }
  if (reminder.days === 0) {
    return `${reminder.title}: ${reminder.label.toLowerCase()} expires today`;
  }
  return `${reminder.title}: ${reminder.label.toLowerCase()} in ${reminder.days} days`;
}
