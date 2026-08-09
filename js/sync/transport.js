/**
 * The Apps Script client.
 *
 * Two constraints shape this file, and both are Apps Script's rather than
 * ours:
 *
 * 1. **No CORS preflight.** A published web app answers `POST` but not
 *    `OPTIONS`. Any request that triggers a preflight — a custom header, or a
 *    JSON content type — fails before it is sent. So the body goes as
 *    `text/plain` and the access token travels inside it. That is a simple
 *    request under the CORS rules and needs no preflight.
 *
 * 2. **Six minutes.** An Apps Script execution is killed at six minutes with
 *    no useful response. Every call is therefore batched and bounded, and the
 *    client sets a shorter deadline of its own so a hung request surfaces as
 *    a retryable error rather than a spinner that never stops.
 *
 * Everything here reports failure as a `TransportError` carrying whether the
 * failure is worth retrying. The outbox depends on that answer.
 */

import { TransportError } from '../core/errors.js';

const DEFAULT_TIMEOUT_MS = 90_000;

export class AppsScriptTransport {
  #url;
  #getToken;
  #fetch;
  #timeout;
  #deviceId;
  #clientVersion;

  /**
   * @param {{url: string, getToken: () => Promise<string>, fetchImpl?: typeof fetch,
   *          timeoutMs?: number, deviceId?: string, clientVersion?: string}} options
   */
  constructor(options) {
    this.#url = options.url;
    this.#getToken = options.getToken;
    this.#fetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.#timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#deviceId = options.deviceId ?? '';
    this.#clientVersion = options.clientVersion ?? '1.0.0';
  }

  get configured() {
    return Boolean(this.#url);
  }

  async call(action, payload = {}) {
    if (!this.#url) {
      throw new TransportError('no Apps Script URL is configured', { status: 0, retryable: false });
    }
    if (!this.#fetch) {
      throw new TransportError('this runtime has no fetch', { status: 0, retryable: false });
    }

    const token = await this.#getToken();
    if (!token) {
      // Not retryable: retrying without an interactive sign-in produces the
      // same answer forever, and the outbox would spin on it.
      throw new TransportError('not signed in to Google', { status: 401, retryable: false });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeout);

    let response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        // Deliberately text/plain — see the note at the top of this file.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action,
          token,
          deviceId: this.#deviceId,
          clientVersion: this.#clientVersion,
          payload,
        }),
        signal: controller.signal,
        redirect: 'follow', // Apps Script answers through a 302 to googleusercontent
        credentials: 'omit',
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err?.name === 'AbortError';
      throw new TransportError(
        aborted ? `${action} timed out` : `could not reach Google: ${err.message}`,
        { status: 0, cause: err, retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new TransportError(`${action} failed with ${response.status}`, {
        status: response.status,
        body: text.slice(0, 500),
      });
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // Apps Script serves its sign-in and error pages as HTML with a 200.
      // Treating that as success would corrupt the local store with nothing.
      const looksLikeLogin = /accounts\.google\.com|sign in/i.test(text);
      throw new TransportError(
        looksLikeLogin
          ? 'Google asked for sign-in — reauthorise FamilyOS in Settings'
          : `${action} returned something that is not JSON`,
        { status: looksLikeLogin ? 401 : 502, retryable: !looksLikeLogin, body: text.slice(0, 300) },
      );
    }

    if (body.ok === false) {
      throw new TransportError(body.error ?? `${action} was rejected`, {
        status: body.status ?? 400,
        retryable: body.retryable ?? false,
        body,
      });
    }

    return body.data ?? body;
  }

  /* ------------------------------------------------------------ operations */

  /** Create the workbook, the tabs and the Drive tree. Idempotent. */
  bootstrap(manifest) {
    return this.call('bootstrap', { manifest });
  }

  /** Additive sheet migration for a changed schema. Idempotent. */
  migrate(manifest) {
    return this.call('schema', { manifest });
  }

  /**
   * @param {Array<{store, op, recordId, payload, rev}>} changes
   * @returns {Promise<{applied: string[], rejected: Array<{recordId, reason}>,
   *                    conflicts: Array<{store, record}>}>}
   */
  push(changes) {
    return this.call('push', { changes });
  }

  /**
   * @param {Record<string, string>} cursors per-store high-water marks
   * @returns {Promise<{records: Record<string, object[]>, cursors: object, more: boolean}>}
   */
  pull(cursors, limit) {
    return this.call('pull', { cursors, limit });
  }

  appendAudit(entries) {
    return this.call('audit', { entries });
  }

  /**
   * Drive upload. `content` is base64; Apps Script cannot take a stream.
   * `person` is `{ id, name }` or null, and decides which folder the file
   * lands in — dropping it here would file everybody's papers together.
   */
  upload({ name, mimeType, content, category, documentId, person, ocr }) {
    return this.call('upload', { name, mimeType, content, category, documentId, person, ocr });
  }

  download(fileId) {
    return this.call('download', { fileId });
  }

  fileVersions(fileId) {
    return this.call('versions', { fileId });
  }

  /** The per-person document folders that exist in Drive. */
  personFolders() {
    return this.call('folders', {});
  }

  /**
   * Receipts from the household's own Gmail. The query is built by
   * `domain/merchants.js` and names the senders it is for; the server refuses
   * one that does not.
   */
  mail(query, limit = 100) {
    return this.call('mail', { query, limit });
  }

  /** Row counts per sheet, to verify a backup actually landed. */
  verify() {
    return this.call('verify', {});
  }
}

/**
 * A transport that answers from a script, for tests and for the demo mode
 * that lets someone try FamilyOS before connecting a Google account.
 */
export class FakeTransport {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.calls = [];
  }

  get configured() { return true; }

  async call(action, payload) {
    this.calls.push({ action, payload });
    const handler = this.handlers[action];
    if (!handler) {
      throw new TransportError(`no handler for ${action}`, { status: 501, retryable: false });
    }
    return handler(payload, this);
  }

  bootstrap(manifest) { return this.call('bootstrap', { manifest }); }
  migrate(manifest) { return this.call('schema', { manifest }); }
  push(changes) { return this.call('push', { changes }); }
  pull(cursors, limit) { return this.call('pull', { cursors, limit }); }
  appendAudit(entries) { return this.call('audit', { entries }); }
  upload(file) { return this.call('upload', file); }
  download(fileId) { return this.call('download', { fileId }); }
  fileVersions(fileId) { return this.call('versions', { fileId }); }
  personFolders() { return this.call('folders', {}); }
  mail(query, limit) { return this.call('mail', { query, limit }); }
  verify() { return this.call('verify', {}); }
}
