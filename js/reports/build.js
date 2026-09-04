/**
 * Report definitions.
 *
 * A report is a name, the entities it needs, and a function turning those
 * records into sections. The three writers — CSV, XLSX, PDF — all consume the
 * same section list, so a report is defined once and comes out in every
 * format, and the PDF cannot drift from the spreadsheet.
 *
 * A section is:
 *   { title, columns: [{key, label, type, align, width}], rows, summary? }
 */

import { toCsv, columnsFor } from './csv.js';
import { toXlsx } from './xlsx.js';
import { PdfDocument } from './pdf.js';
import { format, formatCompact, sum } from '../core/money.js';
import { formatDay, today, range, startOfFinancialYear, endOfFinancialYear } from '../core/dates.js';
import { entity } from '../data/schema.js';
import { t } from '../core/locale.js';
import * as fin from '../domain/finance.js';
import { netWorth } from '../domain/networth.js';
import { portfolioSummary, allocation, holdingGain, xirr, cashFlows } from '../domain/portfolio.js';
import { allReminders, describeReminder } from '../domain/reminders.js';
import { safeFileName } from '../security/sanitize.js';

/* -------------------------------------------------------------- catalogue */

export const reports = [
  {
    id: 'net-worth',
    label: 'Net worth statement',
    description: 'Assets, liabilities and what makes them up, as of today.',
    entities: ['account', 'transaction', 'holding', 'property', 'vehicle', 'loan', 'person'],
    build(data) {
      const result = netWorth({
        accounts: data.account, transactions: data.transaction, holdings: data.holding,
        properties: data.property, vehicles: data.vehicle, loans: data.loan,
      });
      const balances = fin.accountBalances(data.account, data.transaction);

      return {
        summary: [
          ['Total assets', format(result.assets)],
          ['Total liabilities', format(result.liabilities)],
          ['Net worth', format(result.total)],
        ],
        note: result.staleValuations.length
          ? `${result.staleValuations.length} item(s) rest on a valuation that is missing or `
            + 'out of date. Update those valuations for a truer figure.'
          : '',
        sections: [
          {
            title: 'Summary',
            columns: [
              { key: 'label', label: 'Component' },
              { key: 'value', label: 'Amount', type: 'currency', align: 'right' },
            ],
            rows: result.breakdown,
          },
          {
            title: 'Accounts',
            columns: [
              { key: 'name', label: 'Account', width: 2 },
              { key: 'institution', label: 'Institution' },
              { key: 'kind', label: 'Type' },
              { key: 'balance', label: 'Balance', type: 'currency', align: 'right' },
            ],
            rows: balances.filter((a) => !a.archived),
          },
          {
            title: 'Investments',
            columns: [
              { key: 'name', label: 'Holding', width: 2 },
              { key: 'kind', label: 'Type' },
              { key: 'invested', label: 'Invested', type: 'currency', align: 'right' },
              { key: 'currentValue', label: 'Value', type: 'currency', align: 'right' },
            ],
            rows: data.holding.filter((h) => h.active !== false),
          },
          {
            title: 'Liabilities',
            columns: [
              { key: 'name', label: 'Loan', width: 2 },
              { key: 'lender', label: 'Lender' },
              { key: 'outstanding', label: 'Outstanding', type: 'currency', align: 'right' },
              { key: 'emiAmount', label: 'EMI', type: 'currency', align: 'right' },
            ],
            rows: data.loan,
          },
        ].filter((section) => section.rows.length),
      };
    },
  },

  {
    id: 'monthly-finance',
    label: 'Monthly financial summary',
    description: 'Income, spending by category, and every transaction in the month.',
    entities: ['transaction', 'account', 'budget'],
    periods: true,
    build(data, { period = 'month' } = {}) {
      const bounds = typeof period === 'string' ? range(period) : period;
      const rows = fin.inPeriod(data.transaction, bounds);
      const totals = fin.totals(rows);
      const accountName = Object.fromEntries(data.account.map((a) => [a.id, a.name]));

      return {
        summary: [
          ['Period', `${formatDay(bounds.from)} to ${formatDay(bounds.to)}`],
          ['Income', format(totals.income)],
          ['Spending', format(totals.expense)],
          ['Net', format(totals.net)],
        ],
        sections: [
          {
            title: 'Spending by category',
            columns: [
              { key: 'label', label: 'Category' },
              { key: 'value', label: 'Amount', type: 'currency', align: 'right' },
            ],
            rows: fin.byCategory(rows),
          },
          {
            title: 'Budgets',
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'limit', label: 'Limit', type: 'currency', align: 'right' },
              { key: 'spent', label: 'Spent', type: 'currency', align: 'right' },
              { key: 'remaining', label: 'Left', type: 'currency', align: 'right' },
            ],
            rows: fin.budgetStatus(data.budget, data.transaction, { month: bounds.from }),
          },
          {
            title: 'Transactions',
            columns: [
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'payee', label: 'Payee', width: 2 },
              { key: 'category', label: 'Category' },
              { key: 'accountName', label: 'Account' },
              { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
            ],
            rows: rows.map((t) => ({
              ...t,
              accountName: accountName[t.account] ?? '',
              amount: t.kind === 'income' ? t.amount : -t.amount,
            })),
          },
        ].filter((section) => section.rows.length),
      };
    },
  },

  {
    id: 'investment',
    label: 'Investment report',
    description: 'Holdings, gain, asset allocation and XIRR.',
    entities: ['holding', 'investmentTransaction', 'person'],
    build(data) {
      const summary = portfolioSummary(data.holding);
      const flows = data.holding
        .flatMap((holding) => cashFlows(holding, data.investmentTransaction))
        .sort((a, b) => a.date.localeCompare(b.date));
      const rate = xirr(flows);
      const owner = Object.fromEntries(data.person.map((p) => [p.id, p.name]));

      return {
        summary: [
          ['Invested', format(summary.invested)],
          ['Current value', format(summary.value)],
          ['Gain', `${format(summary.gain)} (${summary.gainPercent ?? 0}%)`],
          ['XIRR', rate === null ? 'not computable' : `${rate}%`],
        ],
        sections: [
          {
            title: 'Holdings',
            columns: [
              { key: 'name', label: 'Holding', width: 2 },
              { key: 'kind', label: 'Type' },
              { key: 'ownerName', label: 'Owner' },
              { key: 'invested', label: 'Invested', type: 'currency', align: 'right' },
              { key: 'value', label: 'Value', type: 'currency', align: 'right' },
              { key: 'gainPercent', label: 'Gain %', align: 'right' },
            ],
            rows: data.holding.map((holding) => ({
              ...holding,
              ...holdingGain(holding),
              ownerName: owner[holding.owner] ?? '',
            })),
          },
          {
            title: 'Asset allocation',
            columns: [
              { key: 'label', label: 'Asset class' },
              { key: 'value', label: 'Value', type: 'currency', align: 'right' },
              { key: 'share', label: 'Share %', align: 'right' },
            ],
            rows: allocation(data.holding),
          },
        ].filter((section) => section.rows.length),
      };
    },
  },

  {
    id: 'renewals',
    label: 'Renewals & expiries',
    description: 'Everything with a date attached, and how long is left on it.',
    entities: ['policy', 'vehicle', 'document', 'identityDocument', 'subscription',
      'digitalAsset', 'holding', 'property', 'certificate', 'person', 'importantDate'],
    build(data) {
      const reminders = allReminders(data, { horizonDays: 365 });
      return {
        summary: [
          ['Items tracked', String(reminders.length)],
          ['Already lapsed', String(reminders.filter((r) => r.days < 0).length)],
          ['Within 30 days', String(reminders.filter((r) => r.days >= 0 && r.days <= 30).length)],
        ],
        sections: [{
          title: 'Upcoming',
          columns: [
            { key: 'title', label: 'Item', width: 2 },
            { key: 'label', label: 'What' },
            { key: 'date', label: 'Date', type: 'date' },
            { key: 'days', label: 'Days', align: 'right' },
            { key: 'severity', label: 'Status' },
          ],
          rows: reminders,
        }],
      };
    },
  },

  {
    id: 'health',
    label: 'Health record',
    description: 'Medical history, medications and vaccinations, per person.',
    entities: ['person', 'healthRecord', 'medication', 'vaccination', 'appointment', 'policy'],
    build(data) {
      const name = Object.fromEntries(data.person.map((p) => [p.id, p.name]));
      const withName = (rows) => rows.map((r) => ({ ...r, personName: name[r.person] ?? '' }));

      return {
        summary: [
          ['People', String(data.person.length)],
          ['Records', String(data.healthRecord.length)],
          ['Ongoing medications', String(data.medication.filter((m) => m.ongoing !== false).length)],
        ],
        sections: [
          {
            title: 'People',
            columns: [
              { key: 'name', label: 'Name', width: 2 },
              { key: 'bloodGroup', label: 'Blood group' },
              { key: 'allergies', label: 'Allergies', width: 2 },
            ],
            rows: data.person,
          },
          {
            title: 'Medical history',
            columns: [
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'personName', label: 'Person' },
              { key: 'kind', label: 'Type' },
              { key: 'title', label: 'Detail', width: 2 },
              { key: 'doctor', label: 'Doctor' },
            ],
            rows: withName(data.healthRecord),
          },
          {
            title: 'Medications',
            columns: [
              { key: 'personName', label: 'Person' },
              { key: 'name', label: 'Medicine', width: 2 },
              { key: 'dosage', label: 'Dosage' },
              { key: 'frequency', label: 'Frequency' },
            ],
            rows: withName(data.medication.filter((m) => m.ongoing !== false)),
          },
          {
            title: 'Vaccinations',
            columns: [
              { key: 'personName', label: 'Person' },
              { key: 'vaccine', label: 'Vaccine', width: 2 },
              { key: 'date', label: 'Given', type: 'date' },
              { key: 'nextDoseOn', label: 'Next dose', type: 'date' },
            ],
            rows: withName(data.vaccination),
          },
        ].filter((section) => section.rows.length),
      };
    },
  },

  {
    id: 'vehicle',
    label: 'Vehicle report',
    description: 'Compliance dates, service history and running cost.',
    entities: ['vehicle', 'vehicleService', 'fuelLog'],
    build(data) {
      const registration = Object.fromEntries(data.vehicle.map((v) => [v.id, v.registration]));
      const withVehicle = (rows) => rows.map((r) => ({
        ...r, vehicleName: registration[r.vehicle] ?? '',
      }));

      const fuelCost = sum(data.fuelLog.map((f) => f.amount ?? 0));
      const serviceCost = sum(data.vehicleService.map((s) => s.cost ?? 0));

      return {
        summary: [
          ['Vehicles', String(data.vehicle.length)],
          ['Fuel spend recorded', format(fuelCost)],
          ['Service spend recorded', format(serviceCost)],
        ],
        sections: [
          {
            title: 'Vehicles',
            columns: [
              { key: 'registration', label: 'Registration' },
              { key: 'make', label: 'Make' },
              { key: 'model', label: 'Model' },
              { key: 'insuranceExpiresOn', label: 'Insurance', type: 'date' },
              { key: 'pucExpiresOn', label: 'PUC', type: 'date' },
              { key: 'odometer', label: 'Odometer', align: 'right' },
            ],
            rows: data.vehicle,
          },
          {
            title: 'Service history',
            columns: [
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'vehicleName', label: 'Vehicle' },
              { key: 'kind', label: 'Type' },
              { key: 'workshop', label: 'Workshop' },
              { key: 'cost', label: 'Cost', type: 'currency', align: 'right' },
            ],
            rows: withVehicle(data.vehicleService),
          },
        ].filter((section) => section.rows.length),
      };
    },
  },

  {
    id: 'insurance',
    label: 'Insurance schedule',
    description: 'Every policy, its cover, premium and renewal date.',
    entities: ['policy', 'person'],
    build(data) {
      const name = Object.fromEntries(data.person.map((p) => [p.id, p.name]));
      return {
        summary: [
          ['Policies', String(data.policy.length)],
          ['Total cover', formatCompact(sum(data.policy.map((p) => p.sumAssured ?? 0)))],
          ['Annual premium', format(sum(data.policy.map(annualPremium)))],
        ],
        sections: [{
          title: 'Policies',
          columns: [
            { key: 'name', label: 'Policy', width: 2 },
            { key: 'insurer', label: 'Insurer' },
            { key: 'kind', label: 'Type' },
            { key: 'holderName', label: 'Holder' },
            { key: 'sumAssured', label: 'Cover', type: 'currency', align: 'right' },
            { key: 'premium', label: 'Premium', type: 'currency', align: 'right' },
            { key: 'renewsOn', label: 'Renews', type: 'date' },
          ],
          rows: data.policy.map((p) => ({ ...p, holderName: name[p.holder] ?? '' })),
        }],
      };
    },
  },

  {
    id: 'property',
    label: 'Property report',
    description: 'Holdings, valuations, rental income and tax status.',
    entities: ['property', 'person'],
    build(data) {
      const name = Object.fromEntries(data.person.map((p) => [p.id, p.name]));
      return {
        summary: [
          ['Properties', String(data.property.length)],
          ['Market value', formatCompact(sum(data.property.map((p) => p.currentValue || p.purchasePrice || 0)))],
          ['Monthly rent', format(sum(data.property.filter((p) => p.rented).map((p) => p.monthlyRent ?? 0)))],
        ],
        sections: [{
          title: 'Properties',
          columns: [
            { key: 'name', label: 'Property', width: 2 },
            { key: 'kind', label: 'Type' },
            { key: 'ownerName', label: 'Owner' },
            { key: 'purchasePrice', label: 'Cost', type: 'currency', align: 'right' },
            { key: 'currentValue', label: 'Value', type: 'currency', align: 'right' },
            { key: 'monthlyRent', label: 'Rent', type: 'currency', align: 'right' },
          ],
          rows: data.property.map((p) => ({ ...p, ownerName: name[p.owner] ?? '' })),
        }],
      };
    },
  },
];

