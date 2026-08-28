/**
 * Confirming which household member is using this device.
 *
 * ## The card, and the sentence it must never let itself write
 *
 * FamilyOS asks on first unlock which of the people in the household you are,
 * and that answer is a stored choice anybody holding the unlocked device can
 * change. Sending a code to an address already on that person's record makes
 * the answer harder to get wrong.
 *
 * It does **not** make it a lock, and the three sentences under the form say
 * so. They come from `WHAT_IT_DOES_NOT_DO` in the domain rather than being
 * written here, because the temptation on a sign-in card is to write something
 * shorter and warmer that quietly implies the code is protecting something.
 *
 * ## Nothing is offered that cannot work
 *
 * With no Apps Script URL configured there is no server to send or check a
 * code, so the card says that instead of drawing a button whose only outcome
 * is an error toast. That is the same fault the chat composer had — a form
 * that takes your typing and fails afterwards — and it is worth not repeating.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, button, chip } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { app } from '../context.js';
import { userMessage } from '../core/errors.js';
import { t } from '../core/locale.js';
import {
  STEP, WHAT_IT_DOES_NOT_DO, advance, start, canSubmit,
} from '../domain/otp.js';

const CHANNELS = Object.freeze(['email', 'sms']);

/**
 * @param {() => Promise<void>|void} [onVerified] so the screen around it can
 *   redraw once the person is known
 */
export function signInCard(onVerified) {
  const host = h('div', {});
  const { db, transport } = app();

  let state = start();
  let code = '';
  let busy = false;

  const addressBox = h('input', {
    class: 'input', type: 'text', id: 'otp-address',
    onInput: (event) => { state = advance(state, { type: 'address', address: event.target.value }); },
  });

  const codeBox = h('input', {
    class: 'input', type: 'text', inputmode: 'numeric', id: 'otp-code',
    maxlength: '6', autocomplete: 'one-time-code',
    onInput: (event) => { code = event.target.value; },
  });

  async function run(work) {
    if (busy) return;
    busy = true;
    try {
      await work();
    } catch (error) {
      // The reducer records it; it does not invent wording of its own.
      state = advance(state, { type: 'failed', error: userMessage(error) });
    } finally {
      busy = false;
      paint();
    }
  }

  const send = () => run(async () => {
    await transport.callPublic('otp.request', {
      channel: state.channel, address: state.address,
    });
    state = advance(state, { type: 'sent' });
    code = '';
  });

  const verify = () => run(async () => {
    const answer = await transport.callPublic('otp.verify', {
      address: state.address, code,
    });
    // The person the server named, and only that.
    state = advance(state, { type: 'verified', personId: answer?.personId });

    if (state.personId) {
      await db.setMeta('auth.currentPerson', state.personId);
      toast(t('otp.confirmed'), { kind: 'success' });
      await onVerified?.();
    }
  });

  function limits() {
    return h('div', { class: 'stack stack--tight' },
      WHAT_IT_DOES_NOT_DO.map((key) => h('p', { class: ['small', 'muted'] }, t(key))));
  }

  function paint() {
    // Offered only when there is something to answer it. See the note above.
    if (!transport?.configured) {
      replace(host, [card({ class: 'card--quiet' }, [
        cardHeader(t('otp.title'), badge(t('otp.unavailable'), 'muted'), { iconName: 'phone' }),
        h('p', { class: 'small' }, t('otp.noBackend')),
        limits(),
      ])]);
      return;
    }

    const body = state.step === STEP.done
      ? [h('p', { class: 'small' }, t('otp.done'))]
      : state.step === STEP.code
        ? [
          h('p', { class: 'small' }, t('otp.sentTo', { address: state.address })),
          h('label', { class: 'field-label', for: 'otp-code' }, t('otp.codeLabel')),
          codeBox,
          h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
            button(t('otp.verify'), {
              variant: 'primary',
              disabled: !canSubmit(state, code),
              onClick: verify,
            }),
            button(t('otp.startAgain'), {
              variant: 'subtle',
              onClick: () => { state = advance(state, { type: 'restart' }); code = ''; paint(); },
            }),
          ]),
        ]
        : [
          h('div', { class: 'chip-row', role: 'group', 'aria-label': t('otp.channel') },
            CHANNELS.map((one) => chip(t(`otp.channel.${one}`), {
              pressed: state.channel === one,
              onClick: () => {
                state = advance(state, { type: 'channel', channel: one });
                paint();
              },
            }))),
          h('label', { class: 'field-label', for: 'otp-address' },
            t(state.channel === 'sms' ? 'otp.numberLabel' : 'otp.emailLabel')),
          addressBox,
          button(t('otp.send'), {
            variant: 'primary',
            disabled: !canSubmit(state),
            onClick: send,
          }),
        ];

    replace(host, [card({}, [
      cardHeader(t('otp.title'), null, { iconName: 'phone' }),
      h('p', { class: ['small', 'muted'] }, t('otp.body')),
      ...body,
      state.error ? h('p', { class: 'small money--negative' }, state.error) : null,
      limits(),
    ].filter(Boolean))]);

    // The box is rebuilt by `replace`, so put back what was in it.
    addressBox.value = state.address;
    codeBox.value = code;
  }

  paint();
  return host;
}
