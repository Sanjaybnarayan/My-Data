/**
 * Settings: how much is stored, what a deletion left behind, unresolved sync
 * conflicts, and getting every byte out and back in again.
 */

import { ACTIONS } from '../../data/audit.js';
import { ArchiveService } from '../../services/archive.js';
import { card, cardHeader, button, badge, listItem, empty, metric, progress } from '../../ui/components/basics.js';
import { download } from '../reports.js';
import { entities, entity, entityNames } from '../../data/schema.js';
import { formatDay } from '../../core/dates.js';
import { h } from '../../ui/dom.js';
import { modal, confirm, prompt } from '../../ui/components/modal.js';
import { open as openArchive, describeBody } from '../../domain/archive.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';
import { ExampleService, loadedExample } from '../../services/example.js';
import { exampleStrings } from '../../locale/en-example.js';

/* ------------------------------------------------------------------ data */

export function dataCard(db, stats, usage) {
  const totalRows = Object.entries(stats)
    .filter(([key]) => !key.startsWith('_'))
    .reduce((n, [, s]) => n + s.live, 0);

  return card({}, [
    cardHeader('Data on this device', null, { iconName: 'grid' }),
    h('div', { class: 'row', style: { gap: 'var(--space-5)' } }, [
      metric({ label: 'Records', value: String(totalRows), compact: true }),
      usage
        ? metric({
          label: 'Storage used',
          value: `${(usage.usage / 1024 / 1024).toFixed(1)} MB`,
          compact: true,
        })
        : null,
    ].filter(Boolean)),

    usage ? progress(usage.usage, usage.quota, { label: 'Browser storage quota' }) : null,

    h('div', { class: 'row', style: { marginTop: 'var(--space-3)' } }, [
      button('Rebuild the search index', {
        variant: 'subtle',
        onClick: async () => {
          const n = await db.reindex();
          toast(`Reindexed ${n} record types`, { kind: 'success' });
        },
      }),
      button('Check for broken links', {
        variant: 'subtle',
        onClick: async () => {
          const broken = await db.danglingReferences();
          modal({
            title: broken.length ? `${broken.length} broken references` : 'No broken references',
            body: broken.length
              // `label` is the field's own name — "Filed under" rather than
              // `person` — and `points` names what it cannot find. Both come
              // from the same audit the write path refuses a record by, so a
              // row listed here is a row a write would reject.
              ? h('div', { class: 'list' }, broken.slice(0, 100).map((row) => listItem({
                title: `${entity(row.entity).labels.one} · ${row.label}`,
                subtitle: `points at ${row.points.id}, which is deleted or missing`,
              })))
              : h('p', {}, 'Every reference points at a record that exists.'),
          });
        },
      }),
      button('Erase everything on this device', {
        variant: 'danger',
        onClick: () => eraseEverything(db),
      }),
    ]),
  ]);
}

