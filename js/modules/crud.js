/**
 * The generic module screen.
 *
 * Eight of the nineteen modules are this file — health, insurance, property,
 * education, tasks, notes, digital and emergency. It reads
 * the module's entity list out of the schema and produces the list, the
 * filters, the detail view, the add and edit forms and the delete flow — all
 * from the field definitions.
 *
 * A module that needs more than this (Finance, Investments, the Dashboard)
 * imports `listSection` and `recordDetail` and adds its own views alongside,
 * rather than replacing them. That way a summary screen and a plain list of
 * the same entity never disagree about how a field is displayed.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { entity, entitiesOfModule, modules } from '../data/schema.js';
import { describeConnections } from '../domain/connections.js';
import { RecordsService } from '../services/records.js';
import { entityTable, filterBar, cellFor } from '../ui/components/table.js';
import { entityForm } from '../ui/components/form.js';
import { modal, confirm, inform } from '../ui/components/modal.js';
import { toast } from '../ui/components/toast.js';
import {
  card, cardHeader, button, badge, pageHeader, empty, reveal, dueBadge, chip, listItem,
} from '../ui/components/basics.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { userMessage } from '../core/errors.js';
import { can } from '../security/rbac.js';
import { isEncrypted } from '../security/crypto.js';
import { safeUrl } from '../security/sanitize.js';
import { maskable, mask, classify } from '../data/classification.js';
import { formatInstant } from '../core/dates.js';
import { describe as describeAudit } from '../data/audit.js';
import { t, noun } from '../core/locale.js';
import { entityLabel, fieldLabel, moduleLabel } from '../core/labels.js';

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
    ? h('div', { class: 'chip-row chip-row--scroll', role: 'group', 'aria-label': moduleLabel(moduleDef), style: { marginBottom: 'var(--space-4)' } },
      entities.map((e) => chip(entityLabel(e, 'many'), {
        pressed: e.name === entityName,
        onClick: () => app().router.navigate({ module: moduleDef.id, entity: e.name }),
      })))
    : null;

  const writable = can(db.actor, 'write', entityName);

  const node = h('div', {}, [
    pageHeader(moduleLabel(moduleDef), {
      subtitle: entityLabel(def, 'many'),
      actions: writable
        ? [button(t('record.add', { one: noun(entityLabel(def)) }), {
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
/**
 * @param {string} entityName
 * @param {{fixedFilter?: Function, autoOpenNew?: boolean, preset?: object,
 *          banner?: () => (Node|Node[]|null|Promise<Node|Node[]|null>)}} [options]
 *   `banner` renders above the table and is rebuilt on every load, so a
 *   finding derived from the rows stays in step with them. It exists because
 *   some entities carry an answer the table cannot show — see the KYC drift
 *   report in `modules/identity.js`.
 *
 *   The signature said `Node` and its only caller has always returned an
 *   **array** of cards. `replace` accepts either, so nothing broke, and the
 *   inferred type of that caller was loose enough that nothing complained —
 *   until a view model with real shapes in it made the array concrete.
 */
