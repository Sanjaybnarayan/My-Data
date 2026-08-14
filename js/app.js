/**
 * Boot.
 *
 * The order matters and each step has a reason:
 *
 *  1. Theme, before anything paints.
 *  2. Config, because the Google ids decide whether sync exists at all.
 *  3. Database, because the keyring's wrapped keys live in it.
 *  4. Lock screen — enrolment on a fresh device, unlock on a known one. The
 *     app does not proceed without a data key; there is nothing readable
 *     without one.
 *  5. Shell, router, sync. Sync starts *after* the first screen is on the
 *     glass, because an offline-first app must never wait on the network to
 *     show data it already has.
 */

import {
  loadConfig, loadStoredConfig, loadLocalOnly, config, isConfigured,
} from './core/config.js';
import { Database } from './data/database.js';
import { setContext } from './context.js';
import { applyTheme, storedTheme, watchSystemTheme } from './ui/theme.js';
import { buildShell } from './ui/shell.js';
import { lockScreen, recoveryKitScreen } from './auth/lock.js';
import { Session, AttemptLimiter } from './security/session.js';
import { GoogleAuth } from './auth/google.js';
import { AppsScriptTransport } from './sync/transport.js';
import { SyncEngine } from './sync/engine.js';
import { DocumentStore } from './sync/drive.js';
import { Assistant } from './ai/assistant.js';
import { mountToasts, toast } from './ui/components/toast.js';
import { bus, TOPIC } from './core/bus.js';
import { h, replace } from './ui/dom.js';
import { ACTIONS } from './data/audit.js';
import { userMessage } from './core/errors.js';
import { modules } from './data/schema.js';

const root = () => document.getElementById('app');

export async function boot() {
  applyTheme(storedTheme());
  watchSystemTheme();
  mountToasts();

  await loadConfig();

  // Before the lock screen, and deliberately not awaited.
  //
  // It used to run at the end of `start()`, which meant it never ran at all
  // until somebody had chosen a PIN and got through enrolment. A browser
  // decides whether a site is installable by looking for a registered worker,
  // so on a first visit there was none to find and no "Install app" was ever
  // offered — the one thing that makes this a PWA rather than a web page. The
  // shell was also uncached until after enrolment, so a first run with a bad
  // connection had nothing to fall back on.
  //
  // It needs nothing from the keyring: it caches the shell, which is the same
  // for every household and holds none of their data.
  registerServiceWorker();

  const db = new Database({ currency: config().currency });
  await db.open();

  // A deployment entered in Settings overrides the file, because a hosted copy
  // has no way to be given the file at all.
  await loadStoredConfig(db);

  // Before the lock screen, because it decides whether there is a Google way
  // in at all, and before anything schedules a sync.
  await loadLocalOnly(db);

  // Ask the browser not to evict us. A household's records being cleared to
  // reclaim disk is not an acceptable outcome, and the prompt is free.
  await db.adapter.persist?.();

  const limiter = new AttemptLimiter({
    max: config().maxUnlockAttempts,
    lockoutSeconds: config().unlockLockoutSeconds,
    storage: globalThis.localStorage,
  });

  const enrolled = await db.keyring.isEnrolled();
  const credentialId = await db.meta('auth.webauthnCredentialId');
  const methods = await db.keyring.methods();

  // Carried out of the lock screen so the session that let somebody in is the
  // one that syncs, rather than the app asking them to sign in twice.
  let googleSession = null;

  await new Promise((resolve) => {
    replace(root(), lockScreen({
      keyring: db.keyring,
      limiter,
      biometricCredentialId: credentialId,
      googleEnrolled: methods.some((m) => m.method === 'google'),
      mode: enrolled ? 'unlock' : 'enrol',
      onUnlocked: async ({ firstRun, googleSession: session }) => {
        if (session) googleSession = session;
        if (firstRun) {
          await new Promise((done) => {
            replace(root(), recoveryKitScreen({
              keyring: db.keyring,
              onDone: () => done(),
            }));
          });
        }
        resolve();
      },
    }));
  });

  await start(db, limiter, googleSession);
}

async function start(db, limiter, googleSession = null) {
  const actor = await resolveActor(db);
  db.setActor(actor);
  await db.logAudit(ACTIONS.unlock, {});

  // Somebody who signed in to get past the lock screen is already signed in.
  // Building a second `GoogleAuth` here would ask them again — through a
  // hidden iframe that a strict browser blocks, and that on a machine with
  // several Google accounts can renew as the wrong one.
  const auth = googleSession ?? new GoogleAuth();
  const transport = new AppsScriptTransport({
    url: config().apiUrl,
    getToken: () => auth.getToken(),
    deviceId: db.deviceId,
  });
  const sync = new SyncEngine({
    db, transport, batchSize: config().syncBatchSize,
  });
  const assistant = new Assistant({ db });

  // Handed to the sync engine so uploads drain on the same schedule as
  // records, and put in the context so a screen never builds its own.
  const documents = new DocumentStore({ db, transport });
  sync.documents = documents;

  const session = new Session({
    timeoutMinutes: config().sessionTimeoutMinutes,
    onExpire: () => relock(db),
  }).start().observe();

  const shell = buildShell({
    actor,
    onSync: () => sync.run().then((r) => {
      if (r.error) toast(r.error, { kind: 'error' });
      else if (r.skipped === 'not-configured') toast('Connect a Google account in Settings to sync.');
      else toast(`Synced — ${r.pushed} up, ${r.pulled} down`, { kind: 'success' });
    }),
    onLock: () => relock(db),
    onSearch: (term, results) => quickSearch(db, term, results),
  });

  setContext({
    db, sync, auth, assistant, session, limiter, shell, transport, documents,
    router: shell.router,
    currency: config().currency,
  });

  replace(root(), shell.root);
  registerRoutes(shell.router);
  await shell.router.start();

  // Everything above is on screen before anything below touches the network.
  if (isConfigured()) {
    auth.getToken()
      .then((token) => (token ? sync.run() : null))
      .catch(() => {});
    sync.schedule({ everyMinutes: config().autoSyncMinutes });
  }

  // Catch-up work: recurring payments moved on, repeating tasks recreated,
  // reminders delivered. Idempotent within a day, so a launch loop is safe.
  const { runAutomations } = await import('./domain/automation.js');
  runAutomations(db).catch((err) => console.warn('automations failed', err));

  bus.emit(TOPIC.authState, { signedIn: auth.isSignedIn });
}

