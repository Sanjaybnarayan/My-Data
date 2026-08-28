/**
 * Screen time, at last on a screen.
 *
 * ## The stack that was built and never drawn
 *
 * `android/.../ScreenTimePlugin.java`, `js/core/screentime.js` and
 * `js/services/screentime.js` all existed — a native plugin behind
 * `PACKAGE_USAGE_STATS`, a device layer, and a service that refuses to make
 * the call at all without a recorded consent decision. **Nothing imported the
 * service.** Grep for `ScreenTimeService` across `js/modules` and the answer
 * was nothing at all.
 *
 * That is this repository's most-repeated fault — the engine exists and no
 * screen calls it — and it is the same one that left `ChatService.send`,
 * `markVerified`, `revoke` and `withdraw` unreachable. So this screen adds no
 * capability. It draws one.
 *
 * ## Three states, kept apart on purpose
 *
 * `ScreenTimeService.readiness` separates what the *device* allows from what
 * *consent* allows, and the reason is in that file: collapsing them tells a
 * household "not available" when the truth is "you have not asked them yet",
 * which is a thing they can fix and should have to do deliberately.
 *
 * So this screen never says "unavailable". It says which of the three it is:
 * this build has no plugin, Android has not been granted usage access, or the
 * person whose phone it is has not been asked.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, badge, listItem, empty, button, pageHeader,
} from '../ui/components/basics.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { t } from '../core/locale.js';
import { ScreenTimeService } from '../services/screentime.js';
import { openSettings } from '../core/screentime.js';
import {
  summarise, saidAs, packageTail, whyBlocked, CANNOT_SHOW,
} from '../domain/wellbeing.js';

export async function render() {
  const host = h('div', {});
  const { db } = app();
  const service = new ScreenTimeService(db);

  async function paint() {
    const me = db.actor?.personId ?? '';
    const reading = await service.forPerson(me, { days: 7 });
    const week = summarise(reading.apps);

    replace(host, [
      pageHeader(t('wellbeing.title'), { subtitle: t('wellbeing.subtitle') }),

      reading.asked
        ? weekCard(week)
        : blockedCard(reading, paint),

      limitsCard(),
    ]);
  }

  await paint();
  return { node: host };
}

/** The reading, when there is one. */
function weekCard(week) {
  const total = saidAs(week.total);

  if (!week.total) {
    return card({}, empty({
      title: t('wellbeing.none.title'),
      message: t('wellbeing.none.message'),
      iconName: 'phone',
    }));
  }

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(
      t('wellbeing.week.title'),
      badge(t('wellbeing.hoursMinutes', { hours: total.hours, minutes: total.minutes }), 'accent'),
      { iconName: 'phone' },
    )),

    h('p', { class: ['small', 'muted', 'attention-head'] }, t('wellbeing.week.window')),

    h('div', { class: 'list' }, week.apps.map((one) => {
      const said = saidAs(one.minutes);
      const percent = Math.round(one.share * 100);
      return listItem({
        // The package's last segment, not an invented friendly name. See
        // `packageTail` for why guessing one would be worse than this.
        title: packageTail(one.app),
        subtitle: one.app,
        /*
         * A plain bar, not `progress`.
         *
         * That component paints a high ratio as warning and a full one as
         * danger, because it was built for a budget — where reaching the
         * limit is the bad outcome. A share of screen time is not a budget,
         * and colouring somebody's most-used application red would be this
         * screen deciding that using it a lot is a problem. It does not know
         * that, and it is not this application's place to imply it.
         *
         * The figure is beside the bar, so the length is never the only
         * signal.
         */
        trailing: h('div', { class: 'wellbeing-share' }, [
          h('span', { class: ['small', 'numeric'] },
            t('wellbeing.hoursMinutes', { hours: said.hours, minutes: said.minutes })),
          h('div', {
            class: 'wellbeing-bar',
            role: 'img',
            'aria-label': t('wellbeing.shareOf', { app: packageTail(one.app), percent }),
          }, h('span', { style: { width: `${percent}%` } })),
        ]),
      });
    })),

    h('p', { class: ['small', 'faint', 'attention-foot'] }, t('wellbeing.appName')),

    week.hidden
      ? h('p', { class: ['small', 'faint', 'attention-foot'] },
        t('wellbeing.week.more', { n: week.hidden }))
      : null,
  ].filter(Boolean));
}

/**
 * Why there is no reading, said as the specific one it is.
 *
 * Never "unavailable". `whyBlocked` names the case and says which control is
 * honest to offer for it, so this function chooses no cause of its own.
 */
function blockedCard(reading, repaint) {
  const why = whyBlocked(reading.state);

  return card({ class: 'card--quiet' }, [
    cardHeader(t('wellbeing.blocked.title'), badge(t('wellbeing.blocked.badge'), 'muted'),
      { iconName: 'phone' }),

    h('p', { class: 'small' }, t(why.key)),

    why.settings
      /*
       * Usage access has no prompt. `requestPermissions` for
       * `PACKAGE_USAGE_STATS` returns denied without showing anything, so the
       * only honest control is one that opens the settings page — which is
       * what `openSettings` does and why there is no "Allow" button here.
       */
      ? h('div', { class: 'stack stack--tight' }, [
        h('p', { class: ['small', 'muted'] }, t('wellbeing.blocked.noPrompt')),
        button(t('wellbeing.blocked.open'), {
          variant: 'primary',
          onClick: async () => { await openSettings(); await repaint(); },
        }),
      ])
      : null,

    // Consent lives on the settings screen, where every other purpose does.
    why.consent
      ? h('a', { class: ['btn', 'btn--subtle', 'btn--small'], href: Router.href({ module: 'settings' }) },
        t('wellbeing.blocked.consent'))
      : null,
  ].filter(Boolean));
}

/**
 * What a phone's own wellbeing page shows and this one cannot.
 *
 * On the screen rather than only in a comment: somebody comparing the two is
 * entitled to know which absences are deliberate rather than broken.
 */
function limitsCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader(t('wellbeing.absent.title'), null, { iconName: 'info' }),
    h('div', { class: 'stack stack--tight' },
      CANNOT_SHOW.map((key) => h('p', { class: ['small', 'muted'] }, t(key)))),
  ]);
}
