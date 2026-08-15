/**
 * Errors.
 *
 * Three things need to be told apart at a catch site, and a message string
 * cannot do it:
 *
 *   - the user typed something wrong        → show it on the field
 *   - they are not allowed to do this       → show it once, do not retry
 *   - the network failed                    → queue it and retry later
 *
 * The sync engine's backoff turns entirely on the third distinction: retrying
 * a rejected write forever is how an outbox stops draining.
 */

export class AppError extends Error {
  /** @param {{code?: string, cause?: unknown, details?: object}} [options] */
  constructor(message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? 'error';
    this.details = options.details ?? {};
  }

  /** Safe to show a user as-is. Subclasses that leak internals override this. */
  get userMessage() {
    return this.message;
  }
}

/** One or more fields failed schema validation. Never retryable. */
export class ValidationError extends AppError {
  /** @param {Array<{field: string, message: string}>} issues */
  constructor(issues, entity = '') {
    const first = issues[0];
    super(first ? `${first.field}: ${first.message}` : 'invalid record',
      { code: 'validation', details: { issues, entity } });
    this.issues = issues;
  }

  get userMessage() {
    return this.issues.length === 1
      ? this.issues[0].message
      : `${this.issues.length} fields need attention`;
  }
}

/** The signed-in role may not do this. Never retryable. */
export class PermissionError extends AppError {
  constructor(action, entity, role) {
    super(`role ${role} may not ${action} ${entity}`,
      { code: 'permission', details: { action, entity, role } });
  }

  get userMessage() {
    return 'You do not have permission to do that.';
  }
}

/**
 * The app is locked, or the session expired. Recoverable by unlocking.
 *
 * The message is the caller's — "that PIN is not right" and "the vault is
 * locked" are different things to a person holding the phone, and collapsing
 * both into one string tells them nothing about what to do next.
 */
export class LockedError extends AppError {
  constructor(message = 'the vault is locked', reason = 'locked') {
    super(message, { code: 'locked', details: { reason } });
  }

  get userMessage() {
    return 'Unlock FamilyOS to continue.';
  }
}

/**
 * The server or the network failed. `retryable` decides whether the outbox
 * backs off and tries again or parks the entry for a human.
 */
export class TransportError extends AppError {
  /**
   * @param {string} message
   * @param {{status?: number, retryable?: boolean|null, cause?: unknown,
   *          body?: string}} [options]
   */
  constructor(message, { status = 0, retryable = null, cause, body } = {}) {
    super(message, { code: 'transport', cause, details: { status, body } });
    this.status = status;
    // 408 and 429 are the two 4xx codes that mean "later", not "never".
    this.retryable = retryable ?? (status === 0 || status === 408 || status === 429 || status >= 500);
  }

  get userMessage() {
    return this.retryable
      ? 'Could not reach Google. Your changes are saved and will sync later.'
      : 'Google rejected the request. See Settings → Sync.';
  }
}

/** Two devices changed the same record and the merge needed arbitration. */
export class ConflictError extends AppError {
  constructor(store, recordId, fields) {
    super(`conflicting edits on ${store}/${recordId}`,
      { code: 'conflict', details: { store, recordId, fields } });
  }
}

export class StorageError extends AppError {
  constructor(message, cause) {
    super(message, { code: 'storage', cause });
  }

  get userMessage() {
    return 'This device could not save the change. Check available storage.';
  }
}

/** True when a failure is worth trying again unchanged. */
export function isRetryable(err) {
  if (err instanceof TransportError) return err.retryable;
  if (err instanceof ValidationError) return false;
  if (err instanceof PermissionError) return false;
  if (err instanceof LockedError) return false;
  // An unrecognised failure is treated as transient once; the attempt cap
  // stops it from retrying forever.
  return true;
}

export function userMessage(err) {
  if (err instanceof AppError) return err.userMessage;
  return 'Something went wrong. The change was not saved.';
}
