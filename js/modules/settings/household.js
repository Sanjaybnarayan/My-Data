/**
 * Settings: who is in the household, what each role may see, and which
 * devices have been trusted.
 */

import { app } from '../../context.js';
import { card, cardHeader, button, badge, listItem } from '../../ui/components/basics.js';
import { entities } from '../../data/schema.js';
import { formatDay } from '../../core/dates.js';
import { h, replace } from '../../ui/dom.js';
import { prompt } from '../../ui/components/modal.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';
import { t } from '../../core/locale.js';

/* ------------------------------------------------------------- household */

/**
 * Which Google accounts may reach this household's backend.
 *
 * The backend runs as one account and answers requests carrying an OAuth
 * token. For a long time it answered *only* that account's token, which meant
 * the documented way to add a family member — sign in with their own Google
 * account and sync — could not work: their token was rejected before it
 * reached anything.
 *
 * This is that list. What it grants is the right to reach the workbook, not
 * the ability to read it: the sensitive fields in it are ciphertext, and the
 * key that opens them is wrapped by a PIN, a fingerprint or a recovery phrase
 * on each person's own device and never goes near Google.
 */
/**
 * What a role means, in the words a household would use.
 *
 * Derived from the schema rather than written out, so a role that gains an
 * entity gains it here too — and a role that loses one stops claiming it.
 */
function describeRole(role) {
  const readable = Object.keys(entities).filter((n) => entities[n].acl.read.includes(role));
  const writable = Object.keys(entities).filter((n) => entities[n].acl.write.includes(role));
  if (!readable.length) return 'May sync, but is sent nothing';
  if (!writable.length) return `Can see ${readable.length} of ${Object.keys(entities).length} kinds of record, and change none`;
  return `Can see ${readable.length} and change ${writable.length} of ${Object.keys(entities).length} kinds of record`;
}

/**
 * The devices this household has synced from, and signing one out.
 *
 * ## Why this screen exists
 *
 * The registry behind it worked and was **unusable**. It was reachable over the
 * API and nowhere else, so signing out a lost phone meant calling an endpoint
 * by hand — which is a capability, not a feature. And it answered in opaque
 * ids, so an owner facing three `dev_01M0…` could not tell which was the phone.
 *
 * ## What it says plainly
 *
 * **Signing a device out stops it reaching the backup. It does not reach into
 * the device and erase anything.** Records already synced to it stay there,
 * behind its lock screen. A PWA cannot wipe a device it is not running on, and
 * a screen that implied otherwise would be the most dangerous kind of comfort —
 * somebody would stop looking for the phone.
 */
