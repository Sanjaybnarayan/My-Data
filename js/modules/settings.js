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
import { pageHeader, chip } from '../ui/components/basics.js';
import { t } from '../core/locale.js';
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
  privacyCard, consentCard, permissionsCard, notificationsCard, originCard,
} from './settings/privacy.js';
import { householdCard, devicesCard } from './settings/household.js';
import { securityCard } from './settings/security.js';
import { appearanceCard, languageCard, aboutCard } from './settings/display.js';
import { dataCard, backupCard, deletedCard, conflictsCard, exampleCard } from './settings/data.js';
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

  /*
   * Grouped on the screen, not only in the source tree.
   *
   * The note at the top of this file says the cards live in
   * `js/modules/settings/` "grouped by the question somebody came to this
   * screen to ask". That was true of the *files* and had never been true of
   * the screen, which was one flat grid: measured on a 390×844 phone, 19
   * cards, 6,905px — **8.2 screens of scrolling** with nothing to navigate by.
   *
   * So the grouping the file already claimed is now the thing a person sees.
   * Nothing is removed and nothing is hidden: every card is where it was, in a
   * named section.
   *
   * The order keeps the reasoning that was already here. `privacyCard` says it
   * is first "because it is the question people actually have", so the group
   * it leads is first too.
   */
  const cards = {
    privacy: privacyCard(db, repaint),
    consent: consentCard(db, repaint, consent),
    google: googleCard(auth, sync, status),
    scopes: permissionsCard(),
    origin: originCard(),
    // Repainted after the prompt so the badge shows what was actually
    // answered rather than what was asked.
    notifications: notificationsCard(repaint),
    household: householdCard(),
    devices: devicesCard(),
    sync: syncCard(db, sync, status),
    security: securityCard(db, methods, repaint),
    appearance: appearanceCard(),
    language: languageCard(),
    data: dataCard(db, stats, usage),
    backup: await backupCard(db, repaint),
    deleted: deletedCard(db),
    conflicts: conflictsCard(db),
    example: await exampleCard(db, repaint),
    connections: connectionsCard(needing),
    activity: activityCard(activity, people, db),
    diagnostics: diagnosticsCard(diagnostics),
    breach: breachCard(breach),
    about: aboutCard(),
  };

  /** @type {[string, string[]][]} */
  const groups = [
    ['settings.group.data', ['privacy', 'data', 'backup', 'deleted', 'conflicts', 'example']],
    ['settings.group.device', ['appearance', 'language', 'security', 'notifications']],
    ['settings.group.agreed', ['consent', 'household', 'devices']],
    ['settings.group.connections', ['google', 'origin', 'sync', 'connections', 'scopes']],
    ['settings.group.wrong', ['activity', 'diagnostics', 'breach']],
    ['settings.group.about', ['about']],
  ];

  const drawn = groups
    .map(([title, names]) => ({ title, inside: names.map((name) => cards[name]).filter(Boolean) }))
    // A card can decline to render — `connectionsCard` draws nothing when no
    // connector needs attention — so a group with nothing in it is not drawn
    // either, rather than leaving a heading over empty space.
    .filter(({ inside }) => inside.length);

  /*
   * A jump row, because named sections are not the same as navigable ones.
   *
   * Buttons rather than anchors, and this is not a style preference: the
   * application routes on the hash, so an `href="#connections"` would be read
   * as a route and take somebody off this screen entirely.
   */
  const sections = new Map(drawn.map(({ title }) => [title, h('div', {})]));

  replace(host, [
    pageHeader('Settings', { subtitle: `Device ${db.deviceId.slice(0, 12)}…` }),

    drawn.length > 1
      ? h('div', { class: 'chip-row settings-jump', role: 'group', 'aria-label': 'Settings sections' }, drawn.map(({ title }) => chip(t(title), {
        onClick: () => sections.get(title)?.scrollIntoView({ block: 'start' }),
      })))
      : null,

    ...drawn.map(({ title, inside }) => {
      const anchor = sections.get(title);
      return h('section', { class: 'settings-group' }, [
        anchor,
        h('h2', { class: 'settings-group-title' }, t(title)),
        h('div', { class: 'grid grid--wide' }, inside),
      ]);
    }),
  ].filter(Boolean));
}
