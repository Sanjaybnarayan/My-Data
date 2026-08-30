/**
 * Automation.
 *
 * Three jobs that would otherwise be somebody remembering:
 *
 *  - **Recurring payments catch up.** A bill due on the 5th is still due on
 *    the 5th next month; a device that was off for two months should show one
 *    upcoming bill, not two months of red.
 *  - **Recurring tasks reappear.** Completing "pay the maid" on a monthly
 *    repeat creates the next one, dated forward.
 *  - **Reminders are delivered.** Once a day at most, for the things actually
 *    inside their lead time.
 *
 * Everything here is pure except `runAutomations`, which is the one function
 * that writes. That split is deliberate: the decisions are testable without a
 * database and the writes are a thin layer over them.
 */

import { today, addDays, addMonths, addYears, daysUntil } from '../core/dates.js';
import { advanceRecurring } from './finance.js';
import { t } from '../core/locale.js';
import {
  allReminders, moneyReminders, mergeReminders, SEVERITY,
  datedEntities, BY_NAME,
} from './reminders.js';

const LAST_RUN_KEY = 'automation.lastRun';
const LAST_NOTIFIED_KEY = 'automation.lastNotified';

/* ------------------------------------------------------------- recurrence */

/** The next date for a repeating task, from the one just completed. */
export function nextOccurrence(repeat, from = today()) {
  switch (repeat) {
    case 'daily': return addDays(from, 1);
    case 'weekly': return addDays(from, 7);
    case 'monthly': return addMonths(from, 1);
    case 'yearly': return addYears(from, 1);
    case 'weekdays': {
      // Friday and Saturday both roll to Monday; a weekday task on a Sunday
      // is a task nobody does.
      let next = addDays(from, 1);
      for (let guard = 0; guard < 7; guard++) {
        const day = new Date(`${next}T00:00:00`).getDay();
        if (day !== 0 && day !== 6) return next;
        next = addDays(next, 1);
      }
      return next;
    }
    default: return null;
  }
}

/**
 * Which recurring payments need their due date moved on, and to what.
 * Returns only the ones that change, so a no-op run writes nothing.
 */
export function recurringToAdvance(payments, from = today()) {
  return payments
    .filter((payment) => !payment.deletedAt && payment.active !== false)
    .filter((payment) => payment.nextDueOn && payment.nextDueOn < from)
    .map((payment) => ({ payment, nextDueOn: advanceRecurring(payment, from) }))
    .filter((row) => row.nextDueOn !== row.payment.nextDueOn);
}

/**
 * Tasks completed on a repeat that have no successor yet. Matching on title
 * and project rather than a link field, because a repeating task is a series
 * a person recognises by its name.
 */
export function tasksToRepeat(tasks, from = today()) {
  const open = tasks.filter((t) => !t.deletedAt && t.status !== 'done');
  const hasOpenTwin = (task) => open.some(
    (other) => other.title === task.title && other.project === task.project,
  );

  return tasks
    .filter((task) => !task.deletedAt)
    .filter((task) => task.status === 'done' && task.repeat && task.repeat !== 'none')
    .filter((task) => !hasOpenTwin(task))
    .map((task) => ({
      task,
      next: {
        title: task.title,
        description: task.description,
        status: 'todo',
        priority: task.priority,
        assignee: task.assignee,
        project: task.project,
        repeat: task.repeat,
        tags: task.tags,
        dueOn: nextOccurrence(task.repeat, task.completedOn || task.dueOn || from),
      },
    }))
    .filter((row) => row.next.dueOn);
}

/* ----------------------------------------------------------- notifications */

/**
 * What is worth interrupting somebody for. Only the urgent and the overdue —
 * a notification for something six weeks out teaches people to dismiss
 * notifications.
 */
export function notifiableReminders(reminders) {
  return reminders
    .filter((reminder) => {
      if (reminder.group === 'date') return reminder.days <= 1;
      return reminder.days <= 7;
    })
    // Sorted here, because the digest shows the first one and the callers
    // compose *two* already-sorted lists — which does not make a sorted list.
    // Without this the notification led with a passport six days out while
    // ₹35,000 of rent fell due tomorrow.
    .sort((a, b) => {
      const bySeverity = (SEVERITY[a.severity] ?? 9) - (SEVERITY[b.severity] ?? 9);
      return bySeverity !== 0 ? bySeverity : a.days - b.days;
    });
}

/**
 * One notification for one thing, a digest for several.
 *
 * ## Why this says how many and how urgent, and never what
 *
 * The body used to be `describeReminder(reminders[0])`, which is the right
 * sentence for the assistant and for a screen and the wrong one here. It
 * produced, verbatim from the tests that asserted it:
 *
 *     "KA01AB1234: PUC expiry expired 3 days ago"
 *     "Rent is due in 1 day (₹35,000.00)"
 *
 * **A notification is read off a lock screen by whoever is holding the
 * phone.** This application has a PIN and locks itself, which is a statement
 * that its contents need authentication — and this was posting a vehicle
 * registration number and a household's rent, with the amount, outside it.
 * v8.0 names notifications in the same breath as URLs and console logs.
 *
 * `describeReminder` is unchanged and still says everything, in the places
 * that are behind the lock. What is lost here is nothing a person needs from a
 * notification: its job is to get somebody to open the application, and the
 * application then tells them everything.
 */
