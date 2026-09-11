/**
 * Settings: how much is stored, what a deletion left behind, unresolved sync
 * conflicts, and getting every byte out and back in again.
 */

import { ACTIONS } from '../../data/audit.js';
import { CODE_METHOD } from '../../security/codeescrow.js';
import { ArchiveService } from '../../services/archive.js';
import { card, cardHeader, button, badge, listItem, empty, metric, progress } from '../../ui/components/basics.js';
import { download } from '../reports.js';
import { entities, entity, entityNames } from '../../data/schema.js';
import { entityLabel } from '../../core/labels.js';
import { formatDay } from '../../core/dates.js';
import { h } from '../../ui/dom.js';
import { t } from '../../core/locale.js';
import { modal, confirm, prompt } from '../../ui/components/modal.js';
import { open as openArchive, describeBody } from '../../domain/archive.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';
import { ExampleService, loadedExample } from '../../services/example.js';
import { exampleStrings } from '../../locale/en-example.js';
import { openFields } from '../../security/fieldcrypto.js';

/* ------------------------------------------------------------------ data */

export function dataCard(db, stats, usage) {
  const totalRows = Object.entries(stats)
    .filter(([key]) => !key.startsWith('_'))
    .reduce((n, [, s]) => n + s.live, 0);

  return card({}, [
    cardHeader(t('settings.data.title'), null, { iconName: 'grid' }),
    h('div', { class: 'row', style: { gap: 'var(--space-5)' } }, [
      metric({ label: 'Records', value: String(totalRows), compact: true }),
      usage
        ? metric({
          label: t('settings.data.storageUsed'),
          value: t('settings.data.megabytes', { n: (usage.usage / 1024 / 1024).toFixed(1) }),
          compact: true,
        })
        : null,
    ].filter(Boolean)),

    usage ? progress(usage.usage, usage.quota, { label: t('settings.data.quota') }) : null,

    h('div', { class: 'row', style: { marginTop: 'var(--space-3)' } }, [
      button(t('settings.data.reindex'), {
        variant: 'subtle',
        onClick: async () => {
          const n = await db.reindex();
          toast(t('settings.data.reindexed', { n }), { kind: 'success' });
        },
      }),
      button(t('settings.data.checkLinks'), {
        variant: 'subtle',
        onClick: async () => {
          const broken = await db.danglingReferences();
          modal({
            title: broken.length
              ? t('settings.data.brokenCount', { n: broken.length })
              : t('settings.data.noBroken'),
            body: broken.length
              // `label` is the field's own name — "Filed under" rather than
              // `person` — and `points` names what it cannot find. Both come
              // from the same audit the write path refuses a record by, so a
              // row listed here is a row a write would reject.
              ? h('div', { class: 'list' }, broken.slice(0, 100).map((row) => listItem({
                title: t('settings.data.brokenRow', {
                  entity: entityLabel(entity(row.entity)), label: row.label,
                }),
                subtitle: t('settings.data.brokenPoints', { id: row.points.id }),
              })))
              : h('p', {}, t('settings.data.allRefsOk')),
          });
        },
      }),
      button(t('settings.data.eraseButton'), {
        variant: 'danger',
        onClick: () => eraseEverything(db),
      }),
    ]),
  ]);
}

/** The word typed to confirm, named once so the prompt and the check agree. */
const ERASE_WORD = 'ERASE';

async function eraseEverything(db) {
  /*
   * The escrow is named only when there is one, and it is a local read: the
   * keyring's own method list, no network, on a path that must not hang.
   */
  const escrowed = (await db.keyring.methods())
    .some((one) => one.method === CODE_METHOD);

  const ok = await confirm({
    title: t('settings.data.eraseTitle'),
    // Joined rather than interpolated: a template literal holding two routed
    // calls still reads as an English sentence to `tools/strings.mjs`, and
    // would put the unrouted ratchet up for a string that is entirely routed.
    message: [
      t('settings.data.eraseMessage'),
      ...(escrowed ? [t('settings.data.eraseEscrow')] : []),
    ].join(' '),
    confirmLabel: t('settings.data.eraseConfirm'),
    danger: true,
  });
  if (!ok) return;

  const typed = await prompt({
    title: t('settings.data.eraseTypeTitle', { word: ERASE_WORD }),
    label: t('settings.data.eraseTypeLabel'),
    confirmLabel: 'Erase',
  });
  if (typed !== ERASE_WORD) {
    toast(t('settings.data.notErased'));
    return;
  }

  await db.keyring.reset();
  await db.adapter.destroy();
  globalThis.localStorage.clear();
  globalThis.location.reload();
}

