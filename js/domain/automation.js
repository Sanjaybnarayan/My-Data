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
import { allReminders, describeReminder } from './reminders.js';

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
  return reminders.filter((reminder) => {
    if (reminder.group === 'date') return reminder.days <= 1;
    return reminder.days <= 7;
  });
}

/** One notification for one thing, a digest for several. */
export function notificationFor(reminders) {
  if (!reminders.length) return null;
  if (reminders.length === 1) {
    return { title: 'FamilyOS', body: describeReminder(reminders[0]), tag: reminders[0].id };
  }
  const overdue = reminders.filter((r) => r.days < 0).length;
  return {
    title: `${reminders.length} things need attention`,
    body: [
      overdue ? `${overdue} already lapsed` : null,
      describeReminder(reminders[0]),
    ].filter(Boolean).join(' · '),
    tag: 'familyos-digest',
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

  const lastRun = await db.meta(LAST_RUN_KEY);
  if (lastRun === now) {
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
    const lastNotified = await db.meta(LAST_NOTIFIED_KEY);
    if (lastNotified !== now) {
      const data = {};
      for (const name of ['policy', 'vehicle', 'document', 'identityDocument',
        'subscription', 'digitalAsset', 'holding', 'property', 'certificate',
        'person', 'importantDate', 'task', 'appointment']) {
        try {
          data[name] = await db.repo(name).list({ decrypt: false, limit: 5000 });
        } catch {
          data[name] = [];
        }
      }

      const due = notifiableReminders(allReminders(data, { clock }));
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
      await db.setMeta(LAST_NOTIFIED_KEY, now);
    }
  }

  await db.setMeta(LAST_RUN_KEY, now);
  return result;
}

export { daysUntil };