async function eraseEverything(db) {
  const ok = await confirm({
    title: 'Erase FamilyOS from this device?',
    message: 'Every record, the encryption key and the queue are deleted from this browser. '
      + 'Anything already synced stays in your Google Sheets and Drive; anything not yet '
      + 'synced is gone for good. This cannot be undone.',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;

  const typed = await prompt({
    title: 'Type ERASE to confirm',
    label: 'This is deliberately awkward',
    confirmLabel: 'Erase',
  });
  if (typed !== 'ERASE') {
    toast('Not erased.');
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
    cardHeader('Deleted items', null, { iconName: 'trash' }),
    h('p', { class: 'small muted' },
      'Nothing is ever hard-deleted — a deletion is a marker that replicates, so a '
      + 'device that has been offline learns about it rather than bringing the record back.'),
    button('Show deleted records', {
      variant: 'subtle',
      onClick: async () => {
        const rows = [];
        for (const name of Object.keys(entities)) {
          const deleted = await db.repo(name).list({ includeDeleted: true, decrypt: false })
            .then((list) => list.filter((r) => r.deletedAt));
          for (const record of deleted) rows.push({ name, record });
        }

        modal({
          title: `${rows.length} deleted record${rows.length === 1 ? '' : 's'}`,
          wide: true,
          body: rows.length
            ? h('div', { class: 'list' }, rows.slice(0, 200).map(({ name, record }) => listItem({
              title: String(entity(name).title(record) ?? record.id),
              subtitle: `${entity(name).labels.one} · deleted ${formatDay(record.deletedAt.slice(0, 10))}`,
              trailing: button('Restore', {
                class: 'btn--small',
                variant: 'subtle',
                onClick: async () => {
                  await db.repo(name).restore(record.id);
                  toast('Restored', { kind: 'success' });
                },
              }),
            })))
            : empty({ title: 'Nothing deleted', iconName: 'check' }),
        });
      },
    }),
  ]);
}

/* ------------------------------------------------------------- conflicts */

export function conflictsCard(db) {
  return card({}, [
    cardHeader('Conflicts', null, { iconName: 'swap' }),
    h('p', { class: 'small muted' },
      'When two devices change the same field, FamilyOS merges them and records what '
      + 'it had to choose. Nothing here needs action — it is a record of decisions you '
      + 'can reverse.'),
    button('Show conflicts', {
      variant: 'subtle',
      onClick: async () => {
        const conflicts = await db.adapter.query('conflicts', { limit: 200 });
        modal({
          title: conflicts.length ? `${conflicts.length} resolved conflicts` : 'No conflicts',
          wide: true,
          body: conflicts.length
            ? h('div', { class: 'stack' }, conflicts.map((conflict) => card({ variant: 'quiet' }, [
              h('div', { class: 'row row--between' }, [
                h('strong', {}, entity(conflict.store).labels.one),
                badge(conflict.outcome),
              ]),
              h('div', { class: 'list' }, conflict.fields.map((field) => listItem({
                title: field,
                subtitle: `this device: ${conflict.localValues[field]} · other device: ${conflict.remoteValues[field]}`,
                value: `kept: ${conflict.resolvedValues[field]}`,
              }))),
              h('div', { class: 'row row--end' }, [
                button('Use this device’s version', {
                  class: 'btn--small',
                  variant: 'subtle',
                  onClick: async () => {
                    await db.repo(conflict.store).update(conflict.recordId, conflict.localValues);
                    await db.adapter.write('conflicts', { ...conflict, reviewed: true });
                    toast('Reverted to this device’s values', { kind: 'success' });
                  },
                }),
              ]),
            ])))
            : empty({ title: 'Nothing has conflicted', iconName: 'check' }),
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
      h('p', { class: 'small muted' },
        'Only an owner can back up the household. Taken by anyone else it would '
        + `be missing ${missing.length} of the ${entityNames().length} kinds of `
        + 'record, and would not say so — which is worse than having no backup, '
        + 'because you would have stopped worrying about it.'),
    ]);
  }

  return card({}, [
    cardHeader('Backup', null, { iconName: 'download' }),
    h('p', { class: 'small muted' },
      'One encrypted file holding every record, every document and the keys that '
      + 'open them. It is the only backup this device has if you are not syncing '
      + 'to Google — see docs/PORTABILITY.md for what the CSV exports are and are not.'),

    // A backup nobody remembers to take is close to a backup nobody has, so
    // the date is on the card rather than somewhere it has to be looked for.
    // "Never" is the honest word for a household that has not taken one, and
    // it is the state most of them are in.
    lastTakenLine(await archive.lastTaken()),

    h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
      button('Take a backup', { variant: 'primary', onClick: () => take(db, archive, repaint) }),
      button('Restore from a file', { variant: 'subtle', onClick: () => restore(db, archive, repaint) }),
    ]),
  ]);
}

async function take(db, archive, repaint) {
  const phrase = await prompt({
    title: 'Take a backup',
    label: 'Your recovery phrase — it is what encrypts the file, and what opens it again',
    placeholder: 'the words you wrote down when you set this up',
    confirmLabel: 'Take the backup',
  });
  if (!phrase) return;

  try {
    // Before anything is written. A file sealed with a typo is a file nobody
    // can open, and nothing would say so until it mattered.
    await db.keyring.unlockWithRecoveryPhrase(phrase);
  } catch {
    toast('That is not the recovery phrase for this household. Nothing was written.',
      { kind: 'error', ms: 0 });
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
    toast(`${records} records and ${documents} documents, encrypted and read back. `
      + 'Keep it somewhere you control.', { kind: 'success', ms: 0 });
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
    title: 'Restore a backup',
    label: 'The recovery phrase this file was taken with',
    confirmLabel: 'Open the file',
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
    const taken = summary.createdAt ? summary.createdAt.slice(0, 10) : 'an unknown date';

    const go = await confirm({
      title: 'Restore this backup?',
      message: `Taken on ${taken}. It holds ${summary.records} records and `
        + `${summary.documents} documents.\n\n`
        + 'Everything in it will be written to this device, and the keys inside it '
        + 'become this device\u2019s keys — so afterwards you unlock with the PIN and '
        + 'phrase that were in use when the backup was taken, not the ones on this '
        + 'device now.\n\n'
        + 'FamilyOS will reload when it finishes.',
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!go) return;

    const done = await archive.restore(opened.body);
    if (!done.ok) {
      toast(done.why === undefined ? 'The restore was refused.' : done.why,
        { kind: 'error', ms: 0 });
      await repaint();
      return;
    }

    // The session is holding a key that belongs to records this device no
    // longer has. There is no correct way to carry on in it.
    toast(`Restored ${done.restored} records. Reloading…`, { kind: 'success' });
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
    ? `Last backup: ${iso.slice(0, 10)}`
    : 'No backup has ever been taken on this device.');
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
