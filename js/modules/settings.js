/**
 * Settings.
 *
 * The screen where the honest things live: what is queued and not yet synced,
 * what failed and why, whether the backup has been verified, what a deletion
 * left behind, and how to get every byte out. A settings screen that only
 * offers a theme toggle is hiding the parts that matter when something goes
 * wrong.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, button, badge, pageHeader, listItem, empty, metric, progress,
} from '../ui/components/basics.js';
import { modal, confirm, prompt } from '../ui/components/modal.js';
import { toast } from '../ui/components/toast.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { config, isConfigured, saveStoredConfig } from '../core/config.js';
import { entities, entity, ROLES } from '../data/schema.js';
import { Outbox } from '../sync/outbox.js';
import { formatInstant, formatDay } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { applyTheme, storedTheme, THEMES } from '../ui/theme.js';
import { platformAuthenticatorAvailable, enrolBiometric, biometricExplanation } from '../auth/biometric.js';
import { recentActivity, describe as describeAudit } from '../data/audit.js';

export async function render() {
  const host = h('div', {});
  await paint(host);
  const off = bus.on(TOPIC.syncState, () => paint(host));
  return { node: host, destroy: off };
}

async function paint(host) {
  const { db, sync, auth } = app();
  const status = await sync.status();
  const stats = await db.statistics();
  const usage = await db.adapter.usage?.();
  const activity = await recentActivity(db.adapter, { limit: 12 });
  const people = Object.fromEntries(
    (await db.repo('person').list({ decrypt: false })).map((p) => [p.id, p.name]),
  );

  replace(host, [
    pageHeader('Settings', { subtitle: `Device ${db.deviceId.slice(0, 12)}…` }),

    h('div', { class: 'grid grid--wide' }, [
      googleCard(auth, sync, status),
      householdCard(),
      syncCard(db, sync, status),
      securityCard(db),
      appearanceCard(),
      dataCard(db, stats, usage),
      deletedCard(db),
      conflictsCard(db),
      activityCard(activity, people),
      aboutCard(),
    ]),
  ]);
}

/* ---------------------------------------------------------------- Google */

function googleCard(auth, sync, status) {
  const configured = isConfigured();

  return card({}, [
    cardHeader('Google account', configured
      ? badge(auth.isSignedIn ? 'connected' : 'signed out', auth.isSignedIn ? 'positive' : 'warning')
      : badge('not configured', 'warning'), { iconName: 'cloud' }),

    configured
      ? h('div', { class: 'stack stack--tight' }, [
        h('p', { class: 'small muted' }, auth.profile?.email
          ? `Signed in as ${auth.profile.email}. FamilyOS can only see the files it creates — `
            + 'the rest of your Drive is invisible to it.'
          : 'Sign in to back your records up to your own Google Sheets and Drive.'),
        h('div', { class: 'row' }, [
          auth.isSignedIn
            ? button('Sign out', {
              variant: 'subtle',
              onClick: async () => {
                await auth.signOut();
                toast('Signed out. Your records stay on this device.');
              },
            })
            : button('Sign in with Google', {
              variant: 'primary',
              iconName: 'cloud',
              onClick: async () => {
                try {
                  await auth.signIn();
                  toast('Connected', { kind: 'success' });
                  await sync.bootstrap();
                  await sync.run();
                } catch (err) {
                  toast(userMessage(err), { kind: 'error' });
                }
              },
            }),
          auth.isSignedIn
            ? button('Set up the workbook', {
              variant: 'subtle',
              onClick: async () => {
                try {
                  const info = await sync.bootstrap();
                  toast(`Workbook ready (${info.workbookId.slice(0, 8)}…)`, { kind: 'success' });
                } catch (err) {
                  toast(userMessage(err), { kind: 'error' });
                }
              },
            })
            : null,
        ]),
      ])
      : connectForm(),

    status.lastVerification
      ? h('p', { class: 'small faint' },
        `Backup ${status.lastVerification.verified ? 'verified' : 'MISMATCHED'} `
        + `on ${formatInstant(status.lastVerification.at)}.`)
      : null,
  ]);
}

/* ------------------------------------------------------------- household */

/**
 * Which Google accounts may reach this household's backend.
 *
 * The backend runs as one account and answers requests carrying an OAuth
 * token. For a long time it answered *only* that account's token, which meant
 * the documented way to add a family member — sign in with their own Google
 * account and sync — could not work: their token was rejected before it
 * reached anything.
 *
 * This is that list. What it grants is the right to reach the workbook, not
 * the ability to read it: the sensitive fields in it are ciphertext, and the
 * key that opens them is wrapped by a PIN, a fingerprint or a recovery phrase
 * on each person's own device and never goes near Google.
 */
