/**
 * Confirming which household member is using this device.
 *
 * ## What a confirmed code means, and the much larger thing it does not
 *
 * FamilyOS asks, on first unlock, which of the people in the household you
 * are. That answer is a stored choice, and anybody holding the unlocked device
 * can change it. Sending a code to an address already on that person's record
 * makes the answer harder to get wrong — a member picks themselves, not
 * whoever was at the top of a list.
 *
 * **It is not a lock, and this file will not let a screen imply it is.**
 *
 *   - The device PIN is what keeps somebody out.
 *   - The encryption keys are what keep the records unreadable.
 *   - A verified code tells a *browser* that an address answered. A browser is
 *     not a place an authorisation decision can be enforced; anybody who can
 *     open a developer console can set the same flag.
 *
 * Signing in this way decrypts nothing. A new phone still sees no messages
 * until it is enrolled, and only the recovery phrase reaches conversations
 * from before then. `WHAT_IT_DOES_NOT_DO` is exported so the screen renders
 * those sentences rather than inventing kinder ones.
 */

/**
 * @typedef {{step: string, channel: 'email'|'sms', address: string,
 *            error: string|null, personId: string|null}} Flow
 *
 * Declared rather than inferred. Without it TypeScript reads `start()` as
 * returning `step: 'address'` — the literal, not the union — and every later
 * assignment in a screen becomes an error about a type that has "no overlap"
 * with the step it is about to move to. The screens would then each carry a
 * cast, which is a lie repeated per file instead of a type written once.
 */

/** The states the flow can be in. Nothing else is a state. */
export const STEP = Object.freeze({
  address: 'address',
  code: 'code',
  done: 'done',
});

/**
 * The sentences a screen must show, in the words this file chose.
 *
 * Exported rather than left to each screen because the temptation, on a
 * sign-in page, is to write something shorter and warmer that happens to imply
 * the code is protecting something.
 */
export const WHAT_IT_DOES_NOT_DO = Object.freeze([
  'otp.limit.notALock',
  'otp.limit.notAKey',
  'otp.limit.enrolStill',
]);

/**
 * Is this something a code could be sent to?
 *
 * Deliberately loose. The server decides whether an address belongs to
 * anybody, and answers the same either way; this only catches the typo a
 * person can see, so nobody waits ten minutes for a code that was never going
 * anywhere.
 *
 * @param {string} address
 * @param {'email'|'sms'} channel
 */
export function addressLooksSendable(address, channel) {
  const value = String(address ?? '').trim();
  if (!value) return false;
  if (channel === 'sms') {
    const digits = value.replace(/[^\d]/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/** A code is six digits and nothing else. */
export function codeLooksComplete(code) {
  return /^\d{6}$/.test(String(code ?? '').trim());
}

/**
 * Advance the flow.
 *
 * A pure reducer so the whole sequence — including every refusal — can be
 * tested without a network or a DOM. The screen holds one of these and draws
 * it; it makes no decisions of its own.
 *
 * @param {Flow} state
 * @param {{type: string} & Record<string, any>} event
 * @returns {Flow}
 */
export function advance(state, event) {
  switch (event.type) {
    case 'channel':
      // Changing channel clears the address: a phone number left in the box
      // after switching to email is a code nobody receives.
      return { ...state, channel: event.channel, address: '', error: null };

    case 'address':
      return { ...state, address: event.address, error: null };

    case 'sent':
      return { ...state, step: STEP.code, error: null };

    case 'verified':
      return {
        ...state,
        step: STEP.done,
        error: null,
        // Whatever the server said, and only that. A screen that filled this
        // in from the address it had would be trusting itself.
        personId: event.personId ?? null,
      };

    case 'failed':
      /*
       * A failure never advances, and never silently retreats either.
       *
       * Dropping back to the address step on a wrong code would throw away a
       * code that is still valid and charge the rate limit for another —
       * which is the failure mode that makes people give up on a sign-in.
       */
      // Whatever the caller was told, and no invented fallback. A reducer
      // that writes its own copy is a reducer writing untranslated English
      // into a file no catalogue reaches; the screen supplies the words.
      return { ...state, error: String(event.error ?? '') };

    case 'restart':
      return start(state.channel);

    default:
      return state;
  }
}

/**
 * @param {'email'|'sms'} [channel]
 * @returns {Flow}
 */
export function start(channel = 'email') {
  return { step: STEP.address, channel, address: '', error: null, personId: null };
}

/**
 * Whether the button on the current step should be enabled.
 *
 * @param {Flow} state
 * @param {string} [code]
 */
export function canSubmit(state, code = '') {
  if (state.step === STEP.address) return addressLooksSendable(state.address, state.channel);
  if (state.step === STEP.code) return codeLooksComplete(code);
  return false;
}
