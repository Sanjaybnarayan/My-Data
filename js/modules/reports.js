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
import { range, formatDay, today, addMonths } from '../core/dates.js';
import { format } from '../core/money.js';
import { heldRows, describeHeld } from '../domain/amounts.js';
import { docx } from '../reports/docx.js';
import {
  rentReceived, rentYear, rentReceiptBlocks, rentReceiptFilename,
} from '../domain/rentreceipt.js';
import { userMessage } from '../core/errors.js';
import { readTemplate, generate, generatedName } from '../domain/docxtemplate.js';
import { inflate } from '../data/pdf-read.js';
import { ACTIONS } from '../data/audit.js';
import { TRANSACTION_LIMIT } from '../services/service.js';
import { documentStore } from './documents.js';
import { plugin } from '../core/native.js';
import { toBase64 } from '../security/crypto.js';

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

/**
 * Rent receipts, for rent the household has actually been paid.
 *
 * ## One direction only
 *
 * A receipt is a statement by the person who **received** the money. This
 * issues them for property the household rents out, where they are the one
 * making the statement and signing it.
 *
 * It does not produce receipts for rent the household *pays*. That would mean
 * writing, in a landlord's voice, that the landlord received it — a document
 * asserting somebody else's acknowledgement, produced by the party who benefits
 * from the claim. Tenants need those for HRA and often cannot get them, which
 * is exactly the pressure that makes writing one dangerous rather than helpful.
 *
 * ## And only for months there is a payment for
 *
 * `property.monthlyRent` is what the rent *is*, not evidence any arrived. A
 * month with no matching credit produces **no document**, and is listed as
 * unreceipted instead — the difference between a record and a claim.
 */
function rentReceiptsCard() {
  const host = h('div', {});
  void paint();
  return host;

  async function paint() {
    const { db } = app();
    const [properties, transactions, people] = await Promise.all([
      db.repo('property').list({ decrypt: false, limit: 500 }),
      db.repo('transaction').list({ decrypt: false, limit: TRANSACTION_LIMIT }),
      db.repo('person').list({ decrypt: false, limit: 200 }),
    ]);

    const rented = properties.filter((p) => !p.deletedAt && p.rented && p.monthlyRent);
    if (!rented.length) {
      replace(host, null);
      return;
    }

    const to = today();
    const from = addMonths(to, -12).slice(0, 8) + '01';

    /*
     * A credit the sync is holding is a month that will be receipted later and
     * reads, until then, exactly like a month nobody paid.
     *
     * Counted over the credits in the window this report covers, and from the
     * unfiltered list on purpose: `rentReceived` asks `settled()`, so by the
     * time it has run the held rows are gone and counting them there would
     * count nothing at all.
     */
    const held = describeHeld(heldRows(transactions.filter((one) => one
      && !one.deletedAt
      && one.direction === 'in'
      && one.date >= from && one.date <= to)));

    replace(host, card({ class: 'card--quiet', style: { marginTop: 'var(--space-5)' } }, [
      cardHeader('Rent receipts', null, { iconName: 'receipt' }),
      h('p', { class: 'small muted' },
        'For rent you have been paid, on the property you let. One document per '
        + 'month, from the payment that actually arrived — a month with no '
        + 'matching credit gets no receipt, because a receipt is a statement '
        + 'that money was received.'),

      // `faint`, not a warning: the receipt is not missing, it is early.
      held ? h('p', { class: 'small faint' }, held) : null,

      h('div', { class: 'list' }, rented.map((property) => {
        // Every other letting is passed in so a credit two of them could
        // claim is attributed to neither, rather than receipted twice.
        const { months } = rentReceived(property, transactions, { from, to, others: rented });
        const year = rentYear(months);
        const owner = people.find((person) => person.id === property.owner)?.name ?? '';

        return listItem({
          title: property.name,
          subtitle: [
            `${year.receipted} of ${months.length} months received`,
            year.missing - year.contested
              ? `${year.missing - year.contested} with no matching payment` : null,
            // Said separately from "no payment": money arrived and this
            // application will not say whose it was, which the household can
            // fix by recording where each property's rent lands.
            year.contested
              ? `${year.contested} where a credit could belong to more than one letting`
              : null,
            year.shortfalls
              ? `${year.shortfalls} paid less than the rent on record`
              : null,
            // Reported, never printed on the document. Whether a PAN goes on it
            // is the signer's decision and theirs to write.
            year.needsPan
              ? 'over ₹1,00,000 — your tenant will need your PAN for their claim'
              : null,
          ].filter(Boolean).join(' · '),
          value: format(year.total),
          trailing: year.receipted
            ? button(`Download ${year.receipted}`, {
              variant: 'subtle',
              class: 'btn--small',
              onClick: () => downloadReceipts(property, months, owner),
            })
            : null,
        });
      })),
    ]));
  }

  async function downloadReceipts(property, months, owner) {
    const issued = months.filter((month) => month.received);
    for (const month of issued) {
      const blocks = rentReceiptBlocks(property, month, { owner, at: today() });
      if (!blocks) continue;
      // One file each rather than a bundle: twelve separate receipts is what a
      // tenant hands over, and a zip of them is one more thing to explain.
      await download({
        blobParts: docx(blocks, { title: `Rent receipt ${month.month}` }),
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: rentReceiptFilename(property, month),
      });
    }
    toast(`${issued.length} receipt${issued.length === 1 ? '' : 's'} saved — sign each one`,
      { kind: 'success' });
  }
}

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

    rentReceiptsCard(),

    templateCard(),

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
/**
 * A DOCX template, uploaded, filled in and generated.
 *
 * Phase 3's engine reads the file and finds its fields; this is the half a
 * household can reach. It lives on Reports because that is where documents are
 * produced, beside the rent receipts that already generate `.docx`.
 */