function householdCard() {
  const host = h('div', {});
  const body = h('div', {}, h('p', { class: 'muted' }, 'Checking…'));
  let members = [];
  let owner = '';
  let isOwner = false;

  replace(host, card({}, [
    cardHeader('Household accounts', null, {
      subtitle: 'Who may sync with this backup',
      iconName: 'family',
    }),
    body,
  ]));

  void load();
  return host;

  async function load() {
    const { transport } = app();
    if (!transport.configured) {
      replace(body, h('p', { class: 'muted' },
        'No backend is configured, so nothing syncs and there is nobody to admit.'));
      return;
    }

    try {
      const result = await transport.members();
      members = result.members ?? [];
      owner = result.owner ?? '';
      isOwner = Boolean(result.isOwner);
      paint();
    } catch (err) {
      replace(body, [
        h('p', { class: 'muted' }, userMessage(err)),
        // An older deployment has no `members` action at all, and saying so
        // beats an error nobody can act on.
        h('p', { class: 'small faint' },
          'A backend deployed before this feature will not know the request. '
          + 'Redeploy apps-script/ and this will fill itself in.'),
      ]);
    }
  }

  function paint() {
    const field = h('input', {
      type: 'email',
      class: 'input',
      placeholder: 'family@gmail.com',
      'aria-label': 'Google account to admit',
      onKeyDown: (event) => { if (event.key === 'Enter') add(); },
    });

    const add = () => {
      const value = field.value.trim().toLowerCase();
      if (!value.includes('@') || members.includes(value)) return;
      field.value = '';
      void save([...members, value]);
    };

    replace(body, [
      listItem({
        title: owner || 'the deploying account',
        subtitle: 'Owns the backend — admitted by identity, and cannot be removed',
        leading: badge('owner', 'success'),
      }),
      ...members.map((email) => listItem({
        title: email,
        subtitle: 'May sync with this backup',
        leading: badge('member', 'info'),
        trailing: isOwner ? button('Remove', {
          onClick: () => save(members.filter((other) => other !== email)),
        }) : null,
      })),

      isOwner
        ? h('div', {}, [
          h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
            field, button('Admit', { onClick: add }),
          ]),
          h('p', { class: 'small muted', style: { marginTop: 'var(--space-2)' } },
            'They also need to be a test user on your OAuth consent screen, and they '
            + 'need the household’s recovery phrase or their own PIN enrolled on their '
            + 'device — this list decides who may reach the backup, not who can read it. '
            + 'Everything sensitive in it is encrypted with a key Google never sees.'),
        ])
        : h('p', { class: 'small muted', style: { marginTop: 'var(--space-3)' } },
          'Only the account that deployed the backend can change this list.'),
    ].filter(Boolean));
  }

  async function save(next) {
    try {
      const result = await app().transport.members(next);
      members = result.members ?? next;
      toast('Household accounts updated', { kind: 'success' });
      paint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }
}

/* ------------------------------------------------------------------ sync */

function syncCard(db, sync, status) {
  const queue = status.queue;

  return card({}, [
    cardHeader('Sync', badge(status.state, {
      idle: 'positive', running: 'accent', offline: 'warning',
      blocked: 'danger', error: 'danger',
    }[status.state] ?? ''), { iconName: 'refresh' }),

    h('div', { class: 'row', style: { gap: 'var(--space-5)' } }, [
      metric({ label: 'Waiting to send', value: String(queue.pending), compact: true }),
      metric({ label: 'Backing off', value: String(queue.waiting), compact: true }),
      metric({ label: 'Stuck', value: String(queue.failed), compact: true }),
    ]),

    status.lastRun
      ? h('p', { class: 'small faint' }, `Last run ${formatInstant(status.lastRun)}.`)
      : h('p', { class: 'small faint' }, 'Never synced.'),

    status.error ? h('p', { class: 'small money--negative' }, status.error) : null,

    h('div', { class: 'row' }, [
      button('Sync now', { variant: 'primary', iconName: 'refresh', onClick: () => sync.run() }),
      button('Verify backup', {
        variant: 'subtle',
        onClick: async () => {
          try {
            const report = await sync.verifyBackup();
            showVerification(report);
          } catch (err) {
            toast(userMessage(err), { kind: 'error' });
          }
        },
      }),
      queue.failed
        ? button(`Retry ${queue.failed} stuck`, {
          variant: 'subtle',
          onClick: async () => {
            const n = await new Outbox(db.adapter).reviveAll();
            toast(`${n} change${n === 1 ? '' : 's'} queued again`);
            await sync.run();
          },
        })
        : null,
      queue.failed ? button('See what is stuck', { variant: 'subtle', onClick: () => showStuck(db) }) : null,
    ]),
  ]);
}

