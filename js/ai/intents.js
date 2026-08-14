/**
 * The assistant's vocabulary.
 *
 * A registry of intents. Each declares the phrasings it answers and a handler
 * that reads local records and returns a sentence plus, where useful, the
 * records behind it.
 *
 * **This is not a language model.** It is a deterministic parser over a fixed
 * set of questions, and it says so when it does not understand rather than
 * inventing an answer — which for a household's financial and medical records
 * is the only acceptable failure mode. Every answer is traceable to rows the
 * user can open.
 *
 * Adding a question is adding an entry here. The handler receives:
 *
 *   ctx.load(entityName)   decrypted records the signed-in role may read
 *   ctx.period             a {from, to} range parsed out of the question
 *   ctx.match              the regex groups
 *   ctx.clock              the clock to resolve "today" against
 */

import { format, formatCompact } from '../core/money.js';
import { range, formatDay, today, daysUntil, relativeDays } from '../core/dates.js';
import * as fin from '../domain/finance.js';
import { netWorth } from '../domain/networth.js';
import { portfolioSummary, allocation, holdingGain, xirr, cashFlows } from '../domain/portfolio.js';
import { allReminders } from '../domain/reminders.js';

/** Phrases that name a time span, longest first so "last month" beats "month". */
/** @type {[RegExp, string][]} */
const PERIODS = [
  [/\b(last|previous)\s+month\b/i, 'last-month'],
  [/\b(this|current)\s+month\b/i, 'month'],
  [/\blast\s+year\b/i, 'last-year'],
  [/\b(this|current)\s+year\b/i, 'year'],
  [/\bfinancial\s+year\b|\bfy\b/i, 'financial-year'],
  [/\b(last|past)\s+(week|7\s*days)\b/i, 'week'],
  [/\b(last|past)\s+(quarter|3\s*months)\b/i, 'quarter'],
  [/\btoday\b/i, 'today'],
  [/\byesterday\b/i, 'yesterday'],
  [/\ball\s+time\b|\bever\b|\btotal\b/i, 'all'],
];

/** @param {string} text */
export function parsePeriod(text, clock = Date.now) {
  for (const [pattern, name] of PERIODS) {
    if (pattern.test(text)) return { ...range(name, clock), name };
  }
  return { ...range('month', clock), name: 'month', assumed: true };
}

const money = (value) => format(value);

