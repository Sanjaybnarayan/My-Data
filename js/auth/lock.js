/**
 * The lock screen: first-run enrolment and everyday unlock.
 *
 * It is the only screen that renders before the data key exists, so it must
 * not touch the repository — nothing behind it can be read yet. It takes a
 * keyring and an attempt limiter and returns when the key is in memory.
 *
 * The PIN entry is a keypad rather than a text field. On a phone a numeric
 * text input brings up a keyboard that covers the dots, and on a shared
 * desktop a text field is one autofill away from being remembered.
 */

import { h, replace, announce, focus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { platformAuthenticatorAvailable, unlockWithBiometric } from './biometric.js';
import {
  googleUnlockAvailable, connectGoogleUnlock, unlockFreshDevice, GOOGLE_METHOD,
} from './google-unlock.js';
import { CODE_METHOD } from '../security/codeescrow.js';
import { addressLooksSendable, codeLooksComplete } from '../domain/otp.js';
import { userMessage } from '../core/errors.js';
import { generatePassphrase } from '../security/crypto.js';
import { ACTIONS } from '../data/audit.js';
import { t } from '../core/locale.js';

/**
 * Lock the application, from wherever somebody asked for it.
 *
 * One function because there were two: the shell's dropped the key, wrote an
 * audit entry and reloaded, and Settings → Security's dropped the key and
 * reloaded. So locking from Settings left no record that anybody had — which
 * is exactly the event an audit log exists to hold.
 *
 * The audit write is not awaited and its failure is swallowed: the lock must
 * happen whether or not the log accepted the entry, and a person who asked to
 * lock a phone they are handing over should not be shown an error about
 * bookkeeping.
 */
export function lockNow(db) {
  db.keyring.lock();
  db.logAudit(ACTIONS.lock, {}).catch(() => {});
  globalThis.location.reload();
}

const PIN_LENGTH_MIN = 4;
const PIN_LENGTH_MAX = 12;

/**
 * @param {{keyring, limiter, biometricCredentialId?: string,
 *          onUnlocked: Function, mode?: 'unlock'|'enrol',
 *          googleEnrolled?: boolean, codeEscrow?: object}} options
 *
 * The sign-in-with-Google path lives in `auth/google-unlock.js`, which Settings
 * uses too — this screen decides *when* to offer it and nothing about how it
 * works. How the key is kept, and what keeping it that way costs, is in
 * `security/escrow.js`.
 *
 * `googleEnrolled` is whether this device has a `google` wrapping already. On
 * a known device without one the button could only ever report that the
 * account has no key on it, which is not worth a person's time.
 *
 * @returns {Node}
 */
export function lockScreen({
  keyring, limiter, biometricCredentialId, onUnlocked, mode = 'unlock',
  googleEnrolled = false, codeEscrow = null,
}) {
  let pin = '';
  let confirming = false;
  let firstEntry = '';

  const dots = h('div', { class: 'pin-input', role: 'status', 'aria-label': 'PIN entry' });
  const message = h('p', { class: 'small muted', role: 'status' });
  const card = h('div', { class: 'lock-card' });
  const root = h('div', { class: 'lock-screen' }, card);

  function renderDots() {
    replace(dots, Array.from({ length: Math.max(PIN_LENGTH_MIN, pin.length) }, (_, i) => h('span', {
      class: 'pin-dot',
      dataset: { filled: String(i < pin.length) },
    })));
  }

  function setMessage(text, tone = '') {
    message.textContent = text;
    message.className = `small ${tone === 'error' ? 'money--negative' : 'muted'}`;
    if (text) announce(text, tone === 'error');
  }

  function reject(text) {
    pin = '';
    renderDots();
    setMessage(text, 'error');
    card.classList.remove('shake');
    // Reflow so the animation restarts on a second wrong attempt.
    void card.offsetWidth;
    card.classList.add('shake');
  }

  async function press(digit) {
    if (pin.length >= PIN_LENGTH_MAX) return;
    pin += digit;
    renderDots();
    setMessage('');

    // Auto-submit at six digits during unlock; enrolment waits for Done so a
    // longer PIN is possible.
    if (mode === 'unlock' && pin.length === 6) await submit();
  }

  function back() {
    pin = pin.slice(0, -1);
    renderDots();
  }

  async function submit() {
    if (pin.length < PIN_LENGTH_MIN) {
      reject(`A PIN is at least ${PIN_LENGTH_MIN} digits.`);
      return;
    }

    if (mode === 'enrol') {
      if (!confirming) {
        firstEntry = pin;
        confirming = true;
        pin = '';
        renderDots();
        setMessage('Enter the same PIN again to confirm.');
        return;
      }
      if (pin !== firstEntry) {
        confirming = false;
        firstEntry = '';
        reject('Those did not match. Start again.');
        return;
      }
      try {
        await keyring.enrolPin(pin);
        onUnlocked({ method: 'pin', firstRun: true });
      } catch (err) {
        confirming = false;
        firstEntry = '';
        reject(userMessage(err));
      }
      return;
    }

    try {
      limiter.assertAllowed();
    } catch (err) {
      reject(`Too many attempts. Try again in ${err.retryAfterSeconds} seconds.`);
      return;
    }

    try {
      await keyring.unlockWithPin(pin);
      limiter.recordSuccess();
      onUnlocked({ method: 'pin' });
    } catch {
      limiter.recordFailure();
      const left = limiter.attemptsLeft;
      reject(left > 0
        ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : 'That PIN is not right.');
    }
  }

  async function biometric() {
    try {
      const { rawKey } = await unlockWithBiometric(biometricCredentialId);
      if (!rawKey) {
        // The convenience path: the gesture passed but no key came back, so
        // the PIN is still required. Say so rather than failing silently.
        setMessage('Fingerprint recognised — enter your PIN to unlock the data.');
        return;
      }
      await keyring.unlockWithRawKey(rawKey);
      limiter.recordSuccess();
      onUnlocked({ method: 'biometric' });
    } catch (err) {
      if (err.code !== 'cancelled') setMessage(userMessage(err), 'error');
    }
  }

  async function recover() {
    const { modal } = await import('../ui/components/modal.js');
    const input = h('textarea', {
      class: 'textarea mono',
      rows: 2,
      placeholder: 'amber-anchor-basil-cedar-coral',
      'aria-label': 'Recovery phrase',
    });

    const { close } = modal({
      title: 'Use your recovery phrase',
      body: h('div', { class: 'stack' }, [
        h('p', { class: 'small muted' },
          'The phrase printed when you set FamilyOS up. It unlocks the same data '
          + 'as your PIN. If you do not have it, the data on this device cannot be '
          + 'recovered — sign in on a device that is still unlocked, or start again '
          + 'and sync from Google.'),
        input,
      ]),
      footer: [
        button('Cancel', { variant: 'subtle', onClick: () => close() }),
        button('Unlock', {
          variant: 'primary',
          onClick: async () => {
            try {
              await keyring.unlockWithRecoveryPhrase(input.value.trim());
              close();
              onUnlocked({ method: 'recovery' });
            } catch (err) {
              toast(userMessage(err), { kind: 'error' });
            }
          },
        }),
      ],
    });
  }

  /**
   * Sign in with a one-time code, on a device that has never seen this
   * household — in place of the recovery phrase.
   *
   * Offered only in `enrol` mode. A device that is already set up has its own
   * wrapping and a PIN that opens it; adding a second, weaker way in there
   * would widen the household's exposure and buy nothing.
   *
   * The unlock itself is `unlockFreshDevice`, the same function the Google
   * path uses, with the escrow being this one — including the rollback that
   * un-adopts a wrapping which turns out not to open. That is the reason this
   * is nine lines rather than sixty.
   */
  async function withCode() {
    if (!offerCode) return;
    const { modal } = await import('../ui/components/modal.js');

    const address = h('input', {
      class: 'input', type: 'text', 'aria-label': t('signin.code.addressLabel'),
      placeholder: 'you@example.com',
    });
    const codeBox = h('input', {
      class: 'input', type: 'text', inputmode: 'numeric', maxlength: '6',
      autocomplete: 'one-time-code', 'aria-label': t('signin.code.codeLabel'),
    });
    const note = h('p', { class: 'small muted', role: 'status' });
    const step = h('div', { class: 'stack' }, [address]);
    const action = button(t('signin.code.send'), { variant: 'primary' });

    const { close } = modal({
      title: t('signin.code.title'),
      body: h('div', { class: 'stack' }, [
        h('p', { class: 'small muted' }, t('signin.code.intro')),
        step,
        note,
      ]),
      footer: [
        button(t('signin.code.cancel'), { variant: 'subtle', onClick: () => close() }),
        action,
      ],
    });

    let sent = false;
    action.onclick = async () => {
      const value = address.value.trim();
      const channel = value.includes('@') ? 'email' : 'sms';
      note.textContent = '';

      try {
        if (!sent) {
          if (!addressLooksSendable(value, channel)) {
            note.textContent = t('signin.code.badAddress');
            return;
          }
          await codeEscrow.request(channel, value);
          sent = true;
          replace(step, [codeBox]);
          action.textContent = t('signin.code.unlock');
          note.textContent = t('signin.code.onItsWay');
          focus(codeBox);
          return;
        }

        if (!codeLooksComplete(codeBox.value)) {
          note.textContent = t('signin.code.sixDigits');
          return;
        }

        const { personId, unlocks } = await codeEscrow.verify(value, codeBox.value.trim());
        if (!unlocks) {
          // Verified, and this person has no escrow. Saying which of the two
          // happened matters: "wrong code" would send somebody looking for a
          // typo that is not there.
          note.textContent = t('signin.code.notEnrolled');
          return;
        }

        await unlockFreshDevice(keyring, codeEscrow, value, CODE_METHOD);
        close();
        // Not a first run: the household already existed, its recovery phrase
        // was printed on the first device, and printing a second sheet would
        // wrap the same key twice and imply the first no longer counts.
        onUnlocked({ method: CODE_METHOD, firstRun: false, personId });
      } catch (err) {
        note.textContent = userMessage(err);
      }
    };
  }

  const keypad = h('div', { class: 'keypad' }, [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button', {
      type: 'button', onClick: () => press(d), 'aria-label': d,
    }, d)),
    h('button', {
      type: 'button', 'aria-label': 'Backspace', onClick: back,
    }, icon('chevronLeft')),
    h('button', { type: 'button', onClick: () => press('0'), 'aria-label': '0' }, '0'),
    h('button', {
      type: 'button', 'aria-label': mode === 'enrol' ? 'Done' : 'Unlock', onClick: submit,
    }, icon('check')),
  ]);

  // A physical keyboard should work too — a desktop user should not have to
  // reach for the mouse to type six digits.
  root.addEventListener('keydown', (event) => {
    if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); back(); }
    else if (event.key === 'Enter') { event.preventDefault(); submit(); }
  });

  /**
   * Sign in with Google, and be in.
   *
   * On a fresh household this mints a key and enrols it; on a device that has
   * never seen this household it fetches the one already in their Drive.
   * Either way it ends unlocked with backup already configured, which is the
   * whole reason to offer it.
   */
  async function withGoogle() {
    if (!offerGoogle) return;
    replace(message, 'Opening Google…');

    try {
      const { auth, escrow, email } = await connectGoogleUnlock();

      if (mode === 'enrol') {
        // Reads the account before minting anything. A device with no keyring
        // is *always* on this path — including the household's second phone —
        // and minting first is what used to write over the first phone's key.
        const { outcome } = await unlockFreshDevice(keyring, escrow, email);
        onUnlocked({
          method: GOOGLE_METHOD,
          // An adopted key belongs to a household that already exists, so this
          // is not a first run: the recovery phrase was printed on the first
          // device, and printing a second one would wrap the same key twice
          // and imply the first sheet of paper no longer counts.
          firstRun: outcome === 'found',
          googleSession: auth,
        });
        return;
      }

      // Unlocking a device that is already set up needs only the bytes: its
      // own wrapping is already in its keyring. The wrapping in the file is
      // for devices that have none, which is why its absence is not checked
      // here and is fatal in `unlockFreshDevice`.
      const record = await escrow.read();
      if (!record) {
        replace(message, 'That Google account has no FamilyOS key on it. '
          + 'Use your PIN, or your recovery phrase.');
        return;
      }
      await keyring.unlockWithRawKey(record.rawKey, GOOGLE_METHOD);
      limiter?.clear?.();
      onUnlocked({ method: GOOGLE_METHOD, googleSession: auth });
    } catch (err) {
      replace(message, userMessage(err));
    }
  }

  // Offered on a fresh device, and on a known one that has actually enrolled
  // it. A button that can only say "there is no key on that account" is not
  // worth a person's time.
  const offerGoogle = googleUnlockAvailable() && (mode === 'enrol' || googleEnrolled);

  // Fresh devices only, and only where there is a backend to answer. A button
  // whose only outcome is "no server is configured" is not worth a person's
  // time — the same argument `offerGoogle` makes one line above.
  const offerCode = mode === 'enrol' && Boolean(codeEscrow?.configured);

  const googleOption = () => (offerGoogle
    ? h('div', { class: 'stack stack--tight' }, [
      button(mode === 'enrol' ? 'Continue with Google' : 'Sign in with Google', {
        variant: 'primary', iconName: 'cloud', onClick: withGoogle,
      }),
      // Said here, where the choice is made, and not in a document nobody
      // opens. A household picking the fast path should know what it gives up.
      h('p', { class: 'small faint' }, mode === 'enrol'
        ? 'Fastest, and it sets up backup at the same time. Your unlock key is kept '
          + 'in your own Google Drive, so anyone who can sign in as you can read this '
          + 'data. A PIN is the stronger choice — you can have both.'
        : 'Signs you in and syncs, on any device.'),
      h('div', { class: 'lock-or' }, mode === 'enrol' ? 'or choose a PIN' : 'or use your PIN'),
    ])
    : null);

  replace(card, [
    h('div', { class: 'brand-mark', style: { margin: '0 auto', width: '48px', height: '48px' } }, 'FO'),
    h('h1', { style: { fontSize: 'var(--text-xl)' } },
      mode === 'enrol' ? 'Choose a PIN' : 'Welcome back'),
    googleOption(),
    h('p', { class: 'small muted' }, mode === 'enrol'
      ? 'This PIN encrypts everything sensitive in FamilyOS. It is not stored anywhere '
        + 'and cannot be reset for you.'
      : 'Enter your PIN to unlock.'),
    dots,
    message,
    keypad,
    h('div', { class: 'stack stack--tight' }, [
      mode === 'unlock' && biometricCredentialId
        ? button('Use fingerprint', { variant: 'subtle', iconName: 'fingerprint', onClick: biometric })
        : null,
      mode === 'unlock'
        ? h('button', {
          class: 'btn btn--small', type: 'button', onClick: recover,
        }, 'I have forgotten my PIN')
        : null,
      offerCode
        ? h('button', {
          class: 'btn btn--small', type: 'button', onClick: withCode,
        }, t('signin.code.offer'))
        : null,
    ]),
  ]);

  renderDots();

  // Offer the fingerprint immediately rather than making the user ask for it.
  if (mode === 'unlock' && biometricCredentialId) {
    platformAuthenticatorAvailable().then((ok) => { if (ok) biometric(); });
  }

  focus(root);
  root.setAttribute('tabindex', '-1');
  return root;
}

