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
 * **Unless the household turned signing in by code on, it is not a lock, and
 * this file will not let a screen imply it is.**
 *
 *   - The device PIN is what keeps somebody out.
 *   - The encryption keys are what keep the records unreadable.
 *   - A verified code tells a *browser* that an address answered. A browser is
 *     not a place an authorisation decision can be enforced; anybody who can
 *     open a developer console can set the same flag.
 *
 * By default, signing in this way decrypts nothing. A new phone still sees no
 * messages until it is enrolled, and only the recovery phrase reaches
 * conversations from before then.
 *
 * ## And when they did turn it on, the same rule runs the other way
 *
 * A household can escrow the data key with their own backend so that a code
 * opens a new device in place of the recovery phrase — see
 * `security/codeescrow.js`. Every sentence in the paragraph above then becomes
 * false, and a screen still reciting it would be reassuring somebody about a
 * protection they no longer have. That is worse than the overclaiming this
 * file was written to stop, because it is the same mistake pointing at the
 * safer-sounding answer.
 *
 * So the sentences are chosen by `limitsFor`, from the three sets below — one
 * for each situation, including the one where a screen could not find out
 * which situation it is in. None of the three is a default.
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
 * And the sentences for a household that turned signing in by code on, where
 * the three above have stopped being true.
 *
 * Same job, opposite content: name the thing a person would otherwise have to
 * discover. There it was "this is weaker than you might assume"; here it is
 * "this is stronger than you might assume, and that is the problem".
 */
export const WHAT_A_CODE_NOW_DOES = Object.freeze([
  'otp.unlock.opensDevices',
  'otp.unlock.backendHolds',
  'otp.unlock.insteadOfPhrase',
]);

/**
 * And the sentence for a screen that has not been able to find out which of
 * the two it is.
 *
 * There is no safe guess here, and picking one was the first thing tried.
 * Defaulting to `WHAT_IT_DOES_NOT_DO` tells somebody a code cannot unlock
 * their records when it can — a false reassurance, which is the direction that
 * costs them. Defaulting the other way tells a household they turned on a
 * feature they did not, which is an alarm about nothing.
 *
 * Both are the same fault this repository keeps finding: an unread value
 * reported as an answer. So the third case is a third answer.
 */
export const WHAT_IS_NOT_KNOWN = Object.freeze([
  'otp.limit.unknown',
]);

/**
 * Which set of sentences this screen must show.
 *
 * @param {boolean|null} unlocksNewDevices whether this household escrowed the
 *   data key so a code opens a device that has nothing — `null` when the
 *   screen could not find out.
 */
export function limitsFor(unlocksNewDevices) {
  if (unlocksNewDevices === null || unlocksNewDevices === undefined) return WHAT_IS_NOT_KNOWN;
  return unlocksNewDevices ? WHAT_A_CODE_NOW_DOES : WHAT_IT_DOES_NOT_DO;
}

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
