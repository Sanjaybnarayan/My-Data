/**
 * What the example household owns, owes and keeps locked.
 *
 * The third and last of the example modules. `example.js` is who they are,
 * `example-life.js` is what has happened to them, and this is the balance
 * sheet and the filing cabinet: a house and a home loan, some investments, the
 * budgets they set themselves, a tenant, a vault, the papers that matter after
 * a death.
 *
 * Everything in `example.js`'s header applies unchanged. Two things are worth
 * saying again here because this is where they bite hardest.
 *
 * **No price feed, and no pretence of one.** A holding carries `invested`,
 * `currentValue` and `valuedOn` — three figures a household types in from a
 * statement. Phase 8 and Phase 12 both refuse a price feed, and this refuses
 * it too: nothing here revalues itself, and `valuedOn` says when each figure
 * was last true.
 *
 * The dates are set months back deliberately, and writing them is how a claim
 * of mine turned out to be wrong. This comment used to say `domain/networth.js`
 * would report these valuations as *stale*. It does not: `staleValuations`
 * means **no `currentValue` at all** — valued at cost, at purchase price, or
 * not valued — and never consults `valuedOn`. Measured: a property valued
 * three years ago contributes its full figure and is flagged as nothing, while
 * the same property with no valuation is flagged. The unknown is surfaced and
 * the confidently-stale is silent, which is the wrong way round.
 *
 * **The vault holds inventions, not secrets.** `vaultItem.password` and the
 * rest are encrypted fields, and what is sealed into them here is nonsense
 * chosen to look like nothing anybody uses. A demonstration whose vault
 * contained a plausible real password would be a demonstration you could not
 * safely show anybody.
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
const on = (clock, { years = 0, months = 0, days = 0 }) => {
  let day = today(clock);
  if (years || months) day = addMonths(day, years * 12 + months);
  return days ? addDays(day, days) : day;
};

/**
 * A house, and the loan against it.
 *
 * The loan's `outstanding` is below its `principal` by roughly what nine years
 * of payments would clear, so the liabilities side of net worth is a figure
 * with a shape rather than a round number — and `domain/amortise.js` has a
 * schedule it can actually draw.
 */
export function property(clock = Date.now) {
  return [{
    key: 'property-0',
    name: text('example.property.house'),
    kind: option('property', 'kind', 'apartment'),
    address: text('example.address'),
    owner: 'anand',
    area: 1180,
    purchasePrice: 62_00_000_00,
    purchasedOn: on(clock, { years: -9 }),
    currentValue: 1_15_00_000_00,
    valuedOn: on(clock, { months: -14 }),
    rented: false,
    notes: note(),
  }];
}

export function letProperty(clock = Date.now) {
  return [{
    key: 'property-1',
    name: text('example.property.shop'),
    kind: option('property', 'kind', 'commercial'),
    owner: 'ramesh',
    area: 320,
    purchasePrice: 18_00_000_00,
    purchasedOn: on(clock, { years: -22 }),
    currentValue: 46_00_000_00,
    valuedOn: on(clock, { months: -20 }),
    rented: true,
    monthlyRent: 24_000_00,
    notes: note(),
  }];
}

export function tenants(clock = Date.now) {
  return [{
    key: 'tenant-0',
    name: text('example.tenant'),
    property: 'property-1',
    phone: '+91 80 0000 0003',
    agreementStartsOn: on(clock, { months: -19 }),
    agreementEndsOn: on(clock, { months: 5 }),
    monthlyRent: 24_000_00,
    deposit: 1_44_000_00,
    rentDueOn: option('tenant', 'rentDueOn', '5th'),
    notes: note(),
  }];
}

export function loans(clock = Date.now) {
  return [
    {
      key: 'loan-0',
      name: text('example.loan.home'),
      kind: option('loan', 'kind', 'home'),
      lender: text('example.bank.harbour'),
      borrower: 'anand',
      principal: 48_00_000_00,
      outstanding: 31_40_000_00,
      interestRate: 8.6,
      tenureMonths: 240,
      emiAmount: 42_100_00,
      emiDay: 5,
      startedOn: on(clock, { years: -9 }),
      endsOn: on(clock, { years: 11 }),
      notes: note(),
    },
    {
      key: 'loan-1',
      name: text('example.loan.car'),
      kind: option('loan', 'kind', 'vehicle'),
      lender: text('example.bank.sapphire'),
      borrower: 'priya',
      principal: 6_50_000_00,
      outstanding: 1_18_000_00,
      interestRate: 9.4,
      tenureMonths: 60,
      emiAmount: 13_600_00,
      emiDay: 10,
      startedOn: on(clock, { years: -4, months: -6 }),
      endsOn: on(clock, { months: 6 }),
      notes: note(),
    },
  ];
}

/**
 * Four holdings, valued on a day that is stated.
 *
 * `valuedOn` sits months back on purpose, so the demonstration carries a
 * portfolio whose figures have an age — see the header for what the
 * application does and does not currently do with that age.
 */
export function holdings(clock = Date.now) {
  /** @type {Array<[string, string, string, number, number, number]>} */
  const rows = [
    ['hold.index', 'mutual-fund', 'anand', 6_40_000_00, 8_12_000_00, -4],
    ['hold.elss', 'mutual-fund', 'priya', 3_00_000_00, 3_86_500_00, -4],
    ['hold.gold', 'gold', 'lakshmi', 2_20_000_00, 4_05_000_00, -11],
    ['hold.fd', 'fixed-deposit', 'ramesh', 5_00_000_00, 5_71_000_00, -2],
  ];
  return rows.map(([key, kind, owner, invested, currentValue, valuedMonths], i) => ({
    key: `holding-${i}`,
    name: text(`example.${key}`),
    kind: option('holding', 'kind', kind),
    owner,
    invested,
    currentValue,
    valuedOn: on(clock, { months: valuedMonths }),
    active: true,
    notes: note(),
  }));
}

