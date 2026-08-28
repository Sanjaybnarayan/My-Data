/**
 * Profile — who you are, and the controls that belong to you.
 *
 * ## Assembly, not new logic
 *
 * `domain/profile.js` already defines sixteen sections spanning basics,
 * contact, identity, KYC, documents, accounts, loans, investments, insurance,
 * health, vehicles, property, education, employment, digital life and
 * emergency, and scores completion against them. `IdentityService.profiles()`
 * already computes it per person and for the household. Both are tested.
 *
 * What did not exist was a screen. Nothing here recomputes a percentage.
 *
 * ## Every figure is real or absent
 *
 * The completion figure is the one the domain calculates. Where a section
 * cannot be counted — because this person's role cannot read those records —
 * `describeCompletion` says what it is waiting on rather than quietly counting
 * it as missing. A profile with nothing recorded shows no percentage at all,
 * because `completion` returns `null` for it and a `0%` would be a claim about
 * a person rather than about the records.
 *
 * There is no "✓ Verified" badge. Nothing in this application verifies an
 * identity against an issuing authority — there is no CKYCRR, DigiLocker or
 * ABDM integration — so a tick claiming verification would be inventing one.
 * What is shown instead is what is actually known: how much has been recorded.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, badge, listItem, avatar, metric, empty, pageHeader,
} from '../ui/components/basics.js';
import { Router } from '../ui/router.js';
import { app } from '../context.js';
import { IdentityService } from '../services/identity.js';
import { describeCompletion } from '../domain/profile.js';
import { visibleModules } from '../security/rbac.js';
import { signInCard } from './signin.js';
import { PRIMARY } from '../ui/shell.js';
import { modules } from '../data/schema.js';
import { moduleLabel } from '../core/labels.js';
import { t } from '../core/locale.js';
import { lockNow } from '../auth/lock.js';

/**
 * The control centre, grouped.
 *
 * Every destination is an existing route. This screen adds no capability; it
 * gathers what was previously reachable only through a drawer of twenty-three
 * entries, which is the thing the design brief is actually complaining about.
 *
 * ## The order is a judgement; the completeness is not
 *
 * These four groups are editorial — *yours*, *what you own*, *your life*,
 * *what is on record* is a decision about how a household thinks, and no
 * derivation produces it. But a list of twenty module ids beside a schema that
 * declares twenty-five is the fault this repository has now found eleven
 * times, and here it would be a module nobody could reach: the brief allows no
 * sixth tab, so a module that is neither primary nor named below is reachable
 * only by typing its URL.
 *
 * So `grouped()` derives the last group. Anything in the schema that is not
 * one of the five tabs and not named above falls into *everything else* —
 * unsorted and unloved, but present, and visibly wanting a home rather than
 * silently gone.
 */
const GROUPS = Object.freeze([
  { title: 'profile.group.you', items: ['identity', 'family', 'documents', 'vault'] },
  {
    title: 'profile.group.owned',
    items: ['finance', 'investments', 'property', 'vehicles', 'belongings', 'insurance'],
  },
  { title: 'profile.group.life', items: ['health', 'education', 'travel', 'calendar', 'tasks', 'notes'] },
  { title: 'profile.group.records', items: ['safety', 'emergency', 'digital', 'reports'] },
]);

/** Reached from Profile some other way than a group row. */
const ELSEWHERE = Object.freeze(['settings']);

/**
 * The four groups, plus whatever the schema has that none of them claims.
 *
 * @param {readonly {id: string}[]} schema every module the application declares
 * @param {readonly string[]} primary the bottom-tab ids
 */
export function grouped(schema = modules, primary = PRIMARY) {
  const claimed = new Set([...GROUPS.flatMap((one) => one.items), ...primary, ...ELSEWHERE]);
  const rest = schema.map((one) => one.id).filter((id) => !claimed.has(id));

  return rest.length
    ? [...GROUPS, { title: 'profile.group.rest', items: rest }]
    : [...GROUPS];
}

export async function render() {
  const host = h('div', {});
  const { db } = app();
  const actor = db.actor;

  const { people, family } = await new IdentityService(db).profiles();

  // The signed-in person's own row, where the household has one for them.
  const mine = people.find((row) => row.person.id === actor?.personId)
    ?? people.find((row) => row.person.name === actor?.name)
    ?? null;

  const allowed = new Set(visibleModules(actor, modules).map((one) => one.id));

  replace(host, [
    pageHeader(t('profile.title'), { subtitle: t('profile.subtitle') }),
    headerCard(actor, mine),
    signInCard(() => {
      // A confirmed person changes who the whole shell thinks is here, and
      // half this screen is drawn from that. Reloading is blunt and it is
      // also correct: `resolveActor` runs at boot, so repainting one card
      // would leave the rest of the application disagreeing with it.
      globalThis.location?.reload();
    }),
    householdCard(family, people.length),
    ...grouped().map((group) => groupCard(group, allowed)),
    deviceCard(),
    settingsCard(allowed),
    lockCard(),
  ]);

  return { node: host };
}

