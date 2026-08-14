/**
 * The generic module screen.
 *
 * Fifteen of the sixteen modules are this file. It reads the module's entity
 * list out of the schema and produces the list, the filters, the detail view,
 * the add and edit forms and the delete flow — all from the field definitions.
 *
 * A module that needs more than this (Finance, Investments, the Dashboard)
 * imports `listSection` and `recordDetail` and adds its own views alongside,
 * rather than replacing them. That way a summary screen and a plain list of
 * the same entity never disagree about how a field is displayed.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { entity, entitiesOfModule, modules } from '../data/schema.js';
import { entityTable, filterBar, cellFor } from '../ui/components/table.js';
import { entityForm } from '../ui/components/form.js';
import { modal, confirm } from '../ui/components/modal.js';
import { toast } from '../ui/components/toast.js';
import {
  card, cardHeader, button, badge, pageHeader, empty, reveal, dueBadge, chip,
} from '../ui/components/basics.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { userMessage } from '../core/errors.js';
import { can } from '../security/rbac.js';
import { isEncrypted } from '../security/crypto.js';
import { maskable, mask, classify } from '../data/classification.js';
import { formatInstant } from '../core/dates.js';

/**
 * @param {{module: string, entity?: string, id?: string}} route
 * @returns {Promise<{node: Node, destroy?: Function}>}
 */
export async function render(route) {
  const moduleDef = modules.find((m) => m.id === route.module);
  const entities = entitiesOfModule(route.module);

  if (!entities.length) {
    return { node: empty({ title: 'Nothing here yet', iconName: 'info' }) };
  }

  const entityName = route.entity && entities.some((e) => e.name === route.entity)
    ? route.entity
    : entities[0].name;

  if (route.id && route.id !== 'new') {
    return recordDetail(entityName, route.id);
  }

  return moduleScreen(moduleDef, entities, entityName, route);
}

/* ------------------------------------------------------------ list screen */