export async function listSection(entityName, {
  fixedFilter, autoOpenNew = false, preset, banner,
} = {}) {
  const def = entity(entityName);
  const { db, router } = app();

  let rows = [];
  let userFilter = () => true;

  const host = h('div', {});
  const bannerHost = h('div', {});
  const table = entityTable(entityName, [], {
    onOpen: (record) => router.navigate({
      module: def.module, entity: entityName, id: record.id,
    }),
    currency: app().currency,
    emptyAction: can(db.actor, 'write', entityName)
      ? button(t('record.addFirst', { one: noun(entityLabel(def)) }), {
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
    if (banner) replace(bannerHost, (await banner()) ?? []);
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
        toast(record ? t('record.saved') : t('record.added', { One: entityLabel(def) }), { kind: 'success' });
        await load();
      },
      onCancel: () => close(),
    });

    const { close } = modal({
      title: record
        ? t('record.editTitle', { one: noun(entityLabel(def)) })
        : t('record.newTitle', { one: noun(entityLabel(def)) }),
      body: form.node,
      wide: def.fields.length > 12,
    });
  }

  replace(host, [bar, bannerHost, table.node]);
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
 * @param {{onDelete?: (id: string) => Promise<string|void>,
 *          extra?: (record: object) => (Node|Node[]|null|Promise<Node|Node[]|null>)}} [options]
 *   `onDelete` replaces the record-only delete for entities that own more than
 *   a row — a document also owns bytes on this device and a file in Drive, and
 *   removing the row alone leaves both behind with nothing pointing at them.
 *   Return a string to say what actually happened.
 *
 *   `extra` renders below the fields, for an answer the fields cannot give. A
 *   movement's own row says its amount and its kind; where that amount *came
 *   from* is a walk back through the legs to the file they were parsed out of,
 *   and no column can hold it.
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
      title: t('record.editTitle', { one: noun(entityLabel(def)) }),
      body: form.node,
      wide: def.fields.length > 12,
    });
  }

  async function remove() {
    // The repository refuses a delete that would leave a *required* reference
    // dangling. This dialog asks the same question first, so the answer
    // arrives before somebody presses Delete rather than as an error after.
    //
    // The distinction matters and this is where it is drawn: a dangling
    // *optional* reference is untidy and the delete goes through, a dangling
    // *required* one leaves the referring record unable to pass its own
    // validation and the delete does not happen at all.
    const records = new RecordsService(db);
    const impact = await records.impactOfDeleting(entityName, id);

    if (impact.breaking) {
      // No Delete button, because there is no delete to offer. Showing one and
      // then failing would be the same refusal delivered less honestly.
      await inform({
        title: t('record.deleteBlockedTitle', { one: noun(entityLabel(def)) }),
        message: records.describeImpact(impact),
      });
      return;
    }

    const ok = await confirm({
      title: t('record.deleteTitle', { one: noun(entityLabel(def)) }),
      message: `${impact.total ? `${records.describeImpact(impact)} ` : ''}`
        + 'It can be restored from Settings → Deleted items.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      let detail = '';
      if (options.onDelete) detail = (await options.onDelete(id)) || '';
      else await db.repo(entityName).remove(id);

      toast(detail || t('record.deleted', { One: entityLabel(def) }), {
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
    pageHeader(String(def.title(record) ?? entityLabel(def)), {
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

    /*
     * Said here, on the record, rather than only counted on the activity card.
     *
     * A held row is shown and does not add itself to any total, and somebody
     * looking at a transaction that is plainly there and plainly missing from
     * the month's spending is owed the reason on the record rather than a
     * number somewhere else.
     */
    record.heldAt
      ? card({ class: 'card--quiet' }, h('div', { class: 'row' }, [
        icon('alert', { size: 18 }),
        h('span', { class: 'small' }, t('record.held')),
      ]))
      : null,

    h('div', { class: 'grid' }, [...groups].map(([groupName, fields]) => card({}, [
      cardHeader(groupName),
      h('dl', { class: 'stack stack--tight', style: { margin: 0 } },
        fields.map((field) => h('div', { class: 'row row--between' }, [
          h('dt', { class: 'small muted' }, fieldLabel(def.name, field)),
          h('dd', { style: { margin: 0, textAlign: 'right' } }, detailValue(field, record, labels)),
        ]))),
    ]))),

    options.extra ? (await options.extra(record)) ?? null : null,

    await connectionsCard(entityName, record),

    await historyCard(entityName, id),

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

/**
 * What this record is connected to, in both directions.
 *
 * Phase 17's knowledge graph, and the whole of it: **an edge is a reference,
 * never a resemblance.** Nothing here joins two records because they mention
 * the same name or fall on the same date. A line is drawn because one record
 * stores the other's id, so nothing on this card can be wrong in a way the
 * records are not already wrong.
 *
 * The inbound half is the useful one — a person's documents, a vehicle's
 * services, a will's beneficiaries — and it is also the half that was
 * incomplete until `referenceFields` replaced a hardcoded list of two field
 * types with "anything carrying a `ref`".
 */
async function connectionsCard(entityName, record) {
  const found = await new RecordsService(app().db).connectionsFor(entityName, record);
  if (!found.total) return null;

  return card({ class: 'record-connections' }, [
    cardHeader('Connected records', badge(String(found.total)), { iconName: 'link' }),
    h('p', { class: 'small muted' }, describeConnections(found)),

    found.from.length
      ? h('div', { class: 'list' }, found.from.flatMap((group) => group.records.map((one) => listItem({
        title: one.title || '(untitled)',
        subtitle: `${group.label} · via ${group.fieldLabel}`,
        href: Router.href({
          module: entity(group.entity).module, entity: group.entity, id: one.id,
        }),
      })))) : null,

    found.to.length
      ? h('div', { class: 'list' }, found.to.map((one) => listItem({
        title: one.title || 'Not found',
        subtitle: one.missing
          ? `${one.label} · this points at a record that is not there`
          : `${one.label}`,
        href: one.missing ? undefined : Router.href({
          module: entity(one.entity).module, entity: one.entity, id: one.id,
        }),
      }))) : null,
  ]);
}

/**
 * What has happened to this record.
 *
 * Every record screen, not one. The log has recorded `recordId` on every entry
 * since Phase 0.5 and nothing could ask it: `recentActivity` filters by entity
 * *name*, so the application could say what happened to accounts and never
 * what happened to **this** account — the question somebody looking at a record
 * actually has.
 *
 * Kept short deliberately. A record edited weekly for a year has a long log and
 * a screen is not an audit tool; the newest handful, with a sentence saying how
 * many there are in total, is what a person reads.
 */
async function historyCard(entityName, id) {
  const { entries, summary, nameOf } = await new RecordsService(app().db).history(id);
  if (!entries.length) return null;

  return card({ class: 'card--quiet record-history' }, [
    cardHeader('What has happened to this', summary.changes
      ? badge(`${summary.changes} change${summary.changes === 1 ? '' : 's'}`)
      : null, { iconName: 'clock' }),

    h('div', { class: 'list' }, entries.slice(0, 6).map((entry) => listItem({
      title: describeAudit(entry, nameOf),
      subtitle: formatInstant(entry.at),
    }))),

    entries.length > 6
      ? h('p', { class: 'small faint' },
        `${entries.length} entries in all. This is the household's own log — it `
        + 'is never sent anywhere, and it records which fields changed rather '
        + 'than what they changed to.')
      : h('p', { class: 'small faint' },
        'The household\'s own log. It records which fields changed rather than '
        + 'what they changed to.'),
  ]);
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
    /*
     * Checked here, not only on the way in.
     *
     * `data/formats.js` rejects `javascript:` and `data:` when a URL is typed
     * into the form, with a comment saying exactly why. But that is the form
     * path, and it is not the only one: `Repository.applyRemote` writes a row
     * arriving from the household's own Google Sheet straight to the store
     * with no validation at all — deliberately, because a sync that rejected a
     * row would lose it, and losing data silently is worse. So a value typed
     * into the spreadsheet reaches this line unchecked.
     *
     * `safeUrl` was written for this, exported, tested — and called by
     * nothing. It returns '' for anything outside http, https, mailto and tel,
     * and an anchor with no href is inert rather than a link that runs.
     *
     * The text stays whatever was stored, so a household can see what is
     * actually in the record rather than an empty cell where a bad value is.
     */
    const safe = safeUrl(value);
    return safe
      ? h('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, value)
      : h('span', { class: 'faint', title: t('url.notLinked') }, value);
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