export function investmentTransactions(clock = Date.now) {
  const rows = [];
  for (let back = 5; back >= 0; back--) {
    rows.push({
      key: `invtxn-${rows.length}`,
      holding: 'holding-0',
      date: on(clock, { months: -back, days: 2 }),
      kind: option('investmentTransaction', 'kind', 'buy'),
      amount: 20_000_00,
      notes: note(),
    });
  }
  return rows;
}

/**
 * Budgets, set below what the household actually spends on two of the four.
 *
 * A demonstration where every budget is comfortably met shows the budget screen
 * in one state only. Groceries and dining are set where eight months of the
 * seeded transactions will breach them, so the over-budget path has something
 * real to draw.
 */
export function budgets(clock = Date.now) {
  return [
    ['groceries', 11_000_00],
    ['dining', 1_500_00],
    ['fuel', 6_500_00],
    ['utilities', 4_500_00],
  ].map(([category, monthlyLimit], i) => ({
    key: `budget-${i}`,
    category: option('transaction', 'category', category),
    monthlyLimit,
    alertAtPercent: 80,
    notes: note(),
  }));
}

export function recurringPayments(clock = Date.now) {
  /** @type {Array<[string, string, number, string, number]>} */
  const rows = [
    ['rec.emi', 'EMI', 42_100_00, 'monthly', 5],
    ['rec.premium', 'premium', 42_600_00, 'yearly', 38],
    ['rec.sip', 'SIP', 20_000_00, 'monthly', 2],
  ];
  return rows.map(([key, kind, amount, frequency, days], i) => ({
    key: `recurring-${i}`,
    name: text(`example.${key}`),
    kind: option('recurringPayment', 'kind', kind.toLowerCase()),
    amount,
    frequency,
    nextDueOn: on(clock, { days }),
    active: true,
    notes: note(),
  }));
}

/**
 * The vault, holding inventions.
 *
 * Every secret here is nonsense by construction. A demonstration whose vault
 * contained something that looked like a real password is one you could not
 * show anybody over your shoulder, and somebody would eventually reuse it.
 */
export function vault(clock = Date.now) {
  return [
    ['vault.wifi', 'wifi', 'not-a-real-passphrase-0001'],
    ['vault.email', 'login', 'not-a-real-password-0002'],
    ['vault.locker', 'secure-note', 'not-a-real-combination-0003'],
  ].map(([key, kind, secret], i) => ({
    key: `vault-${i}`,
    name: text(`example.${key}`),
    kind: option('vaultItem', 'kind', kind),
    password: secret,
    person: 'anand',
    passwordChangedOn: on(clock, { months: -7 }),
    notes: note(),
  }));
}

export function digitalAssets(clock = Date.now) {
  return [
    ['digital.domain', 'domain'],
    ['digital.photos', 'cloud-storage'],
  ].map(([key, kind], i) => ({
    key: `digital-${i}`,
    name: text(`example.${key}`),
    kind: option('digitalAsset', 'kind', kind),
    owner: 'anand',
    notes: note(),
  }));
}

export function papers(clock = Date.now) {
  return {
    legalDocuments: [{
      key: 'legal-0',
      title: text('example.legal.poa'),
      kind: option('legalDocument', 'kind', 'power-of-attorney'),
      notes: note(),
    }],
    certificates: [
      {
        key: 'cert-0', person: 'vikram',
        title: text('example.cert.swimming'), notes: note(),
      },
      {
        key: 'cert-1', person: 'anand',
        title: text('example.cert.degree'), notes: note(),
      },
    ],
    kycRecords: [
      {
        key: 'kyc-0', person: 'anand',
        institution: text('example.bank.harbour'),
        recordedOn: on(clock, { months: -30 }),
        source: option('kycRecord', 'source', 'account-opening-form'),
        notes: note(),
      },
      {
        key: 'kyc-1', person: 'priya',
        institution: text('example.bank.deccan'),
        recordedOn: on(clock, { months: -16 }),
        source: option('kycRecord', 'source', 'their-portal'),
        notes: note(),
      },
    ],
    notes: [
      { key: 'note-0', title: text('example.note.meter'), notes: note() },
      { key: 'note-1', title: text('example.note.plumber'), notes: note() },
    ],
  };
}

export function calendarAndTravel(clock = Date.now) {
  return {
    events: [
      {
        key: 'event-0', title: text('example.event.parentsDay'),
        date: on(clock, { days: 14 }), notes: note(),
      },
      {
        key: 'event-1', title: text('example.event.service'),
        date: on(clock, { days: 12 }), notes: note(),
      },
    ],
    trips: [{
      key: 'trip-0',
      destination: text('example.trip'),
      departsOn: on(clock, { days: 63 }),
      returnsOn: on(clock, { days: 71 }),
      // Who is going, not how many: `travellers` is a multiref, and the
      // validator refused the number — which is referential integrity
      // working, on a demonstration, before anybody shipped it.
      travellers: ['anand', 'priya', 'vikram', 'ananya'],
      international: false,
      notes: note(),
    }],
  };
}