/* --------------------------------------------------------------- deleted */

export function deletedCard(db) {
  return card({}, [
    cardHeader(t('settings.data.deletedTitle'), null, { iconName: 'trash' }),
    h('p', { class: 'small muted' }, t('settings.data.deletedBlurb')),
    button(t('settings.data.showDeleted'), {
      variant: 'subtle',
      onClick: async () => {
        const rows = [];
        for (const name of Object.keys(entities)) {
          const deleted = await db.repo(name).list({ includeDeleted: true, decrypt: false })
            .then((list) => list.filter((r) => r.deletedAt));
          for (const record of deleted) rows.push({ name, record });
        }

        modal({
          title: rows.length === 1
            ? t('settings.data.deletedCount.one')
            : t('settings.data.deletedCount.many', { n: rows.length }),
          wide: true,
          body: rows.length
            ? h('div', { class: 'list' }, rows.slice(0, 200).map(({ name, record }) => listItem({
              title: String(entity(name).title(record) ?? record.id),
              subtitle: t('settings.data.deletedRow', {
                entity: entityLabel(entity(name)),
                day: formatDay(record.deletedAt.slice(0, 10)),
              }),
              trailing: button('Restore', {
                class: 'btn--small',
                variant: 'subtle',
                onClick: async () => {
                  await db.repo(name).restore(record.id);
                  toast('Restored', { kind: 'success' });
                },
              }),
            })))
            : empty({ title: t('settings.data.nothingDeleted'), iconName: 'check' }),
        });
      },
    }),
  ]);
}

/* ------------------------------------------------------------- conflicts */

/**
 * The three sides of one conflict, as a person can read them.
 *
 * A conflict row holds what was stored, which for an encrypted field is the
 * envelope — see `openFields`, which explains why that is right to keep and
 * wrong to show. Opening happens here, for the screen, and the row itself is
 * left alone.
 *
 * Exported so the suite can ask what the three sentences on that screen
 * actually say. Nothing else imports it: the card below is its only caller,
 * and a screen nobody can question is how the envelopes got printed for as
 * long as they did.
 */
export async function readable(db, conflict) {
  const open = (values) =>
    openFields(conflict.store, conflict.recordId, values, db.keyring.key);
  const [local, remote, resolved] = await Promise.all([
    open(conflict.localValues), open(conflict.remoteValues), open(conflict.resolvedValues),
  ]);
  const say = (side) => (field) =>
    (side.sealed.includes(field) ? t('settings.data.conflictSealed') : side.values[field]);
  return { local: say(local), remote: say(remote), resolved: say(resolved) };
}

/**
 * Undo the merge's choice for one conflict, and mark the row reviewed.
 *
 * It sends the **stored** values, not the ones `readable` opened for the
 * screen. An envelope passes back through `encryptRecord` untouched — it is
 * already sealed, and bound to this entity, this record and this field, so it
 * lands in the slot it came out of. Sending the opened map would send the
 * "cannot read this" sentence for a field that would not open, and write it
 * over a ciphertext a later key may still open.
 *
 * Exported for the same reason `readable` is: this is the one button on this
 * screen that changes a record, and a button nobody can question is not a
 * button anybody should trust.
 */
export async function revertToThisDevice(db, conflict) {
  await db.repo(conflict.store).update(conflict.recordId, conflict.localValues);
  await db.adapter.write('conflicts', { ...conflict, reviewed: true });
}

export function conflictsCard(db) {
  return card({}, [
    cardHeader('Conflicts', null, { iconName: 'swap' }),
    h('p', { class: 'small muted' }, t('settings.data.conflictsBlurb')),
    button(t('settings.data.showConflicts'), {
      variant: 'subtle',
      onClick: async () => {
        const conflicts = await db.adapter.query('conflicts', { limit: 200 });
        const shown = await Promise.all(conflicts.map((one) => readable(db, one)));
        modal({
          title: conflicts.length
            ? t('settings.data.conflictCount', { n: conflicts.length })
            : t('settings.data.noConflicts'),
          wide: true,
          body: conflicts.length
            ? h('div', { class: 'stack' }, conflicts.map((conflict, i) => card({ variant: 'quiet' }, [
              h('div', { class: 'row row--between' }, [
                h('strong', {}, entityLabel(entity(conflict.store))),
                badge(conflict.outcome),
              ]),
              h('div', { class: 'list' }, conflict.fields.map((field) => listItem({
                title: field,
                subtitle: t('settings.data.conflictValues', {
                  local: shown[i].local(field),
                  remote: shown[i].remote(field),
                }),
                value: t('settings.data.conflictKept', { value: shown[i].resolved(field) }),
              }))),
              h('div', { class: 'row row--end' }, [
                button(t('settings.data.useThisDevice'), {
                  class: 'btn--small',
                  variant: 'subtle',
                  onClick: async () => {
                    await revertToThisDevice(db, conflict);
                    toast(t('settings.data.reverted'), { kind: 'success' });
                  },
                }),
              ]),
            ])))
            : empty({ title: t('settings.data.nothingConflicted'), iconName: 'check' }),
        });
      },
    }),
  ]);
}

