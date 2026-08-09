/**
 * Service worker.
 *
 * Two jobs, and it refuses the third:
 *
 *  1. **Serve the shell offline.** Everything needed to open the app — HTML,
 *     CSS, every module — is precached on install. Opening FamilyOS on a plane
 *     is the same as opening it at home.
 *  2. **Update without surprising anyone.** A new worker installs in the
 *     background and waits. The page offers a reload; it never swaps the code
 *     under a half-filled form.
 *
 * What it does *not* do is cache API responses. Household data lives in
 * IndexedDB, where the application controls decryption, permissions and
 * conflict resolution. A copy of the same rows in the HTTP cache would be a
 * second source of truth, unencrypted, that nothing in the app knows how to
 * invalidate.
 */

const VERSION = 'familyos-v4';
const SHELL_CACHE = `${VERSION}-shell`;

/**
 * Precached explicitly rather than discovered, because a module map that
 * drifts is an app that works until the one screen nobody opened offline.
 * Keep this in step with the imports in `js/app.js`.
 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './oauth-callback.html',
  './assets/icon.svg',

  './css/tokens.css',
  './css/base.css',
  './css/components.css',

  './js/app.js',
  './js/context.js',

  './js/core/bus.js',
  './js/core/config.js',
  './js/core/dates.js',
  './js/core/errors.js',
  './js/core/ids.js',
  './js/core/money.js',

  './js/data/audit.js',
  './js/data/database.js',
  './js/data/formats.js',
  './js/data/idb.js',
  './js/data/migrations.js',
  './js/data/pdf-read.js',
  './js/data/repository.js',
  './js/data/schema.js',
  './js/data/search.js',
  './js/data/storage.js',
  './js/data/validate.js',

  './js/security/crypto.js',
  './js/security/fieldcrypto.js',
  './js/security/keyring.js',
  './js/security/rbac.js',
  './js/security/sanitize.js',
  './js/security/session.js',

  './js/sync/conflict.js',
  './js/sync/engine.js',
  './js/sync/outbox.js',
  './js/sync/transport.js',
  './js/sync/drive.js',

  './js/auth/biometric.js',
  './js/auth/google.js',
  './js/auth/lock.js',

  './js/domain/automation.js',
  './js/domain/extract.js',
  './js/domain/filing.js',
  './js/domain/categorise.js',
  './js/domain/finance.js',
  './js/domain/import.js',
  './js/domain/inbox.js',
  './js/domain/mailboxes.js',
  './js/domain/merchants.js',
  './js/domain/networth.js',
  './js/domain/portfolio.js',
  './js/domain/reminders.js',
  './js/domain/statement.js',
  './js/domain/tree.js',

  './js/ui/dom.js',
  './js/ui/icons.js',
  './js/ui/router.js',
  './js/ui/shell.js',
  './js/ui/theme.js',
  './js/ui/components/basics.js',
  './js/ui/components/charts.js',
  './js/ui/components/form.js',
  './js/ui/components/modal.js',
  './js/ui/components/table.js',
  './js/ui/components/toast.js',

  './js/modules/assistant-screen.js',
  './js/modules/calendar.js',
  './js/modules/crud.js',
  './js/modules/documents.js',
  './js/modules/family.js',
  './js/modules/dashboard.js',
  './js/modules/finance.js',
  './js/modules/investments.js',
  './js/modules/receipts.js',
  './js/modules/reports.js',
  './js/modules/settings.js',
  './js/modules/statements.js',

  './js/ai/assistant.js',
  './js/ai/intents.js',
  './js/ai/summary.js',

  './js/reports/csv.js',
  './js/reports/xlsx.js',
  './js/reports/pdf.js',
  './js/reports/build.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Added one at a time rather than `addAll`, which rejects the whole batch
    // if a single file 404s — one renamed module should not leave the app with
    // no offline shell at all.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] could not precache', url, err.message);
      }
    }));
    // No skipWaiting: the page decides when to take the update.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('familyos-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything not ours — Google's endpoints — goes straight to the network.
  // Caching an OAuth response or a Sheets write would be a security bug, not
  // a performance win.
  if (url.origin !== self.location.origin) return;

  // A navigation falls back to the cached shell, so a deep link opened
  // offline still boots into the app rather than the browser's error page.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('./index.html')) ?? Response.error();
      }
    })());
    return;
  }

  // Cache first for the shell: these are versioned by the cache name, so a
  // stale copy is impossible without an activate that cleared it.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return cached ?? new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});

/**
 * Background sync, where the browser supports it. The tag is registered by
 * the page when a write is queued with no network; the worker cannot run the
 * sync itself — it has no data key — so it wakes any open client instead.
 */
self.addEventListener('sync', (event) => {
  if (event.tag !== 'familyos-outbox') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'sync-now' });
  })());
});
