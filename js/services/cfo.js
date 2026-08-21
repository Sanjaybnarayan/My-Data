/**
 * Where the household's money stands, on one page.
 *
 * The assembly lives in `domain/cfo.js` and is pure; this fetches. The split
 * matters here more than usual: ten figures drawn from six modules is exactly
 * the kind of thing that ends up computed inline in a screen and testable only
 * through a browser.
 */

import { Service, TRANSACTION_LIMIT } from './service.js';
import { position } from '../domain/cfo.js';

/** @type {Record<string, import('./service.js').Load>} */
export const CFO_LOAD = Object.freeze({
  accounts: ['account', { decrypt: false, limit: 500 }],
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  holdings: ['holding', { decrypt: false, limit: 500 }],
  properties: ['property', { decrypt: false, limit: 200 }],
  vehicles: ['vehicle', { decrypt: false, limit: 200 }],
  loans: ['loan', { decrypt: false, limit: 200 }],
  recurring: ['recurringPayment', { decrypt: false, limit: 500 }],
  subscriptions: ['subscription', { decrypt: false, limit: 500 }],
  digitalAssets: ['digitalAsset', { decrypt: false, limit: 500 }],
  goals: ['goal', { decrypt: false, limit: 500 }],
});

export class CfoService extends Service {
  /** @param {{clock?: () => number}} [options] */
  async position({ clock = Date.now } = {}) {
    return position(await this.load(CFO_LOAD), { clock });
  }
}
