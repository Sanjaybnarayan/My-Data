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
import { format } from '../core/money.js';
import { upcomingBills } from './finance.js';
import { phraseKey, tenseFor } from './duewords.js';
import { t } from '../core/locale.js';

export const SEVERITY = { overdue: 0, urgent: 1, soon: 2, upcoming: 3 };

function severityFor(days, lead) {
  if (days < 0) return 'overdue';
  if (days <= Math.min(7, lead)) return 'urgent';
  if (days <= Math.max(14, Math.round(lead / 2))) return 'soon';
  return 'upcoming';
}

/**
 * The warning window the schema declares for one expiry field.
 *
 * One place, because the alternative is what this file found: a number typed
 * into a screen beside a number declared in the schema, agreeing until one of
 * them changes.
 *
 * @param {string} entityName
 * @param {string} fieldKey
 * @param {number} [fallback] when the field declares none
 */
export function leadFor(entityName, fieldKey, fallback = 45) {
  const field = (entities[entityName]?.fields ?? []).find((one) => one.key === fieldKey);
  return Number.isFinite(field?.expiryLead) ? field.expiryLead : fallback;
}

/**
 * @param {Record<string, object[]>} recordsByEntity
 * @param {{horizonDays?: number, clock?: () => number}} [options]
 * @returns {Array<{id, entity, module, recordId, field, label, date, days, lead,
 *   severity, title}>}
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
          // The window this row was judged against, carried out with it.
          //
          // Screens were re-deciding urgency with a flat 30 days while the
          // severity above used the field's own lead. A passport is warned
          // about 180 days out, so one 100 days from expiry was listed under
          // "Expiring & due" wearing a green badge — the screen disagreeing
          // with itself about the row it had just chosen to show.
          lead,
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
 * Every dated thing inside a window, whatever its reminder lead.
 *
 * ## Why this is not `expiryReminders`
 *
 * A reminder lead answers *"how long before this should I be nagged?"*, and
 * seven days is right for a broadband bill. A calendar asks a different
 * question — *"what falls in September?"* — and the answer must not depend on
 * how early anybody wanted warning.
 *
 * The calendar screen called `expiryReminders` with `horizonDays: 400` so that
 * paging back and forth would work. It never worked, because `horizonDays` is
 * only a **fallback** for fields carrying no `expiryLead` of their own:
 *
 *     const lead = field.expiryLead ?? horizonDays;
 *     if (days > lead) continue;
 *
 * So a recurring payment (lead 7) vanished from the grid eight days out, a
 * policy (lead 30) at thirty-one, and paging one month forward showed almost
 * nothing. Measured on a household with nine dated things across four months,
 * the calendar drew **three** — under a subtitle promising *"every renewal
 * date"*.
 *
 * Anniversaries are deliberately not here: they repeat yearly and come from
 * `upcomingDates`, which the caller composes alongside.
 *
 * @param {Record<string, object[]>} recordsByEntity
 * @param {{from: string, to: string}} window inclusive, in calendar days
 */