function annualPremium(policy) {
  const premium = policy.premium ?? 0;
  switch (policy.premiumFrequency) {
    case 'monthly': return premium * 12;
    case 'quarterly': return premium * 4;
    case 'half-yearly': return premium * 2;
    case 'single': return 0;
    default: return premium;
  }
}

export function reportById(id) {
  const report = reports.find((r) => r.id === id);
  if (!report) throw new Error(`unknown report: ${id}`);
  return report;
}

/* ------------------------------------------------------------- rendering */

/**
 * Load every entity a report needs, through the repository's permissions.
 *
 * ## Why this reports what it could not read
 *
 * A failed read used to become `[]`, and the report was then built over it.
 * That is worse here than anywhere else in the application: a screen is looked
 * at once and can be reloaded, but a report is a **file a household keeps** —
 * dated, downloaded, sent to an accountant, read again a year later with no
 * memory of the moment it was made.
 *
 * `renderCsv` made the claim out loud: *"No records fall in this period."* A
 * report whose every store failed to read printed exactly that sentence.
 *
 * A permission refusal is different and stays silent. A role that may not read
 * loans contributes no loans, and that is the design rather than a fault —
 * `core/errors.js` gives `PermissionError` the code `'permission'`, which is
 * what tells the two apart. Anything else is recorded and travels with the
 * report.
 *
 * @returns {Promise<{data: Record<string, any[]>, unreadable: string[]}>}
 */
