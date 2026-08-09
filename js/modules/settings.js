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
import { config, isConfigured, saveStoredConfig, setLocalOnly } from '../core/config.js';
import { privacyReport, whereData } from '../domain/privacy.js';
import { consentScreen } from '../core/scopes.js';
import { redirectUriFor as redirectUri } from '../auth/google.js';
import { entities, entity, ROLES } from '../data/schema.js';
import { Outbox } from '../sync/outbox.js';
import { formatInstant, formatDay } from '../core/dates.js';
import { userMessage } from '../core/errors.js';
import { applyTheme, storedTheme, THEMES } from '../ui/theme.js';
import { platformAuthenticatorAvailable, enrolBiometric, biometricExplanation } from '../auth/biometric.js';
import {
  googleUnlockAvailable, connectGoogleUnlock, linkExistingDevice, unlinkGoogleUnlock,
  GOOGLE_METHOD,
} from '../auth/google-unlock.js';
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
  const methods = await db.keyring.methods();
  const people = Object.fromEntries(
    (await db.repo('person').list({ decrypt: false })).map((p) => [p.id, p.name]),
  );

  replace(host, [
    pageHeader('Settings', { subtitle: `Device ${db.deviceId.slice(0, 12)}…` }),

    h('div', { class: 'grid grid--wide' }, [
      privacyCard(db, host),
      googleCard(auth, sync, status),
      permissionsCard(),
      householdCard(),
      syncCard(db, sync, status),
      securityCard(db, methods, () => paint(host)),
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

/* --------------------------------------------------------------- privacy */

/**
 * Where the data is, what is sealed, and the switch that stops it moving.
 *
 * Put first because it is the question people actually have, and answered by
 * counting the schema rather than by asserting anything. "Encrypted on the
 * device" is true of the fields marked sensitive and not of the rest, and a
 * household is entitled to see which is which before deciding what to type in.
 */
function privacyCard(db, host) {
  const report = privacyReport();
  const detail = h('div', {});
  let open = false;

  const state = {
    localOnly: config().localOnly,
    configured: isConfigured(),
  };
  const map = whereData(state);

  async function toggle(on) {
    if (on) {
      const ok = await confirm({
        title: 'Keep everything on this device?',
        message: 'Nothing will sync, no documents will upload, no mail will be read, '
          + 'and the unlock key will not be kept in Drive.\n\n'
          + 'The cost is that there is no backup. If this device is lost or its '
          + 'browser storage is cleared, the records are gone — the recovery phrase '
          + 'restores a key, not data that was never copied anywhere.'
          + (state.configured
            ? '\n\nAnything already in your Google Sheet and Drive stays there. '
              + 'Delete it from Google if you want it gone.'
            : ''),
        confirmLabel: 'Keep it local',
      });
      if (!ok) return;
    }

    await setLocalOnly(db, on);
    toast(on ? 'Nothing will leave this device' : 'Sync re-enabled', { kind: 'success' });
    await paint(host);
  }

  function paintDetail() {
    replace(detail, open
      ? h('div', { class: 'stack stack--tight' }, report.entities.map((entry) => h('details', {
        class: 'small',
      }, [
        h('summary', {}, `${entry.label} — ${entry.sealed.length} of ${entry.total} sealed`),
        entry.sealed.length
          ? h('p', { class: 'small' }, [
            h('strong', {}, 'Encrypted: '),
            entry.sealed.map((f) => f.label).join(', '),
          ])
          : null,
        h('p', { class: 'small muted' }, [
          h('strong', {}, 'Readable: '),
          entry.plain.map((f) => f.label).join(', ') || 'nothing',
        ]),
      ].filter(Boolean))))
      : null);
  }

  return card({}, [
    cardHeader('Privacy', [
      button(state.localOnly ? 'Allow syncing' : 'Keep everything local', {
        variant: state.localOnly ? 'subtle' : 'primary',
        iconName: 'lock',
        onClick: () => toggle(!state.localOnly),
      }),
    ], {
      subtitle: state.localOnly ? 'Nothing leaves this device' : 'Where your records are',
      iconName: 'shield',
    }),

    h('p', { class: 'muted' }, map.summary),

    h('div', { class: 'list' }, map.places.map((place) => listItem({
      title: place.where,
      subtitle: place.what,
      leading: badge(place.warn ? 'the key' : 'copy', place.warn ? 'warning' : ''),
    }))),

    h('div', { class: 'grid grid--tight' }, [
      metric({ label: 'Fields encrypted', value: String(report.sealed) }),
      metric({
        label: 'Fields readable',
        value: String(report.plain),
        hint: 'searchable, listed, totalled or linked',
      }),
    ]),

    // The sentence that stops somebody assuming more than is true.
    h('p', { class: 'small muted' },
      `${report.sealed} of ${report.total} fields are ciphertext — the identifiers and `
      + 'secrets. The rest is stored as it reads, because a search index over ciphertext '
      + 'finds nothing and a table cannot sort a column it cannot read. That applies on '
      + 'this device and in your Google Sheet alike.'),

    h('button', {
      class: 'btn btn--small',
      type: 'button',
      onClick: () => { open = !open; paintDetail(); },
    }, 'Show me field by field'),
    detail,
  ]);
}

/* -------------------------------------------------------------- permissions */

/**
 * Exactly which Google permissions to add, and where.
 *
 * Here rather than only in a setup document, because the person doing the
 * configuring is looking at this screen and the document is a scroll and a tab
 * away. Built from `core/scopes.js`, which is also what the code asks for — so
 * this cannot describe a permission the application does not request, which is
 * how the setup page came to say the browser never reads mail.
 */
function permissionsCard() {
  const { required, optional } = consentScreen();

  const copy = (list, label) => button(label, {
    variant: 'subtle',
    iconName: 'copy',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(list.map((scope) => scope.id).join('\n'));
        toast('Copied — paste into “Add or remove scopes”', { kind: 'success' });
      } catch {
        toast('Could not reach the clipboard. Select the list and copy it.', { kind: 'error' });
      }
    },
  });

  const row = (scope) => listItem({
    title: scope.id.replace('https://www.googleapis.com/auth/', ''),
    subtitle: `${scope.title} — ${scope.why}`,
    value: '',
  });

  return card({}, [
    cardHeader('Google permissions', [copy([...required, ...optional], 'Copy all')], {
      subtitle: 'Cloud Console → APIs & Services → OAuth consent screen → Scopes',
      iconName: 'key',
    }),

    h('p', { class: 'small muted' },
      'Two consent surfaces, and mixing them up is why adding a scope in the console '
      + 'sometimes changes nothing. This list is the one a person grants in the browser. '
      + 'The Apps Script backend authorises itself separately, from its own manifest, '
      + 'when you deploy it — nothing here affects that.'),

    h('h3', { class: 'small' }, 'Required'),
    h('div', { class: 'list' }, required.map(row)),
    copy(required, 'Copy the required scopes'),

    // The commonest reason a sign-in fails has nothing to do with scopes: the
    // OAuth client does not list where this copy of the app is served from.
    // Google shows its own error inside the popup, the person closes it, and
    // the application can only tell that a window shut. So the two strings it
    // has to match are printed here, exactly, rather than described.
    h('h3', { class: 'small', style: { marginTop: 'var(--space-4)' } }, 'Where this copy is served from'),
    h('p', { class: 'small muted' },
      'On the OAuth client — not the consent screen — these two must be listed '
      + 'exactly, or Google refuses the sign-in before it asks you anything.'),
    h('div', { class: 'list' }, [
      listItem({
        title: 'Authorised JavaScript origin',
        subtitle: globalThis.location?.origin ?? '',
      }),
      listItem({
        title: 'Authorised redirect URI',
        subtitle: redirectUri(),
      }),
    ]),
    button('Copy both', {
      variant: 'subtle',
      iconName: 'copy',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(
            `${globalThis.location?.origin ?? ''}\n${redirectUri()}`,
          );
          toast('Copied', { kind: 'success' });
        } catch {
          toast('Could not reach the clipboard.', { kind: 'error' });
        }
      },
    }),

    h('h3', { class: 'small', style: { marginTop: 'var(--space-4)' } }, 'Optional'),
    h('div', { class: 'list' }, optional.map((scope) => listItem({
      title: scope.id.replace('https://www.googleapis.com/auth/', ''),
      subtitle: `${scope.title} — ${scope.why}`,
      trailing: badge('optional', ''),
    }))),
    h('p', { class: 'small faint' },
      'Each optional one buys a single named feature and nothing works worse without it. '
      + 'Notably you do not need drive.appdata: without it the unlock key goes in an '
      + 'ordinary visible file in your Drive, which works identically.'),
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

const METHOD_NAMES = {
  pin: 'PIN',
  webauthn: 'Fingerprint or face',
  recovery: 'Recovery phrase',
  google: 'Google account',
};

/**
 * Turning Continue with Google on and off after first run.
 *
 * This is the control that was missing, and its absence was not cosmetic.
 * Enrolment only ever ran on a device with no data key, so a household that
 * started with a PIN had no way to add Google at all — and a household that
 * started *with* Google had its second phone take the enrolment path, mint a
 * new key, and write it over the one the first phone depended on.
 */
function googleUnlockRow(db, methods, repaint) {
  const entry = methods.find((m) => m.method === GOOGLE_METHOD);

  return h('div', { class: 'stack stack--tight' }, [
    h('p', { class: 'small muted' }, entry
      ? `Signing in with ${entry.label || 'your Google account'} unlocks this device. `
        + 'Google holds the key that opens your records, which is what lets a new '
        + 'phone pick up where this one left off.'
      : 'Continue with Google keeps the key that unlocks your records in a file in '
        + 'your own Drive, so a new phone can open them without your PIN. It also '
        + 'means anyone who can sign in as you can read them. Off by default, for '
        + 'that reason.'),

    h('div', { class: 'row' }, [
      entry
        ? button('Stop using Google here', {
          variant: 'subtle',
          onClick: () => turnOff(db, repaint),
        })
        : button('Turn on Continue with Google', {
          variant: 'subtle',
          iconName: 'cloud',
          onClick: () => turnOn(db, repaint),
        }),
    ]),
  ]);
}

async function turnOn(db, repaint) {
  try {
    const { escrow, email } = await connectGoogleUnlock();
    const { outcome } = await linkExistingDevice(db.keyring, escrow, email);
    toast(outcome === 'published'
      ? `On. ${email || 'That account'} can now unlock FamilyOS on any device.`
      : `Linked to the key already in ${email || 'that account'}.`,
    { kind: 'success' });
    await repaint();
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

async function turnOff(db, repaint) {
  const go = await confirm({
    title: 'Stop using Google to unlock?',
    message: 'This device will need its PIN, fingerprint or recovery phrase from now '
      + 'on. Nothing is deleted and no records are affected.',
    confirmLabel: 'Stop using it here',
  });
  if (!go) return;

  try {
    await unlinkGoogleUnlock(db.keyring, null);
  } catch (err) {
    toast(userMessage(err), { kind: 'error' });
    return;
  }
  toast('Removed from this device.', { kind: 'success' });
  await repaint();

  // Asked separately, and only after the local removal has succeeded, because
  // the two have different blast radii: this one reaches every device in the
  // household. A cancelled prompt — or a stray Escape — must leave the file
  // exactly where it is.
  const alsoDelete = await confirm({
    title: 'Delete the key from Drive too?',
    message: 'Only if no other device signs in with Google. Any that does will be '
      + 'locked out and will need its recovery phrase to get back in.',
    confirmLabel: 'Delete it from Drive',
    cancelLabel: 'Leave it there',
    danger: true,
  });
  if (!alsoDelete) return;

  try {
    const { escrow } = await connectGoogleUnlock();
    await escrow.drop();
    toast('The key file is gone from Drive.', { kind: 'success' });
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

function securityCard(db, methods = [], repaint = () => {}) {
  return card({}, [
    cardHeader('Security', null, { iconName: 'lock' }),
    h('div', { class: 'stack stack--tight' }, [
      h('p', { class: 'small muted' },
        `The app locks after ${config().sessionTimeoutMinutes} minutes of inactivity. `
        + 'Sensitive fields are encrypted with a key your PIN unwraps; changing the PIN '
        + 're-wraps that key and re-encrypts nothing.'),

      // What actually opens this device. Worth showing rather than assuming:
      // "how do I get back in" is the question this card exists to answer, and
      // a household that never printed a recovery phrase should find that out
      // here rather than on the morning they need it.
      h('div', { class: 'stack stack--tight' }, [
        h('p', { class: 'small' }, 'This device unlocks with:'),
        h('div', { class: 'row' }, methods.length
          ? methods.map((m) => badge(
            METHOD_NAMES[m.method] ?? m.method, m.method === 'recovery' ? 'positive' : 'accent',
          ))
          : badge('nothing yet', 'danger')),
        methods.some((m) => m.method === 'recovery')
          ? null
          : h('p', { class: 'small money--negative' },
            'No recovery phrase. If you lose every unlocked device, the records on '
            + 'them cannot be recovered by anyone.'),
      ]),

      googleUnlockAvailable() ? googleUnlockRow(db, methods, repaint) : null,

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
