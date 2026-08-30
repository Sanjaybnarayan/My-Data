/**
 * The rest of the example household: the records a life leaves behind.
 *
 * `domain/example.js` holds the people and the things they own outright —
 * accounts, cars, policies, identity papers. This holds everything those
 * people *do*: money moving, a course of tablets, a service due, a will.
 *
 * A second file for the size ratchet, and the split is the natural one: the
 * first module is who the household is, this one is what has happened to them.
 * Everything in the header of `example.js` applies here unchanged — nothing
 * connects to anything, every record says it is an example, and it is all
 * refused by a household that has people in it.
 *
 * ## Transactions, and why there are now some
 *
 * The first version wrote none, on the reasoning that a demonstration must not
 * invent a *derived* figure. That was the right instinct pointed at the wrong
 * thing. A transaction is a record, like an account is; what would have been
 * dishonest is claiming one had been *fetched* from a bank, or that a
 * reconciliation had closed when nothing was compared.
 *
 * What writing none actually did was leave the whole of Finance blank — no
 * spending, no categories, no budgets, no CFO page — which is most of the
 * application. So they are here, generated from a recurring pattern rather
 * than typed out one by one, because a household's money is a pattern with
 * exceptions and a list of ninety literals would be the same thing written
 * less honestly.
 *
 * None is marked `reconciled`, none carries a `statement`, an `importKey` or a
 * `movement`. They are what a person typing into the app would produce, and
 * nothing about them claims otherwise.
 */

import { exampleStrings } from '../locale/en-example.js';
import { today, addDays, addMonths } from '../core/dates.js';
import { option } from './example.js';

const text = (key) => {
  const found = exampleStrings[key];
  if (found === undefined) throw new Error(`no-such-example-string:${key}`);
  return found;
};

const note = () => text('example.note');

/**
 * Two digits, without a space in the source.
 *
 * `${String(day).padStart(2, '0')}` inside a template reads to
 * `tools/strings.mjs` as an English sentence — rightly, since a literal with
 * words and spaces is exactly what it looks for. Same lesson as `birthdayOn`
 * in `example.js`: the tool is not wrong, the expression was.
 */
const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
const on = (clock, { years = 0, months = 0, days = 0 }) => {
  let day = today(clock);
  if (years || months) day = addMonths(day, years * 12 + months);
  return days ? addDays(day, days) : day;
};

/** How many months of money the example carries. */
export const MONTHS = 8;

/**
 * Money, as a pattern with exceptions.
 *
 * Each row is `[everyNthMonthDay, kind, amountInPaise, category, accountKey,
 * payeeKey]`, repeated across `MONTHS`. Salaries land on the 1st, the weekly
 * shop four times a month, fuel twice. The transfer at the end of each month
 * is the household moving what is left into savings — it is a `transfer`, so
 * `domain/finance.js` counts it as neither income nor expense, which is the
 * single most common way a household budget ends up double the truth and
 * therefore the thing most worth having in a demonstration.
 */
const MONTHLY = [
  [1, 'income', 1_85_000_00, 'salary', 'anand-harbour', 'employer.tech'],
  [1, 'income', 68_000_00, 'salary', 'priya-harbour', 'employer.school'],
  [2, 'expense', 3_600_00, 'utilities', 'anand-harbour', 'payee.power'],
  [3, 'expense', 1_450_00, 'subscription', 'anand-harbour', 'payee.broadband'],
  [4, 'expense', 3_200_00, 'groceries', 'priya-harbour', 'payee.grocer'],
  [7, 'expense', 2_800_00, 'fuel', 'anand-harbour', 'payee.fuel'],
  [11, 'expense', 3_200_00, 'groceries', 'priya-harbour', 'payee.grocer'],
  [14, 'expense', 1_850_00, 'dining', 'anand-harbour', 'payee.restaurant'],
  [18, 'expense', 3_200_00, 'groceries', 'priya-harbour', 'payee.grocer'],
  [21, 'expense', 2_800_00, 'fuel', 'priya-harbour', 'payee.fuel'],
  [23, 'expense', 1_200_00, 'transport', 'priya-harbour', 'payee.transport'],
  [25, 'expense', 3_200_00, 'groceries', 'priya-harbour', 'payee.grocer'],
  [26, 'expense', 12_400_00, 'education', 'anand-harbour', 'payee.school'],
  [28, 'transfer', 40_000_00, option('transaction', 'category', 'own-account'), 'anand-harbour', null],
];

/**
 * Which of `example.js`'s twelve accounts each pattern row is written against.
 *
 * A position in that list, which is a reference nothing checks — so
 * `tests/example.test.mjs` checks it, by asserting every transaction resolves
 * to an account held by the person the pattern says is paying.
 */
const ACCOUNT_OF = {
  'anand-harbour': 4,
  'priya-harbour': 6,
  'anand-sapphire': 5,
};