/* ----------------------------------------------------------------- backup */

/**
 * A whole household in one file, and the way back from a lost phone.
 *
 * Everything else on this screen is a setting. This is the only place that can
 * hand somebody every record they have, and the only place that can replace
 * every record they have, so both halves say plainly what they are before they
 * do it.
 *
 * ## Why it asks for the recovery phrase rather than a new password
 *
 * The file is encrypted with a key derived from the phrase, and the phrase is
 * checked against the keyring *before* anything is written. That check is the
 * point: a backup sealed with a mistyped passphrase is a backup nobody can
 * open, and it fails silently — the file looks fine, the household stops
 * worrying, and the mistake surfaces years later on the worst day. Unlocking
 * with the phrase costs one PBKDF2 derivation and removes that entire class of
 * failure. It also unwraps the same data key that is already in memory, so
 * verifying changes nothing about the session.
 */
export async function backupCard(db, repaint) {
  const archive = new ArchiveService(db);
  const missing = archive.unreadable();

  if (missing.length) {
    return card({}, [
      cardHeader('Backup', null, { iconName: 'download' }),
      h('p', { class: 'small muted' }, t('settings.data.backupOwnerOnly', {
        missing: missing.length, total: entityNames().length,
      })),
    ]);
  }

  return card({}, [
    cardHeader('Backup', null, { iconName: 'download' }),
    h('p', { class: 'small muted' }, t('settings.data.backupBlurb')),

    // A backup nobody remembers to take is close to a backup nobody has, so
    // the date is on the card rather than somewhere it has to be looked for.
    // "Never" is the honest word for a household that has not taken one, and
    // it is the state most of them are in.
    lastTakenLine(await archive.lastTaken()),

    h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
      button(t('settings.data.takeBackup'), { variant: 'primary', onClick: () => take(db, archive, repaint) }),
      button(t('settings.data.restoreFromFile'), { variant: 'subtle', onClick: () => restore(db, archive, repaint) }),
    ]),
  ]);
}

async function take(db, archive, repaint) {
  const phrase = await prompt({
    title: t('settings.data.takeBackup'),
    label: t('settings.data.phraseLabel'),
    placeholder: t('settings.data.phrasePlaceholder'),
    confirmLabel: t('settings.data.takeBackupConfirm'),
  });
  if (!phrase) return;

  try {
    // Before anything is written. A file sealed with a typo is a file nobody
    // can open, and nothing would say so until it mattered.
    await db.keyring.unlockWithRecoveryPhrase(phrase);
  } catch {
    toast(t('settings.data.wrongPhrase'), { kind: 'error', ms: 0 });
    return;
  }

  try {
    // Gathers, seals, and opens the sealed file again before it is offered.
    // Nothing is handed over that has not been read back.
    const taken = await archive.take(phrase);
    if (!taken.ok) {
      toast(taken.why, { kind: 'error', ms: 0 });
      return;
    }

    const day = new Date().toISOString().slice(0, 10);
    await download({
      blobParts: JSON.stringify(taken.file),
      mime: 'application/json',
      filename: `FamilyOS backup ${day}.familyos`,
    });

    const { records, documents } = taken.summary;
    toast(t('settings.data.backupTaken', { records, documents }), { kind: 'success', ms: 0 });
    await db.logAudit(ACTIONS.export, { report: 'backup', format: 'archive', includeEncrypted: true });
    await repaint();
  } catch (err) {
    toast(userMessage(err), { kind: 'error', ms: 0 });
  }
}

/**
 * Restoring, which is the one button here that replaces everything.
 *
 * It only ever runs against a device holding nothing — the service refuses
 * anything else rather than merging, because two records with one id and no
 * common ancestor is a reconciliation problem and an archive has none of the
 * context the sync engine uses to solve it. So the confirmation is not "are you
 * sure", which people click; it says what is in the file and what will be true
 * afterwards.
 */
