/**
 * Settings: the Google account, and what sync is doing with it.
 *
 * `connectForm` lives here rather than beside `aboutCard` because it is the
 * thing `googleCard` opens, and `syncCard` reads the same status object.
 */

import { Outbox } from '../../sync/outbox.js';
import { app } from '../../context.js';
import { card, cardHeader, button, badge, listItem, empty, metric } from '../../ui/components/basics.js';
import { config, isConfigured, saveStoredConfig } from '../../core/config.js';
import { entity } from '../../data/schema.js';
import { formatInstant } from '../../core/dates.js';
import { h } from '../../ui/dom.js';
import { modal, confirm } from '../../ui/components/modal.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';

/* ---------------------------------------------------------------- Google */

export function googleCard(auth, sync, status) {
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

/* ------------------------------------------------------------------ sync */

export function syncCard(db, sync, status) {
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
      'Nothing is configured, so FamilyOS is running entirely on this device. '
      + 'Everything works; nothing is backed up.'),

    h('label', { class: 'small faint' }, 'OAuth client id'),
    clientId,
    h('p', { class: 'small faint' },
      'Enough on its own for Continue with Google and for reading receipts in Shops. '
      + 'Both talk to Google straight from this device.'),

    h('label', { class: 'small faint' }, 'Apps Script URL — optional'),
    apiUrl,
    h('p', { class: 'small faint' },
      'Only for backing records up to your own Sheet and Drive. Leave it empty and '
      + 'everything else still works — you can add it later.'),
    h('div', { class: 'row row--end', style: { gap: 'var(--space-2)' } }, [
      button('Connect', {
        variant: 'primary',
        onClick: async () => {
          const id = clientId.value.trim();
          const url = apiUrl.value.trim();

          // The client id alone is a complete configuration for two of the
          // three things Google is used for: Continue with Google, and reading
          // receipts in Shops. Both go from this device straight to Google and
          // never touch the Apps Script deployment.
          //
          // Requiring both meant a household who wanted their receipts read had
          // to deploy a backend they would never call — the longest step of the
          // setup, for a feature that does not use it.
          if (!id) {
            toast('The OAuth client id is the one value nothing works without.',
              { kind: 'error' });
            return;
          }
          if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
            // A deployment URL that is not the /exec one answers with HTML and
            // every sync fails later with something that does not say why.
            toast('That does not look like a deployed Apps Script URL — it should end in /exec.',
              { kind: 'error' });
            return;
          }
          try {
            await saveStoredConfig(app().db, { googleClientId: id, apiUrl: url });
            toast(url
              ? 'Saved. Reload to sign in with Google.'
              : 'Saved. Reload to sign in — backup stays off until an Apps Script URL is added.',
            { kind: 'success' });
          } catch (err) {
            toast(userMessage(err), { kind: 'error' });
          }
        },
      }),
    ]),
  ]);
}
