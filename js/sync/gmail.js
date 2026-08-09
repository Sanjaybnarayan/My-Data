/**
 * Gmail, read from the browser.
 *
 * ## Why this exists alongside `apps-script/Gmail.gs`
 *
 * The Apps Script route is tighter: the Gmail permission is granted to a
 * script you deployed and can read, and no mail token ever exists in the page.
 * It also asks a household to deploy a separate Apps Script project for every
 * address its receipts arrive at, which is enough setup that most people will
 * do it once and never again — and a feature nobody sets up is a feature
 * nobody has.
 *
 * So this is the other way: sign in with a Google account, in a popup, and
 * read that account's mail directly. One click per mailbox, no deployment.
 *
 * ## The cost, stated plainly
 *
 * This puts a `gmail.readonly` token in the page for an hour at a time. Gmail
 * has no narrower scope that would work — `gmail.metadata` returns headers
 * without bodies, and a receipt's total is in the body, so it would buy a
 * permission that reads more politely and finds nothing.
 *
 * What that changes: a script injected into this application could already
 * reach the Drive and Sheets tokens it holds. With a mailbox connected it
 * could also read that mailbox. That is a real escalation and the reason both
 * routes are kept — a household that would rather not make the trade uses a
 * deployment and gives up nothing but convenience.
 *
 * The grant is separate from the sign-in the rest of the application uses.
 * Connecting a mailbox is its own consent, for its own account, revocable on
 * its own at <https://myaccount.google.com/permissions> without disturbing
 * sync.
 *
 * ## What is fetched
 *
 * The same query `domain/merchants.js` builds — senders and a date. Message
 * ids first, then each message; bodies are truncated on arrival to the same
 * few thousand characters the Apps Script route allows, because a receipt's
 * total sits near the top and the rest is marketing.
 */

import { TransportError } from '../core/errors.js';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Identity, plus the mail itself. Nothing about Drive or Sheets. */
export const MAIL_SCOPES = Object.freeze(['openid', 'email', GMAIL_SCOPE]);

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Gmail returns 500 ids a page; a receipt scan never wants more at once. */
const PAGE = 100;

export class GmailClient {
  #getToken;
  #fetch;
  #concurrency;
  #maxBodyChars;

  /**
   * @param {{getToken: () => Promise<string>, fetchImpl?: typeof fetch,
   *          concurrency?: number, maxBodyChars?: number}} options
   */
  constructor({ getToken, fetchImpl, concurrency = 6, maxBodyChars = 4000 } = {}) {
    this.#getToken = getToken;
    this.#fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    // Enough to be quick, few enough to stay well inside Gmail's per-second
    // quota. A scan that trips a rate limit is slower than one that does not
    // try to.
    this.#concurrency = concurrency;
    this.#maxBodyChars = maxBodyChars;
  }

  get configured() {
    return Boolean(this.#fetch && this.#getToken);
  }

  /**
   * The same shape `AppsScriptTransport.mail` returns, so the caller does not
   * care which route a mailbox uses.
   *
   * @param {string} query a Gmail search naming senders
   * @param {number} limit
   */
  async mail(query, limit = 100) {
    if (!query || !query.includes('from:')) {
      // The same refusal the backend makes. A query with no sender term is a
      // request to read the whole mailbox, and neither route will build or
      // send one.
      throw new TransportError('a mail search must name the senders it is for',
        { status: 400, retryable: false });
    }

    const ids = await this.#listIds(query, limit);
    const messages = await this.#pool(ids, (id) => this.#message(id));

    return {
      messages: messages.filter(Boolean),
      query,
      truncated: ids.length >= limit,
    };
  }

  async #listIds(query, limit) {
    const ids = [];
    let pageToken = '';

    while (ids.length < limit) {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(Math.min(PAGE, limit - ids.length)),
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.#call(`${API}/messages?${params}`);
      for (const message of page.messages ?? []) ids.push(message.id);

      pageToken = page.nextPageToken ?? '';
      if (!pageToken) break;
    }

    return ids.slice(0, limit);
  }

  async #message(id) {
    const message = await this.#call(`${API}/messages/${encodeURIComponent(id)}?format=full`);
    const headers = headerMap(message.payload?.headers);

    return {
      id: message.id,
      from: headers.from ?? '',
      subject: headers.subject ?? '',
      // `internalDate` is epoch milliseconds and always present, which is one
      // fewer date format to parse than the Date header's many.
      date: dayOf(message.internalDate, headers.date),
      body: readBody(message.payload).slice(0, this.#maxBodyChars),
    };
  }

  async #call(url) {
    const token = await this.#getToken();
    if (!token) {
      throw new TransportError('not signed in to this mailbox',
        { status: 401, retryable: false });
    }

    let response;
    try {
      response = await this.#fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      throw new TransportError(`could not reach Gmail: ${err.message}`,
        { status: 0, cause: err, retryable: true });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TransportError(
        response.status === 403
          ? 'this mailbox has not granted permission to read its mail'
          : `Gmail refused the request (${response.status})`,
        // 429 and 5xx are worth another go; a refusal is not.
        { status: response.status, retryable: response.status === 429 || response.status >= 500, body: body.slice(0, 300) },
      );
    }

    return response.json();
  }

  /**
   * Run `work` over `items`, a few at a time.
   *
   * A scan of two hundred messages is two hundred requests. All at once trips
   * Gmail's rate limit; one at a time takes a minute. A failure on one message
   * yields null rather than losing the other hundred and ninety-nine.
   */
  async #pool(items, work) {
    const out = new Array(items.length);
    let next = 0;

    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        try {
          out[index] = await work(items[index]);
        } catch {
          out[index] = null;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.#concurrency, items.length) }, worker),
    );
    return out;
  }
}

/* ----------------------------------------------------------------- parsing */

function headerMap(headers) {
  const map = {};
  for (const header of headers ?? []) map[String(header.name).toLowerCase()] = header.value;
  return map;
}

function dayOf(internalDate, headerDate) {
  const ms = Number(internalDate);
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date(headerDate ?? NaN);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/**
 * The readable text of a message.
 *
 * `text/plain` is preferred because a receipt's totals survive it and the
 * markup does not. Where a sender ships HTML only, the tags are stripped
 * rather than the message skipped — the total is in there, wrapped in a table
 * nobody needs.
 */
export function readBody(payload) {
  const plain = findPart(payload, 'text/plain');
  if (plain) return decode(plain);

  const html = findPart(payload, 'text/html');
  return html ? strip(decode(html)) : '';
}

function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part.body.data;

  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

/** Gmail encodes bodies base64url, and receipts are full of non-ASCII rupees. */
function decode(data) {
  try {
    const binary = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function strip(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8377;|&rupee;/g, '₹')
    .replace(/[ \t]+/g, ' ');
}