async function restore(db, archive, repaint) {
  const picker = h('input', {
    type: 'file',
    accept: '.familyos,application/json',
    style: { display: 'none' },
  });
  document.body.append(picker);

  const chosen = await new Promise((resolve) => {
    picker.addEventListener('change', () => resolve(picker.files?.[0] ?? null), { once: true });
    picker.addEventListener('cancel', () => resolve(null), { once: true });
    picker.click();
  });
  picker.remove();
  if (!chosen) return;

  const phrase = await prompt({
    title: t('settings.data.restoreTitle'),
    label: t('settings.data.restorePhraseLabel'),
    confirmLabel: t('settings.data.openFile'),
  });
  if (!phrase) return;

  try {
    const parsed = JSON.parse(await chosen.text());
    const opened = await openArchive(parsed, phrase);
    if (!opened.ok) {
      toast(opened.why, { kind: 'error', ms: 0 });
      return;
    }

    const summary = describeBody(opened.body);
    const taken = summary.createdAt
      ? summary.createdAt.slice(0, 10)
      : t('settings.data.unknownDate');

    const go = await confirm({
      title: t('settings.data.restoreConfirmTitle'),
      message: t('settings.data.restoreMessage', {
        taken, records: summary.records, documents: summary.documents,
      }),
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!go) return;

    const done = await archive.restore(opened.body);
    if (!done.ok) {
      toast(done.why === undefined ? t('settings.data.restoreRefused') : done.why,
        { kind: 'error', ms: 0 });
      await repaint();
      return;
    }

    // The session is holding a key that belongs to records this device no
    // longer has. There is no correct way to carry on in it.
    toast(t('settings.data.restored', { n: done.restored }), { kind: 'success' });
    setTimeout(() => globalThis.location.reload(), 1200);
  } catch (err) {
    toast(userMessage(err), { kind: 'error', ms: 0 });
  }
}

/** The date, or the word that is true when there isn't one. */
function lastTakenLine(iso) {
  return h('p', {
    class: ['small', iso ? 'muted' : 'faint'],
    style: { marginTop: 'var(--space-2)' },
  }, iso
    ? t('settings.data.lastBackup', { day: iso.slice(0, 10) })
    : t('settings.data.neverBackedUp'));
}

/* -------------------------------------------------------------- example */

/**
 * The example household's own text, with `{count}` filled in.
 *
 * A three-line stand-in for `t()` because these keys are outside the UI
 * catalogue on purpose — `js/locale/en-example.js` sets out why. Whole
 * sentences per key either way, so a language that wants this can translate it
 * without the code changing.
 */
const say = (key, vars = {}) => String(exampleStrings[key] ?? key)
  .replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

/**
 * The example household: load it, or take it out again.
 *
 * Placed in the data group rather than anywhere more prominent, because it is
 * a thing you do once to look around and never again. What it must not be is
 * hidden: a household that loaded it and forgot is a household that could mistake
 * invented figures for its own, so the card states plainly when it is present.
 */
export async function exampleCard(db, repaint) {
  const loaded = await loadedExample(db);
  const service = new ExampleService(db);

  return card({}, [
    cardHeader(say('example.load.title'), loaded ? badge(String(loaded.ids.length), 'warning') : null,
      { iconName: 'grid' }),
    h('p', { class: 'small muted' }, say('example.load.body')),

    // Said on the card, not only on the records: the count is the reassurance
    // that removal knows exactly what it would take out.
    loaded
      ? h('p', { class: 'small' }, say('example.present', { count: loaded.ids.length }))
      : null,

    h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
      loaded
        ? button(say('example.remove.action'), {
          variant: 'subtle', onClick: () => removeExample(service, repaint),
        })
        : button(say('example.load.action'), {
          variant: 'subtle', onClick: () => loadExample(service, repaint),
        }),
    ]),
  ].filter(Boolean));
}

async function loadExample(service, repaint) {
  try {
    const out = await service.install();
    if (out.loaded) toast(say('example.loaded', { count: out.count }));
    else if (out.present) toast(say('example.present', { count: out.count }));
    // A refusal is not a failure and is not phrased as one. It says what is
    // already there and why that settles it.
    else toast(say('example.refused', { count: out.people }), { kind: 'warning' });
    repaint();
  } catch (error) {
    toast(userMessage(error), { kind: 'error' });
  }
}

async function removeExample(service, repaint) {
  const ok = await confirm({
    title: say('example.remove.action'),
    message: say('example.load.body'),
  });
  if (!ok) return;

  try {
    const out = await service.remove();
    toast(say('example.removed', { count: out.removed }));
    repaint();
  } catch (error) {
    toast(userMessage(error), { kind: 'error' });
  }
}