export const intents = [
  {
    id: 'net-worth',
    examples: ['What is our family net worth?', 'How much are we worth?'],
    patterns: [/\bnet\s*worth\b/i, /\bhow much (are we|do we) (worth|have)\b/i],
    async handle(ctx) {
      const result = netWorth({
        accounts: await ctx.load('account'),
        transactions: await ctx.load('transaction'),
        holdings: await ctx.load('holding'),
        properties: await ctx.load('property'),
        vehicles: await ctx.load('vehicle'),
        loans: await ctx.load('loan'),
      });

      const caveat = result.staleValuations.length
        ? ` ${result.staleValuations.length} item${result.staleValuations.length === 1 ? ' is' : 's are'} `
          + 'valued at cost or missing a valuation, so the real figure may differ.'
        : '';

      return {
        text: `Family net worth is ${money(result.total)} — ${money(result.assets)} in assets `
          + `less ${money(result.liabilities)} owed.${caveat}`,
        breakdown: result.breakdown,
        chart: { kind: 'donut', data: result.breakdown.filter((b) => b.value > 0) },
      };
    },
  },

  {
    id: 'expenses',
    examples: ['Show expenses for last month.', 'How much did we spend this year?'],
    patterns: [
      /\b(expenses?|spend|spent|spending|outgoings?)\b/i,
    ],
    async handle(ctx) {
      const transactions = await ctx.load('transaction');
      const rows = fin.inPeriod(transactions, ctx.period);
      const t = fin.totals(rows);
      const categories = fin.byCategory(rows).slice(0, 5);

      if (!rows.length) {
        return { text: `No transactions are recorded between ${formatDay(ctx.period.from)} and ${formatDay(ctx.period.to)}.` };
      }

      const top = categories.length
        ? ` The largest was ${categories[0].label} at ${money(categories[0].value)}.`
        : '';

      return {
        text: `${money(t.expense)} spent between ${formatDay(ctx.period.from)} and `
          + `${formatDay(ctx.period.to)}, across ${rows.filter(fin.isSpending).length} transactions.${top}`,
        records: { entity: 'transaction', rows: rows.filter(fin.isSpending) },
        chart: { kind: 'donut', data: categories },
      };
    },
  },

  {
    id: 'income',
    examples: ['What was our income last month?'],
    patterns: [/\b(income|earned|salary|received)\b/i],
    async handle(ctx) {
      const rows = fin.inPeriod(await ctx.load('transaction'), ctx.period);
      const t = fin.totals(rows);
      return {
        text: `${money(t.income)} received between ${formatDay(ctx.period.from)} and `
          + `${formatDay(ctx.period.to)}. Net of spending, that is ${money(t.net)}.`,
        records: { entity: 'transaction', rows: rows.filter(fin.isIncome) },
      };
    },
  },

  {
    id: 'find-document',
    examples: ['Find passport.', 'Where is the RC book?'],
    patterns: [
      // The trailing `[?.!]*` matters: people type "Find passport." with the
      // full stop, and an anchored pattern without it matches nothing.
      /^(?:find|locate|where(?:'s| is| are)?|show me)\s+(?:the\s+|my\s+|our\s+)?(?<term>[\w\s'’-]{2,40}?)\s*[?.!]*$/i,
    ],
    async handle(ctx) {
      const term = (ctx.match?.groups?.term ?? '').trim();
      if (!term) return null;

      const hits = await ctx.search(term, { limit: 8 });
      if (!hits.length) {
        return { text: `Nothing matching “${term}” is stored. Try a different word, or check the spelling.` };
      }

      const first = hits[0];
      return {
        text: hits.length === 1
          ? `Found “${first.title}” in ${first.module}.`
          : `Found ${hits.length} matches for “${term}”. The closest is “${first.title}” in ${first.module}.`,
        hits,
      };
    },
  },

  {
    id: 'expiring',
    examples: ['Which insurance expires next?', 'What is expiring soon?'],
    patterns: [
      /\b(expir\w*|renew\w*|due to lapse|lapsing)\b/i,
    ],
    async handle(ctx) {
      const data = {};
      for (const name of ['policy', 'vehicle', 'document', 'identityDocument',
        'subscription', 'digitalAsset', 'holding', 'property', 'certificate']) {
        data[name] = await ctx.load(name);
      }

      // "Which insurance expires next" should not answer with a passport.
      const wantsInsurance = /\binsuran\w*|policy|policies\b/i.test(ctx.text);
      let reminders = allReminders(data, { horizonDays: 365, clock: ctx.clock })
        .filter((r) => r.group === 'expiry');
      if (wantsInsurance) reminders = reminders.filter((r) => r.entity === 'policy');

      if (!reminders.length) {
        return { text: wantsInsurance
          ? 'No insurance policy is due to renew in the next year.'
          : 'Nothing is due to expire in the next year.' };
      }

      const next = reminders[0];
      const rest = reminders.length > 1 ? ` ${reminders.length - 1} more follow.` : '';
      return {
        text: `${next.title} — ${next.label.toLowerCase()} ${next.days < 0 ? 'lapsed' : 'falls due'} `
          + `${relativeDays(next.date, ctx.clock)} (${formatDay(next.date)}).${rest}`,
        reminders: reminders.slice(0, 10),
      };
    },
  },

  {
    id: 'bills',
    examples: ['List pending bills.', 'What is due this month?'],
    patterns: [/\b(bills?|dues?|payments? due|pending payments?|emis?)\b/i],
    async handle(ctx) {
      const bills = fin.upcomingBills(
        await ctx.load('recurringPayment'),
        await ctx.load('loan'),
        {
          days: 30,
          from: today(ctx.clock),
          // "What is due?" is exactly the question where leaving out the card
          // bill matters most.
          accounts: await ctx.load('account'),
          transactions: await ctx.load('transaction'),
        },
      );
      if (!bills.length) return { text: 'No bills are due in the next 30 days.' };

      // A card with no statement day is due on a date it knows for an amount
      // it does not. `sum` would fold that in as zero, so the answer would
      // name a figure smaller than the truth without saying it had.
      const { total, unknown } = fin.billsTotal(bills);
      const gap = unknown
        ? ` ${unknown} of them ${unknown === 1 ? 'is a card bill' : 'are card bills'} with no `
          + 'statement day recorded, so the amount is not in that total.'
        : '';
      const overdue = bills.filter((b) => b.overdue);
      const note = overdue.length ? ` ${overdue.length} of them ${overdue.length === 1 ? 'is' : 'are'} already overdue.` : '';

      return {
        text: `${bills.length} bill${bills.length === 1 ? '' : 's'} totalling ${money(total)} `
          + `due in the next 30 days, starting with ${bills[0].name} on ${formatDay(bills[0].dueOn)}.${note}${gap}`,
        bills,
      };
    },
  },

  {
    id: 'investment-returns',
    examples: ['Show investment returns.', 'How are my investments doing?'],
    patterns: [/\b(investments?|portfolio|returns?|xirr|mutual funds?|stocks?)\b/i],
    async handle(ctx) {
      const holdings = await ctx.load('holding');
      const transactions = await ctx.load('investmentTransaction');
      const summary = portfolioSummary(holdings);

      if (!summary.count) {
        return { text: 'No investments are recorded yet.' };
      }

      const flows = holdings.flatMap((holding) => cashFlows(holding, transactions));
      const rate = xirr(flows.sort((a, b) => a.date.localeCompare(b.date)));

      const best = holdings
        .map((holding) => ({ holding, ...holdingGain(holding) }))
        .filter((row) => row.gainPercent !== null)
        .sort((a, b) => b.gainPercent - a.gainPercent)[0];

      return {
        text: `${formatCompact(summary.value)} invested across ${summary.count} holdings, `
          + `${summary.gain >= 0 ? 'up' : 'down'} ${money(Math.abs(summary.gain))} `
          + `(${summary.gainPercent ?? 0}%) on ${money(summary.invested)} put in.`
          + (rate !== null ? ` Annualised, that is about ${rate}% XIRR.` : '')
          + (best ? ` The strongest is ${best.holding.name} at ${best.gainPercent}%.` : ''),
        chart: { kind: 'donut', data: allocation(holdings) },
        records: { entity: 'holding', rows: holdings },
      };
    },
  },

  {
    id: 'balance',
    examples: ['How much cash do we have?', 'What is the balance in HDFC?'],
    patterns: [/\b(balance|cash|how much (money|is) (do we have|left|in))\b/i],
    async handle(ctx) {
      const accounts = fin.accountBalances(
        await ctx.load('account'), await ctx.load('transaction'),
      );
      const named = ctx.text.match(/\bin\s+(?<name>[\w\s]{2,30})$/i)?.groups?.name?.trim();

      if (named) {
        const match = accounts.find((a) => a.name.toLowerCase().includes(named.toLowerCase())
          || (a.institution ?? '').toLowerCase().includes(named.toLowerCase()));
        if (match) {
          return { text: `${match.name} holds ${money(match.balance)}.`, accounts: [match] };
        }
      }

      const cash = fin.liquidCash(accounts);
      return {
        text: `${money(cash)} in cash and current accounts, across `
          + `${accounts.filter((a) => !a.archived).length} accounts.`,
        accounts: accounts.filter((a) => !a.archived),
      };
    },
  },

  {
    id: 'tasks',
    examples: ['What is on my list?', 'Show open tasks.'],
    // "on my list" is matched as a phrase rather than adding "list" as a
    // word, which would steal "list pending bills".
    patterns: [/\b(tasks?|to-?do|chores?)\b/i, /\bon (my|the) list\b/i],
    async handle(ctx) {
      const tasks = (await ctx.load('task')).filter((t) => t.status !== 'done');
      if (!tasks.length) return { text: 'Nothing is outstanding.' };

      const overdue = tasks.filter((t) => t.dueOn && daysUntil(t.dueOn, ctx.clock) < 0);
      return {
        text: `${tasks.length} task${tasks.length === 1 ? '' : 's'} open`
          + (overdue.length ? `, ${overdue.length} of them overdue.` : '.'),
        records: { entity: 'task', rows: tasks },
      };
    },
  },

  {
    id: 'birthdays',
    examples: ['Whose birthday is next?'],
    patterns: [/\b(birthdays?|anniversar\w+)\b/i],
    async handle(ctx) {
      const dates = allReminders({
        person: await ctx.load('person'),
        importantDate: await ctx.load('importantDate'),
      }, { horizonDays: 365, clock: ctx.clock }).filter((r) => r.group === 'date');

      if (!dates.length) return { text: 'No birthdays or anniversaries are recorded.' };
      const next = dates[0];
      return {
        text: `${next.title} is ${relativeDays(next.date, ctx.clock)} on ${formatDay(next.date)}`
          + (next.turning ? `, turning ${next.turning}.` : '.'),
        reminders: dates.slice(0, 10),
      };
    },
  },

  {
    id: 'budget',
    examples: ['Am I over budget?'],
    patterns: [/\bbudgets?\b/i],
    async handle(ctx) {
      const rows = fin.budgetStatus(await ctx.load('budget'), await ctx.load('transaction'));
      if (!rows.length) return { text: 'No budgets are set up.' };

      const over = rows.filter((b) => b.state === 'over');
      if (!over.length) {
        return { text: `All ${rows.length} budgets are within their limits this month.`, budgets: rows };
      }
      return {
        text: `${over.length} of ${rows.length} budgets ${over.length === 1 ? 'is' : 'are'} over: `
          + over.map((b) => `${b.category} by ${money(-b.remaining)}`).join(', ') + '.',
        budgets: rows,
      };
    },
  },

  {
    id: 'medical',
    examples: ['What is my blood group?', 'Show medical information.'],
    patterns: [/\b(blood group|medical|allerg\w+|medications?|prescriptions?)\b/i],
    async handle(ctx) {
      const people = await ctx.load('person');
      const medications = (await ctx.load('medication')).filter((m) => m.ongoing !== false);

      const withGroup = people.filter((p) => p.bloodGroup);
      const lines = withGroup.map((p) => `${p.name}: ${p.bloodGroup}`).join(', ');

      return {
        text: [
          withGroup.length ? `Blood groups — ${lines}.` : 'No blood groups are recorded.',
          medications.length ? `${medications.length} ongoing medication${medications.length === 1 ? '' : 's'}.` : '',
          people.some((p) => p.allergies) ? 'Allergies are recorded — open Health for details.' : '',
        ].filter(Boolean).join(' '),
        records: { entity: 'person', rows: withGroup },
      };
    },
  },

  {
    id: 'vehicle-compliance',
    examples: ['Is the car insurance valid?', 'When is the PUC due?'],
    patterns: [/\b(puc|fastag|rc|vehicle|car|bike|scooter)\b/i],
    async handle(ctx) {
      const vehicles = await ctx.load('vehicle');
      if (!vehicles.length) return { text: 'No vehicles are recorded.' };

      const lines = vehicles.map((v) => {
        const bits = [];
        for (const [field, label] of [
          ['insuranceExpiresOn', 'insurance'],
          ['pucExpiresOn', 'PUC'],
          ['rcExpiresOn', 'RC'],
        ]) {
          if (!v[field]) continue;
          const days = daysUntil(v[field], ctx.clock);
          bits.push(`${label} ${days < 0 ? `expired ${-days} days ago` : `valid for ${days} days`}`);
        }
        return `${v.registration}: ${bits.join(', ') || 'no dates recorded'}`;
      });

      return { text: lines.join('. ') + '.', records: { entity: 'vehicle', rows: vehicles } };
    },
  },
];

/** Everything the assistant can answer, for the help panel. */
export function exampleQuestions() {
  return intents.flatMap((intent) => intent.examples);
}

export { today };
