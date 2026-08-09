/**
 * Every Google permission this application can ask for, in one place.
 *
 * ## Why this file exists
 *
 * The scopes were declared in four places — the browser's base list in
 * `core/config.js`, the mailbox sign-in in `sync/gmail.js`, the app-folder
 * scope in `security/escrow.js`, and the backend's own list in
 * `apps-script/appsscript.json` — and described in a fifth, `docs/SETUP.md`,
 * in prose. Prose drifts. By the time anyone asked "so which do I add?", the
 * setup document was telling them the browser never talks to Gmail, which had
 * stopped being true the moment a mailbox could be attached by signing in.
 *
 * So: declared once, imported by the code that asks for them, listed by the
 * screen that explains them, and checked by a test that the four lists still
 * agree. A registry that nothing reads is another thing to drift.
 *
 * ## The two consent surfaces, which are not the same thing
 *
 * **The browser's OAuth client.** What a person grants when they press a
 * button in this application. Configured on the OAuth consent screen in the
 * Cloud Console. `where: 'browser'` below.
 *
 * **The Apps Script deployment.** What the backend authorises *once*, as
 * itself, when it is first run. It comes from `appsscript.json` and is granted
 * on the "this app isn't verified" screen during deployment — not on the
 * consent screen, and not by family members. `where: 'backend'` below.
 *
 * Conflating the two is the reason somebody adds a scope in the console and
 * nothing changes.
 */

const AUTH = 'https://www.googleapis.com/auth/';

/**
 * @typedef {{id: string, where: 'browser'|'backend', required: boolean,
 *            title: string, why: string, without: string}} Scope
 */

/** @type {Scope[]} */
export const SCOPES = Object.freeze([
  {
    id: 'openid',
    where: 'browser',
    required: true,
    title: 'Sign in',
    why: 'Proves which Google account is asking. Nothing more.',
    without: 'Nothing can sync, because the backend cannot tell who is calling.',
  },
  {
    id: 'email',
    where: 'browser',
    required: true,
    title: 'Your email address',
    why: 'The backend admits accounts by address, and mailboxes are named by one.',
    without: 'Sync is refused — the backend cannot match you against its list.',
  },
  {
    id: 'profile',
    where: 'browser',
    required: false,
    title: 'Your name and picture',
    why: 'Shown in the corner of the app. Cosmetic.',
    without: 'The account shows as an address rather than a name.',
  },
  {
    id: `${AUTH}drive.file`,
    where: 'browser',
    required: false,
    title: 'Files this app creates in your Drive',
    why: 'Only for Continue with Google, which keeps the unlock key in a file of '
      + 'its own. Documents you upload do not need it — those go through the '
      + 'Apps Script backend, under the backend’s own permission. Narrow either '
      + 'way: it cannot see anything else in your Drive.',
    without: 'Continue with Google is not offered. Everything else is unaffected.',
  },
  {
    id: `${AUTH}drive.appdata`,
    where: 'browser',
    required: false,
    title: 'A hidden folder of its own',
    why: 'Tidier home for the unlock key. Optional: without it the key goes in '
      + 'an ordinary visible file, which works identically.',
    without: 'The unlock key is a visible file in your Drive instead. Nothing breaks.',
  },
  {
    id: `${AUTH}gmail.readonly`,
    where: 'browser',
    required: false,
    title: 'Read your mail',
    why: 'Only if you attach a mailbox with “Add a Gmail account” in Shops. '
      + 'Asked for separately, per mailbox, never at ordinary sign-in.',
    without: 'Shops can still read mail through an Apps Script deployment instead.',
  },

  /* --------------------------------------------------------------- backend */

  {
    id: `${AUTH}spreadsheets`,
    where: 'backend',
    required: true,
    title: 'Your spreadsheets',
    why: 'The backend writes the backup workbook.',
    without: 'The backend cannot store anything.',
  },
  {
    id: `${AUTH}drive.file`,
    where: 'backend',
    required: true,
    title: 'Files it creates in your Drive',
    why: 'Document folders, uploads, and the OCR conversion.',
    without: 'Documents cannot be uploaded or read.',
  },
  {
    id: `${AUTH}script.external_request`,
    where: 'backend',
    required: true,
    title: 'Make network requests',
    why: 'Verifies your access token with Google before answering anything.',
    without: 'The backend cannot check who is calling, so it answers nobody.',
  },
  {
    id: `${AUTH}userinfo.email`,
    where: 'backend',
    required: true,
    title: 'The address it runs as',
    why: 'Compares the caller against the account that deployed it.',
    without: 'Every request is refused.',
  },
  {
    id: `${AUTH}gmail.readonly`,
    where: 'backend',
    required: false,
    title: 'Read the mail of the account that deployed it',
    why: 'Only if you kept `Gmail.gs`. Delete that file and this scope to opt out.',
    without: 'Shops reads mail by signing in from the browser instead.',
  },
]);

const of = (where) => SCOPES.filter((scope) => scope.where === where);

/**
 * The scopes an ordinary sign-in asks for: who you are, and nothing else.
 *
 * This used to include `spreadsheets` and `drive.file`, and it should not
 * have. The browser never calls the Sheets API — every sheet this application
 * writes is written by the Apps Script backend, under the backend's own
 * authorisation, from its own manifest. The browser's token was being used
 * only to prove which account was asking, and `spreadsheets` is a *sensitive*
 * scope covering every spreadsheet a person owns.
 *
 * Asking for a permission and never using it is the plainest possible breach
 * of "request the narrowest scope that does the job", and it is the first
 * thing an OAuth verification review looks for.
 *
 * `drive.file` moved out for the same reason with a smaller blast radius: only
 * Continue with Google needs it, so only that button asks for it.
 */
export const BASE_SCOPES = Object.freeze(
  of('browser').filter((scope) => scope.required).map((scope) => scope.id)
    // Cosmetic and long-standing: the name in the corner of the app.
    .concat('profile'),
);

/** Identity, plus the one file the unlock key lives in. */
export const UNLOCK_SCOPES = Object.freeze([
  ...BASE_SCOPES, `${AUTH}drive.file`, `${AUTH}drive.appdata`,
]);

/** Identity only: proves who is asking and nothing else. */
export const IDENTITY_SCOPES = Object.freeze(['openid', 'email']);

export const APPDATA_SCOPE = `${AUTH}drive.appdata`;
export const GMAIL_SCOPE = `${AUTH}gmail.readonly`;

/** Identity plus the mail itself, for a mailbox attached by signing in. */
export const MAIL_SCOPES = Object.freeze([...IDENTITY_SCOPES, GMAIL_SCOPE]);

/**
 * What to put on the OAuth consent screen, and what each is for.
 *
 * `required` first, because that is the list somebody needs before anything
 * works; the optional ones each buy one named feature.
 */
export function consentScreen() {
  const browser = of('browser');
  return {
    required: browser.filter((scope) => scope.required),
    optional: browser.filter((scope) => !scope.required),
  };
}

/** What the Apps Script deployment authorises as itself. */
export function backendScopes() {
  return of('backend');
}
