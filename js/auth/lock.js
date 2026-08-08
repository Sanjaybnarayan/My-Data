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
import { userMessage } from '../core/errors.js';
import { generatePassphrase } from '../security/crypto.js';

const PIN_LENGTH_MIN = 4;
const PIN_LENGTH_MAX = 12;

/**
 * @param {{keyring, limiter, biometricCredentialId?: string,
 *          onUnlocked: Function, mode?: 'unlock'|'enrol'}} options
 * @returns {Node}
 */
export function lockScreen({ keyring, limiter, biometricCredentialId, onUnlocked, mode = 'unlock' }) {
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

  replace(card, [
    h('div', { class: 'brand-mark', style: { margin: '0 auto', width: '48px', height: '48px' } }, 'FO'),
    h('h1', { style: { fontSize: 'var(--text-xl)' } },
      mode === 'enrol' ? 'Choose a PIN' : 'Welcome back'),
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
