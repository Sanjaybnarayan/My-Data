/**
 * Undoing an import.
 *
 * ## Why deleting the statement was never enough
 *
 * An import writes two things: one `bankStatement` recording that a file was
 * read, and one `transaction` per row. Only the first of those looks like the
 * file. Deleting it left every row it created behind — untraceable, because
 * the record naming the file they came from was the thing just removed — and
 * the totals stayed exactly as wrong as they were before.
 *
 * So an import is a pair, and undoing one has to remove both. That is what
 * this file works out: given the statements and the transactions, which rows
 * belong to which file, and what removing a file would actually take with it.
 *
 * ## And rows whose file is already gone
 *
 * Some households will have deleted a statement the old way. Their rows are
 * still there and now point at nothing. Those are worth finding and saying so,
 * because "why is my spending ₹40,000 higher than my statements" has no other
 * answer available.
 *
 * ## Nothing here deletes anything
 *
 * It reports. The writing happens in the screen, against the repository, as a
 * soft delete like every other — so an undo is itself undoable from
 * Settings → Deleted items, which matters when the file somebody meant to
 * remove was not the one they clicked.
 */

/**
 * Every import, newest first, with what it brought in.
 *
 * @param {object[]} statements `bankStatement` records
 * @param {object[]} transactions every transaction on record
 */
export function importList(statements, transactions) {
  const rows = new Map();
  for (const transaction of transactions ?? []) {
    if (!transaction.statement) continue;
    const list = rows.get(transaction.statement) ?? [];
    list.push(transaction);
    rows.set(transaction.statement, list);
  }

  return (statements ?? [])
    .map((statement) => summarise(statement, rows.get(statement.id) ?? []))
    .sort((a, b) => String(b.importedOn ?? '').localeCompare(String(a.importedOn ?? ''))
      || String(b.periodTo ?? '').localeCompare(String(a.periodTo ?? '')));
}

function summarise(statement, rows) {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const row of rows) {
    if (directionOf(row) === 'in') moneyIn += row.amount ?? 0;
    else moneyOut += row.amount ?? 0;
  }

  return {
    id: statement.id,
    statement,
    account: statement.account,
    fileName: statement.fileName || 'a statement',
    importedOn: statement.importedOn,
    periodFrom: statement.periodFrom,
    periodTo: statement.periodTo,
    reconciled: Boolean(statement.reconciled),
    // What the record *claimed* it wrote, against what is actually still
    // there. They differ when somebody has since deleted rows by hand, and a
    // household about to undo an import should see that before they do.
    claimed: statement.importedCount ?? 0,
    rows,
    count: rows.length,
    moneyIn,
    moneyOut,
  };
}

/**
 * Transactions whose statement no longer exists.
 *
 * Grouped by nothing, because there is nothing left to group them by — that
 * is the whole problem with them.
 */
export function orphanedTransactions(statements, transactions) {
  const known = new Set((statements ?? []).map((statement) => statement.id));
  return (transactions ?? [])
    .filter((transaction) => transaction.statement && !known.has(transaction.statement));
}

/**
 * Exactly what undoing one import would remove.
 *
 * Returned rather than done, so the screen can put the real numbers in front
 * of somebody before anything is written. An undo that says "this will remove
 * 412 transactions worth ₹3,40,000 between 1 and 31 May" is a decision; one
 * that says "delete?" is a gamble.
 */
export function planUndo(entry) {
  const dates = entry.rows.map((row) => row.date).filter(Boolean).sort();

  return {
    statementId: entry.id,
    transactionIds: entry.rows.map((row) => row.id),
    count: entry.rows.length,
    from: dates.at(0) ?? entry.periodFrom ?? null,
    to: dates.at(-1) ?? entry.periodTo ?? null,
    moneyIn: entry.moneyIn,
    moneyOut: entry.moneyOut,
    // A file whose rows are all gone already leaves only the record itself.
    onlyTheRecord: entry.rows.length === 0,
  };
}

/**
 * Which way the money went.
 *
 * The same fallback `domain/ledger.js` documents: `direction` is stored by the
 * current importer, and older records carry only `kind`.
 */
function directionOf(record) {
  if (record.direction === 'in' || record.direction === 'out') return record.direction;
  return record.kind === 'income' ? 'in' : 'out';
}
