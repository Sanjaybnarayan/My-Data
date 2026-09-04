/**
 * Settings: the PIN, the biometric, unlocking with a Google account, and
 * signing in with a one-time code.
 *
 * The last two are the same bargain wearing different clothes, and the card
 * says so in both places: an escrow somewhere off this device is what lets a
 * new phone in without the recovery phrase, and it is also what lets whoever
 * holds that somewhere read the household's records. Google's version keeps it
 * in the household's own Drive; the code version keeps it in the household's
 * own Apps Script deployment. Neither is the recovery phrase, which is kept
 * nowhere.
 */

import { card, cardHeader, button, badge } from '../../ui/components/basics.js';
import { config } from '../../core/config.js';
import { googleUnlockAvailable, connectGoogleUnlock, linkExistingDevice, unlinkGoogleUnlock, GOOGLE_METHOD } from '../../auth/google-unlock.js';
import { h } from '../../ui/dom.js';
import { modal, confirm, prompt } from '../../ui/components/modal.js';
import {
  biometricUnavailableReason, enrolBiometric, biometricExplanation, forgetBiometric,
} from '../../auth/biometric.js';
import { toast } from '../../ui/components/toast.js';
import { userMessage } from '../../core/errors.js';
import { CodeEscrow, CODE_METHOD } from '../../security/codeescrow.js';
import { mintRawKey } from '../../security/escrow.js';
import { addressLooksSendable } from '../../domain/otp.js';
import { app } from '../../context.js';
import { t } from '../../core/locale.js';

/* -------------------------------------------------------------- security */

const METHOD_NAMES = {
  pin: 'PIN',
  webauthn: 'Fingerprint or face',
  recovery: 'Recovery phrase',
  google: 'Google account',
};

/**
 * The name of an unlock method, at render time.
 *
 * A function rather than a fifth entry above, because the entry would be a
 * `t()` call evaluated once when this module is imported — correct today, and
 * a trap the moment a second language can be chosen after boot. The four
 * English literals above cannot follow a language change at all; this one can,
 * and pinning it to import time would quietly give that up.
 */
function methodName(method) {
  if (method === CODE_METHOD) return t('security.code.method');
  return METHOD_NAMES[method] ?? method;
}

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

/**
 * Signing in with a one-time code, on and off.
 *
 * Turning it on takes 32 fresh bytes, wraps this household’s data key under
 * them, and sends both to the household’s own backend. Both, together, in one
 * place — which is what makes a code sufficient on a device that has nothing,
 * and equally what makes the backend able to decrypt. The paragraph below is
 * the only warning a household gets before choosing, so it says the whole of
 * it rather than the comfortable half.
 */
function codeUnlockRow(db, methods, repaint) {
  const entry = methods.find((m) => m.method === CODE_METHOD);

  return h('div', { class: 'stack stack--tight' }, [
    h('p', { class: 'small muted' },
      t(entry ? 'security.code.onBody' : 'security.code.offBody')),

    h('div', { class: 'row' }, [
      entry
        ? button(t('security.code.turnOff'), {
          variant: 'subtle',
          onClick: () => codeOff(db, repaint),
        })
        : button(t('security.code.turnOn'), {
          variant: 'subtle',
          iconName: 'phone',
          onClick: () => codeOn(db, repaint),
        }),
    ]),
  ]);
}

