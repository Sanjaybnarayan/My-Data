/**
 * The application context.
 *
 * One object holding the database, the sync engine, the Google client and the
 * router, set once at boot and read by the lazily-imported module screens.
 *
 * A module could take these as arguments instead, but every screen would then
 * thread four parameters it does not use down to the one place that does. This
 * is the seam where that stops. It is deliberately the *only* mutable global
 * in the codebase, it is written once, and reading it before boot throws
 * rather than handing back a half-built application.
 */

import { AppError } from './core/errors.js';

let context = null;

export function setContext(value) {
  context = Object.freeze(value);
  return context;
}

export function app() {
  if (!context) throw new AppError('the application has not booted yet', { code: 'no-context' });
  return context;
}

export function hasContext() {
  return context !== null;
}

/** For tests, and for the sign-out path that rebuilds everything. */
export function clearContext() {
  context = null;
}
