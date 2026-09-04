#!/usr/bin/env node
/**
 * Read bank statement PDFs and report what is in them.
 *
 *   node tools/statement.mjs statement.pdf [more.pdf …]
 *   node tools/statement.mjs --json statement.pdf > analysis.json
 *   node tools/statement.mjs --csv  statement.pdf > transactions.csv
 *   node tools/statement.mjs --business="Acme Partners" a.pdf
 *   node tools/statement.mjs --override="some shop=groceries" a.pdf
 *
 * Nothing leaves this machine. The PDF is read here, the rules are in
 * `js/domain/categorise.js`, and the only output is what you see. That matters
 * for a bank statement more than for most files.
 *
 * The parse checks itself against the statement's own balances and refuses to
 * present totals it cannot reconcile — a categorised statement that quietly
 * dropped forty rows is worse than no analysis at all.
 */

import { read } from './pdf-text.mjs';
import { parseStatement, reconcile } from '../js/domain/statement.js';
import {
  categorise, resolveAliases, summarise, peopleLedger, recurring, lendingLedger,
  businessLedger, counterpartyKey,
} from '../js/domain/categorise.js';
import { insights } from '../js/domain/insights.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const overrides = Object.fromEntries(
  args.filter((a) => a.startsWith('--override='))
    .map((a) => a.slice('--override='.length).split('='))
    .map(([name, category]) => [counterpartyKey(name), category]),
);
/*
 * A firm the household owns. Direction decides what it means — money out of it
 * is earnings, money into it is capital — so this cannot be expressed as an
 * override, which maps a name to one category regardless of direction. It is
 * the one fact no rule can derive: a business account looks exactly like a
 * stranger's until somebody says otherwise.
 */