async function showStuck(db) {
  const failed = await new Outbox(db.adapter).failed();
  modal({
    title: 'Changes that could not be sent',
    wide: true,
    body: failed.length
      ? h('div', { class: 'list' }, failed.map((entry) => listItem({
        title: `${entity(entry.store).labels.one} · ${entry.op}`,
        subtitle: entry.lastError || 'no reason recorded',
        trailing: h('div', { class: 'row' }, [
          badge(`${entry.attempts} attempts`),
          button('Discard', {
            variant: 'danger',
            class: 'btn--small',
            onClick: async () => {
              const ok = await confirm({
                title: 'Discard this change?',
                message: 'The record on this device keeps its current value; it simply stops '
                  + 'trying to reach Google. The two will be out of step until you edit it again.',
                confirmLabel: 'Discard',
                danger: true,
              });
              if (ok) {
                await new Outbox(db.adapter).discard(entry.id);
                toast('Discarded');
              }
            },
          }),
        ]),
      })))
      : empty({ title: 'Nothing stuck', iconName: 'check' }),
  });
}

function showVerification(report) {
  modal({
    title: report.verified ? 'Backup verified' : 'Backup does not match',
    wide: true,
    body: h('div', { class: 'stack' }, [
      h('p', { class: 'small muted' }, report.verified
        ? 'Every record type has the same number of rows here and in Google Sheets.'
        : 'Some record types differ. Run a sync; if the difference persists, the rows '
          + 'below were rejected by the server and are listed under Sync.'),
      h('div', { class: 'list' }, report.rows
        .filter((row) => !row.ok || row.local > 0)
        .map((row) => listItem({
          title: entity(row.entity).labels.many,
          subtitle: row.sheet,
          value: `${row.local} here · ${row.remote} there`,
          trailing: row.ok ? badge('ok', 'positive') : badge('differs', 'danger'),
        }))),
    ]),
  });
}

/* -------------------------------------------------------------- security */

function securityCard(db) {
  return card({}, [
    cardHeader('Security', null, { iconName: 'lock' }),
    h('div', { class: 'stack stack--tight' }, [
      h('p', { class: 'small muted' },
        `The app locks after ${config().sessionTimeoutMinutes} minutes of inactivity. `
        + 'Sensitive fields are encrypted with a key your PIN unwraps; changing the PIN '
        + 're-wraps that key and re-encrypts nothing.'),
      h('div', { class: 'row' }, [
        button('Change PIN', {
          variant: 'subtle',
          iconName: 'key',
          onClick: async () => {
            const current = await prompt({ title: 'Change PIN', label: 'Current PIN', confirmLabel: 'Next' });
            if (!current) return;
            const next = await prompt({ title: 'Change PIN', label: 'New PIN', confirmLabel: 'Change' });
            if (!next) return;
            try {
              await db.keyring.changePin(current, next);
              toast('PIN changed', { kind: 'success' });
            } catch (err) {
              toast(userMessage(err), { kind: 'error' });
            }
          },
        }),
        button('Set up fingerprint', {
          variant: 'subtle',
          iconName: 'fingerprint',
          onClick: () => setUpBiometric(db),
        }),
        button('Lock now', {
          variant: 'subtle',
          iconName: 'lock',
          onClick: () => {
            db.keyring.lock();
            globalThis.location.reload();
          },
        }),
      ]),
    ]),
  ]);
}

async function setUpBiometric(db) {
  if (!(await platformAuthenticatorAvailable())) {
    toast('This device has no fingerprint or face unlock available to the browser.',
      { kind: 'error' });
    return;
  }

  try {
    const actor = db.actor;
    const result = await enrolBiometric({
      userId: actor.personId || db.deviceId,
      userName: actor.name || 'FamilyOS user',
    });

    if (result.rawKey) {
      await db.keyring.addMethod('webauthn', { rawKey: result.rawKey, label: 'This device' });
    }
    await db.setMeta('auth.webauthnCredentialId', result.credentialId);
    await db.setMeta('auth.webauthnDerivesKey', Boolean(result.rawKey));

    modal({
      title: 'Fingerprint set up',
      body: h('p', {}, biometricExplanation(Boolean(result.rawKey))),
    });
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

/* ------------------------------------------------------------ appearance */

function appearanceCard() {
  const current = storedTheme();
  return card({}, [
    cardHeader('Appearance', null, { iconName: 'sun' }),
    h('div', { class: 'chip-row' }, THEMES.map((theme) => h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(theme === current),
      onClick: (event) => {
        applyTheme(theme);
        for (const chip of event.target.parentElement.children) {
          chip.setAttribute('aria-pressed', String(chip === event.target));
        }
      },
    }, theme === 'system' ? 'Follow the system' : theme))),
  ]);
}

