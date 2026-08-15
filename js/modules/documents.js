/**
 * Documents.
 *
 * The one module where the record is not the point — the file is. So this
 * screen is built around capture and retrieval rather than a table: take a
 * photograph of a policy in a car park, and it is encrypted on the device
 * before anything is asked of the network.
 *
 * Order of operations, and the reason for it:
 *
 *   pick or photograph → encrypt → store locally → create the record
 *                                                → upload when there is a network
 *
 * The upload is never awaited by the person holding the phone. A document
 * that only exists after a successful round trip is a document lost every time
 * the signal drops.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, button, badge, pageHeader, empty, listItem, chip, dueBadge, avatar,
} from '../ui/components/basics.js';
import { modal } from '../ui/components/modal.js';
import { toast } from '../ui/components/toast.js';
import { entityForm } from '../ui/components/form.js';
import { recordDetail } from './crud.js';
import { MATCH, attachmentFor } from '../domain/receiptmatch.js';
import { format } from '../core/money.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { DocumentStore } from '../sync/drive.js';
import {
  CATEGORIES, HOUSEHOLD_FOLDER, guessCategory, categoryForEntity, matches,
  iconForMime, formatSize, personFolderName,
} from '../domain/filing.js';
import { identifierOffers, identityRecordFor, textState } from '../domain/identifiers.js';
import { formatDay, daysUntil } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { can } from '../security/rbac.js';

export async function render(route) {
  if (route.id && route.id !== 'new') return documentDetail(route.id);

  const { db } = app();
  const store = documentStore();
  const host = h('div', {});

  let category = route.query?.category ?? '';
  let personId = route.query?.person ?? '';
  let text = '';
  let people = [];

  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    // `accept` rather than a filter dialog: the OS picker is better at this
    // than anything a web page can draw.
    accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt',
    style: { display: 'none' },
    onChange: (event) => capture([...event.target.files], { source: 'file' }),
  });

  // `capture="environment"` opens the rear camera straight into the picker on
  // a phone, which is what "Scan" means to someone standing at a desk.
  const cameraInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: { display: 'none' },
    onChange: (event) => capture([...event.target.files], { source: 'camera' }),
  });

  async function capture(files, { source }) {
    if (!files.length) return;
    const dismiss = toast(`Saving ${files.length} file${files.length === 1 ? '' : 's'}…`, { ms: 0 });

    let saved = 0;
    for (const file of files) {
      try {
        const { document: record } = await store.capture(file, {
          title: file.name.replace(/\.[^.]+$/, ''),
          category: category || guessCategory(file.name),
          // Filed under whoever's folder is open. Browsing "Asha" and adding
          // a file should not drop it into Household.
          person: personId || undefined,
        });
        saved++;
        // Straight into the edit form for the first one: the title and the
        // expiry date are the fields that make a document findable later, and
        // nobody comes back to fill them in.
        if (files.length === 1) await editAfterCapture(record, source);
      } catch (err) {
        toast(userMessage(err), { kind: 'error' });
      }
    }

    dismiss();
    if (saved) {
      toast(`${saved} saved on this device`, { kind: 'success' });
      // Fire and forget: the file is already safe locally.
      store.flush().catch(() => {});
      await paint();
    }
    fileInput.value = '';
    cameraInput.value = '';
  }

  async function editAfterCapture(record, source) {
    const form = await entityForm('document', {
      record,
      db,
      hide: ['ocrText'],
      submitLabel: 'Save',
      onSubmit: async (values) => {
        await db.repo('document').update(record.id, values);
        close();
        await paint();
      },
      onCancel: () => close(),
    });

    const { close } = modal({
      title: source === 'camera' ? 'Name this scan' : 'Name this document',
      body: form.node,
      wide: true,
    });
  }

  async function paint() {
    const documents = await db.repo('document').list({ limit: 5000 });
    people = await db.repo('person').list({ decrypt: false, limit: 200 }).catch(() => []);

    const counts = new Map();
    for (const document of documents) {
      counts.set(document.category, (counts.get(document.category) ?? 0) + 1);
    }

    const perPerson = new Map();
    for (const document of documents) {
      const key = document.person || '';
      perPerson.set(key, (perPerson.get(key) ?? 0) + 1);
    }

    const filtered = documents
      .filter((d) => !personId || (personId === HOUSEHOLD_FOLDER ? !d.person : d.person === personId))
      .filter((d) => !category || d.category === category)
      .filter((d) => !text || matches(d, text));

    const expiring = documents
      .filter((d) => d.expiresOn && daysUntil(d.expiresOn) <= 60)
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));

    const usage = await store.storageUsed();
    const writable = can(db.actor, 'write', 'document');

    replace(host, [
      pageHeader('Documents', {
        subtitle: `${documents.length} stored, encrypted on this device`,
        actions: writable ? [
          button('Scan', { variant: 'subtle', iconName: 'camera', onClick: () => cameraInput.click() }),
          button('Add files', { variant: 'primary', iconName: 'upload', onClick: () => fileInput.click() }),
        ] : null,
      }),

      fileInput,
      cameraInput,

      usage.pending
        ? card({ class: 'card--quiet' }, h('div', { class: 'row' }, [
          icon('cloudOff', { size: 18 }),
          h('span', { class: 'small' },
            `${usage.pending} file${usage.pending === 1 ? '' : 's'} not yet in Drive. `
            + 'They are safe on this device and will upload when there is a connection.'),
          h('span', { class: 'spacer' }),
          button('Try now', {
            class: 'btn--small',
            variant: 'subtle',
            onClick: async () => {
              const result = await store.flush({ limit: 20 });
              toast(result.uploaded ? `${result.uploaded} uploaded` : 'Still no connection');
              await paint();
            },
          }),
        ]))
        : null,

      expiring.length
        ? card({ class: 'card--flush' }, [
          h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
            cardHeader('Expiring', badge(String(expiring.length), 'warning'), { iconName: 'alert' })),
          h('div', { class: 'list' }, expiring.slice(0, 5).map((document) => listItem({
            title: document.title,
            subtitle: `${document.category} · ${formatDay(document.expiresOn)}`,
            trailing: dueBadge(document.expiresOn, { leadDays: 60 }),
            href: Router.href({ module: 'documents', entity: 'document', id: document.id }),
          }))),
        ])
        : null,

      h('div', { class: 'row', style: { marginBottom: 'var(--space-4)' } }, [
        h('div', { class: 'search-box' }, [
          icon('search', { size: 18 }),
          h('input', {
            class: 'input',
            type: 'search',
            placeholder: 'Search titles, tags and extracted text',
            'aria-label': 'Search documents',
            onInput: (event) => {
              text = event.target.value.trim().toLowerCase();
              paintList();
            },
          }),
        ]),
      ]),

      // Whose folder, then which category inside it — the order somebody
      // actually looks for a piece of paper in.
      h('div', { class: 'chip-row', style: { marginBottom: 'var(--space-3)' } }, [
        chip(`Everyone (${documents.length})`, {
          pressed: !personId,
          onClick: () => { personId = ''; paint(); },
        }),
        ...people
          .filter((person) => perPerson.get(person.id))
          .map((person) => h('button', {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(personId === person.id),
            onClick: () => { personId = person.id; paint(); },
          }, [
            avatar(person.name, { size: 'sm' }),
            `${person.name} (${perPerson.get(person.id)})`,
          ])),
        perPerson.get('')
          ? chip(`${HOUSEHOLD_FOLDER} (${perPerson.get('')})`, {
            pressed: personId === HOUSEHOLD_FOLDER,
            iconName: 'home',
            onClick: () => { personId = HOUSEHOLD_FOLDER; paint(); },
          })
          : null,
      ].filter(Boolean)),

      h('div', { class: 'chip-row', style: { marginBottom: 'var(--space-4)' } }, [
        chip(`All (${documents.length})`, {
          pressed: !category,
          onClick: () => { category = ''; paint(); },
        }),
        ...CATEGORIES
          .filter((name) => counts.get(name))
          .map((name) => chip(`${name} (${counts.get(name)})`, {
            pressed: category === name,
            onClick: () => { category = name; paint(); },
          })),
      ]),

      listHost,
    ]);

    paintList(filtered);
  }

  const listHost = h('div', {});

  async function paintList(rows) {
    const documents = rows ?? (await db.repo('document').list({ limit: 5000 }))
      .filter((d) => !category || d.category === category)
      .filter((d) => !text || matches(d, text));

    replace(listHost, documents.length
      ? h('div', { class: 'grid grid--tight' }, documents.map((document) => documentTile(document)))
      : empty({
        title: text || category ? 'Nothing matches' : 'No documents yet',
        message: text || category
          ? 'Try a different word, or clear the filter.'
          : 'Photograph a policy, a registration certificate or a bill. It is '
            + 'encrypted here before anything is sent anywhere.',
        iconName: 'file',
      }));
  }

  function documentTile(document) {
    return card({
      variant: 'interactive',
      onClick: () => app().router.navigate({
        module: 'documents', entity: 'document', id: document.id,
      }),
    }, [
      h('div', { class: 'row', style: { marginBottom: 'var(--space-3)' } }, [
        icon(iconForMime(document.mimeType), { size: 22, class: 'faint' }),
        h('span', { class: 'spacer' }),
        document.driveFileId ? null : badge('on device only', 'warning'),
        document.confidential ? badge('confidential', 'danger') : null,
      ]),
      h('div', { class: 'list-item-title truncate' }, document.title),
      h('div', { class: 'small muted truncate' }, [
        folderOf(document),
        document.sizeBytes ? ` · ${formatSize(document.sizeBytes)}` : '',
        document.versionCount > 1 ? ` · v${document.versionCount}` : '',
      ].join('')),
      document.expiresOn
        ? h('div', { style: { marginTop: 'var(--space-2)' } },
          dueBadge(document.expiresOn, { leadDays: 60 }))
        : null,
    ]);
  }

  /** `Asha Narayan / Identity` — the path the file is at in Drive. */
  function folderOf(document) {
    const person = people.find((p) => p.id === document.person);
    return `${personFolderName(person, people)} / ${title(document.category)}`;
  }

  await paint();
  // Renaming a person renames their folder, so the labels have to follow.
  const off = bus.on(TOPIC.dataChanged, (payload) => {
    if (payload.entity === 'document' || payload.entity === 'person') paint();
  });
  return { node: host, destroy: off };
}

