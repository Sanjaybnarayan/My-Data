/**
 * Settings: what has happened on this device — the audit trail and its hash
 * chain, connectors needing attention, local diagnostics, and what a
 * household would need if it thought its records had got out.
 */

import { SEVERITY } from '../../domain/breach.js';
import { card, cardHeader, button, badge, listItem, empty } from '../../ui/components/basics.js';
import { describe as describeAudit } from '../../data/audit.js';
import { formatInstant } from '../../core/dates.js';
import { h, replace } from '../../ui/dom.js';
import { summarise as summariseDiagnostics } from '../../data/diagnostics.js';

/* -------------------------------------------------------------- activity */

/**
 * Whether the log still adds up.
 *
 * Behind a button rather than run on the way past: it reads every entry, and a
 * check that costs something should be something a person asks for.
 *
 * The sentence it prints is careful on purpose. "Intact" here means nothing has
 * been altered *without recomputing the chain*, and somebody who can unlock
 * this application can recompute it. Saying "verified" or "proven" would be
 * claiming more than a hash chain inside its own database can deliver —
 * docs/AUDIT_CHAIN.md sets the limit out in full.
 */
function chainCheck(db) {
  const out = h('div', {});

  return h('div', { style: { padding: '0 var(--space-5) var(--space-5)' } }, [
    h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
      button('Check the log', {
        variant: 'subtle',
        iconName: 'shield',
        onClick: async () => {
          replace(out, h('p', { class: 'small faint' }, 'Checking…'));
          const result = await db.verifyAudit();

          const unchained = result.unchained
            ? ` ${result.unchained} older ${result.unchained === 1 ? 'entry' : 'entries'} `
              + 'cannot be checked at all — they were written before this existed.'
            : '';

          if (result.ok) {
            replace(out, h('p', { class: 'small' },
              `${result.checked} ${result.checked === 1 ? 'entry links' : 'entries link'} `
              + 'up correctly. Nothing has been altered or removed without also '
              + 'rebuilding the chain — which anybody who can unlock FamilyOS '
              + `could do.${unchained}`));
            return;
          }

          const broken = result.devices.filter((d) => !d.ok);
          replace(out, [
            h('p', { class: 'small money--negative' },
              `The audit log does not add up on ${broken.length} `
              + `${broken.length === 1 ? 'device' : 'devices'}.`),
            ...broken.map((d) => h('p', { class: 'small faint' },
              `${d.why}${d.at ? ` (entry ${d.at})` : ''}`)),
            unchained ? h('p', { class: 'small faint' }, unchained.trim()) : null,
          ].filter(Boolean));
        },
      }),
    ]),
    out,
  ]);
}

export function activityCard(activity, people, db) {
  return card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      cardHeader('Audit log', null, { iconName: 'clock' })),
    chainCheck(db),
    activity.length
      ? h('div', { class: 'list' }, activity.map((entry) => listItem({
        title: describeAudit(entry, (id) => people[id] ?? 'Someone'),
        subtitle: `${formatInstant(entry.at)} · ${entry.actorRole || 'unknown role'}`,
        trailing: entry.synced ? null : badge('local', 'warning'),
      })))
      : empty({ title: 'No activity yet', iconName: 'clock' }),
  ]);
}

/* ---------------------------------------------------------- connections */

/**
 * The connections that have stopped working.
 *
 * One place for all of them. Gmail says so on the receipts screen, which is
 * right where somebody is already looking for receipts — but Drive and
 * Calendar have no screen of their own, and a household that has not opened
 * Shops in a month should not have to go looking.
 *
 * Absent when everything works. A card that is permanently present and
 * permanently green is a card people stop reading, and the one time it turns
 * red they will not notice.
 */
export function connectionsCard(needing) {
  if (!needing.length) return null;

  const LABEL = {
    'google:drive': 'Google Drive',
    'google:calendar': 'Google Calendar',
  };

  return card({}, [
    cardHeader('Connections that need you',
      badge(String(needing.length), 'warning'), { iconName: 'alert' }),

    h('div', { class: 'list' }, needing.map((c) => listItem({
      // A mailbox id is `gm_someone@example.com`, which is already the
      // clearest name it has. Everything else gets a real one.
      title: LABEL[c.id] ?? c.id.replace(/^gm_/, ''),
      subtitle: c.why,
      trailing: c.action ? badge(c.action, 'warning') : null,
    }))),

    h('p', { class: 'small faint', style: { marginBottom: 0 } },
      'Nothing here has been lost. A connection that stops working stops '
      + 'bringing new things in; what it already brought is still on this '
      + 'device.'),
  ]);
}

/* ----------------------------------------------------- how this is going */

/**
 * What has gone wrong on this device lately.
 *
 * The card exists to answer one question nothing could answer before: *has
 * this been happening?* A single failed sync is a bad minute; the same failure
 * every day for a week is something a household should be told, and until this
 * existed those looked identical the moment somebody reloaded.
 *
 * The two sentences at the bottom are not decoration. A screen headed
 * "problems" invites the assumption that somebody is watching them, and
 * nobody is — no alerting, no aggregate across devices, and nothing sent
 * anywhere. Saying so here costs three lines and prevents a false belief that
 * would otherwise be perfectly reasonable to hold.
 */