/* ------------------------------------------------------------ google entry */

/* ----------------------------------------------------------------- routing */

function registerRoutes(router) {
  // Modules with their own screens; everything else is the generic one, which
  // is the whole point of the schema being the program.
  const custom = {
    dashboard: () => import('./modules/dashboard.js'),
    documents: () => import('./modules/documents.js'),
    family: () => import('./modules/family.js'),
    identity: () => import('./modules/identity.js'),
    calendar: () => import('./modules/calendar.js'),
    finance: () => import('./modules/finance.js'),
    investments: () => import('./modules/investments.js'),
    reports: () => import('./modules/reports.js'),
    settings: () => import('./modules/settings.js'),
    assistant: () => import('./modules/assistant-screen.js'),
  };

  for (const mod of modules) {
    router.register(mod.id, custom[mod.id] ?? (() => import('./modules/crud.js')));
  }
  router.register('assistant', custom.assistant);
  router.fallback(() => import('./modules/crud.js'));
}

/* ------------------------------------------------------------------ actor */

/**
 * Who is using this device. On a fresh install there is nobody yet, so the
 * first unlock creates the owner — a family that has to fill in a form before
 * seeing anything has already been asked too much.
 */
async function resolveActor(db) {
  const stored = await db.meta('auth.currentPerson');
  db.setActor({ personId: stored ?? '', role: 'owner' });

  const people = await db.repo('person').list({ limit: 50 });
  if (stored) {
    const person = people.find((p) => p.id === stored);
    if (person) return { personId: person.id, role: person.role || 'owner', name: person.name };
  }

  if (people.length) {
    const owner = people.find((p) => p.role === 'owner') ?? people[0];
    await db.setMeta('auth.currentPerson', owner.id);
    return { personId: owner.id, role: owner.role || 'owner', name: owner.name };
  }

  const created = await db.repo('person').create({
    name: 'You', role: 'owner', relationship: 'self',
  });
  await db.setMeta('auth.currentPerson', created.id);
  return { personId: created.id, role: 'owner', name: created.name };
}

/* ------------------------------------------------------------------- lock */

function relock(db) {
  db.keyring.lock();
  db.logAudit(ACTIONS.lock, {}).catch(() => {});
  globalThis.location.reload();
}

/* ----------------------------------------------------------------- search */

let searchTimer = null;

function quickSearch(db, term, results) {
  clearTimeout(searchTimer);
  if (term.trim().length < 2) {
    results.hidden = true;
    return;
  }
  // Debounced: a search per keystroke over an index of tens of thousands of
  // prefixes is work nobody sees the result of.
  searchTimer = setTimeout(async () => {
    try {
      const hits = await db.search(term, { limit: 12 });
      replace(results, hits.length
        ? hits.map((hit) => h('a', {
          class: 'list-item',
          href: `#/${hit.module}/${hit.entity}/${hit.recordId}`,
          role: 'option',
        }, [
          h('div', { class: 'list-item-body' }, [
            h('div', { class: 'list-item-title' }, hit.title || '(untitled)'),
            h('div', { class: 'list-item-subtitle' }, `${hit.module} · ${hit.subtitle || hit.entity}`),
          ]),
        ]))
        : h('div', { class: 'list-item muted' }, `Nothing matching “${term}”`));
      results.hidden = false;
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }, 180);
}

/* -------------------------------------------------------- service worker */

function registerServiceWorker() {
  // A worker has to be its own file at its own URL — that is the mechanism —
  // so the single-file build cannot have one and says so rather than asking
  // for a `sw.js` that is not there and logging a 404 about it.
  if (globalThis.__FAMILYOS_SINGLE_FILE__) return;
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((registration) => {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        // Only offer the reload when there was already a controller — on a
        // first install this fires for the initial worker and a "new version"
        // prompt would be nonsense.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of FamilyOS is ready.', {
            ms: 0,
            action: { label: 'Reload', onClick: () => globalThis.location.reload() },
          });
        }
      });
    });
  }).catch(() => {
    // No service worker means no offline shell, but the app still runs from
    // the network and IndexedDB still works.
  });
}

if (typeof document !== 'undefined') {
  boot().catch((err) => {
    console.error('boot failed', err);
    replace(root(), h('div', { class: 'lock-screen' }, h('div', { class: 'lock-card' }, [
      h('h1', { style: { fontSize: 'var(--text-xl)' } }, 'FamilyOS could not start'),
      h('p', { class: 'small muted' }, userMessage(err)),
      h('p', { class: 'small faint mono' }, err.message),
      h('button', {
        class: 'btn btn--primary',
        onClick: () => globalThis.location.reload(),
      }, 'Try again'),
    ])));
  });
}
