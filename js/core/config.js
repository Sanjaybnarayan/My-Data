/**
 * Deployment configuration.
 *
 * These four values are the only things that differ between one family's
 * installation and another's. They are read from `familyos.config.json` at
 * boot when present, so a fork does not have to be edited to be deployed, and
 * fall back to the values here for local development.
 *
 * Nothing secret belongs in this file. The OAuth *client id* is public by
 * design; there is no client secret anywhere in FamilyOS because the browser
 * cannot keep one.
 */

export const defaults = Object.freeze({
  /** Google Cloud OAuth 2.0 Web client id. */
  googleClientId: '',

  /** Deployed Apps Script web app URL, ending in `/exec`. */
  apiUrl: '',

  /** Drive folder that holds the workbook and the document tree. */
  driveRootName: 'FamilyOS',

  /** Sheets workbook name, created on first bootstrap. */
  workbookName: 'FamilyOS Data',

  currency: 'INR',

  /** Minutes of inactivity before the data key is dropped from memory. */
  sessionTimeoutMinutes: 15,

  /** Unlock attempts allowed before a cooling-off period. */
  maxUnlockAttempts: 5,
  unlockLockoutSeconds: 60,

  /** PBKDF2 rounds for deriving the key-encryption key from the PIN. */
  pbkdf2Iterations: 600_000,

  /** Minutes between automatic sync runs while the app is open and online. */
  autoSyncMinutes: 10,

  /** Rows per pull/push batch. Apps Script times out at six minutes. */
  syncBatchSize: 500,

  /** Days ahead that a renewal or expiry starts appearing as a reminder. */
  reminderHorizonDays: 45,

  /** Rows past which a list switches to windowed rendering. */
  virtualListThreshold: 200,

  /**
   * When true, nothing leaves this device — no sync, no upload, no mail, no
   * key escrow. Off by default because a household that never turns it on
   * still gets a backup, and a backup nobody has is how records are lost.
   */
  localOnly: false,

  scopes: [
    'openid',
    'email',
    'profile',
    // drive.file is deliberately narrow: FamilyOS sees only the files it
    // creates, never the rest of the user's Drive.
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

let current = { ...defaults };

export function config() {
  return current;
}

export function configure(patch) {
  current = { ...current, ...patch };
  return current;
}

/**
 * Load `familyos.config.json` beside the app, if it exists. A missing file is
 * not an error — it means an unconfigured install, which the setup screen
 * handles by asking for the two ids.
 */
export async function loadConfig(fetchImpl = globalThis.fetch, url = './familyos.config.json') {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) return current;
    const json = await res.json();
    return configure(json);
  } catch {
    return current;
  }
}

/** The two values a deployment needs, and the only two it can be given. */
export const DEPLOYMENT_KEYS = Object.freeze(['googleClientId', 'apiUrl']);

/** Where an in-app answer is kept, so it survives a redeploy of the site. */
const STORED = 'deployment.config';

/** Where the local-only switch is kept. Read at boot, before anything syncs. */
const LOCAL_ONLY = 'privacy.localOnly';

/**
 * Nothing leaves this device.
 *
 * A separate switch from "no deployment configured", because they are
 * different promises. Absence of configuration is an accident waiting to be
 * corrected — somebody pastes a URL into Settings and a household's records
 * start going to Google. This is a decision, and every path out of the
 * application checks it: sync, document upload, mail reading, and the unlock
 * key escrow.
 *
 * It is enforced in four places rather than one because there are four ways
 * out, and a single check at the top of the sync engine would leave three of
 * them open.
 */
export async function loadLocalOnly(db) {
  try {
    return configure({ localOnly: Boolean(await db.meta(LOCAL_ONLY, false)) });
  } catch {
    return current;
  }
}

export async function setLocalOnly(db, on) {
  await db.setMeta(LOCAL_ONLY, Boolean(on));
  return configure({ localOnly: Boolean(on) });
}

/**
 * Apply a deployment configured from inside the app.
 *
 * A hosted copy cannot be handed `familyos.config.json`: the file is not in
 * version control — deliberately, so a fork does not carry one family's
 * deployment — and a static host has nowhere else to put it. Without this a
 * published install could never be connected to a Google account at all, which
 * would make the whole backup half of FamilyOS unreachable to anyone who did
 * not build it themselves.
 *
 * Neither value is a secret. The OAuth client id is public by design, and the
 * Apps Script URL is useless without a token the script checks.
 */
export async function loadStoredConfig(db) {
  try {
    const stored = await db.meta(STORED, null);
    if (!stored) return current;
    return configure(Object.fromEntries(
      DEPLOYMENT_KEYS.filter((key) => stored[key]).map((key) => [key, String(stored[key]).trim()]),
    ));
  } catch {
    return current;
  }
}

/** Remember a deployment entered in Settings, and apply it now. */
export async function saveStoredConfig(db, patch) {
  const clean = Object.fromEntries(
    DEPLOYMENT_KEYS.map((key) => [key, String(patch[key] ?? '').trim()]),
  );
  await db.setMeta(STORED, clean);
  return configure(clean);
}

export function isConfigured(c = current) {
  return Boolean(c.googleClientId && c.apiUrl);
}
