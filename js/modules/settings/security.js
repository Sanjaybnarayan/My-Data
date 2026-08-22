/**
 * Settings: the PIN, the biometric, and unlocking with a Google account.
 */

import { card, cardHeader, button, badge } from '../../ui/components/basics.js';
import { config } from '../../core/config.js';
import { googleUnlockAvailable, connectGoogleUnlock, linkExistingDevice, unlinkGoogleUnlock, GOOGLE_METHOD } from '../../auth/google-unlock.js';
import { h } from '../../ui/dom.js';
import { modal, confirm, prompt } from '../../ui/components/modal.js';
import { platformAuthenticatorAvailable, enrolBiometric, biometricExplanation } from '../../auth/biometric.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';

/* -------------------------------------------------------------- security */

const METHOD_NAMES = {
  pin: 'PIN',
  webauthn: 'Fingerprint or face',
  recovery: 'Recovery phrase',
  google: 'Google account',
};

/**
 * Turning Continue with Google on and off after first run.
 *
 * This is the control that was missing, and its absence was not cosmetic.
 * Enrolment only ever ran on a device with no data key, so a household that
 * started with a PIN had no way to add Google at all — and a household that
 * started *with* Google had its second phone take the enrolment path, mint a
 * new key, and write it over the one the first phone depended on.
 */
function googleUnlockRow(db, methods, repaint) {
  const entry = methods.find((m) => m.method === GOOGLE_METHOD);

  return h('div', { class: 'stack stack--tight' }, [
    h('p', { class: 'small muted' }, entry
      ? `Signing in with ${entry.label || 'your Google account'} unlocks this device. `
        + 'Google holds the key that opens your records, which is what lets a new '
        + 'phone pick up where this one left off.'
      : 'Continue with Google keeps the key that unlocks your records in a file in '
        + 'your own Drive, so a new phone can open them without your PIN. It also '
        + 'means anyone who can sign in as you can read them. Off by default, for '
        + 'that reason.'),

    h('div', { class: 'row' }, [
      entry
        ? button('Stop using Google here', {
          variant: 'subtle',
          onClick: () => turnOff(db, repaint),
        })
        : button('Turn on Continue with Google', {
          variant: 'subtle',
          iconName: 'cloud',
          onClick: () => turnOn(db, repaint),
        }),
    ]),
  ]);
}

async function turnOn(db, repaint) {
  try {
    const { escrow, email } = await connectGoogleUnlock();
    const { outcome } = await linkExistingDevice(db.keyring, escrow, email);
    toast(outcome === 'published'
      ? `On. ${email || 'That account'} can now unlock FamilyOS on any device.`
      : `Linked to the key already in ${email || 'that account'}.`,
    { kind: 'success' });
    await repaint();
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

async function turnOff(db, repaint) {
  const go = await confirm({
    title: 'Stop using Google to unlock?',
    message: 'This device will need its PIN, fingerprint or recovery phrase from now '
      + 'on. Nothing is deleted and no records are affected.',
    confirmLabel: 'Stop using it here',
  });
  if (!go) return;

  try {
    await unlinkGoogleUnlock(db.keyring, null);
  } catch (err) {
    toast(userMessage(err), { kind: 'error' });
    return;
  }
  toast('Removed from this device.', { kind: 'success' });
  await repaint();

  // Asked separately, and only after the local removal has succeeded, because
  // the two have different blast radii: this one reaches every device in the
  // household. A cancelled prompt — or a stray Escape — must leave the file
  // exactly where it is.
  const alsoDelete = await confirm({
    title: 'Delete the key from Drive too?',
    message: 'Only if no other device signs in with Google. Any that does will be '
      + 'locked out and will need its recovery phrase to get back in.',
    confirmLabel: 'Delete it from Drive',
    cancelLabel: 'Leave it there',
    danger: true,
  });
  if (!alsoDelete) return;

  try {
    const { escrow } = await connectGoogleUnlock();
    await escrow.drop();
    toast('The key file is gone from Drive.', { kind: 'success' });
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

export function securityCard(db, methods = [], repaint = () => {}) {
  return card({}, [
    cardHeader('Security', null, { iconName: 'lock' }),
    h('div', { class: 'stack stack--tight' }, [
      h('p', { class: 'small muted' },
        `The app locks after ${config().sessionTimeoutMinutes} minutes of inactivity. `
        + 'Sensitive fields are encrypted with a key your PIN unwraps; changing the PIN '
        + 're-wraps that key and re-encrypts nothing.'),

      // What actually opens this device. Worth showing rather than assuming:
      // "how do I get back in" is the question this card exists to answer, and
      // a household that never printed a recovery phrase should find that out
      // here rather than on the morning they need it.
      h('div', { class: 'stack stack--tight' }, [
        h('p', { class: 'small' }, 'This device unlocks with:'),
        h('div', { class: 'row' }, methods.length
          ? methods.map((m) => badge(
            METHOD_NAMES[m.method] ?? m.method, m.method === 'recovery' ? 'positive' : 'accent',
          ))
          : badge('nothing yet', 'danger')),
        methods.some((m) => m.method === 'recovery')
          ? null
          : h('p', { class: 'small money--negative' },
            'No recovery phrase. If you lose every unlocked device, the records on '
            + 'them cannot be recovered by anyone.'),
      ]),

      googleUnlockAvailable() ? googleUnlockRow(db, methods, repaint) : null,

      h('div', { class: 'row' }, [
        button('Change PIN', {
          variant: 'subtle',
          iconName: 'key',
          onClick: async () => {
            const current = await prompt({ title: 'Change PIN', label: 'Current PIN', confirmLabel: 'Next' });
            if (!current) return;
            const next = await prompt({ title: 'Change PIN', label: 'New PIN', confirmLabel: 'Change' });
            if (!next) return;
            try {
              await db.keyring.changePin(current, next);
              toast('PIN changed', { kind: 'success' });
            } catch (err) {
              toast(userMessage(err), { kind: 'error' });
            }
          },
        }),
        button('Set up fingerprint', {
          variant: 'subtle',
          iconName: 'fingerprint',
          onClick: () => setUpBiometric(db),
        }),
        button('Lock now', {
          variant: 'subtle',
          iconName: 'lock',
          onClick: () => {
            db.keyring.lock();
            globalThis.location.reload();
          },
        }),
      ]),
    ]),
  ]);
}

async function setUpBiometric(db) {
  if (!(await platformAuthenticatorAvailable())) {
    toast('This device has no fingerprint or face unlock available to the browser.',
      { kind: 'error' });
    return;
  }

  try {
    const actor = db.actor;
    const result = await enrolBiometric({
      userId: actor.personId || db.deviceId,
      userName: actor.name || 'FamilyOS user',
    });

    if (result.rawKey) {
      await db.keyring.addMethod('webauthn', { rawKey: result.rawKey, label: 'This device' });
    }
    await db.setMeta('auth.webauthnCredentialId', result.credentialId);
    await db.setMeta('auth.webauthnDerivesKey', Boolean(result.rawKey));

    modal({
      title: 'Fingerprint set up',
      body: h('p', {}, biometricExplanation(Boolean(result.rawKey))),
    });
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}
