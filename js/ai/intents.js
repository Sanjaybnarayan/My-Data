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
import { allReminders, datedEntities } from '../domain/reminders.js';
import { reviewGoals, describeGoal } from '../domain/goals.js';
import { mileage, describeMileage } from '../domain/fuel.js';

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
          + 'resting on a valuation that is missing or out of date, so the real figure may differ.'
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
      /*
       * Derived, not typed out. This handler named nine entities; the schema
       * declares nineteen with an expiry field, and `expiryReminders` reads
       * every one of them. So the ten it did not name were invisible here —
       * a warranty running out, a tenancy ending, a vaccination due, a
       * medication course finishing, a service falling due — and the answer
       * was not "some of these are missing" but a flat "nothing is due to
       * expire in the next year".
       *
       * `datedEntities()` is the same list the dashboard uses, and its own
       * comment records `medication` being moved onto it after exactly this
       * fault. The assistant was the caller that never followed.
       */
      const data = {};
      for (const name of datedEntities()) {
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
          subscriptions: await ctx.load('subscription'),
          digitalAssets: await ctx.load('digitalAsset'),
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
    /*
     * The second pattern exists because "When is the PUC due?" — this
     * intent's own example, on the help panel — was answered with a list of
     * pending bills. `bills` matches `due` and this matched `PUC`, both three
     * characters, and `matchIntent` breaks a tie on weight by declaration
     * order, which puts `bills` first. Spanning from the part to the question
     * about it makes the match longer than the word `due` alone, so the
     * question reaches the intent that offers it.
     */
    patterns: [
      /\b(puc|fastag|rc)\b[^.?!]{0,40}?\b(due|expir\w+|valid)\b/i,
      /\b(puc|fastag|rc|vehicle|car|bike|scooter)\b/i,
    ],
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

  {
    id: 'mileage',
    examples: ['What mileage are we getting?', 'How much fuel are we using?'],
    // `mileage` and `fuel` are longer than the `car` in `vehicle-compliance`,
    // and `matchIntent` weighs the match by length, so a question about how
    // far a tank goes is not answered with an insurance date.
    patterns: [/\b(mileage|kmpl|fuel|petrol|diesel)\b/i],
    async handle(ctx) {
      const logs = await ctx.load('fuelLog');
      if (!logs.length) return { text: 'No fill-ups are recorded, so mileage cannot be worked out.' };

      const vehicles = await ctx.load('vehicle');
      // `describeMileage` already says why a figure is missing — a tank that
      // was never filled to full, an odometer that went backwards. Repeating
      // the refusal here in different words would be a second place to keep
      // in step with `domain/fuel.js`.
      const lines = vehicles
        .map((v) => ({ v, result: mileage(v.id, logs) }))
        .filter(({ result }) => result.fills > 0)
        .map(({ v, result }) => `${v.registration}: ${describeMileage(result, money)}`);

      if (!lines.length) return { text: 'Fill-ups are recorded, but not against any vehicle.' };
      return { text: lines.join('. ') + '.', records: { entity: 'fuelLog', rows: logs } };
    },
  },

  {
    id: 'employment',
    examples: ['Who is employed?', 'Who works where?'],
    /*
     * Not `salary`: that word belongs to the income intent, and a household
     * asking what it earned wants the ledger, not a list of job titles.
     *
     * `who works` is spelled out rather than a bare `work`, because
     * `find-document` matches any question opening with *where* and consumes
     * the whole sentence — and `matchIntent` weighs by match length, so a
     * four-letter word never beats it. "Where does everyone work?" was this
     * intent's own example and was answered by the document search.
     */
    patterns: [/\b(employ\w+|workplace)\b/i, /\bwho works\b/i],
    async handle(ctx) {
      const jobs = await ctx.load('employment');
      if (!jobs.length) return { text: 'No employment is recorded.' };

      const people = await ctx.load('person');
      const who = (id) => people.find((p) => p.id === id)?.name ?? 'Someone';
      // A job with no end date is the current one. Past employers are counted
      // rather than listed: the question is where people work, not where they
      // used to.
      const current = jobs.filter((j) => !j.endedOn);
      const past = jobs.length - current.length;

      if (!current.length) {
        return {
          text: `Nobody is recorded as currently employed. ${past} past `
            + `${past === 1 ? 'job is' : 'jobs are'} on file.`,
          records: { entity: 'employment', rows: jobs },
        };
      }

      const lines = current.map((j) => `${who(j.person)} at ${j.employer}`
        + (j.designation ? ` as ${j.designation}` : ''));
      return {
        text: lines.join(', ') + '.'
          + (past ? ` ${past} past ${past === 1 ? 'job' : 'jobs'} also on file.` : ''),
        records: { entity: 'employment', rows: current },
      };
    },
  },

  {
    id: 'goals',
    examples: ['What are our financial goals?', 'How are we doing on savings?', 'Show goals.'],
    patterns: [/\b(goals?|savings?\s*target|financial\s*goal)\b/i,
      /\bhow\s+are\s+we\s+doing\s+on\b/i],
    async handle(ctx) {
      const goals = await ctx.load('goal');
      if (!goals.length) return { text: 'No financial goals have been set up yet.' };

      const accounts = fin.accountBalances(
        await ctx.load('account'),
        await ctx.load('transaction'),
      );
      const holdings = await ctx.load('holding');

      const balanceOf = (id) => accounts.find((a) => a.id === id)?.balance ?? 0;
      const holdingValueOf = (id) => {
        const h = holdings.find((hh) => hh.id === id);
        return h ? (h.currentValue ?? h.invested ?? 0) : 0;
      };

      /*
       * Monthly spend is needed for emergency-fund goals that express their
       * target in months of spending rather than a fixed rupee amount.
       * We use the last-month period to estimate it; if no transactions exist
       * we default to zero and the goal will say it cannot be measured.
       */
      const lastMonth = fin.inPeriod(
        await ctx.load('transaction'),
        { ...range('last-month', ctx.clock) },
      );
      const monthlySpend = Math.abs(fin.totals(lastMonth).expense);

      const rows = reviewGoals(goals, { balanceOf, holdingValueOf, monthlySpend, clock: ctx.clock });

      const open = rows.filter((r) => r.status !== 'reached');
      const reached = rows.filter((r) => r.status === 'reached');

      const parts = rows.slice(0, 3).map((r) => `${r.goal.name}: ${describeGoal(r, money)}`);
      const tail = rows.length > 3 ? ` ${rows.length - 3} more.` : '';

      return {
        text: `${goals.length} goal${goals.length === 1 ? '' : 's'} — `
          + `${open.length} open, ${reached.length} reached. `
          + parts.join('. ') + (parts.length ? '.' : '') + tail,
        records: { entity: 'goal', rows: goals },
      };
    },
  },

  {
    id: 'emergency-contacts',
    examples: ['Who do we call in an emergency?', 'Show emergency contacts.'],
    patterns: [/\b(emergency\s*contacts?|who\s+(?:do|should)\s+(?:we|i)\s+call)\b/i],
    async handle(ctx) {
      const contacts = await ctx.load('emergencyContact');
      if (!contacts.length) {
        return { text: 'No emergency contacts are stored. Add them under Emergency.' };
      }

      /*
       * Contacts are sorted by priority (lower number = higher priority).
       * Phone numbers are encrypted and decrypted by ctx.load — the assistant
       * never decrypts or logs them; it shows the name and relationship only.
       */
      const sorted = contacts.slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      const first = sorted[0];
      const lines = sorted.slice(0, 3).map(
        (c) => `${c.name}${c.relationship ? ` (${c.relationship})` : ''}`,
      );
      const tail = sorted.length > 3 ? ` and ${sorted.length - 3} more` : '';

      return {
        text: `${sorted.length} emergency contact${sorted.length === 1 ? '' : 's'}. `
          + `First: ${first.name}${first.relationship ? `, ${first.relationship}` : ''}. `
          + lines.join(', ') + tail + '.',
        records: { entity: 'emergencyContact', rows: sorted },
      };
    },
  },

  {
    id: 'trips',
    examples: ['Are there upcoming trips?', 'When is the next holiday?', 'Show travel plans.'],
    patterns: [/\b(trips?|travel|holiday|holidays|journey|flight)\b/i],
    async handle(ctx) {
      const trips = await ctx.load('trip');
      if (!trips.length) return { text: 'No trips are recorded.' };

      const now = today(ctx.clock);
      const upcoming = trips
        .filter((t) => t.departsOn && t.departsOn >= now)
        .sort((a, b) => a.departsOn.localeCompare(b.departsOn));
      const past = trips
        .filter((t) => !t.departsOn || t.departsOn < now)
        .sort((a, b) => b.departsOn?.localeCompare(a.departsOn ?? '') ?? 0);

      if (!upcoming.length) {
        const last = past[0];
        return {
          text: `No trips are planned. The last one was ${last?.destination ?? 'unknown'}`
            + (last?.departsOn ? ` on ${formatDay(last.departsOn)}` : '') + '.',
          records: { entity: 'trip', rows: past.slice(0, 5) },
        };
      }

      const next = upcoming[0];
      const days = daysUntil(next.departsOn, ctx.clock);
      const rest = upcoming.length > 1 ? ` ${upcoming.length - 1} more planned.` : '';

      return {
        text: `Next trip: ${next.destination} on ${formatDay(next.departsOn)}`
          + ` — ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.`
          + (next.returnsOn ? ` Returns ${formatDay(next.returnsOn)}.` : '')
          + rest,
        records: { entity: 'trip', rows: upcoming.slice(0, 5) },
      };
    },
  },

  {
    id: 'staff',
    examples: ['Who is on household staff?', 'Show staff.', 'List household help.'],
    patterns: [/\b(staff|household\s*help|cook|driver|cleaner|maid|housekeeper)\b/i],
    async handle(ctx) {
      const members = await ctx.load('staff');
      if (!members.length) return { text: 'No household staff are recorded.' };

      /*
       * A staff record without an endedOn date is current; one with a date
       * in the past is a historical record. Show active members only, and
       * report how many are on record overall.
       */
      const now = today(ctx.clock);
      const active = members.filter((s) => !s.endedOn || s.endedOn >= now);
      const former = members.length - active.length;

      if (!active.length) {
        return {
          text: `No current staff. ${former} former record${former === 1 ? '' : 's'} on file.`,
          records: { entity: 'staff', rows: members },
        };
      }

      const names = active.slice(0, 3).map(
        (s) => s.role + (s.monthlyPay ? ` — ${money(s.monthlyPay)}/month` : ''),
      );
      const tail = active.length > 3 ? ` and ${active.length - 3} more` : '';

      return {
        text: `${active.length} active staff member${active.length === 1 ? '' : 's'}: `
          + names.join(', ') + tail + '.'
          + (former ? ` ${former} former record${former === 1 ? '' : 's'} also on file.` : ''),
        records: { entity: 'staff', rows: active },
      };
    },
  },
];

/** Everything the assistant can answer, for the help panel. */
export function exampleQuestions() {
  return intents.flatMap((intent) => intent.examples);
}

export { today };