export function notificationFor(reminders) {
  if (!reminders.length) return null;

  const overdue = reminders.filter((r) => r.days < 0).length;
  const n = reminders.length;

  // `tag` is never displayed — it is the browser's key for replacing an
  // earlier notification — so a record id here discloses nothing.
  const tag = n === 1 ? reminders[0].id : 'familyos-digest';

  if (overdue) {
    return {
      title: t('notify.push.title', { n }),
      body: t('notify.push.lapsed', { overdue }),
      tag,
    };
  }

  // Soonest first: `notifiableReminders` sorts by severity then by days, so
  // the head is what the household would want to be told about.
  const days = Math.max(0, Number(reminders[0].days) || 0);
  return {
    title: t('notify.push.title', { n }),
    body: days === 0 ? t('notify.push.today') : t('notify.push.soon', { days }),
    tag,
  };
}

export async function requestNotificationPermission() {
  if (!globalThis.Notification) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  // Only ever asked from a click in Settings. A permission prompt on load is
  // the fastest way to have it denied forever.
  return Notification.requestPermission();
}

export function canNotify() {
  return Boolean(globalThis.Notification) && Notification.permission === 'granted';
}

/* --------------------------------------------------------------- the run */

/**
 * Run everything due. Safe to call on every launch — it is idempotent within
 * a day, and each piece writes only what changed.
 *
 * @param {object} db
 * @param {{clock?: () => number, notify?: boolean}} [options]
 */
export async function runAutomations(db, { clock = Date.now, notify = true } = {}) {
  const now = today(clock);
  const result = { advanced: 0, repeated: 0, notified: 0, skipped: false };

  // Claimed, not read. See `claimMeta`: this used to read the marker here and
  // write it at the end of the run, so two tabs opening together both read
  // yesterday and both did the work.
  if (!(await db.claimMeta(LAST_RUN_KEY, now))) {
    result.skipped = true;
    return result;
  }

  /* recurring payments */
  try {
    const payments = await db.repo('recurringPayment').list({ decrypt: false, limit: 2000 });
    for (const { payment, nextDueOn } of recurringToAdvance(payments, now)) {
      await db.repo('recurringPayment').update(payment.id, { nextDueOn });
      result.advanced++;
    }
  } catch {
    // A role that cannot write recurring payments simply does not advance
    // them; the dashboard still reads the dates correctly.
  }

  /* repeating tasks */
  try {
    const tasks = await db.repo('task').list({ decrypt: false, limit: 5000 });
    for (const { next } of tasksToRepeat(tasks, now)) {
      await db.repo('task').create(next);
      result.repeated++;
    }
  } catch { /* same */ }

  /* reminders */
  if (notify && canNotify()) {
    // The same claim, for the same reason: two tabs would otherwise each
    // decide the digest was theirs to send.
    if (await db.claimMeta(LAST_NOTIFIED_KEY, now)) {
      /*
       * Derived, not named.
       *
       * This was a hand-written list of thirteen entities beside a derivation
       * that produces exactly this — the fault this repository has found more
       * times than any other, and the dashboard's own loader carries a comment
       * about learning it. Eight dated entities were missing: a vehicle
       * service, a health follow-up, a course of medicine, a next dose, a
       * school fee, a warranty, a tenancy and a recurring payment. None of
       * them could ever have produced a notification.
       */
      const data = {};
      for (const name of [...new Set([...datedEntities(), ...BY_NAME])]) {
        try {
          data[name] = await db.repo(name).list({ decrypt: false, limit: 5000 });
        } catch {
          data[name] = [];
        }
      }

      // Money is loaded into a *separate* bag, so the two questions stay
      // separate — but the bags are allowed to overlap now, because
      // `mergeReminders` drops an expiry row that a bill already covers for
      // the same record and date. That used to be arranged by keeping
      // `recurringPayment` out of the first list by hand, which worked for it
      // and not for `subscription` or `digitalAsset`, both of which were in
      // both lists and reported twice.
      const moneyData = {};
      for (const name of ['recurringPayment', 'loan', 'account', 'transaction',
        'subscription', 'digitalAsset']) {
        try {
          moneyData[name] = await db.repo(name).list({ decrypt: false, limit: 5000 });
        } catch {
          moneyData[name] = [];
        }
      }

      const due = notifiableReminders(mergeReminders(
        allReminders(data, { clock }),
        moneyReminders(moneyData, { clock, days: 7 }),
      ));
      const notification = notificationFor(due);
      if (notification) {
        try {
          // eslint-disable-next-line no-new -- the Notification constructor is the API
          new Notification(notification.title, {
            body: notification.body,
            tag: notification.tag,
            icon: './assets/icon-192.png',
            badge: './assets/icon-192.png',
          });
          result.notified = due.length;
        } catch {
          // Some browsers only allow notifications from a service worker
          // registration; failing here is not worth surfacing.
        }
      }
      // Nothing written here: `claimMeta` above already took the marker, and a
      // second write would be a second writer for one fact.
    }
  }

  return result;
}

export { daysUntil };