const businesses = args.filter((a) => a.startsWith('--business='))
  .map((a) => a.slice('--business='.length).replace(/^["']|["']$/g, ''))
  .filter(Boolean);

const files = args.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('usage: node tools/statement.mjs [--json|--csv] [--business=NAME] '
    + '[--override=NAME=category] <file.pdf …>');
  process.exit(1);
}

/* ----------------------------------------------------------------- read it */

const statements = await Promise.all(files.map(async (file) => {
  const { pages, encrypted, reason } = await read(file);
  if (encrypted) throw new Error(`${file}: ${reason}`);
  const parsed = parseStatement(pages.flatMap((page) => page.rows));
  return { file, parsed, check: reconcile(parsed) };
}));

const holder = statements.map((s) => s.parsed.account.holder).find(Boolean) ?? '';
const transactions = resolveAliases(
  statements.flatMap((s) => categorise(s.parsed.transactions, {
    holder, businesses, overrides, aliases: false,
  })),
);
const asOf = transactions.map((t) => t.date).sort().at(-1) ?? null;
const summary = summarise(transactions);

/* --------------------------------------------------------------- print it */

const R = (minor) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%`.padStart(4) : '   —');
const pad = (text, n) => String(text).slice(0, n).padEnd(n);

if (flags.has('--json')) {
  console.log(JSON.stringify({
    account: statements[0].parsed.account,
    statements: statements.map((s) => ({ file: s.file, check: s.check, problems: s.parsed.problems })),
    summary,
    transactions,
    people: peopleLedger(transactions),
    recurring: recurring(transactions, { asOf }),
    lending: lendingLedger(transactions),
    businesses: businessLedger(transactions),
    insights: insights(transactions, summary),
  }, null, 2));
} else if (flags.has('--csv')) {
  const columns = ['date', 'amount', 'direction', 'category', 'channel', 'counterparty', 'counterpartyKind', 'rule', 'balance', 'description'];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  console.log(columns.join(','));
  for (const row of transactions) {
    console.log(columns.map((column) => escape(
      column === 'amount' || column === 'balance' ? (row[column] ?? 0) / 100 : row[column],
    )).join(','));
  }
} else {
  report();
}

function report() {
  const account = statements[0].parsed.account;
  heading(`${account.bank || 'Account'} ${account.number} — ${account.holder}`);

  for (const { file, parsed, check } of statements) {
    const state = parsed.problems.length === 0 && check.balanced ? 'reconciles' : 'NEEDS ATTENTION';
    console.log(`  ${pad(file.split('/').pop(), 44)} ${String(parsed.transactions.length).padStart(5)} rows  ${parsed.mode.padEnd(8)} ${state}`);
    for (const problem of parsed.problems.slice(0, 5)) {
      console.log(`      row ${problem.serial}: ${problem.reason}`);
    }
    if (!check.balanced) console.log(`      off by ${R(check.difference)} against the printed closing balance`);
  }

  heading('Where the money went');
  console.log(`  money in                    ${R(summary.moneyIn).padStart(14)}`);
  console.log(`  money out                   ${R(summary.moneyOut).padStart(14)}`);
  console.log(`  net                         ${R(summary.net).padStart(14)}`);
  console.log('');
  console.log(`  earned and received         ${R(summary.realIncome).padStart(14)}`);
  console.log(`  spent                       ${R(summary.spending).padStart(14)}`);
  console.log(`  sent to people              ${R(summary.transfersOut).padStart(14)}`);
  console.log(`  received from people        ${R(summary.transfersIn).padStart(14)}`);
  console.log(`  moved between own pockets   ${R(summary.internalOut).padStart(14)} out, ${R(summary.internalIn)} in`);

  heading('By category');
  for (const category of summary.byCategory) {
    const of = category.kind === 'spending' ? share(category.out, summary.spending) : '    ';
    console.log(`  ${String(category.count).padStart(5)}  ${pad(category.label, 28)} out ${R(category.out).padStart(13)} ${of}   in ${R(category.in).padStart(13)}`);
  }

  heading('By rail');
  for (const channel of summary.byChannel) {
    console.log(`  ${String(channel.count).padStart(5)}  ${pad(channel.key, 10)} out ${R(channel.out).padStart(13)}   in ${R(channel.in).padStart(13)}`);
  }

  heading('By month');
  for (const month of [...summary.byMonth].sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${month.key}  ${String(month.count).padStart(4)}  in ${R(month.in).padStart(13)}  out ${R(month.out).padStart(13)}  net ${R(month.net).padStart(13)}`);
  }

  heading('Who is at the other end');
  for (const party of summary.byCounterparty.slice(0, 25)) {
    console.log(`  ${String(party.count).padStart(4)}  ${pad(party.kind, 9)} ${pad(party.name, 30)} out ${R(party.out).padStart(13)}   in ${R(party.in).padStart(13)}`);
  }

  heading('People — what is owed which way');
  for (const person of peopleLedger(transactions).slice(0, 25)) {
    const direction = person.balance < 0 ? 'they owe you' : person.balance > 0 ? 'you owe them' : 'square';
    console.log(`  ${String(person.count).padStart(4)}  ${pad(person.name, 26)} sent ${R(person.sent).padStart(12)}  back ${R(person.received).padStart(12)}  ${R(Math.abs(person.balance)).padStart(12)} ${direction}`);
  }

  heading('Repeats on a schedule');
  for (const item of recurring(transactions, { asOf })) {
    console.log(`  ${String(item.occurrences).padStart(3)}×  ${pad(item.period, 10)} ${pad(item.name, 26)} ${R(item.amount).padStart(10)} each, ${R(item.spent).padStart(12)} total  ${item.active ? 'still running' : `stopped ${item.last}`}`);
  }

  heading('Borrowing and lending');
  for (const line of lendingLedger(transactions).slice(0, 20)) {
    console.log(`  ${String(line.count).padStart(4)}  ${pad(line.kind, 12)} ${pad(line.name, 26)} in ${R(line.borrowed).padStart(13)}  out ${R(line.repaid).padStart(13)}  outstanding ${R(line.outstanding).padStart(13)}`);
  }

  const firms = businessLedger(transactions);
  if (firms.length) {
    heading('Your business, both directions');
    for (const firm of firms) {
      console.log(`  ${String(firm.count).padStart(4)}  ${pad(firm.name, 26)} drawn ${R(firm.drawn).padStart(12)}  put in ${R(firm.contributed).padStart(12)}  net ${R(firm.net).padStart(12)} over ${firm.months} months`);
    }
  }

  heading('Worth saying out loud');
  for (const note of insights(transactions, summary)) {
    console.log(`  • ${note.text}  (${R(note.amount)})`);
  }

  const unmatched = transactions.filter((t) => t.rule === 'unmatched');
  if (unmatched.length) {
    heading(`Not categorised — ${unmatched.length} of ${transactions.length}`);
    console.log('  These need a name. Re-run with --override="<name>=<category>" to fix one for good.\n');
    for (const row of unmatched.slice(0, 20)) {
      console.log(`  ${row.date}  ${row.direction === 'in' ? 'in ' : 'out'} ${R(row.amount).padStart(11)}  ${row.description.slice(0, 60)}`);
    }
  }
}

function heading(text) {
  console.log(`\n${text}\n${'─'.repeat(Math.min(78, text.length + 8))}`);
}
