/**
 * The rows of the "what was read from this file" card.
 *
 * Lifted out of `js/modules/documents.js` when `tools/module-size.mjs` refused
 * to let it past 800 lines — the same move `receipts-parts.js` and
 * `statements-parts.js` made before it.
 *
 * Both take an `onRecord` callback rather than reaching for the service
 * themselves. That is not only to break the closure: it keeps the decision of
 * *what a button writes* on the screen that owns the record, and leaves these
 * as what they are — two shapes of row.
 */

import { h } from '../ui/dom.js';
import { button } from '../ui/components/basics.js';
import { userMessage } from '../core/errors.js';
import { toast } from '../ui/components/toast.js';
import { t } from '../core/locale.js';

export function offerRow(offer, { onRecord }) {
  const line = (text, tone) => h('p', { class: `small ${tone}` }, text);

  if (offer.state === 'recorded') {
    return line(`The ${offer.kind} on this document is already recorded — ${offer.masked}.`, 'faint');
  }
  if (offer.state !== 'offer') {
    return line(`${offer.kind} ${offer.masked}: ${offer.why}.`, 'muted');
  }

  return h('div', { class: 'row row--between', style: { gap: 'var(--space-3)' } }, [
    h('span', { class: 'small' },
      `A ${offer.kind} — ${offer.masked} — is on this document and is not recorded anywhere.`),
    button('Record it', {
      variant: 'subtle',
      onClick: async () => {
        try {
          await onRecord(offer);
        } catch (err) {
          toast(userMessage(err), { kind: 'error' });
        }
      },
    }),
  ]);
}

/**
 * One detail a document offers a person record.
 *
 * The value is shown, not masked. A masked name cannot be checked, and
 * checking it is the whole job this row asks of a person — unlike an
 * identity number, where the point is to keep it off the screen.
 */
export function detailRow(detail, { onRecord }) {
  return h('div', { class: 'row row--between', style: { gap: 'var(--space-3)' } }, [
    // Two nodes rather than one template: the label is a schema label and the
    // value is the person's own, and nothing between them is a sentence.
    h('span', { class: 'small' }, [
      h('strong', {}, detail.label),
      ': ',
      detail.value,
    ]),
    button(t('identity.person.record'), {
      variant: 'subtle',
      onClick: async () => {
        try {
          await onRecord(detail);
        } catch (err) {
          toast(userMessage(err), { kind: 'error' });
        }
      },
    }),
  ]);
}