async function moduleScreen(moduleDef, entities, entityName, route) {
  const def = entity(entityName);
  const { db } = app();
  const section = await listSection(entityName, { autoOpenNew: route.id === 'new' });

  const tabs = entities.length > 1
    ? h('div', { class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' } },
      entities.map((e) => chip(e.labels.many, {
        pressed: e.name === entityName,
        onClick: () => app().router.navigate({ module: moduleDef.id, entity: e.name }),
      })))
    : null;

  const writable = can(db.actor, 'write', entityName);

  const node = h('div', {}, [
    pageHeader(moduleDef.label, {
      subtitle: def.labels.many,
      actions: writable
        ? [button(`Add ${def.labels.one.toLowerCase()}`, {
          variant: 'primary', iconName: 'plus', onClick: () => section.openForm(),
        })]
        : null,
    }),
    tabs,
    section.node,
  ]);

  return { node, destroy: section.destroy };
}

/**
 * A filterable list of one entity. Exported so a module with its own layout
 * can drop it into a tab without reimplementing any of it.
 */
export async function listSection(entityName, { fixedFilter, autoOpenNew = false, preset } = {}) {
  const def = entity(entityName);
  const { db, router } = app();

  let rows = [];
  let userFilter = () => true;

  const host = h('div', {});
  const table = entityTable(entityName, [], {
    onOpen: (record) => router.navigate({
      module: def.module, entity: entityName, id: record.id,
    }),
    currency: app().currency,
    emptyAction: can(db.actor, 'write', entityName)
      ? button(`Add the first ${def.labels.one.toLowerCase()}`, {
        variant: 'primary', iconName: 'plus', onClick: () => openForm(),
      })
      : null,
  });

  const bar = filterBar(entityName, {
    onChange: (filter) => {
      userFilter = filter;
      paint();
    },
  });

  async function load() {
    rows = await db.repo(entityName).list({ limit: 5000 });
    if (fixedFilter) rows = rows.filter(fixedFilter);
    await paint();
  }

  async function paint() {
    const visible = rows.filter(userFilter);
    table.update(visible, await referenceLabels(entityName, visible));
  }

  async function openForm(record = null) {
    const form = await entityForm(entityName, {
      record,
      db,
      currency: app().currency,
      preset,
      onSubmit: async (values) => {
        if (record) await db.repo(entityName).update(record.id, values);
        else await db.repo(entityName).create(values);
        close();
        toast(record ? 'Saved' : `${def.labels.one} added`, { kind: 'success' });
        await load();
      },
      onCancel: () => close(),
    });

    const { close } = modal({
      title: record ? `Edit ${def.labels.one.toLowerCase()}` : `New ${def.labels.one.toLowerCase()}`,
      body: form.node,
      wide: def.fields.length > 12,
    });
  }

  replace(host, [bar, table.node]);
  await load();
  if (autoOpenNew) openForm();

  // Any write anywhere in this module refreshes the list — including one that
  // arrived from another device through the sync engine.
  const off = bus.on(`${TOPIC.dataChanged}:${def.module}`, () => load());

  return {
    node: host,
    openForm,
    reload: load,
    destroy: () => {
      off();
      table.destroy?.();
    },
  };
}

/* ---------------------------------------------------------- detail screen */

/**
 * @param {string} entityName
 * @param {string} id
 * @param {{onDelete?: (id: string) => Promise<string|void>}} [options]
 *   `onDelete` replaces the record-only delete for entities that own more than
 *   a row — a document also owns bytes on this device and a file in Drive, and
 *   removing the row alone leaves both behind with nothing pointing at them.
 *   Return a string to say what actually happened.
 */
export async function recordDetail(entityName, id, options = {}) {
  const def = entity(entityName);
  const { db, router } = app();

  const record = await db.repo(entityName).get(id);
  if (!record) {
    return {
      node: empty({
        title: 'Not found',
        message: 'That record has been deleted, or you do not have access to it.',
        iconName: 'info',
        action: button('Back', {
          onClick: () => router.navigate({ module: def.module, entity: entityName }),
        }),
      }),
    };
  }

  const labels = await referenceLabels(entityName, [record]);
  const writable = can(db.actor, 'write', entityName, record);

  const host = h('div', {});

  async function edit() {
    const form = await entityForm(entityName, {
      record,
      db,
      currency: app().currency,
      onSubmit: async (values) => {
        await db.repo(entityName).update(id, values);
        close();
        toast('Saved', { kind: 'success' });
        const next = await recordDetail(entityName, id);
        replace(host, next.node);
      },
      onCancel: () => close(),
    });
    const { close } = modal({
      title: `Edit ${def.labels.one.toLowerCase()}`,
      body: form.node,
      wide: def.fields.length > 12,
    });
  }

  async function remove() {
    // A spreadsheet has no foreign keys, so the check that would be a database
    // constraint elsewhere happens here, before the user commits to it.
    const references = await db.referencedBy(id);
    const ok = await confirm({
      title: `Delete this ${def.labels.one.toLowerCase()}?`,
      message: references.length
        ? `${references.length} other ${references.length === 1 ? 'record refers' : 'records refer'} `
          + 'to this one and will be left pointing at nothing. It can be restored from '
          + 'Settings → Deleted items.'
        : 'It can be restored from Settings → Deleted items.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      let detail = '';
      if (options.onDelete) detail = (await options.onDelete(id)) || '';
      else await db.repo(entityName).remove(id);

      toast(detail || `${def.labels.one} deleted`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            await db.repo(entityName).restore(id);
            toast('Restored');
          },
        },
      });
      router.navigate({ module: def.module, entity: entityName });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  const groups = new Map();
  for (const field of def.fields) {
    if (field.hidden) continue;
    const value = record[field.key];
    if (value === null || value === undefined || value === '' ||
      (Array.isArray(value) && !value.length)) continue;
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }

  replace(host, [
    pageHeader(String(def.title(record) ?? def.labels.one), {
      subtitle: String(def.subtitle(record) ?? ''),
      actions: [
        button('Back', {
          variant: 'subtle',
          iconName: 'chevronLeft',
          onClick: () => router.navigate({ module: def.module, entity: entityName }),
        }),
        writable ? button('Edit', { variant: 'primary', iconName: 'edit', onClick: edit }) : null,
        writable ? button('Delete', { variant: 'danger', iconName: 'trash', onClick: remove }) : null,
      ].filter(Boolean),
    }),

    record._undecryptable?.length
      ? card({ class: 'card--quiet' }, h('div', { class: 'row' }, [
        icon('alert', { size: 18 }),
        h('span', { class: 'small' },
          `${record._undecryptable.length} field(s) on this record could not be decrypted. `
          + 'They were written with a different key, or the row was edited outside FamilyOS.'),
      ]))
      : null,

    h('div', { class: 'grid' }, [...groups].map(([groupName, fields]) => card({}, [
      cardHeader(groupName),
      h('dl', { class: 'stack stack--tight', style: { margin: 0 } },
        fields.map((field) => h('div', { class: 'row row--between' }, [
          h('dt', { class: 'small muted' }, field.label),
          h('dd', { style: { margin: 0, textAlign: 'right' } }, detailValue(field, record, labels)),
        ]))),
    ]))),

    // Any entity with a `documents` field gets file capture, without knowing
    // anything about Drive.
    def.fields.some((f) => f.type === 'files')
      ? (await import('./documents.js'))
        .attachmentStrip(entityName, record, {
          onChange: async () => {
            const next = await recordDetail(entityName, id);
            replace(host, next.node);
          },
        }).node
      : null,

    card({ class: 'card--quiet' }, [
      h('div', { class: 'small faint' }, [
        `Created ${formatInstant(record.createdAt)}`,
        record.updatedAt !== record.createdAt ? ` · updated ${formatInstant(record.updatedAt)}` : '',
        ` · revision ${record.rev}`,
        record.syncState === 'pending' ? ' · not yet synced' : '',
      ].join('')),
    ]),
  ]);

  return { node: host };
}

function detailValue(field, record, labels) {
  const value = record[field.key];

  // Two different reasons to cover a value, both ending at the same control.
  //
  // `encrypted` means it was ciphertext at rest and has just been decrypted
  // for display. `maskable` means it is an identifier or a credential — an
  // account number, a policy number, a passport number — which may well be
  // stored in the clear and is still not something to leave sitting on a
  // screen in a café.
  //
  // The same control serves both: show, hide, and copy with a warning about
  // how long a clipboard lasts. Somebody reading their own record does not
  // care which of the two reasons applies.
  if (value && ((field.encrypted && !isEncrypted(value)) || maskable(field))) {
    return reveal(String(value), {
      label: (field.label ?? field.key).toLowerCase(),
      masked: mask(value, classify(field)),
    });
  }
  if (field.type === 'ref') {
    const label = labels[field.ref]?.[value];
    return label
      ? h('a', { href: Router.href({ module: entity(field.ref).module, entity: field.ref, id: value }) }, label)
      : h('span', { class: 'faint' }, '—');
  }
  if (field.type === 'multiref') {
    return h('span', { class: 'chip-row' },
      (value ?? []).map((v) => badge(labels[field.ref]?.[v] ?? v)));
  }
  if (field.type === 'date' && field.expiry) {
    return h('span', { class: 'row' }, [cellFor(field, record), dueBadge(value, { leadDays: field.expiryLead })]);
  }
  if (field.type === 'url') {
    return h('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value);
  }
  if (field.type === 'textarea' || field.type === 'richtext') {
    return h('span', { style: { whiteSpace: 'pre-wrap', textAlign: 'left', display: 'block' } }, value);
  }
  return cellFor(field, record, { currency: app().currency });
}

/* ----------------------------------------------------------------- shared */

/**
 * `{ person: { per_1: 'Asha Narayan' } }` for every entity this one points
 * at. One pass per referenced entity rather than a lookup per cell.
 */
export async function referenceLabels(entityName, rows) {
  const def = entity(entityName);
  const refs = def.fields.filter((f) => f.type === 'ref' || f.type === 'multiref');
  if (!refs.length || !rows.length) return {};

  const { db } = app();
  const out = {};

  for (const name of new Set(refs.map((f) => f.ref))) {
    try {
      const target = entity(name);
      const list = await db.repo(name).list({ decrypt: false, limit: 5000 });
      out[name] = Object.fromEntries(list.map((r) => [r.id, String(target.title(r) ?? r.id)]));
    } catch {
      out[name] = {};
    }
  }
  return out;
}
