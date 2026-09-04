/**
 * Every file that has been imported, and how to take one back out.
 *
 * ## The gap this closes
 *
 * Importing a statement wrote two things: a record that the file was read,
 * and one transaction per row. The record was listed under Statements and
 * could be deleted, which removed the record and left every row it created —
 * so the totals stayed wrong, and the one thing naming the file those rows
 * came from had just been thrown away. There was no way back from a file
 * imported by mistake.
 *
 * An import is a pair. Undoing one removes both halves together, and says
 * exactly what it is about to remove first: a file, a date range, a count, and
 * what those rows come to. "Delete?" is a gamble; "this removes 412
 * transactions worth ₹3,40,000 between 1 and 31 May" is a decision.
 *
 * ## It is still a soft delete
 *
 * Both halves are stamped, not erased, and both come back from Settings →
 * Deleted items. Which matters most for exactly this screen: the file somebody
 * meant to remove and the file they clicked are not always the same one.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, button, badge, empty, listItem, metric, money, divider,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { confirm } from '../ui/components/modal.js';
import { app } from '../context.js';
import { importList, orphanedTransactions, planUndo } from '../domain/imports.js';
import { format, formatCompact, addable } from '../core/money.js';
import { formatDay } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { TRANSACTION_LIMIT } from '../services/service.js';
import { t } from '../core/locale.js';

export async function render() {
  const { db } = app();

  const host = h('div', {});
  let busy = false;

  await load();
  return { node: host };

  async function load() {
    const [statements, transactions, accounts] = await Promise.all([
      db.repo('bankStatement').list({ decrypt: false, limit: 5000 }),
      db.repo('transaction').list({ decrypt: false, limit: TRANSACTION_LIMIT }),
      db.repo('account').list({ decrypt: false, limit: 500 }),
    ]);

    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    paint(importList(statements, transactions),
      orphanedTransactions(statements, transactions), accountName);
  }

  /* ---------------------------------------------------------------- undoing */

  async function undo(entry) {
    const plan = planUndo(entry);

    const ok = await confirm({
      title: `Remove ${entry.fileName}?`,
      message: plan.onlyTheRecord
        ? 'None of its transactions are still here, so this removes only the record '
          + 'that the file was imported. Importing it again will work normally.'
        : `This removes the record of the file and the ${plan.count} `
          + `${plan.count === 1 ? 'transaction' : 'transactions'} it created`
          + (plan.from ? `, dated ${formatDay(plan.from)} to ${formatDay(plan.to)}` : '')
          + `. That is ${format(plan.moneyIn)} in and ${format(plan.moneyOut)} out, `
          + 'which will come off every total in the app.\n\n'
          + 'Both come back from Settings → Deleted items, and importing the file '
          + 'again will work normally.',
      confirmLabel: plan.onlyTheRecord ? 'Remove the record' : `Remove ${plan.count} rows`,
      danger: true,
    });
    if (!ok) return;

    busy = true;
    let removed = 0;

    try {
      // Rows first. If this is interrupted half way the statement is still
      // there naming what is left, which is recoverable; a statement deleted
      // before its rows would leave them orphaned, which is the state this
      // whole screen exists to prevent.
      for (const id of plan.transactionIds) {
        await db.repo('transaction').remove(id);
        removed += 1;
      }
      await db.repo('bankStatement').remove(plan.statementId);

      toast(plan.onlyTheRecord
        ? `${entry.fileName} removed`
        : `${entry.fileName} and ${removed} transactions removed`, { kind: 'success' });
    } catch (err) {
      toast(`${userMessage(err)} — ${removed} of ${plan.count} rows were removed`,
        { kind: 'error' });
    } finally {
      busy = false;
      await load();
    }
  }

  /**
   * Rows whose statement is already gone.
   *
   * Offered as one action rather than a list: there is nothing left to tell
   * them apart by, which is exactly why they are a problem.
   */
  async function clearOrphans(orphans) {
    const total = orphans.reduce((sum, row) => sum + addable(row.amount), 0);

    const ok = await confirm({
      title: `Remove ${orphans.length} orphaned transactions?`,
      message: `These came from statements that have since been deleted, so nothing `
        + `says which file they belong to any more. Together they come to ${format(total)}.`
        + '\n\nThey come back from Settings → Deleted items.',
      confirmLabel: 'Remove them',
      danger: true,
    });
    if (!ok) return;

    busy = true;
    try {
      for (const row of orphans) await db.repo('transaction').remove(row.id);
      toast(`${orphans.length} orphaned transactions removed`, { kind: 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    } finally {
      busy = false;
      await load();
    }
  }

  /* -------------------------------------------------------------- painting */

  function paint(entries, orphans, accountName) {
    const rows = entries.reduce((sum, entry) => sum + entry.count, 0);

    replace(host, [
      card({ class: 'card--tight' }, [
        cardHeader('Imported files', [
          button('Import more', {
            iconName: 'upload',
            onClick: () => app().router.navigate({ module: 'finance', entity: 'import' }),
          }),
        ], {
          subtitle: entries.length
            ? `${entries.length} ${entries.length === 1 ? 'file' : 'files'}, ${rows} transactions`
            : 'Nothing imported yet',
          iconName: 'receipt',
        }),
        h('p', { class: 'small muted' },
          'A statement is read on this device and never uploaded, so what is kept is '
          + 'the record of the file and the rows it produced. Removing one removes '
          + 'both — and both come back from Settings → Deleted items.'),
      ]),

      orphans.length ? orphanCard(orphans) : null,

      entries.length
        ? h('div', {}, entries.map((entry) => fileCard(entry, accountName)))
        : empty({
          title: 'No files imported',
          message: 'Statements you import appear here, and can be removed along with '
            + 'every transaction they created.',
          iconName: 'file',
          action: button('Import statements', {
            variant: 'primary',
            onClick: () => app().router.navigate({ module: 'finance', entity: 'import' }),
          }),
        }),
    ].filter(Boolean));
  }

  function fileCard(entry, accountName) {
    const missing = entry.claimed && entry.count < entry.claimed;

    return card({}, [
      cardHeader(entry.fileName, [
        button('Remove', {
          variant: 'danger',
          iconName: 'trash',
          disabled: busy,
          onClick: () => undo(entry),
        }),
      ], {
        subtitle: [
          accountName.get(entry.account) ?? 'unmatched account',
          entry.importedOn ? `imported ${formatDay(entry.importedOn)}` : null,
        ].filter(Boolean).join(' · '),
        iconName: 'file',
      }),

      h('div', { class: 'metric-row metric-row--pairs' }, [
        metric({ label: 'Transactions', value: String(entry.count) }),
        metric({ label: 'In', value: formatCompact(entry.moneyIn) }),
        metric({ label: 'Out', value: formatCompact(entry.moneyOut) }),
        metric({
          label: 'Period',
          value: entry.periodFrom ? formatDay(entry.periodFrom, { withYear: false }) : '—',
          hint: entry.periodTo ? `to ${formatDay(entry.periodTo)}` : '',
        }),
      ]),

      h('div', { class: 'chip-row' }, [
        // Three states. A card export has no balances to check against, so
        // `reconciled` is a vacuous true on it — a green "arithmetic closes"
        // on the one kind of file where nothing was checked at all.
        !entry.checkable
          ? badge(t('imports.badge.uncheckable'), 'info')
          : entry.reconciled
            ? badge('arithmetic closes', 'success')
            : badge('did not reconcile', 'warn'),
        missing ? badge(`${entry.claimed - entry.count} rows already deleted`, 'info') : null,
        entry.statement.problems ? badge('had unreadable rows', 'warn') : null,
      ].filter(Boolean)),

      missing
        ? h('p', { class: 'small muted' },
          `This file wrote ${entry.claimed} transactions and ${entry.count} are still here. `
          + 'Removing it now takes only the ones that remain.')
        : null,
    ].filter(Boolean));
  }

  function orphanCard(orphans) {
    const total = orphans.reduce((sum, row) => sum + addable(row.amount), 0);

    return card({ class: 'card--quiet' }, [
      cardHeader('Transactions with no file', [
        button('Remove them', { variant: 'danger', disabled: busy, onClick: () => clearOrphans(orphans) }),
      ], { iconName: 'alert' }),
      h('p', {}, [
        h('strong', {}, `${orphans.length} transactions`),
        ' came from statements that have since been deleted. Nothing says which file '
        + 'they belong to any more, so they cannot be removed with one — but they are '
        + 'still counted in every total. Together they come to ',
        h('strong', {}, format(total)),
        '.',
      ]),
      divider(),
      h('p', { class: 'small faint' },
        'This is what deleting a statement used to leave behind. Removing an import '
        + 'now takes its transactions with it, so nothing new arrives here.'),
      ...orphans.slice(0, 5).map((row) => listItem({
        title: row.payee || row.narration || '(unnamed)',
        subtitle: formatDay(row.date),
        value: money(row.amount),
      })),
      orphans.length > 5
        ? h('p', { class: 'small faint' }, `…and ${orphans.length - 5} more.`)
        : null,
    ].filter(Boolean));
  }
}