/**
 * Shown once, after enrolment. The phrase is the only way back in if the PIN
 * is forgotten on a device that has never synced, so this screen does not let
 * the user past it without acknowledging that.
 */
export function recoveryKitScreen({ keyring, onDone }) {
  const phrase = generatePassphrase(6);
  const confirmed = h('input', { type: 'checkbox', id: 'kit-ack' });

  const continueButton = button('I have written it down', {
    variant: 'primary',
    disabled: true,
    onClick: async () => {
      await keyring.createRecoveryKey(phrase);
      onDone(phrase);
    },
  });

  confirmed.addEventListener('change', () => {
    continueButton.disabled = !confirmed.checked;
  });

  return h('div', { class: 'lock-screen' }, h('div', { class: 'lock-card' }, [
    icon('key', { size: 36, class: 'faint' }),
    h('h1', { style: { fontSize: 'var(--text-xl)' } }, 'Your recovery phrase'),
    h('p', { class: 'small muted' },
      'Write this down and keep it somewhere safe and physical. It is the only way '
      + 'into your data if you forget your PIN. Nobody — not Google, not us — can '
      + 'recover it for you.'),
    h('div', {
      class: 'card card--quiet mono',
      style: { fontSize: 'var(--text-lg)', letterSpacing: '0.04em', lineHeight: '1.8' },
    }, phrase),
    h('div', { class: 'row' }, [
      button('Copy', {
        variant: 'subtle', iconName: 'copy',
        onClick: () => navigator.clipboard?.writeText(phrase)
          .then(() => toast('Copied. Paste it somewhere permanent, then clear your clipboard.')),
      }),
      button('Print', { variant: 'subtle', iconName: 'print', onClick: () => globalThis.print() }),
    ]),
    h('label', { class: 'checkbox', for: 'kit-ack' }, [
      confirmed,
      h('span', { class: 'small' }, 'I have written down my recovery phrase.'),
    ]),
    continueButton,
  ]));
}