export async function gather(db, report) {
  /** @type {Record<string, any[]>} */
  const data = {};
  const unreadable = [];
  for (const name of report.entities) {
    try {
      data[name] = await db.repo(name).list({ limit: 20_000 });
    } catch (err) {
      data[name] = [];
      if (err?.code !== 'permission') unreadable.push(name);
    }
  }
  return { data, unreadable };
}

/**
 * The line a report carries when part of it could not be read.
 *
 * Put in `summary`, which leads all three formats, rather than in `note`,
 * which only the PDF renders. A household that exports a CSV is exactly as
 * entitled to know the file is short.
 */
export function unreadableSummary(unreadable) {
  if (!unreadable?.length) return null;
  return [
    t('report.incomplete.label'),
    t('report.incomplete.text', { n: unreadable.length, names: unreadable.join(', ') }),
  ];
}

export function renderCsv(built) {
  const blocks = [];

  // The summary always leads, so a report over a period with no activity is
  // still a file that says so — a zero-byte download looks like a failure.
  if (built.summary?.length) {
    blocks.push('Summary\r\n' + toCsv(
      [{ key: 'label', label: 'Item' }, { key: 'value', label: 'Value' }],
      built.summary.map(([label, value]) => ({ label, value })),
      { bom: false },
    ));
  }

  // One CSV cannot hold several tables, so the sections are stacked with a
  // blank line and a title between them — what a person would do by hand, and
  // what every spreadsheet imports without complaint.
  for (const section of built.sections) {
    blocks.push(`${section.title}\r\n` + toCsv(section.columns, section.rows, { bom: false }));
  }

  // Only when nothing could have been missed. Saying this over a failed read is
  // the exact sentence this file exists not to print.
  const incomplete = t('report.incomplete.label');
  if (!built.sections.length && !built.summary?.some(([label]) => label === incomplete)) {
    blocks.push(`${t('report.emptyPeriod')}\r\n`);
  }
  return blocks.join('\r\n');
}