export function transactions(clock = Date.now) {
  const rows = [];
  const now = today(clock);

  for (let back = MONTHS - 1; back >= 0; back--) {
    const month = addMonths(now, -back).slice(0, 7);

    for (const [day, kind, amount, category, account, payee] of MONTHLY) {
      const date = `${month}-${pad2(day)}`;
      // Nothing dated after today: a household's ledger does not run ahead of
      // it, and a future-dated expense would be counted by `inPeriod('month')`
      // as money already spent.
      if (date > now) continue;

      rows.push({
        key: `txn-${rows.length}`,
        date,
        kind,
        amount,
        account: `account-${ACCOUNT_OF[account]}`,
        toAccount: kind === 'transfer' ? `account-${ACCOUNT_OF['anand-sapphire']}` : undefined,
        category,
        payee: payee ? text(`example.${payee}`) : '',
        notes: note(),
      });
    }
  }
  return rows;
}


export function documents(clock = Date.now) {
  /** @type {Array<[string, string, string, string]>} */
  const rows = [
    ['doc.rc', 'vehicle', 'anand', on(clock, { years: 8 })],
    ['doc.floater', 'insurance', 'anand', on(clock, { days: 38 })],
    ['doc.school', 'education', 'vikram', ''],
    ['doc.lab', 'health', 'ramesh', ''],
  ];
  return rows.map(([key, category, person, expiresOn], i) => ({
    key: `document-${i}`,
    title: text(`example.${key}`),
    category,
    person,
    expiresOn,
    notes: note(),
  }));
}

export function healthRecords(clock = Date.now) {
  /** @type {Array<[string, string, string, number]>} */
  const rows = [
    ['ramesh', 'consultation', 'health.cardiology', -40],
    ['ramesh', option('healthRecord', 'kind', 'lab-report'), 'health.bloodwork', -38],
    ['lakshmi', 'consultation', 'health.ortho', -95],
    ['ananya', 'consultation', 'health.paediatric', -20],
  ];
  return rows.map(([person, kind, key, days], i) => ({
    key: `health-${i}`,
    person,
    kind,
    date: on(clock, { days }),
    title: text(`example.${key}`),
    notes: note(),
  }));
}

export function medications(clock = Date.now) {
  /** @type {Array<[string, string, string, number]>} */
  const rows = [
    ['ramesh', 'med.bp', option('medication', 'frequency', 'once-daily'), 24],
    ['lakshmi', 'med.calcium', option('medication', 'frequency', 'twice-daily'), -3],
  ];
  return rows.map(([person, key, frequency, endsIn], i) => ({
    key: `medication-${i}`,
    person,
    name: text(`example.${key}`),
    dosage: text('example.med.dosage'),
    frequency,
    // One course still running and one that ended three days ago without
    // anybody closing it — the disagreement `domain/health.js` exists to ask
    // about, which needs a record in that state to show.
    endsOn: on(clock, { days: endsIn }),
    ongoing: endsIn > 0,
    notes: note(),
  }));
}

export function vaccinations(clock = Date.now) {
  /** @type {Array<[string, string, number, number]>} */
  const rows = [
    ['ananya', 'vax.tdap', -400, 1400],
    ['vikram', 'vax.hpv', -60, 120],
    ['ramesh', 'vax.flu', -300, 65],
  ];
  return rows.map(([person, key, was, next], i) => ({
    key: `vaccination-${i}`,
    person,
    vaccine: text(`example.${key}`),
    date: on(clock, { days: was }),
    nextDoseOn: on(clock, { days: next }),
    notes: note(),
  }));
}

export function appointments(clock = Date.now) {
  /** @type {Array<[string, string, number, string]>} */
  const rows = [
    ['ramesh', 'appt.cardiology', 16, 'scheduled'],
    ['lakshmi', 'appt.physio', -9, 'scheduled'],
    ['ananya', 'appt.dental', 30, 'scheduled'],
  ];
  return rows.map(([person, key, days, status], i) => ({
    key: `appointment-${i}`,
    person,
    title: text(`example.${key}`),
    date: on(clock, { days }),
    status,
    notes: note(),
  }));
}

export function projectsAndTasks(clock = Date.now) {
  const project = { key: 'project-0', name: text('example.project.house'), notes: note() };
  /** @type {Array<[string, string, string, number, string]>} */
  const taskRows = [
    ['task.puc', 'todo', 'urgent', -5, 'anand'],
    ['task.renewal', 'todo', 'high', 24, 'priya'],
    ['task.service', 'doing', 'normal', 12, 'anand'],
    ['task.passport', 'todo', 'normal', 52, 'ramesh'],
    ['task.paint', 'blocked', 'low', 90, 'priya'],
  ];
  const tasks = taskRows.map(([key, status, priority, days, assignee], i) => ({
    key: `task-${i}`,
    title: text(`example.${key}`),
    status,
    priority,
    dueOn: on(clock, { days }),
    assignee,
    project: 'project-0',
    notes: note(),
  }));
  return { project, tasks };
}