function templateCard() {
  const host = h('div', {});
  /** @type {{parts: object, fields: string[], name: string}|null} */
  let template = null;

  const input = h('input', {
    type: 'file',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    // Opened by the "Choose a .docx" button beside it. The `id` was never
    // paired with a `label for=`, so it named nothing. See js/modules/chat.js.
    class: 'sr-only',
    'aria-hidden': 'true',
    tabindex: '-1',
    id: 'docx-template',
    onChange: async (event) => {
      const [file] = [...(event.target.files ?? [])];
      event.target.value = '';
      if (!file) return;

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const read = await readTemplate(bytes, inflate);
        if (read.why) {
          template = null;
          paint(read.why);
          return;
        }
        template = { parts: read.parts, fields: read.fields, name: file.name };
        paint(null);
      } catch (err) {
        template = null;
        paint(userMessage(err));
      }
    },
  });

  paint(null);
  return h('div', {}, [
    card({}, [
      cardHeader('Fill in a document template', [
        button('Choose a .docx', { variant: 'subtle', onClick: () => input.click() }),
      ], {
        subtitle: 'Mark the editable places {{like this}} — the original is never changed',
        iconName: 'file',
      }),
      input,
      host,
    ]),
  ]);

  function paint(why) {
    if (why) {
      replace(host, h('p', { class: 'small money--negative' }, why));
      return;
    }
    if (!template) {
      replace(host, null);
      return;
    }

    const inputs = template.fields.map((field) => h('label', { class: 'field' }, [
      h('span', { class: 'field__label' }, field),
      h('input', { class: 'input', id: `docx-field-${field.replace(/\W+/g, '-')}`, value: '' }),
    ]));

    replace(host, [
      h('p', { class: 'small faint' },
        `${template.fields.length} field${template.fields.length === 1 ? '' : 's'} found in `
        + `${template.name}. A field left empty keeps its marker, so you can see which.`),
      ...inputs,
      button('Generate', {
        variant: 'primary',
        onClick: async () => {
          const values = {};
          for (const field of template.fields) {
            const box = host.querySelector(`#docx-field-${field.replace(/\W+/g, '-')}`);
            if (box && box.value) values[field] = box.value;
          }
          try {
            const bytes = generate(template.parts, values);
            const filename = generatedName(template.name);
            const mime = 'application/vnd.openxmlformats-officedocument'
              + '.wordprocessingml.document';

            await download({ blobParts: [bytes], mime, filename });

            // Downloaded *and* filed. A generated document that exists only in
            // a downloads folder is one this application cannot say it
            // produced: no record of what it came from, no version history,
            // and nothing in the household's own Drive. Filing it goes through
            // the same path a scanned file takes, so it gets the same
            // encryption at rest, the same upload queue and the same Drive
            // revisions that `versionCount` already reads.
            const filed = await documentStore().capture(
              new File([bytes], filename, { type: mime }),
              { title: filename, category: 'other', generatedFrom: template.name },
            );

            toast(filed
              ? 'Generated and filed — your template is untouched'
              : 'Generated — your template is untouched', { kind: 'success' });
          } catch (err) {
            toast(userMessage(err), { kind: 'error' });
          }
        },
      }),
    ]);
  }
}

/**
 * Hand the file to the native shell, or say it could not.
 *
 * Both of the web paths below are silent no-ops inside a WebView: the file
 * picker is unimplemented, and clicking an `<a download href="blob:…">` is
 * dropped on the floor by Android and iOS alike. Every export in the
 * application — CSV, XLSX, DOCX, PDF, iCal, rent receipts — would have
 * appeared to work and produced nothing.
 *
 * Cache when there is a share sheet to hand the file to; Documents when there
 * is not, because a file written into a cache the person cannot reach is the
 * same as no file. A cancelled share is not a failure — the person decided —
 * and a write that fails is raised rather than swallowed, because falling
 * through to a web path that cannot work would turn an error into silence.
 *
 * @returns {Promise<boolean>} whether the shell took it
 */
async function saveThroughTheShell(blob, filename) {
  const Filesystem = plugin('Filesystem');
  if (!Filesystem) return false;

  const Share = plugin('Share');
  const directory = Share ? 'CACHE' : 'DOCUMENTS';
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()));

  const { uri } = await Filesystem.writeFile({ path: filename, data, directory, recursive: true });

  if (!Share) {
    toast(`Saved to your documents as ${filename}`, { kind: 'success' });
    return true;
  }

  try {
    await Share.share({ title: filename, url: uri });
  } catch {
    // Dismissing the share sheet is an answer, not an error.
  }
  return true;
}

export async function download({ blobParts, mime, filename }) {
  const blob = new Blob([blobParts], { type: mime });

  if (await saveThroughTheShell(blob, filename)) return;

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