export function renderXlsx(built, { title }) {
  const sheets = built.sections.map((section) => ({
    name: section.title,
    columns: section.columns,
    rows: section.rows,
  }));

  // A workbook needs at least one sheet, and a summary is a better empty
  // state than a blank grid.
  sheets.unshift({
    name: 'Summary',
    columns: [{ key: 'label', label: title }, { key: 'value', label: 'Value' }],
    rows: (built.summary ?? []).map(([label, value]) => ({ label, value })),
  });

  return toXlsx(sheets);
}

export function renderPdf(built, { title, subtitle }) {
  const doc = new PdfDocument({
    title,
    subtitle,
    footer: 'FamilyOS',
  });

  if (built.summary?.length) doc.keyValue(built.summary);
  if (built.note) doc.paragraph(built.note, { size: 9 });

  for (const section of built.sections) {
    doc.heading(section.title, 2);
    doc.table(
      section.columns.map((column) => ({
        key: column.key,
        label: column.label,
        align: column.align,
        width: column.width,
      })),
      section.rows.map((row) => Object.fromEntries(section.columns.map((column) => [
        column.key, formatForPdf(row[column.key], column),
      ]))),
    );
  }

  return doc.build();
}

function formatForPdf(value, column) {
  if (value === null || value === undefined || value === '') return '';
  // The third export, and the same question as the other two. `format` on the
  // hand-edited amount `domain/amounts.js` describes returns the string
  // `'₹NaN'`, and a printed net worth statement with a line reading ₹NaN is
  // the most visible of the three: the CSV and the sheet at least go somewhere
  // a person can inspect, and this is what they hand to somebody.
  //
  // The text that is in their sheet, then, which is the thing to go and fix.
  if (column.type === 'currency') {
    return Number.isFinite(Number(value)) ? format(value) : String(value);
  }
  if (column.type === 'date') return formatDay(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * Produce one report in one format.
 * @returns {Promise<{blobParts: Uint8Array|string, mime: string, filename: string}>}
 */
export async function produce(db, reportId, formatName, options = {}) {
  const report = reportById(reportId);
  const { data, unreadable } = await gather(db, report);
  const built = report.build(data, options);

  // Prepended, not appended. A person reads the top of a summary and stops.
  const warning = unreadableSummary(unreadable);
  if (warning) built.summary = [warning, ...(built.summary ?? [])];

  const subtitle = `Generated ${formatDay(today())}`
    + (options.periodLabel ? ` · ${options.periodLabel}` : '');
  const base = safeFileName(`FamilyOS ${report.label} ${today()}`);

  switch (formatName) {
    case 'csv':
      return {
        blobParts: renderCsv(built),
        mime: 'text/csv;charset=utf-8',
        filename: `${base}.csv`,
      };
    case 'xlsx':
      return {
        blobParts: renderXlsx(built, { title: report.label }),
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${base}.xlsx`,
      };
    case 'pdf':
      return {
        blobParts: renderPdf(built, { title: report.label, subtitle }),
        mime: 'application/pdf',
        filename: `${base}.pdf`,
      };
    default:
      throw new Error(`unknown format: ${formatName}`);
  }
}

/** A raw dump of one entity, for someone who wants their data out. */
export async function exportEntity(db, entityName, formatName, { includeEncrypted = false } = {}) {
  const def = entity(entityName);
  const rows = await db.repo(entityName).list({ limit: 50_000 });
  const columns = columnsFor(entityName, { includeEncrypted });
  const base = safeFileName(`FamilyOS ${def.labels.many} ${today()}`);

  if (formatName === 'xlsx') {
    return {
      blobParts: toXlsx([{ name: def.labels.many, columns, rows }]),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${base}.xlsx`,
    };
  }
  return {
    blobParts: toCsv(columns, rows),
    mime: 'text/csv;charset=utf-8',
    filename: `${base}.csv`,
  };
}

export { describeReminder, startOfFinancialYear, endOfFinancialYear };
