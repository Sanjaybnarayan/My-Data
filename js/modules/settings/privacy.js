/**
 * Settings: where the data is, who has agreed to it being held, and what
 * this device has been given permission to do.
 */

import { card, cardHeader, button, badge, listItem, metric } from '../../ui/components/basics.js';
import { config, isConfigured, setLocalOnly } from '../../core/config.js';
import { confirm } from '../../ui/components/modal.js';
import { consentScreen } from '../../core/scopes.js';
import { formatInstant } from '../../core/dates.js';
import { h, replace } from '../../ui/dom.js';
import { privacyReport, whereData } from '../../domain/privacy.js';
import { record, PURPOSES, DECISIONS } from '../../data/consent.js';
import { redirectUriFor as redirectUri } from '../../auth/google.js';
import { toast } from '../../ui/components/toast.js';
import { t } from '../../core/locale.js';

/* --------------------------------------------------------------- privacy */

/**
 * Where the data is, what is sealed, and the switch that stops it moving.
 *
 * Put first because it is the question people actually have, and answered by
 * counting the schema rather than by asserting anything. "Encrypted on the
 * device" is true of the fields marked sensitive and not of the rest, and a
 * household is entitled to see which is which before deciding what to type in.
 */
export function privacyCard(db, repaint) {
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
    await repaint();
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

/* ------------------------------------------------------------------ consent */

/**
 * What is happening to a household's data, and whether anybody agreed to it.
 *
 * This card is not only a display. It **is** the moment of asking, and until it
 * existed there was none: keeping a copy of every record in a spreadsheet — the
 * most consequential thing this application does — followed from a deployment
 * being configured, and nobody was ever put the question.
 *
 * So the important control here is the pair of buttons on a purpose nobody has
 * answered. Pressing one writes a record; pressing the other writes a record
 * *and* stops the thing. An unanswered purpose is left running, deliberately —
 * a household already syncing has no record because there was nothing to record
 * with, and stopping their backup over a question nobody put to them would be
 * a data-loss bug wearing a privacy costume.
 */
export function consentCard(db, repaint, consent) {
  const gaps = consent.gaps.length;

  async function decide(row, decision) {
    await record(db, {
      purpose: row.purpose,
      decision,
      subject: row.subject,
      deviceId: db.deviceId,
    });
    toast(decision === DECISIONS.GRANTED
      ? 'Agreed, and recorded'
      : `Stopped. ${PURPOSES[row.purpose].without}`, { kind: 'success' });
    await repaint();
  }

  const line = (row) => {
    const purpose = PURPOSES[row.purpose];

    // Nothing leaves the device, so there is nothing to agree to. Offering
    // Agree and No here would be a decision that changes nothing — the kind
    // of control that teaches people the rest of the list is theatre too.
    const answerable = !purpose.localOnly;

    return listItem({
      title: purpose.title + (row.subject ? ` — ${row.subject}` : ''),
      subtitle: [
        purpose.what,
        !answerable
          ? 'Nothing to agree to — this never leaves the device.'
          : row.decision === DECISIONS.UNRECORDED
            ? (row.neverAsked
              // Distinct from an unanswered prompt, and worth the extra words:
              // it means the application never asked, not that somebody
              // skipped past a question.
              ? 'You have never been asked about this.'
              : 'Not recorded on this device.')
            : `${row.decision} ${row.at ? formatInstant(row.at) : ''}`,
        `Seen by: ${row.processors.map((p) => p.name).join(', ') || 'nobody but you'}`,
      ].join(' · '),
      leading: badge(
        row.active ? 'on' : 'off',
        answerable && row.active && row.decision !== DECISIONS.GRANTED ? 'warning' : '',
      ),
      trailing: answerable
        ? h('div', { class: 'row' }, [
          row.decision === DECISIONS.GRANTED
            ? button('Stop', {
              variant: 'subtle',
              onClick: () => decide(row, DECISIONS.WITHDRAWN),
            })
            : button('Agree', {
              variant: 'subtle',
              onClick: () => decide(row, DECISIONS.GRANTED),
            }),
          row.decision === DECISIONS.UNRECORDED
            ? button('No', { variant: 'subtle', onClick: () => decide(row, DECISIONS.DENIED) })
            : null,
        ].filter(Boolean))
        : null,
    });
  };

  return card({}, [
    cardHeader('What you agreed to', [], {
      subtitle: gaps
        ? `${gaps} ${gaps === 1 ? 'thing is' : 'things are'} happening without a record`
        : 'Every active purpose has an answer',
      iconName: 'shield',
    }),

    h('p', { class: 'small muted' },
      'Records here are kept on this device only — they are not synced, so another '
      + 'device has its own. Nothing on this list is a legal assessment; it is a '
      + 'record of what was asked and answered.'),

    // Everything, not only what is switched on. Somebody reading a card called
    // "What you agreed to" wants the whole list of what this application can
    // do with their records — the on/off badge does the work of saying which
    // are happening now, and answering one in advance is a real thing to want.
    h('div', { class: 'list' }, consent.purposes.map(line)),

    h('details', { class: 'small' }, [
      h('summary', {}, 'Who else touches any of this'),
      h('div', { class: 'list' }, consent.processors.map((p) => listItem({
        title: p.name,
        subtitle: `${p.relationship} · sees ${p.sees} · ${p.revoke}`,
      }))),
    ]),
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
export function permissionsCard() {
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

  /*
   * The scope's own name, marked as the machine identifier it is.
   *
   * `drive.file` is a string Google defines, not a sentence FamilyOS wrote —
   * it belongs in `code` for the same reason a filename does, and a household
   * comparing this list against the Google consent screen is reading it
   * character by character.
   *
   * It also keeps the browser suite's locale-key walk honest. That check
   * fails on dotted text drawn where a sentence belongs, because `t()` paints
   * the key when the catalogue has no entry; these four scope names were the
   * only things it flagged, and they are not a fault. Excluding `code`
   * exempts exactly the identifiers somebody meant to show, rather than
   * exempting the four strings by name.
   */
  const scopeName = (scope) => h('code', { class: 'scope-name' },
    scope.id.replace('https://www.googleapis.com/auth/', ''));

  const row = (scope) => listItem({
    title: scopeName(scope),
    subtitle: `${scope.title} — ${scope.why}`,
    value: '',
  });

  /*
   * Folded away, because it is setup reference rather than a control.
   *
   * Measured on a 390×844 phone this card was **1,301px** — one and a half
   * screens, 19% of the whole Settings page — sitting above Security,
   * Appearance and Backup. It is a list of OAuth scopes to paste into Cloud
   * Console, read once while setting the application up and never again, and a
   * household changing their PIN was scrolling past all of it.
   *
   * `<details class="card">` rather than something new: `breachCard` in
   * `settings/activity.js` already folds itself away this way. The heading is
   * a real `h2` inside the summary so the section still appears when somebody
   * navigates by heading — a `<summary>` on its own does not.
   */
  return h('details', { class: 'card' }, [
    h('summary', { class: 'card-summary' }, [
      h('h2', {}, t('settings.scopes.title')),
      h('span', { class: ['small', 'muted'] }, t('settings.scopes.where')),
    ]),

    h('div', { class: 'card-summary-actions' }, copy([...required, ...optional], 'Copy all')),

    h('p', { class: 'small muted' },
      'Two consent surfaces, and mixing them up is why adding a scope in the console '
      + 'sometimes changes nothing. This list is the one a person grants in the browser. '
      + 'The Apps Script backend authorises itself separately, from its own manifest, '
      + 'when you deploy it — nothing here affects that.'),

    h('h3', { class: 'small' }, 'Required'),
    h('div', { class: 'list' }, required.map(row)),
    copy(required, 'Copy the required scopes'),

    h('h3', { class: 'small', style: { marginTop: 'var(--space-4)' } }, 'Optional'),
    h('div', { class: 'list' }, optional.map((scope) => listItem({
      title: scopeName(scope),
      subtitle: `${scope.title} — ${scope.why}`,
      trailing: badge('optional', ''),
    }))),
    h('p', { class: 'small faint' },
      'Each optional one buys a single named feature and nothing works worse without it. '
      + 'Notably you do not need drive.appdata: without it the unlock key goes in an '
      + 'ordinary visible file in your Drive, which works identically.'),
  ]);
}

/**
 * Where this copy is served from — its own card, and not folded.
 *
 * This was inside the scope list, and folding that list away took this with
 * it. That was the wrong call, and the card's own comment said why before I
 * moved it: **the commonest reason a sign-in fails has nothing to do with
 * scopes.** The OAuth client does not list where this copy of the app is
 * served from, Google shows its own error inside the popup, the person closes
 * it, and the application can only tell that a window shut.
 *
 * So the two strings somebody needs when sign-in is broken are visible, and
 * the hundred-line scope reference they do not need is the part that folds.
 * Two browser checks read this text and started failing the moment it went
 * behind a disclosure, which is how the mistake surfaced.
 */
export function originCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader(t('settings.origin.title'), null, { iconName: 'key' }),
    h('p', { class: ['small', 'muted'] }, t('settings.origin.why')),
    h('div', { class: 'list' }, [
      listItem({
        title: 'Authorised JavaScript origin',
        subtitle: globalThis.location?.origin ?? '',
      }),
      listItem({ title: 'Authorised redirect URI', subtitle: redirectUri() }),
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
  ]);
}

/* --------------------------------------------------------- notifications */

/**
 * The click the code said existed.
 *
 * `requestNotificationPermission` in `domain/automation.js` carries the
 * comment *"Only ever asked from a click in Settings. A permission prompt on
 * load is the fastest way to have it denied forever."* — and there was no such
 * click anywhere in the application. Nothing called it.
 *
 * So `Notification.permission` stayed `default` forever, `canNotify()` was
 * always false, and the whole notification path — the digest wording, the
 * once-a-day guard, the `notified` counter — was built and could never run.
 * A passport expiring tomorrow has never produced a notification on any
 * device, because nobody was ever asked whether it might.
 *
 * ## What this card must not claim
 *
 * These are page notifications, not push. There is no server and no push
 * subscription, so nothing arrives while the application is closed: they are
 * raised by `runAutomations` when the app is opened, at most once a day. A
 * card that said "get notified when something is due" would be describing a
 * product this is not.
 *
 * And the answer may be that the platform has none at all. A WebView can be
 * built without the Notification API, in which case asking returns
 * `unsupported` — which is said, rather than shown as a button that does
 * nothing.
 */
export function notificationsCard(repaint) {
  const supported = Boolean(globalThis.Notification);
  const state = supported ? Notification.permission : 'unsupported';

  const tone = { granted: 'positive', denied: 'warning' }[state] ?? 'muted';

  return card({ class: 'card--quiet' }, [
    cardHeader(t('notify.title'), badge(t(`notify.state.${state}`), tone), { iconName: 'bell' }),

    h('p', { class: 'small' }, t('notify.what')),

    /*
     * Only `default` gets a button.
     *
     * `Notification.requestPermission()` resolves immediately with the stored
     * answer once one exists, and a browser will not re-prompt after a
     * refusal — so a button offered to somebody who has already said no does
     * nothing at all when tapped, which is worse than not offering it. The
     * way back is the browser's own site settings, and that is what is said.
     */
    state === 'default'
      ? button(t('notify.ask'), {
        variant: 'primary',
        onClick: async () => {
          const { requestNotificationPermission } = await import('../../domain/automation.js');
          await requestNotificationPermission();
          await repaint();
        },
      })
      : h('p', { class: ['small', 'muted'] }, t(`notify.after.${state}`)),

    h('p', { class: ['small', 'faint'] }, t('notify.notPush')),
  ]);
}