async function codeOn(db, repaint) {
  const actor = db.actor;
  if (!actor?.personId) {
    toast(t('security.code.noPerson'), { kind: 'error' });
    return;
  }

  const address = await prompt({
    title: t('security.code.whereTitle'),
    label: t('security.code.whereLabel'),
    confirmLabel: t('security.code.whereConfirm'),
  });
  if (!address) return;

  const value = address.trim();
  const channel = value.includes('@') ? 'email' : 'sms';
  if (!addressLooksSendable(value, channel)) {
    toast(t('signin.code.badAddress'), { kind: 'error' });
    return;
  }

  const go = await confirm({
    title: t('security.code.warnTitle'),
    message: t('security.code.warnBody'),
    confirmLabel: t('security.code.warnConfirm'),
    danger: true,
  });
  if (!go) return;

  try {
    const escrow = new CodeEscrow({ transport: app().transport });
    const rawKey = mintRawKey();
    // Wrapped locally first. Publishing a key the keyring never accepted would
    // leave the backend holding an escrow no device agrees with.
    await db.keyring.addMethod(CODE_METHOD, { rawKey, label: value });
    await escrow.put(rawKey, await db.keyring.wrappedFor(CODE_METHOD), {
      personId: actor.personId,
      name: actor.name ?? '',
      email: channel === 'email' ? value : '',
      phone: channel === 'sms' ? value : '',
    });
    toast(t('security.code.onToast'), { kind: 'success' });
    await repaint();
  } catch (err) {
    // Rolled back, so a failed publish does not leave a wrapping this device
    // lists as a way in that nothing on the other end will ever answer.
    await db.keyring.removeMethod(CODE_METHOD).catch(() => {});
    toast(userMessage(err), { kind: 'error' });
  }
}

async function codeOff(db, repaint) {
  const go = await confirm({
    title: t('security.code.offTitle'),
    message: t('security.code.offMessage'),
    confirmLabel: t('security.code.offConfirm'),
  });
  if (!go) return;

  try {
    // The backend first. Removing it locally and failing here would leave the
    // key sitting in the deployment, which is the exact thing being undone.
    await new CodeEscrow({ transport: app().transport }).drop(db.actor?.personId ?? '');
    await db.keyring.removeMethod(CODE_METHOD);
  } catch (err) {
    toast(userMessage(err), { kind: 'error' });
    return;
  }
  toast(t('security.code.offToast'), { kind: 'success' });
  await repaint();
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
            methodName(m.method), m.method === 'recovery' ? 'positive' : 'accent',
          ))
          : badge('nothing yet', 'danger')),
        methods.some((m) => m.method === 'recovery')
          ? null
          : h('p', { class: 'small money--negative' },
            'No recovery phrase. If you lose every unlocked device, the records on '
            + 'them cannot be recovered by anyone.'),
      ]),

      googleUnlockAvailable() ? googleUnlockRow(db, methods, repaint) : null,

      // Only where there is a backend to hold the key. Without one the button
      // could do nothing but fail.
      app().transport?.configured ? codeUnlockRow(db, methods, repaint) : null,

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
        // Set up, or take away. There was only ever the first, so a household
        // that enrolled a fingerprint had no way to un-enrol one — and on
        // Android that leaves a Keystore key on the phone with nothing in the
        // app able to reach it.
        methods.some((m) => m.method === 'webauthn')
          ? button(t('biometric.remove'), {
            variant: 'subtle',
            iconName: 'fingerprint',
            onClick: () => removeBiometric(db, repaint),
          })
          : button(t('biometric.setUp'), {
            variant: 'subtle',
            iconName: 'fingerprint',
            onClick: () => setUpBiometric(db, repaint),
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

async function setUpBiometric(db, repaint = () => {}) {
  // Not an error toast: nothing has gone wrong, and on most of these branches
  // nothing the household does will change it. It states what this build can do.
  const unavailable = await biometricUnavailableReason();
  if (unavailable) {
    toast(unavailable, { kind: 'info' });
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
    repaint();
  } catch (err) {
    if (err.code !== 'cancelled') toast(userMessage(err), { kind: 'error' });
  }
}

/**
 * Take the fingerprint off this device.
 *
 * `removeMethod` refuses to remove the last unlock method, so this cannot
 * strand anybody: a household with only a fingerprint is told no, and the
 * error says which rule stopped it.
 *
 * The order matters. The keyring first, because that is the thing that
 * actually decides whether the app opens; the Keystore key second, and its
 * failure ignored — see `forgetBiometric`.
 */
async function removeBiometric(db, repaint = () => {}) {
  try {
    await db.keyring.removeMethod('webauthn');
    await db.setMeta('auth.webauthnCredentialId', null);
    await db.setMeta('auth.webauthnDerivesKey', false);
    await forgetBiometric();
    toast(t('biometric.removed'), { kind: 'success' });
    repaint();
  } catch (err) {
    toast(userMessage(err), { kind: 'error' });
  }
}
