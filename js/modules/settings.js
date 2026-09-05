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
import { Router } from '../ui/router.js';
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


/**
 * The groups, in the order they are shown.
 *
 * Each is a route of its own — `#/settings/device` — so a particular setting
 * can be linked to, and so only one group's worth of work is ever done.
 */
const GROUPS = [
  { id: 'data', title: 'settings.group.data' },
  { id: 'device', title: 'settings.group.device' },
  { id: 'agreed', title: 'settings.group.agreed' },
  { id: 'connections', title: 'settings.group.connections' },
  { id: 'wrong', title: 'settings.group.wrong' },
  { id: 'about', title: 'settings.group.about' },
];

export async function render(route = {}) {
  const host = h('div', {});
  const open = GROUPS.some((one) => one.id === route.entity) ? route.entity : GROUPS[0].id;
  await paint(host, open);
  const off = bus.on(TOPIC.syncState, () => paint(host, open));
  return { node: host, destroy: off };
}

/*
 * One group's worth of work, not all six.
 *
 * This gathered everything before drawing anything: the sync status, the
 * database statistics and disk usage, twelve activity rows, a hundred
 * diagnostics, the connectors needing attention, the breach readiness, the
 * keyring methods, every person, and a full consent report — which itself
 * reads the mailboxes and the people records are held *about*. Twelve awaited
 * reads, on every visit, whichever group somebody came for.
 *
 * Measured against every other screen in the application: Settings took 392ms
 * to settle and 615 nodes, where the median screen is 73ms and about a
 * hundred. The next slowest was 90ms. It was the slowest, the tallest at
 * 10,623px, and the largest, all at once.
 *
 * So each group says what it needs and nothing else is fetched. `about` needs
 * nothing at all and now does nothing at all.
 *
 * The note further up this file records the previous repair — the cards were
 * one flat grid of 19 at 6,905px, and grouping them was that fix. Grouping
 * gave the screen headings to navigate by but nothing to bound it, and it grew
 * to 21 cards and 10,623px afterwards. Headings are not a limit.
 */
const CONTENTS = {
  async data(db, repaint) {
    const [stats, usage] = await Promise.all([db.statistics(), db.adapter.usage?.()]);
    return [
      privacyCard(db, repaint),
      dataCard(db, stats, usage),
      await backupCard(db, repaint),
      deletedCard(db),
      conflictsCard(db),
      await exampleCard(db, repaint),
    ];
  },

  async device(db, repaint) {
    const methods = await db.keyring.methods();
    return [
      appearanceCard(),
      languageCard(),
      securityCard(db, methods, repaint),
      notificationsCard(repaint),
    ];
  },

  async agreed(db, repaint) {
    const methods = await db.keyring.methods();
    const consent = await consentReport(db, {
      localOnly: config().localOnly,
      configured: isConfigured(),
      escrowed: methods.some((m) => m.method === GOOGLE_METHOD),
      // Addresses, because consent to read one mailbox is not consent to read
      // another and the record has to name which.
      mailboxes: ((await db.meta(MAILBOXES_KEY, [])) ?? [])
        .map(readMailbox).filter(Boolean).map((m) => m.email).filter(Boolean),
      // The people the household holds records *about* rather than records
      // *for*. An empty list is the honest answer for a household with
      // neither, and produces no rows rather than a purpose nobody owes.
      people: await peopleWithRecordsAbout(db),
    });
    return [consentCard(db, repaint, consent), householdCard(), devicesCard()];
  },

  async connections(db, repaint, { sync, auth }) {
    const [status, needing] = await Promise.all([
      sync.status(), connectorsNeedingAttention(db),
    ]);
    return [
      googleCard(auth, sync, status),
      originCard(),
      syncCard(db, sync, status),
      connectionsCard(needing),
      permissionsCard(),
    ];
  },

  async wrong(db) {
    const [activity, diagnostics, breach, rows] = await Promise.all([
      recentActivity(db.adapter, { limit: 12 }),
      recentDiagnostics(db.adapter, { limit: 100 }),
      readinessFor(db),
      db.repo('person').list({ decrypt: false }),
    ]);
    const people = Object.fromEntries(rows.map((one) => [one.id, one.name]));
    return [activityCard(activity, people, db), diagnosticsCard(diagnostics), breachCard(breach)];
  },

  async about() {
    return [aboutCard()];
  },
};

async function paint(host, open) {
  const { db, sync, auth } = app();

  // Handed to every card that can change something and needs the screen to
  // catch up. It used to be `host` — the cards reached back into this module
  // for `paint` — which is exactly the coupling that made one file of all of
  // them. A callback says what a card is allowed to do: ask for a repaint,
  // not know how one happens. It keeps the open group, or changing a setting
  // would take you back to the first one.
  const repaint = () => paint(host, open);

  const inside = (await CONTENTS[open](db, repaint, { sync, auth })).filter(Boolean);

  /*
   * A row of the six, and this one navigates.
   *
   * It used to scroll: buttons calling `scrollIntoView`, deliberately not
   * anchors, because `href="#connections"` would have been read as a route and
   * taken somebody off the screen. The groups *are* routes now, so an anchor
   * is exactly right and the reason for the buttons has gone with the change
   * that made it true.
   */
  replace(host, [
    // `Settings`, not the group's name. The group is named by the chip that
    // marks it below, and putting it here instead took the word "Settings"
    // off the screen entirely — a person who lands on `#/settings/device`
    // from a link would have had nothing telling them where they were.
    pageHeader('Settings', { subtitle: `Device ${db.deviceId.slice(0, 12)}…` }),

    h('div', {
      class: 'chip-row chip-row--scroll settings-jump',
      role: 'group',
      'aria-label': 'Settings sections',
    }, GROUPS.map((one) => h('a', {
      class: 'chip',
      href: Router.href({ module: 'settings', entity: one.id }),
      ...(one.id === open ? { 'aria-current': 'page' } : {}),
    }, t(one.title)))),

    h('div', { class: 'grid grid--wide' }, inside),
  ]);
}