function headerCard(actor, mine) {
  const name = mine?.person?.name ?? actor?.name ?? 'You';
  const percent = mine?.percent ?? null;

  return card({ class: 'profile-header' }, [
    h('div', { class: 'profile-header-row' }, [
      avatar(name, { size: 'lg' }),
      h('div', { class: 'spacer' }, [
        h('h2', { class: 'profile-name' }, name),
        h('p', { class: 'small muted profile-role' },
          actor?.role ? t('profile.signedInAs', { role: actor.role }) : t('profile.signedIn')),
      ]),
    ]),

    mine
      /*
       * `profile-summary`, not `profile-completion`. That name was already in
       * use by `js/modules/identity.js` — unstyled, which is why it looked
       * free. Styling it here silently made a card on the Identity screen a
       * flex container and pushed that page 1193px wide on a 390px phone.
       *
       * A class name used somewhere and styled nowhere is not an unused name;
       * it is a name with an owner who has not written the rule yet.
       */
      ? h('div', { class: 'profile-summary' }, [
        // `null` means nothing applies yet, which is not the same as nought,
        // and `describeCompletion` already draws that distinction.
        /*
         * Not `progress()`. That component paints a full bar as danger,
         * because it was built for a budget — where reaching the limit is the
         * bad outcome. Completion is the opposite: full is the good end, and a
         * red bar at 100% would say the wrong thing about somebody's record.
         */
        percent === null
          ? h('p', { class: 'small muted' }, describeCompletion(mine))
          : h('div', {}, [
            metric({
              label: t('profile.recorded'),
              value: `${percent}%`,
              hint: describeCompletion(mine),
              compact: true,
            }),
          ]),
        h('a', {
          class: 'btn btn--subtle btn--small',
          href: Router.href({ module: 'identity', entity: 'person', id: mine.person.id }),
        }, t('profile.openRecord')),
      ])
      : h('p', { class: 'small muted' }, t('profile.noPerson')),
  ]);
}

function householdCard(family, count) {
  if (!count) {
    return card({}, empty({
      title: t('profile.empty.title'),
      message: t('profile.empty.message'),
      iconName: 'family',
    }));
  }

  return card({}, [
    cardHeader(t('profile.household'),
      badge(count === 1 ? t('profile.person') : t('profile.people', { n: count })),
      { iconName: 'family' }),
    /*
     * Not `describeCompletion`. That takes a *person's* result — it reads
     * `recorded`, `applicable`, `dismissed` and `waitingOn`, none of which
     * `familyCompletion` returns. Handing it the household's figure threw on
     * `waitingOn.length` and took the whole screen down, which is what the
     * browser suite caught the first time this screen was opened.
     */
    family && family.percent !== null
      ? metric({
        label: t('profile.recordedAcross'),
        value: `${family.percent}%`,
        hint: family.scored === family.people
          ? t('profile.averagedAll', { n: family.people })
          : t('profile.averagedSome', { scored: family.scored, n: family.people }),
        compact: true,
      })
      : h('p', { class: 'small muted', style: { marginBottom: 0 } },
        t('profile.notEnough')),
    h('a', {
      class: 'btn btn--subtle btn--small',
      href: Router.href({ module: 'family' }),
    }, t('profile.openFamily')),
  ]);
}

function groupCard(group, allowed) {
  // A module this person may not open is not shown at all, rather than shown
  // and refused after the tap.
  const items = group.items.filter((id) => allowed.has(id));
  if (!items.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'profile-group-head' }, cardHeader(t(group.title))),
    h('div', { class: 'list' }, items.map((id) => {
      const mod = modules.find((one) => one.id === id);
      return listItem({
        title: moduleLabel(mod),
        href: Router.href({ module: id }),
      });
    })),
  ]);
}

/**
 * About this phone rather than about the household's records.
 *
 * Separate from the settings card on purpose: that one is gated on being
 * allowed to open Settings, and screen time is a reading of the device in
 * somebody's hand. A member who may not change household settings is still
 * the person whose phone this is.
 */
function deviceCard() {
  return card({ class: 'card--flush' }, [
    h('div', { class: 'profile-group-head' }, cardHeader(t('profile.device.title'))),
    h('div', { class: 'list' }, [
      listItem({
        title: t('profile.wellbeing'),
        subtitle: t('profile.wellbeingHint'),
        href: Router.href({ module: 'wellbeing' }),
      }),
    ]),
  ]);
}

/**
 * Lock, last on the screen.
 *
 * It was an icon in the header for one release, put there because taking the
 * drawer away had otherwise left Profile → Settings → Security as the only
 * route — four taps for the control somebody reaches for while handing over
 * the phone. On a device the icon read as clutter beside sync and theme, so
 * it lives here instead: two taps, a word rather than a glyph, and at the
 * bottom where a thing you do on the way out belongs.
 *
 * Settings → Security keeps its own button. Both call `lockNow`, so both now
 * write the audit entry that only one of them used to.
 */
function lockCard() {
  return card({ class: 'card--flush' }, [
    h('div', { class: 'list' }, [
      listItem({
        title: t('profile.lockNow'),
        subtitle: t('profile.lockNowHint'),
        onClick: () => lockNow(app().db),
      }),
    ]),
  ]);
}

function settingsCard(allowed) {
  if (!allowed.has('settings')) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'profile-group-head' }, cardHeader(t('profile.settings'))),
    h('div', { class: 'list' }, [
      listItem({
        title: t('profile.settings'),
        subtitle: t('profile.settingsHint'),
        href: Router.href({ module: 'settings' }),
      }),
    ]),
  ]);
}
