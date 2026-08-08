/**
 * Reports.
 *
 * Pick a report, pick a format, get a file. Everything is generated on the
 * device from local records — nothing is sent anywhere to produce a PDF, which
 * matters when the PDF is a family's medical history.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, button, pageHeader, badge, listItem, empty,
} from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { modal } from '../ui/components/modal.js';
import { app } from '../context.js';
import { reports, produce, exportEntity } from '../reports/build.js';
import { entities, entity } from '../data/schema.js';
import { range, formatDay } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { ACTIONS } from '../data/audit.js';

const PERIODS = [
  ['month', 'This month'],
  ['last-month', 'Last month'],
  ['quarter', 'Last three months'],
  ['year', 'This calendar year'],
  ['financial-year', 'This financial year'],
  ['all', 'Everything'],
];

const FORMATS = [
  ['pdf', 'PDF', 'file'],
  ['xlsx', 'Excel', 'grid'],
  ['csv', 'CSV', 'report'],
];

export async function render() {
  const host = h('div', {});

  replace(host, [
    pageHeader('Reports', {
      subtitle: 'Generated on this device, from your own records',
    }),

    h('div', { class: 'grid' }, reports.map((report) => card({ variant: 'interactive' }, [
      cardHeader(report.label, null, { iconName: iconFor(report.id) }),
      h('p', { class: 'small muted' }, report.description),
      h('div', { class: 'row', style: { marginTop: 'var(--space-4)' } },
        FORMATS.map(([format, label]) => button(label, {
          variant: format === 'pdf' ? 'primary' : 'subtle',
          class: 'btn--small',
          onClick: () => run(report, format),
        }))),
    ]))),

    card({ class: 'card--quiet', style: { marginTop: 'var(--space-5)' } }, [
      cardHeader('Export raw data', null, { iconName: 'download' }),
      h('p', { class: 'small muted' },
        'One file per record type, exactly as stored. Encrypted fields — document '
        + 'numbers, passwords, medical notes — are left out unless you ask for them, '
        + 'because an export is a plain file that leaves this device’s protection behind.'),
      h('div', { class: 'row', style: { marginTop: 'var(--space-3)' } }, [
        button('Choose a record type', { variant: 'subtle', onClick: chooseExport }),
      ]),
    ]),
  ]);

  return { node: host };
}

function iconFor(id) {
  return {
    'net-worth': 'chart',
    'monthly-finance': 'wallet',
    investment: 'chart',
    renewals: 'alert',
    health: 'health',
    vehicle: 'car',
    insurance: 'shield',
    property: 'home',
  }[id] ?? 'report';
}

async function run(report, format) {
  const { db } = app();

  const options = report.periods ? await askPeriod() : {};
  if (options === null) return;

  const dismiss = toast(`Building ${report.label}…`, { ms: 0 });
  try {
    const file = await produce(db, report.id, format, options);
    download(file);
    await db.logAudit(ACTIONS.export, { report: report.label, format });
    dismiss();
    toast(`${file.filename} saved`, { kind: 'success' });
  } catch (err) {
    dismiss();
    toast(userMessage(err), { kind: 'error' });
  }
}

function askPeriod() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const body = h('div', { class: 'stack' }, PERIODS.map(([id, label]) => {
      const bounds = range(id);
      return h('button', {
        class: 'list-item',
        type: 'button',
        style: { width: '100%', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' },
        onClick: () => {
          finish({ period: bounds, periodLabel: label });
          close();
        },
      }, [
        h('div', { class: 'list-item-body' }, [
          h('div', { class: 'list-item-title' }, label),
          h('div', { class: 'list-item-subtitle' },
            `${formatDay(bounds.from)} — ${formatDay(bounds.to)}`),
        ]),
        icon('chevronRight', { size: 18 }),
      ]);
    }));

    const { close } = modal({
      title: 'Which period?',
      body,
      onClose: () => finish(null),
    });
  });
}

async function chooseExport() {
  const { db } = app();
  let includeEncrypted = false;

  const body = h('div', { class: 'stack' }, [
    h('label', { class: 'checkbox' }, [
      h('input', {
        type: 'checkbox',
        onChange: (e) => { includeEncrypted = e.target.checked; },
      }),
      h('span', { class: 'small' },
        'Include encrypted fields in the clear (document numbers, passwords, medical notes)'),
    ]),
    h('div', { class: 'list' }, Object.values(entities)
      .sort((a, b) => a.labels.many.localeCompare(b.labels.many))
      .map((def) => listItem({
        title: def.labels.many,
        subtitle: def.module,
        trailing: h('div', { class: 'row' }, [
          button('CSV', {
            class: 'btn--small',
            variant: 'subtle',
            onClick: () => exportOne(db, def.name, 'csv', includeEncrypted),
          }),
          button('Excel', {
            class: 'btn--small',
            variant: 'subtle',
            onClick: () => exportOne(db, def.name, 'xlsx', includeEncrypted),
          }),
        ]),
      }))),
  ]);

  modal({ title: 'Export raw data', body, wide: true });
}

async function exportOne(db, entityName, format, includeEncrypted) {
  try {
    const file = await exportEntity(db, entityName, format, { includeEncrypted });
    download(file);
    await db.logAudit(ACTIONS.export, {
      report: entity(entityName).labels.many, format, includeEncrypted,
    });
    toast(`${file.filename} saved`, { kind: 'success' });
  } catch (err) {
    toast(userMessage(err), { kind: 'error' });
  }
}

/**
 * Hand the file to the browser. `showSaveFilePicker` where it exists, so the
 * user chooses where it goes; an anchor everywhere else.
 */
export async function download({ blobParts, mime, filename }) {
  const blob = new Blob([blobParts], { type: mime });

  if (globalThis.showSaveFilePicker) {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: filename.split('.').pop().toUpperCase(), accept: { [mime]: [`.${filename.split('.').pop()}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // The user cancelling the picker is not an error worth reporting; any
      // other failure falls through to the anchor.
      if (err.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export { empty, badge };
