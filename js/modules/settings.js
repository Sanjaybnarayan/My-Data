/**
 * Settings.
 *
 * The screen where the honest things live: what is queued and not yet synced,
 * what failed and why, whether the backup has been verified, what a deletion
 * left behind, and how to get every byte out. A settings screen that only
 * offers a theme toggle is hiding the parts that matter when something goes
 * wrong.
 *
 * ## Why the cards are not in this file
 *
 * They were, and the Phase 0 audit called this a **god component** at 1,597
 * lines. Nothing measured it afterwards, so it reached 1,894 — the named
 * problem grew by 297 lines while sitting on a risk register describing it.
 *
 * What is left here is the assembly: gather the facts once, hand them to the
 * cards, paint. The cards live in `js/modules/settings/`, grouped by the
 * question somebody came to this screen to ask rather than by the order they
 * happened to be written in. `tools/module-size.mjs` is the part that stops
 * this happening again, because a note in a document plainly did not.
 *
 * Every card is a function of the facts it is handed. `paint` is the only
 * place that gathers, which is what makes one repaint enough after any change
 * — and which is why splitting the file moved no reads and left the
 * UI-to-database count where it was.
 */

import { h, replace } from '../ui/dom.js';
import { pageHeader } from '../ui/components/basics.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { config, isConfigured } from '../core/config.js';
import { recentActivity } from '../data/audit.js';
import { recent as recentDiagnostics } from '../data/diagnostics.js';
import { attention as connectorsNeedingAttention } from '../data/connectors.js';
import { readinessFor } from '../data/incident.js';
import { report as consentReport, peopleWithRecordsAbout } from '../data/consent.js';
import { MAILBOXES_KEY, readMailbox } from '../domain/mailboxes.js';
import { GOOGLE_METHOD } from '../auth/google-unlock.js';

import { googleCard, syncCard } from './settings/connection.js';
import {
  privacyCard, consentCard, permissionsCard, notificationsCard,
} from './settings/privacy.js';
import { householdCard, devicesCard } from './settings/household.js';
import { securityCard } from './settings/security.js';
import { appearanceCard, languageCard, aboutCard } from './settings/display.js';
import { dataCard, backupCard, deletedCard, conflictsCard } from './settings/data.js';
import { activityCard, connectionsCard, diagnosticsCard, breachCard } from './settings/activity.js';


export async function render() {
  const host = h('div', {});
  await paint(host);
  const off = bus.on(TOPIC.syncState, () => paint(host));
  return { node: host, destroy: off };
}

async function paint(host) {
  const { db, sync, auth } = app();

  // Handed to every card that can change something and needs the screen to
  // catch up. It used to be `host` — the cards reached back into this module
  // for `paint` — which is exactly the coupling that made one file of all of
  // them. A callback says what a card is allowed to do: ask for a repaint,
  // not know how one happens.
  const repaint = () => paint(host);
  const status = await sync.status();
  const stats = await db.statistics();
  const usage = await db.adapter.usage?.();
  const activity = await recentActivity(db.adapter, { limit: 12 });
  const diagnostics = await recentDiagnostics(db.adapter, { limit: 100 });
  const needing = await connectorsNeedingAttention(db);

  // Facts that already exist, gathered rather than invented.
  const breach = await readinessFor(db);
  const methods = await db.keyring.methods();
  const people = Object.fromEntries(
    (await db.repo('person').list({ decrypt: false })).map((p) => [p.id, p.name]),
  );
  const consent = await consentReport(db, {
    localOnly: config().localOnly,
    configured: isConfigured(),
    escrowed: methods.some((m) => m.method === GOOGLE_METHOD),
    // Addresses, because consent to read one mailbox is not consent to read
    // another and the record has to name which.
    mailboxes: ((await db.meta(MAILBOXES_KEY, [])) ?? [])
      .map(readMailbox).filter(Boolean).map((m) => m.email).filter(Boolean),
    // The people the household holds records *about* rather than records
    // *for*. An empty list is the honest answer for a household with neither,
    // and produces no rows rather than a purpose nobody owes.
    people: await peopleWithRecordsAbout(db),
  });

  replace(host, [
    pageHeader('Settings', { subtitle: `Device ${db.deviceId.slice(0, 12)}…` }),

    h('div', { class: 'grid grid--wide' }, [
      privacyCard(db, repaint),
      consentCard(db, repaint, consent),
      googleCard(auth, sync, status),
      permissionsCard(),
      // Placed beside the other permissions, and repainted after the prompt so
      // the badge shows what was actually answered rather than what was asked.
      notificationsCard(repaint),
      householdCard(),
      devicesCard(),
      syncCard(db, sync, status),
      securityCard(db, methods, repaint),
      appearanceCard(),
      languageCard(),
      dataCard(db, stats, usage),
      await backupCard(db, repaint),
      deletedCard(db),
      conflictsCard(db),
      connectionsCard(needing),
      activityCard(activity, people, db),
      diagnosticsCard(diagnostics),
      breachCard(breach),
      aboutCard(),
    ]),
  ]);
}