/* ------------------------------------------------------------------ data */

function dataCard(db, stats, usage) {
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
              ? h('div', { class: 'list' }, broken.slice(0, 100).map((row) => listItem({
                title: `${entity(row.entity).labels.one} · ${row.field}`,
                subtitle: `points at ${row.missing}, which no longer exists`,
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

function deletedCard(db) {
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

function conflictsCard(db) {
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

/* -------------------------------------------------------------- activity */

function activityCard(activity, people) {
  return card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      cardHeader('Audit log', null, { iconName: 'clock' })),
    activity.length
      ? h('div', { class: 'list' }, activity.map((entry) => listItem({
        title: describeAudit(entry, (id) => people[id] ?? 'Someone'),
        subtitle: `${formatInstant(entry.at)} · ${entry.actorRole || 'unknown role'}`,
        trailing: entry.synced ? null : badge('local', 'warning'),
      })))
      : empty({ title: 'No activity yet', iconName: 'clock' }),
  ]);
}

/* ----------------------------------------------------------------- about */

function aboutCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader('About', null, { iconName: 'info' }),
    h('dl', { class: 'stack stack--tight', style: { margin: 0 } }, [
      ['Roles', ROLES.join(', ')],
      ['Record types', String(Object.keys(entities).length)],
      ['Encryption', 'AES-256-GCM, key wrapped with PBKDF2-SHA-256'],
      ['Storage', 'IndexedDB on this device; Google Sheets and Drive for backup'],
    ].map(([label, value]) => h('div', { class: 'row row--between small' }, [
      h('dt', { class: 'muted' }, label),
      h('dd', { style: { margin: 0, textAlign: 'right' } }, value),
    ]))),
    h('p', { class: 'small faint' }, [
      icon('info', { size: 14 }),
      ' FamilyOS holds the only copy of your encryption key. Nobody can reset it for you — '
      + 'keep your recovery phrase somewhere safe.',
    ]),
  ]);
}

/**
 * Connecting a hosted copy to a Google account.
 *
 * `familyos.config.json` is not in version control, so a copy served from a
 * static host — GitHub Pages, Netlify, anywhere — arrives with no way to be
 * told which Google project to use. Asking here is the only route that does
 * not require rebuilding the site, and neither value is a secret: the client
 * id is public by design, and the Apps Script URL is refused by the script
 * itself without a token belonging to the owner's account.
 */
function connectForm() {
  const clientId = h('input', {
    type: 'text', class: 'input', value: config().googleClientId ?? '',
    placeholder: '1234-abcd.apps.googleusercontent.com',
    'aria-label': 'Google OAuth client id', autocomplete: 'off', spellcheck: 'false',
  });
  const apiUrl = h('input', {
    type: 'url', class: 'input', value: config().apiUrl ?? '',
    placeholder: 'https://script.google.com/macros/s/…/exec',
    'aria-label': 'Apps Script web app URL', autocomplete: 'off', spellcheck: 'false',
  });

  return h('div', { class: 'stack stack--tight' }, [
    h('p', { class: 'small muted' },
      'No Google client id or Apps Script URL is configured, so FamilyOS is running '
      + 'entirely on this device. Everything works; nothing is backed up. '
      + 'docs/SETUP.md walks through the twenty-minute setup that produces these two.'),
    h('label', { class: 'small faint' }, 'OAuth client id'),
    clientId,
    h('label', { class: 'small faint' }, 'Apps Script URL'),
    apiUrl,
    h('div', { class: 'row row--end', style: { gap: 'var(--space-2)' } }, [
      button('Connect', {
        variant: 'primary',
        onClick: async () => {
          const id = clientId.value.trim();
          const url = apiUrl.value.trim();
          if (!id || !url) {
            toast('Both values are needed before anything can sync.', { kind: 'error' });
            return;
          }
          if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
            // A deployment URL that is not the /exec one answers with HTML and
            // every sync fails later with something that does not say why.
            toast('That does not look like a deployed Apps Script URL — it should end in /exec.',
              { kind: 'error' });
            return;
          }
          try {
            await saveStoredConfig(app().db, { googleClientId: id, apiUrl: url });
            toast('Saved. Reload to sign in with Google.', { kind: 'success' });
          } catch (err) {
            toast(userMessage(err), { kind: 'error' });
          }
        },
      }),
    ]),
  ]);
}