export function devicesCard() {
  const host = h('div', {});
  const body = h('div', {}, h('p', { class: 'muted' }, 'Checking…'));
  let devices = [];

  replace(host, card({}, [
    cardHeader('Devices', null, {
      subtitle: 'Where this household has signed in from',
      iconName: 'phone',
    }),
    body,
  ]));

  void load();
  return host;

  async function load() {
    const { transport } = app();
    if (!transport.configured) {
      replace(body, h('p', { class: 'muted' },
        'No backend is configured, so nothing syncs and there are no devices to list.'));
      return;
    }

    try {
      const result = await transport.devices();
      devices = result.devices ?? [];
      paint();
    } catch (err) {
      replace(body, [
        h('p', { class: 'muted' }, userMessage(err)),
        // An older deployment has no `devices` action at all, and saying so
        // beats an error nobody can act on.
        h('p', { class: 'small faint' },
          'A backend deployed before this feature will not know the request. '
          + 'Redeploy apps-script/ and this will fill itself in.'),
      ]);
    }
  }

  async function act(work, done) {
    try {
      const result = await work();
      devices = result.devices ?? devices;
      toast(done, { kind: 'success' });
      paint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  function paint() {
    const { transport, db } = app();

    if (!devices.length) {
      replace(body, h('p', { class: 'muted' },
        'Nothing has synced yet. A device appears here the first time it reaches the backup.'));
      return;
    }

    const row = (device) => {
      const isThis = device.id === db.deviceId;
      const revoked = Boolean(device.revokedAt);
      // Never on the device being used: it vouches for itself by being the
      // thing in somebody's hand, and marking it would make every household
      // suspect themselves on the day they installed this.
      const unrecognised = !isThis && !revoked && !device.acknowledgedAt;

      return listItem({
        // The id is still shown, shortened, because two identical phones report
        // the same name and this is the only thing that tells them apart.
        title: `${device.label || 'Unnamed device'}${isThis ? ' — this device' : ''}`,
        subtitle: [
          revoked ? `Signed out ${formatDay(device.revokedAt.slice(0, 10))}`
            : `Last synced ${formatDay(device.lastSeenAt.slice(0, 10))}`,
          `first seen ${formatDay(device.firstSeenAt.slice(0, 10))}`,
          device.id.slice(0, 12),
        ].filter(Boolean).join(' · '),
        leading: revoked ? badge('signed out', 'warning')
          : unrecognised ? badge('new', 'danger') : null,
        trailing: h('div', { class: 'row' }, [
          button('Rename', {
            variant: 'subtle',
            onClick: async () => {
              const label = await prompt({
                title: 'Name this device',
                label: 'Something you will recognise',
                value: device.label ?? '',
                confirmLabel: 'Save',
              });
              // Cancelled is not the same as cleared: `null` leaves it alone,
              // an empty string deliberately clears the name back to reported.
              if (label === null) return;
              await act(() => transport.nameDevice(device.id, label), 'Renamed');
            },
          }),
          // Only where it would change something. A button on every row would
          // make the marked ones no easier to find, which is the whole job.
          unrecognised ? button('I recognise this', {
            variant: 'subtle',
            onClick: () => act(() => transport.acknowledgeDevice(device.id),
              'Noted — it will not be flagged again'),
          }) : null,
          // No control at all on the device being used. Signing yourself out
          // from the thing you are holding would lock you out of the reply to
          // your own request, and the backend refuses it — a button that always
          // errors is worse than no button.
          isThis ? null : button(revoked ? 'Allow again' : 'Sign out', {
            variant: revoked ? 'subtle' : 'danger',
            onClick: () => act(
              () => (revoked ? transport.restoreDevice(device.id)
                : transport.revokeDevice(device.id)),
              revoked ? 'Allowed again' : 'Signed out — it can no longer reach the backup',
            ),
          }),
        ].filter(Boolean)),
      });
    };

    replace(body, [
      h('div', { class: 'list' }, devices.map(row)),

      // Said under the list rather than in a tooltip, because it is the thing
      // somebody most needs to know at the moment they press the button.
      h('p', { class: 'small faint', style: { marginTop: 'var(--space-3)' } },
        'Signing a device out stops it reaching this backup. It does not erase '
        + 'anything already on it — records synced there stay there, behind that '
        + 'device’s own lock screen. If a phone is lost, sign it out here and '
        + 'change your Google password too.'),

      h('p', { class: 'small faint' },
        'Names are worked out from the browser and can be wrong. Rename any of '
        + 'them to something you will recognise.'),

      // Said where the marks are, so "new" has a meaning rather than being a
      // colour somebody has to interpret.
      devices.some((d) => d.id !== app().db.deviceId && !d.revokedAt && !d.acknowledgedAt)
        ? h('p', { class: 'small faint' },
          'Anything marked new has synced without your saying you recognise it. '
          + 'If you know what it is, say so and it stops being flagged; if you '
          + 'do not, sign it out.')
        : null,
    ]);
  }
}

export function householdCard() {
  const host = h('div', {});
  const body = h('div', {}, h('p', { class: 'muted' }, 'Checking…'));
  let members = [];
  let ownerPersonId = '';
  let owner = '';
  let isOwner = false;
  let people = [];

  replace(host, card({}, [
    cardHeader('Household accounts', null, {
      subtitle: 'Who may sync with this backup',
      iconName: 'family',
    }),
    body,
  ]));

  void load();
  return host;

  async function load() {
    const { transport } = app();
    if (!transport.configured) {
      replace(body, h('p', { class: 'muted' },
        'No backend is configured, so nothing syncs and there is nobody to admit.'));
      return;
    }

    try {
      const [result, household] = await Promise.all([
        transport.members(),
        app().db.repo('person').list({ decrypt: false, limit: 500 }),
      ]);
      people = household.filter((person) => !person.deletedAt);
      members = result.members ?? [];
      ownerPersonId = result.ownerPersonId ?? '';
      owner = result.owner ?? '';
      isOwner = Boolean(result.isOwner);
      paint();
    } catch (err) {
      replace(body, [
        h('p', { class: 'muted' }, userMessage(err)),
        // An older deployment has no `members` action at all, and saying so
        // beats an error nobody can act on.
        h('p', { class: 'small faint' },
          'A backend deployed before this feature will not know the request. '
          + 'Redeploy apps-script/ and this will fill itself in.'),
      ]);
    }
  }

  function paint() {
    const field = h('input', {
      type: 'email',
      class: 'input',
      placeholder: 'family@gmail.com',
      'aria-label': 'Google account to admit',
      onKeyDown: (event) => { if (event.key === 'Enter') add(); },
    });

    // The role is chosen when somebody is admitted, and it is the whole of
    // what they may reach. `guest` first, and as the default, because a
    // household adding an account in a hurry should be adding the narrowest
    // one — widening later is a deliberate act, narrowing after a leak is not
    // a remedy.
    const roleField = h('select', { class: 'input', 'aria-label': 'What they may see' },
      ['guest', 'child', 'adult', 'spouse'].map((role) => h('option', { value: role }, role)));

    const add = () => {
      const value = field.value.trim().toLowerCase();
      if (!value.includes('@') || members.some((m) => m.email === value)) return;
      field.value = '';
      void save([...members, { email: value, role: roleField.value }]);
    };

    replace(body, [
      listItem({
        title: owner || 'the deploying account',
        subtitle: 'Owns the backend — admitted by identity, and cannot be removed',
        leading: badge('owner', 'success'),
        /*
         * The owner picks their own person here, like everybody else.
         *
         * They are deliberately absent from the member list, so their
         * `personId` is stored on its own and had nowhere to be set. Since the
         * backend began refusing a message whose sender is not the caller, an
         * owner who has not answered this cannot send chat at all — which is
         * the right refusal and a miserable one to meet with no control to fix
         * it. This is the control.
         */
        trailing: isOwner ? ownerPicker() : null,
      }),
      isOwner && !ownerPersonId
        ? h('p', { class: ['small', 'money--negative'] }, t('household.ownerUnlinked'))
        : null,
      ...members.map(({ email, role, personId }) => listItem({
        title: email,
        subtitle: `${describeRole(role)} · enforced by the backend, not by this screen`,
        leading: badge(role, role === 'guest' ? '' : 'info'),
        trailing: isOwner
          ? h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
            // Which person this account *is*. The backend uses it to let
            // somebody reach rows about themselves in entities their role
            // cannot otherwise touch — a child's own health record, say. Set
            // here because only the owner may write this list, and that is
            // exactly what makes it safe to widen access from.
            personPicker(email, personId ?? ''),
            button('Remove', {
              onClick: () => save(members.filter((other) => other.email !== email)),
            }),
          ])
          : null,
      })),

      isOwner
        ? h('div', {}, [
          h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
            field, roleField, button('Admit', { onClick: add }),
          ]),
          h('p', { class: 'small muted', style: { marginTop: 'var(--space-2)' } },
            'They also need to be a test user on your OAuth consent screen, and they '
            + 'need the household’s recovery phrase or their own PIN enrolled on their '
            + 'device — this list decides who may reach the backup, not who can read it. '
            + 'Everything sensitive in it is encrypted with a key Google never sees.'),
        ])
        : h('p', { class: 'small muted', style: { marginTop: 'var(--space-3)' } },
          'Only the account that deployed the backend can change this list.'),
    ].filter(Boolean));
  }

  /**
   * The owner's own person, saved through the same call as everybody else's.
   *
   * `save` sends the whole list; this sends the list unchanged plus the owner's
   * answer, so one screen makes one decision — "which person is each account" —
   * in one request.
   */
  function ownerPicker() {
    return h('select', {
      class: 'input input--compact',
      'aria-label': t('household.whichPersonYouAre'),
      onChange: (event) => save(members, event.target.value),
    }, [
      h('option', { value: '' }, t('household.notLinked')),
      ...people.map((person) => h('option', {
        value: person.id,
        ...(person.id === ownerPersonId ? { selected: 'selected' } : {}),
      }, person.name)),
    ]);
  }

  /** Which person in the household an admitted account belongs to. */
  function personPicker(email, current) {
    const select = h('select', {
      class: 'input input--compact',
      'aria-label': `Which person ${email} is`,
      onChange: (event) => save(members.map((member) => (member.email === email
        ? { ...member, personId: event.target.value }
        : member))),
    }, [
      h('option', { value: '' }, 'Not linked to a person'),
      ...people.map((person) => h('option', {
        value: person.id,
        ...(person.id === current ? { selected: 'selected' } : {}),
      }, person.name)),
    ]);
    return select;
  }

  /**
   * @param {Array} next the member list to store
   * @param {string} [ownerNext] the owner's own person. Omitted means "leave
   *   it as it is" — the backend reads an absent field the same way, so a save
   *   from the member rows cannot silently unbind the owner.
   */
  async function save(next, ownerNext) {
    try {
      const result = await app().transport.members(next, ownerNext);
      members = result.members ?? next;
      ownerPersonId = result.ownerPersonId ?? ownerPersonId;
      toast('Household accounts updated', { kind: 'success' });
      paint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }
}