export function goals(clock = Date.now) {
  /** @type {Array<[string, string, number, number]>} */
  const rows = [
    ['goal.emergency', option('goal', 'kind', 'emergency-fund'), 12_00_000_00, 18],
    ['goal.college', 'education', 40_00_000_00, 72],
  ];
  return rows.map(([key, kind, targetAmount, months], i) => ({
    key: `goal-${i}`,
    name: text(`example.${key}`),
    kind,
    targetAmount,
    targetDate: on(clock, { months }),
    notes: note(),
  }));
}

export function purchasesAndWarranties(clock = Date.now) {
  /** @type {Array<[string, string, number, number]>} */
  const purchaseRows = [
    ['buy.fridge', 'appliance', -14, 62_400_00],
    ['buy.laptop', 'electronics', -8, 94_900_00],
  ];
  const purchases = purchaseRows.map(([key, category, months, amount], i) => ({
    key: `purchase-${i}`,
    item: text(`example.${key}`),
    category,
    boughtOn: on(clock, { months }),
    amount,
    notes: note(),
  }));

  /** @type {Array<[string, string, string, number]>} */
  const warrantyRows = [
    ['purchase-0', 'warranty.fridge', 'manufacturer', 10],
    ['purchase-1', 'warranty.laptop', 'extended', 16],
  ];
  const warranties = warrantyRows.map(([purchase, key, kind, months], i) => ({
    key: `warranty-${i}`,
    cover: text(`example.${key}`),
    purchase,
    kind,
    expiresOn: on(clock, { months }),
    notes: note(),
  }));

  return { purchases, warranties };
}

export function upkeep(clock = Date.now) {
  /** @type {Array<[string, string, number]>} */
  const serviceRows = [
    ['estate', option('vehicleService', 'kind', 'periodic-service'), -5],
    ['estate', 'tyres', -14],
    ['hatchback', option('vehicleService', 'kind', 'periodic-service'), -9],
  ];
  const services = serviceRows.map(([vehicle, kind, months], i) => ({
    key: `service-${i}`,
    vehicle,
    date: on(clock, { months }),
    kind,
    notes: note(),
  }));

  const fuel = [];
  for (let back = 0; back < 6; back++) {
    fuel.push({
      key: `fuel-${fuel.length}`,
      vehicle: back % 2 ? 'hatchback' : 'estate',
      date: on(clock, { days: -back * 18 - 3 }),
      litres: back % 2 ? 28.4 : 35.1,
      amount: back % 2 ? 2_920_00 : 3_610_00,
      notes: note(),
    });
  }
  return { services, fuel };
}

export function estate(clock = Date.now) {
  const will = {
    key: 'will-0',
    title: text('example.will'),
    testator: 'anand',
    notes: note(),
  };
  const beneficiaries = ['priya', 'vikram', 'ananya'].map((who, i) => ({
    key: `beneficiary-${i}`,
    will: 'will-0',
    name: text(`example.person.${who}`),
    notes: note(),
  }));
  return { will, beneficiaries };
}

export function everydayLife(clock = Date.now) {
  return {
    emergencyContacts: [
      { key: 'ec-0', name: text('example.ec.doctor'), phone: '+91 80 0000 0001', notes: note() },
      { key: 'ec-1', name: text('example.ec.neighbour'), phone: '+91 80 0000 0002', notes: note() },
    ],
    importantDates: [
      {
        key: 'date-0',
        title: text('example.date.anniversary'),
        kind: 'anniversary',
        date: on(clock, { days: 27 }),
        notes: note(),
      },
    ],
    education: [
      {
        key: 'edu-0', person: 'vikram',
        institution: text('example.employer.school'), level: 'school', notes: note(),
      },
      {
        key: 'edu-1', person: 'ananya',
        institution: text('example.employer.school'), level: 'school', notes: note(),
      },
    ],
    employment: [
      {
        key: 'emp-0', person: 'anand', employer: text('example.employer.tech'),
        startedOn: on(clock, { years: -9 }), notes: note(),
      },
      {
        key: 'emp-1', person: 'priya', employer: text('example.employer.school'),
        startedOn: on(clock, { years: -6 }), notes: note(),
      },
    ],
    subscriptions: [
      {
        key: 'sub-0', name: text('example.sub.broadband'),
        amount: 1_450_00, renewsOn: on(clock, { days: 9 }), notes: note(),
      },
      {
        key: 'sub-1', name: text('example.sub.streaming'),
        amount: 499_00, renewsOn: on(clock, { days: 21 }), notes: note(),
      },
    ],
    safeZones: [
      {
        key: 'zone-0', name: text('example.zone.home'),
        latitude: 13.0035, longitude: 77.5709, radiusMetres: 150, notes: note(),
      },
      {
        key: 'zone-1', name: text('example.zone.school'),
        latitude: 12.9855, longitude: 77.5854, radiusMetres: 200, notes: note(),
      },
    ],
  };
}