export function diagnosticsCard(events) {
  const roll = summariseDiagnostics(events);
  const kinds = Object.entries(roll.byKind);

  return card({ class: 'card--quiet' }, [
    cardHeader('How this device is doing',
      badge(roll.total ? `${roll.total} in ${roll.days} days` : 'nothing recently',
        roll.total ? 'warning' : 'positive'),
      { iconName: 'activity' }),

    roll.total
      ? h('div', { class: 'stack stack--tight' }, [
        h('p', { class: 'small' }, kinds
          .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`).join(', ')),

        // The part worth surfacing: the same thing failing again and again.
        roll.repeated.length
          ? h('div', { class: 'list' }, roll.repeated.slice(0, 5).map((r) => listItem({
            title: r.key.replace(':', ' · '),
            subtitle: `${r.count} times`,
            trailing: badge(String(r.count), 'warning'),
          })))
          : h('p', { class: 'small faint' },
            'Nothing has happened more than once, so none of it looks like a '
            + 'pattern.'),

        // The messages themselves, already redacted on the way in. Shown
        // because "sync · http-501" alone is thin — and because a card that
        // never renders a message would let the redaction rot unnoticed:
        // nothing on any screen would change if it stopped working.
        h('p', { class: 'small faint', style: { marginBottom: 0 } }, 'Most recent:'),
        h('div', { class: 'list' }, events.slice(0, 3).map((e) => listItem({
          title: e.message || `${e.where} ${e.code}`.trim(),
          subtitle: `${e.where}${e.entity ? ` · ${e.entity}` : ''}`,
        }))),
      ])
      : h('p', { class: 'small faint' },
        `Nothing has gone wrong in the last ${roll.days} days.`
        + (roll.full ? ' The record is full, so it may not reach back further.' : '')),

    h('p', { class: 'small faint', style: { marginTop: 'var(--space-4)', marginBottom: 0 } },
      'None of this leaves the device, and the values are stripped out before '
      + 'anything is written — amounts, names and account numbers never reach '
      + 'this record.'),
    h('p', { class: 'small faint', style: { marginBottom: 0 } },
      'Nobody is watching it but you. Nothing alerts anyone, and there is no '
      + 'view across your other devices.'),
  ]);
}

/**
 * What to do if the household thinks their records have got out.
 *
 * ## The word "detection" does not appear here, deliberately
 *
 * No application can detect that a copy of a household's records was taken. A
 * stolen phone, a shared Drive link, a photograph of a screen — none of them
 * produce an event on this device. A card that said "no breaches detected"
 * would be answering a question it never asked.
 *
 * So it reports indicators, each with what it means *and does not*, and it
 * carries the three things it cannot do even when it has something to report.
 * A screen that drops its caveats the moment it has news overstates exactly
 * when it matters most.
 *
 * ## The half that is genuinely useful
 *
 * Who would have to be told. This application knows, because it holds the
 * records — and since the household keeps records about staff and children,
 * that list has people on it whose data is not the household's own to weigh.
 * Working that out under pressure, from a list nobody has, is the part worth
 * having ready.
 */
export function breachCard(answer) {
  const urgent = answer.indicators.filter((i) => i.severity === SEVERITY.URGENT);

  return h('details', { class: 'card card--quiet' }, [
    // The heading is an `h2` inside the summary, not bare text: a `<summary>`
    // is not a heading, so this card contributed nothing to heading
    // navigation while every other card on the screen contributed one.
    h('summary', { class: 'card-summary' }, [
      h('h2', {}, 'If you think your records have got out'),
      urgent.length ? badge(String(urgent.length), 'warning') : null,
    ].filter(Boolean)),

    h('p', { class: 'small' },
      'FamilyOS cannot tell you whether this has happened. What it can do is '
      + 'show you the few things it does know about, and who you would have '
      + 'to tell.'),

    answer.indicators.length
      ? h('div', { class: 'list' }, answer.indicators.map((one) => listItem({
        title: one.what,
        subtitle: `${one.meaning} ${one.notMeaning}`,
        trailing: badge(one.severity, one.severity === SEVERITY.URGENT ? 'warning' : 'muted'),
      })))
      : h('p', { class: 'small faint' },
        'Nothing to show — which is not the same as nothing having happened.'),

    answer.affected.length
      ? h('div', {}, [
        h('p', { class: 'small', style: { marginBottom: 0 } }, 'Who you would have to tell:'),
        h('div', { class: 'list' }, answer.affected.map((person) => listItem({
          title: person.name,
          subtitle: person.why,
          trailing: person.othersData ? badge('not your data', 'warning') : null,
        }))),
      ])
      : null,

    h('p', { class: 'small faint', style: { marginBottom: 0 } },
      `What this cannot do: ${answer.cannot.join(' ')}`),
  ].filter(Boolean));
}