function title(value) {
  return String(value ?? '').charAt(0).toUpperCase() + String(value ?? '').slice(1);
}

const capitalise = title;

/**
 * Whose record this is, from whichever field the entity uses to say so.
 * Returns undefined for household things — a property deed has an owner in
 * the legal sense, but its papers belong to the household.
 */
export function subjectOf(entityName, record) {
  const field = {
    person: 'id',
    healthRecord: 'person', vaccination: 'person', medication: 'person',
    appointment: 'person', education: 'person', certificate: 'person',
    identityDocument: 'person', employment: 'person',
    vehicle: 'owner', holding: 'owner',
    policy: 'holder', account: 'holder',
    loan: 'borrower',
    task: 'assignee',
  }[entityName];
  return field ? record?.[field] || undefined : undefined;
}

/* ---------------------------------------------------------------- detail */

async function documentDetail(id) {
  const { db } = app();
  const store = documentStore();
  // A document is not only a row: it is a row, an encrypted copy on this
  // device, and a file in Drive. Deleting the row alone left the other two
  // behind with nothing pointing at them — quota spent forever on bytes no
  // screen could show again.
  const base = await recordDetail('document', id, {
    onDelete: async (documentId) => {
      const outcome = await store.discard(documentId);
      return [
        'Document deleted',
        outcome.blob ? 'copy on this device removed' : null,
        outcome.drive === 'trashed' ? 'file moved to your Drive bin' : null,
        outcome.drive === 'missing' ? 'it was already gone from Drive' : null,
        // Said out loud rather than swallowed: the household should know the
        // file is still sitting in their Drive.
        outcome.drive === 'offline' ? 'the Drive copy could not be reached — it is still there' : null,
      ].filter(Boolean).join(' · ');
    },
  });
  let record = await db.repo('document').get(id);
  if (!record) return base;

  const preview = h('div', { class: 'stack' });
  const reading = h('div', { class: 'stack' });
  const matched = h('div', { class: 'stack' });
  const host = h('div', { class: 'stack' }, [base.node, reading, matched, preview]);

  /**
   * What was read off this document, and what it is worth doing about.
   *
   * Two things the screen never said. Whether the text was read at all — it
   * said "on device only", which is about Drive, and nothing about the text,
   * so a photographed bill produced no due date and no explanation. And the
   * identifier: extraction found the PAN, kept it out of the searchable field
   * and then dropped it, leaving the encrypted place it belongs empty.
   */
  async function paintReading() {
    const state = textState(record);

    // Read on demand from the encrypted file rather than kept anywhere. A
    // second copy of an unrecorded identifier is exactly what the redaction
    // exists to prevent.
    const { identifiers, readable } = await store.identifiersIn(id).catch(
      () => ({ identifiers: [], readable: false }),
    );

    const existing = await db.repo('identityDocument').list({ limit: 500 }).catch(() => []);
    const offers = identifierOffers(identifiers, record, existing);

    if (state.read && !offers.length) { replace(reading, null); return; }

    replace(reading, card({ class: 'card--quiet' }, [
      cardHeader('What was read from this file'),

      state.read
        ? null
        : h('p', { class: 'small muted' }, `${capitalise(state.why)}.`),

      // `readable` false means nothing on this device can get text out of the
      // file — not that the file has no identifiers in it. Reporting the two
      // the same way would be a claim this cannot support.
      state.read && !readable
        ? h('p', { class: 'small faint' },
          'The text was read elsewhere, so this device cannot check it again '
          + 'for identity numbers.')
        : null,

      ...offers.map((offer) => offerRow(offer)),
    ].filter(Boolean)));
  }

  /**
   * The payment this receipt is the receipt for.
   *
   * ## Why here, and worked out now
   *
   * `receiptMatchesIn` existed for a tranche with nothing calling it — the
   * defect this codebase keeps finding, written down at the time rather than
   * left to be discovered. This is the call.
   *
   * Worked out when somebody opens the document rather than when it was
   * uploaded, because the statement carrying the payment is very often imported
   * weeks later. A match made at upload would freeze an answer taken before the
   * evidence arrived.
   */
  async function paintReceiptMatch() {
    // Reported rather than swallowed. An earlier version returned null here,
    // which turned a broken read into a blank panel — the failure that looks
    // exactly like "nothing to say".
    const result = await store.receiptMatchesIn(id).catch((err) => ({
      proposals: [],
      why: `this receipt could not be checked against your payments: ${userMessage(err)}`,
    }));
    if (!result || (!result.proposals.length && !result.why)) {
      replace(matched, null);
      return;
    }

    // Not a receipt at all: say nothing rather than explain an absence on every
    // policy and bill a household opens.
    if (result.why === 'this does not read as a receipt') {
      replace(matched, null);
      return;
    }

    const [best] = result.proposals;

    replace(matched, card({ class: 'card--quiet' }, [
      cardHeader('The payment this receipt is for'),

      // The honest sentence when nothing matched — usually that the statement
      // has not been imported yet, which is a more useful thing to be told
      // than an empty panel.
      result.why
        ? h('p', { class: 'small muted' }, capitalise(result.why) + '.')
        : null,

      ...result.proposals.map((proposal) => listItem({
        title: `${formatDay(proposal.transaction.date)} · ${proposal.transaction.payee || proposal.transaction.category || 'payment'}`,
        subtitle: proposal.why,
        value: format(proposal.transaction.amount),
        leading: badge(proposal.confidence,
          proposal.confidence === MATCH.PROBABLE ? 'info' : 'warning'),
        // Only on a probable one. An uncertain match applied by a button is
        // still uncertain, and the button would be doing the deciding — the
        // same refusal `attachmentFor` makes, so a control here that always
        // errored would be worse than none.
        trailing: proposal.confidence === MATCH.PROBABLE
          ? button('File it against this', {
            variant: 'subtle',
            onClick: () => attach(proposal),
          })
          : null,
      })),

      best && best.confidence !== MATCH.PROBABLE
        ? h('p', { class: 'small faint' },
          'Filing this against the wrong payment would leave evidence pointing '
          + 'at the wrong row, so nothing is offered until one of them is '
          + 'clearly it.')
        : null,
    ].filter(Boolean)));
  }

  async function attach(proposal) {
    const link = attachmentFor(proposal, id);
    if (!link) {
      toast('Only a clear match can be filed automatically', { kind: 'error' });
      return;
    }

    try {
      await db.repo('transaction').update(link.transactionId, link.patch);
      toast('Filed against that payment — the receipt is still here too',
        { kind: 'success' });
      await paintReceiptMatch();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  function offerRow(offer) {
    const line = (text, tone) => h('p', { class: `small ${tone}` }, text);

    if (offer.state === 'recorded') {
      return line(`The ${offer.kind} on this document is already recorded — ${offer.masked}.`, 'faint');
    }
    if (offer.state !== 'offer') {
      return line(`${offer.kind} ${offer.masked}: ${offer.why}.`, 'muted');
    }

    return h('div', { class: 'row row--between', style: { gap: 'var(--space-3)' } }, [
      h('span', { class: 'small' },
        `A ${offer.kind} — ${offer.masked} — is on this document and is not recorded anywhere.`),
      button('Record it', {
        variant: 'subtle',
        onClick: async () => {
          try {
            // Written through the repository, which is what encrypts `number`
            // and checks the permission. Nothing about the value passes
            // through a searchable field on the way.
            await db.repo('identityDocument').create(identityRecordFor(offer, record));
            toast(`${offer.kind} recorded, encrypted`, { kind: 'success' });
            await paintReading();
          } catch (err) {
            toast(userMessage(err), { kind: 'error' });
          }
        },
      }),
    ]);
  }

  async function open() {
    // Re-read: the heading names the folder, and an edit that reassigns the
    // document moves it. A stale heading here points at the wrong folder.
    record = (await db.repo('document').get(id)) ?? record;
    let blob = await store.read(id);

    if (!blob && record.driveFileId) {
      const dismiss = toast('Fetching from Drive…', { ms: 0 });
      try {
        blob = await store.fetchFromDrive(id);
      } catch (err) {
        toast(userMessage(err), { kind: 'error' });
      } finally {
        dismiss();
      }
    }

    if (!blob) {
      replace(preview, card({ class: 'card--quiet' },
        empty({
          title: 'The file is not on this device',
          message: record.driveFileId
            ? 'It is in Drive. Connect to fetch it back.'
            : 'Only the record was kept — no file was ever attached.',
          iconName: 'cloudOff',
        })));
      return;
    }

    // Object URLs pin the blob in memory until revoked. Revoke the previous
    // one on every re-render, not only when the view goes away, or an edit
    // loop leaks a copy of the file each time.
    revoke();
    const url = URL.createObjectURL(blob);
    revoke = () => URL.revokeObjectURL(url);

    const owner = record.person
      ? await db.repo('person').get(record.person).catch(() => null)
      : null;

    replace(preview, card({}, [
      // The heading is the Drive path, so "where did that end up" is answered
      // on the screen rather than by going and looking.
      cardHeader(`File · ${owner?.name ?? 'Household'} / ${title(record.category)}`, h('div', { class: 'row' }, [
        button('Download', {
          variant: 'subtle',
          iconName: 'download',
          onClick: () => {
            const anchor = h('a', { href: url, download: record.fileName || record.title });
            anchor.click();
          },
        }),
        record.driveFileId
          ? button('Open in Drive', {
            variant: 'subtle',
            iconName: 'globe',
            onClick: () => globalThis.open(
              `https://drive.google.com/file/d/${record.driveFileId}/view`, '_blank', 'noopener',
            ),
          })
          : null,
      ])),

      DocumentStore.canPreview(record.mimeType)
        ? (record.mimeType === 'application/pdf'
          ? h('iframe', {
            src: url,
            title: record.title,
            style: { width: '100%', height: '70dvh', border: '0', borderRadius: 'var(--radius-sm)' },
          })
          : h('img', {
            src: url,
            alt: record.title,
            style: { width: '100%', borderRadius: 'var(--radius-sm)' },
          }))
        : h('p', { class: 'small muted' },
          `${record.mimeType || 'This file type'} cannot be shown here — download it to open it.`),
    ]));
  }

  let revoke = () => {};
  await open();
  await paintReading();
  // Beside `paintReading`, not inside it: that function returns early when a
  // document's text was read and there are no identifiers to offer — which is
  // exactly what a receipt is. Hooked there, this panel never ran at all, and
  // the browser check that drives a real receipt end to end is what said so.
  void paintReceiptMatch();

  const off = bus.on(`${TOPIC.dataChanged}:documents`, (payload) => {
    if (payload.id === id) open().then(paintReading);
  });

  return {
    node: host,
    destroy: () => {
      revoke();
      off();
      base.destroy?.();
    },
  };
}

/* ------------------------------------------------------------ attachments */

/**
 * The attachment strip shown on any record that references documents. Exported
 * so a vehicle, a policy or a health record gets file capture without any of
 * them knowing how Drive works.
 */
export function attachmentStrip(entityName, record, { onChange } = {}) {
  const { db } = app();
  const store = documentStore();
  const host = h('div', {});

  const input = h('input', {
    type: 'file',
    multiple: true,
    style: { display: 'none' },
    onChange: async (event) => {
      const files = [...event.target.files];
      if (!files.length) return;

      const added = [];
      for (const file of files) {
        const { document } = await store.capture(file, {
          title: file.name.replace(/\.[^.]+$/, ''),
          category: categoryForEntity(entityName),
          // A vaccination filed against a child belongs in that child's
          // folder, not in Household — the parent record already says whose
          // it is, so nobody should have to say it twice.
          person: subjectOf(entityName, record),
        });
        added.push(document.id);
      }

      await db.repo(entityName).update(record.id, {
        documents: [...(record.documents ?? []), ...added],
      });
      store.flush().catch(() => {});
      toast(`${added.length} attached`, { kind: 'success' });
      input.value = '';
      onChange?.();
    },
  });

  async function paint() {
    const ids = record.documents ?? [];
    const documents = [];
    for (const id of ids) {
      const document = await db.repo('document').get(id);
      if (document) documents.push(document);
    }

    replace(host, card({}, [
      cardHeader('Attachments', button('Add', {
        class: 'btn--small', variant: 'subtle', iconName: 'upload',
        onClick: () => input.click(),
      })),
      input,
      documents.length
        ? h('div', { class: 'list' }, documents.map((document) => listItem({
          leading: icon(iconForMime(document.mimeType), { size: 20, class: 'faint' }),
          title: document.title,
          subtitle: `${formatSize(document.sizeBytes)}${document.driveFileId ? '' : ' · on device only'}`,
          href: Router.href({ module: 'documents', entity: 'document', id: document.id }),
        })))
        : h('p', { class: 'small faint' }, 'Nothing attached.'),
    ]));
  }

  paint();
  return { node: host, refresh: paint };
}

/* ----------------------------------------------------------------- shared */

export { guessCategory, matches, iconForMime, formatSize };

/**
 * The one document store, built at boot and shared with the sync engine — so
 * an upload started from this screen and one started by a sync run are the
 * same queue rather than two racing over the same blobs.
 */
export function documentStore() {
  const context = app();
  return context.documents ?? new DocumentStore({ db: context.db, transport: context.transport });
}
