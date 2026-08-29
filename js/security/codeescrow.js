/**
 * Signing in with a one-time code — and the thing it replaces.
 *
 * ## What this is
 *
 * A second escrow, alongside `DriveEscrow`. Same idea: the 32 bytes that
 * unwrap the data key, kept somewhere a device that has never seen this
 * household can reach, so that device can be let in. The difference is only
 * *where*. Drive keeps it in the household's Google account; this keeps it in
 * the household's own Apps Script deployment, released when a code sent to an
 * address on that person's record is typed back.
 *
 * ## What it costs, which is the whole point of reading this
 *
 * **The Apps Script deployment can decrypt the household's records.**
 *
 * It holds the wrapped data key and, in the same property store, the secret
 * that unwraps it. It has to: a new device starts with nothing, so for a
 * six-digit code to yield the data key, something the code reaches must hold
 * both halves. Anyone with the Google account that deployed the script — or
 * anyone that account is shared with, or anyone who phishes it — can read them
 * and open every record the household has.
 *
 * This is offered as a **replacement for the recovery phrase** on a new
 * device, and it is a weaker arrangement than the phrase it replaces. The
 * phrase is printed once and lives on paper; nothing stores it, so nothing can
 * leak it. Trading that for a code is a real trade, and it is stated here, in
 * `apps-script/Otp.gs`, in `docs/SIGN_IN_BY_CODE.md`, and on the Settings row
 * that turns it on — because a household that believed this was as strong as
 * what it replaced would be wrong in exactly the way that costs them.
 *
 * ## Why `read()` takes no arguments and can still return nothing
 *
 * There is no action that reads an escrow. The material arrives inside the
 * `otp.verify` reply, once, after the code matched — so this object holds what
 * it was given rather than fetching on demand, and `read()` before a verified
 * code answers null. That keeps the shape `unlockFreshDevice` expects without
 * inventing a readable endpoint, which would have made the escrow reachable by
 * anybody who knew the deployment URL.
 */

import { toBase64, fromBase64 } from './crypto.js';
import { AppError } from '../core/errors.js';
import { t } from '../core/locale.js';

/** The keyring entry this writes. Named so Settings can look for exactly it. */
export const CODE_METHOD = 'otp';

export class CodeEscrow {
  #transport;
  #released = null;

  /**
   * @param {{transport?: {configured?: boolean, call?: Function,
   *          callPublic?: Function}}} [options] every field optional because a
   *   copy with no backend configured builds one of these and asks
   *   `configured`, which must answer rather than throw.
   */
  constructor({ transport } = {}) {
    this.#transport = transport;
  }

  get configured() {
    return Boolean(this.#transport?.configured);
  }

  /** Ask for a code. The reply says nothing about whether the address is known. */
  async request(channel, address) {
    return this.#transport.callPublic('otp.request', { channel, address });
  }

  /**
   * Type the code back.
   *
   * Captures the escrow if one was released, and reports which of the two
   * things happened using the server's own word rather than by testing whether
   * a field arrived — `grants` is what the backend committed to, and a client
   * that inferred it from the shape of the reply would be guessing.
   *
   * @returns {Promise<{personId: string|null, unlocks: boolean}>}
   */
  async verify(address, code) {
    const answer = await this.#transport.callPublic('otp.verify', { address, code });
    const unlocks = answer?.grants === 'identity-and-unlock';

    this.#released = unlocks && answer?.unlock?.key && answer?.unlock?.wrapped?.iv
      ? { rawKey: fromBase64(answer.unlock.key), wrapped: answer.unlock.wrapped }
      : null;

    if (unlocks && !this.#released) {
      // The backend said it was releasing a key and did not. Refusing here is
      // the difference between a clear failure and a device that adopts half
      // an escrow and can never be opened again.
      throw new AppError(t('signin.code.halfEscrow'), { code: 'escrow-corrupt' });
    }

    return { personId: answer?.personId ?? null, unlocks };
  }

  /**
   * What the backend released to this device, in the shape `DriveEscrow.read`
   * returns — so the adopt-and-roll-back path is the same one, not a copy.
   *
   * @returns {Promise<{rawKey: Uint8Array, wrapped: {iv: string, key: string}}|null>}
   */
  async read() {
    return this.#released;
  }

  /**
   * Turn it on for one person. Requires being signed in and being the owner;
   * the backend checks both and this does not repeat the check, because a
   * refusal decided in a browser is not a refusal.
   *
   * @param {Uint8Array} bytes
   * @param {{iv: string, key: string}} wrapped the data key under `bytes`
   * @param {{personId: string, name?: string, email?: string, phone?: string}} who
   */
  async put(bytes, wrapped, who) {
    /*
     * Never from a device that arrived on a code.
     *
     * `unlockFreshDevice` has two branches: adopt what the escrow holds, or —
     * when it holds nothing — mint a data key and publish it. The second is
     * correct for a household's first device and catastrophic for its second,
     * because publishing writes over the key every other device depends on.
     * That is the bug `js/auth/google-unlock.js` was written to end, and the
     * code path reaches the same function.
     *
     * It cannot happen today: `verify` refuses a released escrow that is not
     * whole, so `read()` after a granted unlock is never null. But that is an
     * invariant held in another method for another reason, and the failure it
     * would allow is silent, total and permanent. So it is also refused here,
     * where the damage would be done.
     *
     * No check that `wrapped` is whole, though. The backend refuses a half
     * escrow with a 400 that names what is missing, and it is the side that
     * decides — a second copy of *that* rule is a second thing to keep in step.
     */
    if (this.#released) {
      throw new AppError(t('signin.code.wouldOverwrite'), { code: 'would-overwrite' });
    }
    return this.#transport.call('signin', {
      op: 'put',
      personId: who.personId,
      name: who.name ?? '',
      email: who.email ?? '',
      phone: who.phone ?? '',
      key: toBase64(bytes),
      wrapped,
    });
  }

  /** Turn it off, and take the key out of the deployment. */
  async drop(personId) {
    return this.#transport.call('signin', { op: 'drop', personId });
  }

  /**
   * Who can sign in this way, with addresses masked by the backend.
   *
   * @returns {Promise<Array<{personId: string, name: string, email: string,
   *                          phone: string, unlocks: boolean}>>}
   */
  async status() {
    const answer = await this.#transport.call('signin', { op: 'status' });
    return answer?.people ?? [];
  }
}