export function datesInRange(recordsByEntity, { from, to }) {
  const out = [];

  for (const [entityName, def] of Object.entries(entities)) {
    const rows = recordsByEntity[entityName];
    if (!rows?.length) continue;

    const expiryFields = def.fields.filter((f) => f.expiry);
    if (!expiryFields.length) continue;

    for (const record of rows) {
      if (record.deletedAt) continue;
      // A cancelled policy or a closed subscription is not on the calendar
      // either — the same rule the reminders use, for the same reason.
      if (record.active === false) continue;

      for (const field of expiryFields) {
        const date = record[field.key];
        if (!date || date < from || date > to) continue;

        out.push({
          id: `${entityName}:${record.id}:${field.key}`,
          entity: entityName,
          module: def.module,
          recordId: record.id,
          field: field.key,
          label: field.label,
          title: String(def.title(record) ?? def.labels.one),
          date,
        });
      }
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
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

/**
 * Money due, in the shape a reminder is in.
 *
 * ## Why this is beside `allReminders` and not inside it
 *
 * `allReminders` answers *"which dated records need attention?"* — an expiry,
 * a birthday. It has four callers, and two of them (the dashboard and the
 * report builder) already show bills through their own widget. Folding money
 * into it would have those two count every bill twice.
 *
 * The notifier is asking a different question: *"what is worth interrupting
 * somebody for?"* — and the answer to that plainly includes ₹35,000 of rent
 * due tomorrow. So this is a second function beside the first, which is the
 * same remedy `datesInRange` and `billsInRange` took, for the same reason.
 *
 * ## What it was fixing
 *
 * The notifier read thirteen entity types and **not one of them carries a
 * bill**. A household was told its passport expires in six days and told
 * nothing at all about the rent due tomorrow or the EMI three days after —
 * ₹53,500 a month of committed outflow, invisible to every notification the
 * application sends.
 *
 * That is the third appearance of one shape: money reached no calendar square,
 * then reached one square a year, and now reaches no notification.
 *
 * @param {object} data records by entity name
 * @param {{from?: string, days?: number, clock?: () => number}} [options]
 */
export function moneyReminders(data, { from = null, days = 45, clock = Date.now } = {}) {
  const start = from ?? today(clock);

  // `upcomingBills`, not `billsInRange`: the question here is "what is due
  // soon", which is the one `upcomingBills` actually answers. The other fills
  // a calendar window, and asking it this would be the mistake this project
  // already has a name for.
  const bills = upcomingBills(data.recurringPayment ?? [], data.loan ?? [], {
    days,
    from: start,
    accounts: data.account ?? null,
    transactions: data.transaction ?? null,
    subscriptions: data.subscription ?? null,
    digitalAssets: data.digitalAsset ?? null,
  });

  return bills.map((bill) => {
    const away = bill.days ?? daysBetween(start, bill.dueOn);
    return {
      id: `bill:${bill.id}`,
      entity: bill.entity,
      module: 'finance',
      recordId: bill.recordId,
      field: 'dueOn',
      label: 'Due',
      title: bill.name,
      date: bill.dueOn,
      days: away,
      // A card bill with no statement day has a date and no amount. Left null
      // rather than defaulted to zero — which is how `billsTotal` already
      // tells the two apart — so a sentence can say the amount is not known
      // instead of saying the bill is free.
      amount: bill.amount ?? null,
      autoDebit: Boolean(bill.autoDebit),
      group: 'money',
      severity: severityFor(away, days),
    };
  }).sort((a, b) => a.days - b.days);
}

/** Entities carrying at least one field the schema marks as an expiry. */
export function datedEntities(schema = entities) {
  return Object.entries(schema)
    .filter(([, def]) => def.fields.some((field) => field.expiry))
    .map(([name]) => name);
}

/**
 * The entities `moneyReminders` and `upcomingDates` read that carry no expiry
 * field of their own, so the derivation above cannot find them.
 *
 * Named here rather than merged into the list above, because they are inputs
 * to a different question and lumping them together would hide that.
 */
export const BY_NAME = Object.freeze(['person', 'importantDate', 'recurringPayment', 'loan']);

/**
 * One record, one date, said once.
 *
 * ## What was on the Notifications tab
 *
 * A subscription renewing on the 18th produced two rows and counted two
 * against the badge:
 *
 *     expiry  subscription:s1:renewsOn          Netflix renews in 3 days
 *     money   bill:subscription:s1:2026-06-18   Netflix is due in 3 days (₹6.49)
 *
 * The same fact twice, because `subscription` and `digitalAsset` carry a
 * `renewsOn` the schema marks as an expiry *and* are read by `upcomingBills`.
 * The comment in `domain/automation.js` says the two bags were kept apart
 * precisely so this could not happen — and it worked for `recurringPayment`,
 * which is in only one of them, while these two were in both.
 *
 * ## Why the money row is the one kept
 *
 * Because it carries the amount, and the amount is the reason a renewal is
 * worth interrupting somebody for. `describeReminder` already says so about
 * bills. Dropping the money row instead would keep the shorter sentence and
 * lose the figure.
 *
 * ## Why it is here rather than in either caller
 *
 * `attentionFrom` and the notification digest both compose these two lists,
 * and `services/attention.js` gives the reason it must be one implementation:
 * the count on the Notifications tab and the card on the Dashboard have to be
 * the same arithmetic rather than two that can disagree about what needs
 * attention. A dedupe in one of them would have been a third opinion.
 *
 * Matched on entity, record and date — not on record alone. A policy can carry
 * a renewal date and a separate expiry, and those are two things to know.
 *
 * @param {readonly object[]} dated rows from `allReminders`
 * @param {readonly object[]} money rows from `moneyReminders`
 */
export function mergeReminders(dated = [], money = []) {
  /*
   * Only complete rows go in, and that is the whole guard.
   *
   * A card bill assembled from statements has no single record behind it, so
   * its `recordId` is undefined. Two such rows would both key as
   * `policy:undefined:2026-06-18` — one key — and an unrelated expiry falling
   * on the same day would vanish. Building the set from complete rows only
   * means an incomplete key can never be found in it, so the lookup below
   * needs no second guard of its own.
   *
   * It had one, and the pair was untestable: either half alone prevented the
   * fault, so removing either one broke nothing and no check could fail.
   */
  const covered = new Set(
    money.filter((one) => one?.recordId && one?.date)
      .map((one) => `${one.entity}:${one.recordId}:${one.date}`),
  );

  const kept = dated.filter(
    (one) => !covered.has(`${one?.entity}:${one?.recordId}:${one?.date}`),
  );

  return [...kept, ...money];
}

/** A sentence for a notification or the assistant. */
export function describeReminder(reminder, money = format) {
  if (reminder.group === 'money') {
    const when = reminder.days < 0
      ? `was due ${-reminder.days} ${-reminder.days === 1 ? 'day' : 'days'} ago`
      : reminder.days === 0 ? 'is due today'
        : `is due in ${reminder.days} ${reminder.days === 1 ? 'day' : 'days'}`;
    // The amount is the reason a bill is worth interrupting somebody for, so
    // it is in the sentence — except where it genuinely is not known, which is
    // said rather than filled in with a zero.
    const sum = reminder.amount === null || reminder.amount === undefined
      ? ' (amount not known yet)'
      : ` (${money(reminder.amount)})`;
    return `${reminder.title} ${when}${sum}`;
  }

  if (reminder.group === 'date') {
    const turning = reminder.turning ? ` (turning ${reminder.turning})` : '';
    return reminder.days === 0
      ? `${reminder.title} is today${turning}`
      : `${reminder.title} in ${reminder.days} days${turning}`;
  }
  /*
   * The phrase comes from the field, not from conjugating its label.
   *
   * This used to paste the schema label in front of a verb, and the label of
   * an expiry field is already a phrase — so every dated entity produced at
   * least one line like "X: expires on expires today" or "X: next dose on
   * expired 3 days ago". The second of those is not just clumsy: a next dose
   * does not expire, and saying so is a claim about somebody's vaccination
   * that this application is in no position to make. See `domain/duewords.js`.
   */
  const tense = tenseFor(reminder.days);
  const key = tense ? phraseKey(reminder.field, tense) : null;

  /*
   * No phrase, no invented verb.
   *
   * A field nobody has written words for falls back to naming the date rather
   * than guessing at what it does. `tests/duewords.test.mjs` fails on any
   * `expiry: true` field that reaches here, so this branch should never be
   * seen — but seeing "Passport — Expires on: 3 days ago" is better than
   * seeing a sentence that says something untrue.
   */
  if (!key) {
    return t('due.unknown', {
      title: reminder.title,
      label: reminder.label ?? reminder.field ?? '',
      when: sayDays(reminder.days),
    });
  }

  const phrase = t(key);
  if (reminder.days === 0) return t('due.line.today', { title: reminder.title, phrase });
  const days = Math.abs(reminder.days);
  const plural = days === 1 ? 'one' : 'many';
  return t(`due.line.${tense}.${plural}`, { title: reminder.title, phrase, days });
}

/** A bare number of days, for the fallback that should never be reached. */
function sayDays(days) {
  if (!Number.isFinite(days)) return t('due.noDate');
  if (days === 0) return t('due.line.today.bare');
  const n = Math.abs(days);
  const plural = n === 1 ? 'one' : 'many';
  return t(`due.bare.${days < 0 ? 'past' : 'ahead'}.${plural}`, { days: n });
}
