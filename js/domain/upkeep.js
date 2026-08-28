/**
 * Two small things the secondary modules' records say about themselves.
 *
 * Both are the shape this repository keeps finding: a record holding two
 * facts that contradict each other, where no single list can show it.
 *
 * ## A task that is done, and a date that disagrees
 *
 * The two directions do not arise the same way, and it is worth being exact
 * about which is which.
 *
 * **A completion date on a task that is not done** has no rule anywhere. It is
 * freely creatable through the ordinary form: set a date, leave the status
 * open, and the record now says two things.
 *
 * **`done` with no completion date** is refused at the write path —
 * `js/data/validate.js` carries *"A completed task needs a completion date"* —
 * so the form cannot produce one. It can still arrive, because
 * `Repository.applyRemote` writes a row coming back from the household's own
 * spreadsheet with no validation at all, deliberately, since a sync that
 * rejected a row would lose it. Somebody editing the Tasks sheet by hand is
 * the path, and it is the same one that lets an unchecked URL reach a screen.
 *
 * Both are reported. The second is rarer and is the more interesting of the
 * two, because a household would have no idea a hand edit had produced a
 * record the application would refuse to create.
 *
 * Neither is called "overdue" here. `dueOn` already produces a reminder and
 * the Notifications tab already lists it; saying it twice on another screen
 * would be two counts of the same thing.
 *
 * ## Whether anybody could be reached
 *
 * `emergencyContact.priority` orders the list. What matters is not the
 * ordering but whether there is a first contact at all, and whether two
 * contacts claim the same position — because the one thing this list exists
 * for is somebody reading it under pressure, and "who do I ring first" has to
 * have one answer.
 *
 * A contact with no phone number is worth naming for the same reason. An
 * address and an email are not what anybody uses in the first ten minutes.
 */

const live = (row) => Boolean(row) && !row.deletedAt;
const text = (value) => String(value ?? '').trim();

export const TASK = Object.freeze({
  DONE_NO_DATE: 'doneNoDate',
  DATE_NOT_DONE: 'dateNotDone',
});

/**
 * Tasks whose status and completion date disagree.
 *
 * @param {readonly object[]} tasks
 */
export function taskContradictions(tasks = []) {
  const out = [];
  for (const task of tasks.filter(live)) {
    const done = task.status === 'done';
    const when = text(task.completedOn);
    if (done && !when) out.push({ task, kind: TASK.DONE_NO_DATE });
    else if (!done && when) out.push({ task, kind: TASK.DATE_NOT_DONE });
  }
  return out.sort((a, b) => String(a.task.title ?? '').localeCompare(String(b.task.title ?? '')));
}

export const REACH = Object.freeze({
  NOBODY: 'nobody',
  NO_FIRST: 'noFirst',
  TIED: 'tied',
  NO_PHONE: 'noPhone',
  READY: 'ready',
});

/**
 * Whether this list could actually be used in a hurry.
 *
 * Returns every finding rather than the first, because a list can be missing a
 * first contact *and* have somebody with no number, and fixing one would
 * otherwise reveal the other a week later.
 *
 * @param {readonly object[]} contacts
 * @returns {{state: string, findings: {kind: string, contacts?: object[]}[]}}
 */
export function reachability(contacts = []) {
  const rows = contacts.filter(live);
  if (!rows.length) return { state: REACH.NOBODY, findings: [{ kind: REACH.NOBODY }] };

  /** @type {{kind: string, contacts?: object[]}[]} */
  const findings = [];

  const numbered = rows
    .map((one) => ({ one, priority: Number(one.priority) }))
    .filter(({ priority }) => Number.isFinite(priority));

  if (!numbered.length) {
    findings.push({ kind: REACH.NO_FIRST });
  } else {
    const first = Math.min(...numbered.map(({ priority }) => priority));
    const tied = numbered.filter(({ priority }) => priority === first);
    if (tied.length > 1) {
      findings.push({ kind: REACH.TIED, contacts: tied.map(({ one }) => one) });
    }
  }

  const unreachable = rows.filter((one) => !text(one.phone) && !text(one.altPhone));
  if (unreachable.length) findings.push({ kind: REACH.NO_PHONE, contacts: unreachable });

  return { state: findings.length ? findings[0].kind : REACH.READY, findings };
}
