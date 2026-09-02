/**
 * The assistant's vocabulary for the household's own records.
 *
 * The other half of `intents.js`, and the split is by subject rather than by
 * line count: `intents.js` answers about money — what came in, what went out,
 * what is owed and what it is all worth — while these answer about the people,
 * vehicles, places and things the household keeps records of.
 *
 * Same shape, same contract, same refusal to guess. See `intents.js` for what
 * `ctx` carries.
 */

import { format } from '../core/money.js';
import { range, formatDay, today, daysUntil } from '../core/dates.js';
import * as fin from '../domain/finance.js';
import { reviewGoals, describeGoal } from '../domain/goals.js';
import { mileage, describeMileage } from '../domain/fuel.js';

const money = (value) => format(value);

/** @type {any[]} */
export const householdIntents = [
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
     * `who works` is spelled out rather than a bare `work`, because a bare
     * `work` would claim any sentence containing it.
     *
     * "Where does everyone work?" was this intent's own example and was
     * answered by the document search, which consumes any sentence opening
     * with *where* and wins on length. It is spelled out here too — the
     * search now stands aside when it finds nothing, but only something that
     * matches can be stood aside *for*.
     */
    patterns: [
      /\b(employ\w+|workplace)\b/i,
      /\bwho works\b/i,
      /\bwhere\s+(?:do|does)\s+[\w\s]{2,20}?\bwork\b/i,
    ],
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
    id: 'shopping',
    examples: ['What did we buy?', 'Show purchases.'],
    patterns: [/\b(purchases?|bought|buy|buying|shopping)\b/i, /\breceipts?\b/i],
    async handle(ctx) {
      const purchases = await ctx.load('purchase');
      const receipts = await ctx.load('receipt');
      if (!purchases.length && !receipts.length) {
        return { text: 'Nothing has been recorded as bought, and no receipts are stored.' };
      }
      const recent = [...purchases].sort((a, b) => String(b.boughtOn).localeCompare(String(a.boughtOn)))[0];
      const spent = receipts.reduce((n, r) => n + (r.amount ?? 0), 0);
      return {
        text: `${purchases.length} purchase${purchases.length === 1 ? '' : 's'} recorded`
          + (recent?.item ? `, the latest being ${recent.item}` : '')
          + `. ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} totalling ${money(spent)}.`,
        records: { entity: 'purchase', rows: purchases },
      };
    },
  },

  {
    id: 'events',
    examples: ['What is on the calendar?', 'Are there any events?'],
    // `birthdays` owns anniversaries and `expiring` owns renewals; this is the
    // diary somebody typed in themselves.
    patterns: [/\b(events?|calendar|diary)\b/i],
    async handle(ctx) {
      const events = await ctx.load('event');
      if (!events.length) return { text: 'No events are in the calendar.' };

      const now = today(ctx.clock);
      const ahead = events.filter((e) => e.date >= now)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!ahead.length) {
        return {
          text: `No events are coming up. ${events.length} past `
            + `${events.length === 1 ? 'one is' : 'ones are'} recorded.`,
          records: { entity: 'event', rows: events },
        };
      }
      const next = ahead[0];
      return {
        text: `${next.title} on ${formatDay(next.date)}`
          + (next.location ? ` at ${next.location}` : '')
          + (ahead.length > 1 ? `, and ${ahead.length - 1} more after it.` : '.'),
        records: { entity: 'event', rows: ahead },
      };
    },
  },

  {
    id: 'notes',
    examples: ['Show notes.', 'What projects are running?'],
    patterns: [/\b(notes?)\b/i, /\bprojects?\b/i],
    async handle(ctx) {
      const notes = await ctx.load('note');
      const projects = await ctx.load('project');
      if (!notes.length && !projects.length) return { text: 'No notes or projects are recorded.' };

      const open = projects.filter((p) => p.status && p.status !== 'done');
      const pinned = notes.filter((n) => n.pinned);
      return {
        text: `${notes.length} note${notes.length === 1 ? '' : 's'}`
          + (pinned.length ? ` (${pinned.length} pinned)` : '')
          + `, and ${open.length} of ${projects.length} `
          + `project${projects.length === 1 ? '' : 's'} still open.`,
        records: { entity: 'note', rows: notes },
      };
    },
  },

  {
    id: 'safe-zones',
    examples: ['Where are the safe zones?', 'Has anyone raised an SOS?'],
    patterns: [/\bsafe\s?zones?\b/i, /\b(sos|panic|geofence)\b/i],
    async handle(ctx) {
      const zones = await ctx.load('safeZone');
      const alerts = await ctx.load('sosAlert');
      // An alert is the thing somebody would want to hear about first, and a
      // count of zones is not an answer to "has anyone raised an SOS".
      if (alerts.length) {
        const latest = [...alerts].sort((a, b) => String(b.raisedAt).localeCompare(String(a.raisedAt)))[0];
        return {
          text: `${alerts.length} SOS alert${alerts.length === 1 ? '' : 's'} recorded, the most `
            + `recent on ${formatDay(String(latest.raisedAt).slice(0, 10))}`
            + (latest.reason ? ` — ${latest.reason}.` : '.')
            + ` ${zones.length} safe zone${zones.length === 1 ? '' : 's'} are set up.`,
          records: { entity: 'sosAlert', rows: alerts },
        };
      }
      if (!zones.length) return { text: 'No safe zones are set up, and no SOS has been raised.' };
      return {
        text: `${zones.length} safe zone${zones.length === 1 ? '' : 's'}: `
          + zones.slice(0, 4).map((z) => z.name).join(', ')
          + '. No SOS has been raised.',
        records: { entity: 'safeZone', rows: zones },
      };
    },
  },

  {
    id: 'relationships',
    examples: ['How is everyone related?', 'Show relationships.'],
    patterns: [/\b(relationships?|related)\b/i, /\bfamily tree\b/i],
    async handle(ctx) {
      const links = await ctx.load('relationship');
      if (!links.length) return { text: 'No relationships are recorded between people.' };

      const people = await ctx.load('person');
      const who = (id) => people.find((p) => p.id === id)?.name ?? 'someone';
      const lines = links.slice(0, 4)
        .map((r) => `${who(r.fromPerson)} is ${who(r.toPerson)}’s ${r.type}`);
      const rest = links.length > 4 ? ` ${links.length - 4} more.` : '';
      return {
        text: lines.join(', ') + '.' + rest,
        records: { entity: 'relationship', rows: links },
      };
    },
  },

  {
    id: 'statements',
    examples: ['What statements are imported?', 'Show imported statements.'],
    patterns: [/\bstatements?\b/i],
    async handle(ctx) {
      const statements = await ctx.load('bankStatement');
      if (!statements.length) return { text: 'No bank statements have been imported.' };

      const rows = statements.reduce((n, s) => n + (s.importedCount ?? 0), 0);
      const duplicates = statements.reduce((n, s) => n + (s.duplicateCount ?? 0), 0);
      const events = await ctx.load('economicEvent');
      return {
        text: `${statements.length} statement${statements.length === 1 ? '' : 's'} imported, `
          + `${rows} rows written`
          + (duplicates ? `, ${duplicates} skipped as duplicates` : '')
          + (events.length ? `. ${events.length} movements are threaded across accounts.` : '.'),
        records: { entity: 'bankStatement', rows: statements },
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
      // Absence belongs to the same question as the staff it is about, so it
      // is loaded here rather than given an intent nobody would think to ask.
      const leave = await ctx.load('staffLeave');
      const unpaid = leave.filter((l) => l.paid === false).length;

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
          + (former ? ` ${former} former record${former === 1 ? '' : 's'} also on file.` : '')
          + (leave.length ? ` ${leave.length} absence${leave.length === 1 ? '' : 's'} recorded`
            + (unpaid ? `, ${unpaid} unpaid.` : '.') : ''),
        records: { entity: 'staff', rows: active },
      };
    },
  },
];
